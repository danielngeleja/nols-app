import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { generateBookingTicketPdf } from "../lib/pdfDocuments.js";
import { generateBookingPDF } from "../lib/pdfGenerator.js";
import { signPublicInvoiceAccessToken } from "../lib/publicInvoiceAccess.js";
import { computeDraftBookingAvailability } from "../lib/draftBookingAvailability.js";
import { buildPropertySlug } from "../lib/publicPropertyDto.js";
import { mapPropertyLifecycle } from "../lib/serviceLifecycle.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

/** Hours an unpaid booking draft stays payable before it flips to EXPIRED.
 *  Mirrors PAYMENT_ACCESS_TOKEN_HOURS used for tour-package drafts. */
const BOOKING_DRAFT_WINDOW_HOURS = 12;

function buildPhoneVariants(phoneRaw: string | null | undefined): string[] {
  const raw = String(phoneRaw ?? "").trim();
  if (!raw) return [];

  const compact = raw.replace(/\s+/g, "").replace(/-/g, "");
  const noPlus = compact.replace(/^\+/, "");
  const digitsOnly = noPlus.replace(/\D+/g, "");

  const variants = new Set<string>([raw, compact, noPlus]);
  if (digitsOnly) variants.add(digitsOnly);

  // Tanzania-friendly normalization: 0XXXXXXXXX <-> 255XXXXXXXXX
  if (digitsOnly.length === 9) {
    variants.add("0" + digitsOnly);
    variants.add("255" + digitsOnly);
    variants.add("+255" + digitsOnly);
  }

  if (digitsOnly.startsWith("0") && digitsOnly.length === 10) {
    const t = "255" + digitsOnly.slice(1);
    variants.add(t);
    variants.add("+" + t);
  }

  if (digitsOnly.startsWith("255") && digitsOnly.length === 12) {
    variants.add(digitsOnly);
    variants.add("+" + digitsOnly);
    variants.add("0" + digitsOnly.slice(3));
  }

  return Array.from(variants).filter(Boolean);
}

async function getUserContact(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true, email: true },
  });
  return { id: userId, phone: user?.phone ?? null, email: user?.email ?? null };
}

function getTail9Digits(phoneRaw: string | null | undefined): string | null {
  const raw = String(phoneRaw ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

async function findLegacyBookingIdsByPhoneTail(tail9: string): Promise<number[]> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM \`booking\`
      WHERE \`userId\` IS NULL
        AND \`guestPhone\` IS NOT NULL
        AND RIGHT(REGEXP_REPLACE(\`guestPhone\`, '[^0-9]', ''), 9) = ${tail9}
    `;

    return rows.map((r: { id: number }) => r.id);
  } catch (error) {
    // If the DB doesn't support REGEXP_REPLACE (older MySQL), try a best-effort fallback
    // that strips the most common separators.
    try {
      const rows = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM \`booking\`
        WHERE \`userId\` IS NULL
          AND \`guestPhone\` IS NOT NULL
          AND RIGHT(
            REPLACE(REPLACE(REPLACE(REPLACE(\`guestPhone\`, ' ', ''), '-', ''), '+', ''), '\\t', ''),
            9
          ) = ${tail9}
      `;

      return rows.map((r: { id: number }) => r.id);
    } catch (fallbackError) {
      console.warn(
        "Legacy phone match query failed; falling back to userId-only.",
        error,
        fallbackError
      );
      return [];
    }
  }
}

function buildCustomerBookingWhere(user: { id: number }, legacyBookingIds: number[]) {
  const or: any[] = [{ userId: user.id }];
  if (legacyBookingIds.length) {
    or.push({ id: { in: legacyBookingIds } });
  }
  return { OR: or };
}

/**
 * GET /api/customer/bookings
 * Get all bookings for the authenticated customer
 * Query params: status, page, pageSize, paidOnly, activeDraftsOnly
 */
router.get("/", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { status, page = "1", pageSize = "20", paidOnly, activeDraftsOnly } = req.query as any;
    // paidOnly=1 → exclude unpaid drafts (used by dashboards that count confirmed stays only).
    const excludeDrafts = String(paidOnly ?? "") === "1" || String(paidOnly ?? "").toLowerCase() === "true";
    // activeDraftsOnly=1 keeps payable drafts in summary counts but removes them as
    // soon as their 12 hour payment window closes. The full Bookings page omits this
    // flag so expired drafts remain available there during the seven day grace period.
    const excludeExpiredDrafts =
      String(activeDraftsOnly ?? "") === "1" ||
      String(activeDraftsOnly ?? "").toLowerCase() === "true";
    const activeDraftCutoff = new Date(
      Date.now() - BOOKING_DRAFT_WINDOW_HOURS * 60 * 60 * 1000
    );

    const userContact = await getUserContact(userId);

    const tail9 = getTail9Digits(userContact.phone);
    const legacyBookingIds = tail9 ? await findLegacyBookingIdsByPhoneTail(tail9) : [];

    // Two kinds of rows are shown:
    //  - Paid/active stays: CONFIRMED/CHECKED_IN/CHECKED_OUT with a check-in code.
    //  - Drafts: NEW bookings that reached checkout (have an invoice) but are not yet paid.
    //    These get a 12h payment window and surface in the "Draft" tab.
    const where: any = {
      AND: [
        buildCustomerBookingWhere({ id: userId }, legacyBookingIds),
        {
          OR: [
            {
              status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
              code: { isNot: null },
            },
            {
              status: "NEW",
              invoices: { some: {} },
              ...(excludeExpiredDrafts
                ? {
                    OR: [
                      { createdAt: { gte: activeDraftCutoff } },
                      { invoices: { some: { status: "PAID" } } },
                      {
                        invoices: {
                          some: {
                            status: "CUSTOMER_PAID",
                            receiptNumber: { not: null },
                          },
                        },
                      },
                    ],
                  }
                : {}),
            },
          ],
        },
      ],
    };

    if (status) {
      // Explicit status filter (e.g. admin/legacy callers): keep the strict
      // paid-stay semantics and skip the draft branch.
      where.AND = where.AND.filter((clause: any) => !clause.OR);
      where.AND.push({ status: String(status) }, { code: { isNot: null } });
    } else if (excludeDrafts) {
      // Confirmed stays only — drop the draft branch from the OR.
      where.AND = where.AND.filter((clause: any) => !clause.OR);
      where.AND.push(
        { status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] } },
        { code: { isNot: null } }
      );
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const pageSizeNum = Math.min(50, Math.max(1, Number(pageSize) || 20));
    const skip = (pageNum - 1) * pageSizeNum;

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          property: {
            select: {
              id: true,
              title: true,
              type: true,
              regionName: true,
              district: true,
              city: true,
              status: true,
              roomsSpec: true,
              totalBedrooms: true,
            },
          },
          code: {
            select: {
              id: true,
              code: true,
              status: true,
              generatedAt: true,
              issuedAt: true,
            },
          },
          invoices: {
            select: {
              id: true,
              invoiceNumber: true,
              receiptNumber: true,
              status: true,
              total: true,
              netPayable: true,
              paidAt: true,
            },
            take: 1,
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSizeNum,
      }),
      prisma.booking.count({ where }),
    ]);

    // Calculate if bookings are valid (not expired)
    const now = new Date();
    type BookingRow = (typeof bookings)[number];
    const bookingsWithValidity = await Promise.all(bookings.map(async (booking: BookingRow) => {
      const checkOut = new Date(booking.checkOut);
      const isValid = checkOut >= now && booking.status !== "CANCELED";
      const invoice = booking.invoices?.[0] || null;
      const isPaid =
        invoice?.status === "PAID" ||
        (invoice?.status === "CUSTOMER_PAID" && Boolean(invoice?.receiptNumber));

      // A NEW booking with an unpaid invoice is a "draft" — payable for a fixed
      // window (mirrors tour-package drafts), after which it shows as EXPIRED.
      const isDraft = booking.status === "NEW" && !isPaid;
      const dashboardBucket = isDraft ? "DRAFT" : "PAID";

      let draftExpiresAt: string | null = null;
      let draftExpiryStatus: "ACTIVE" | "EXPIRED" | null = null;
      let invoiceId: number | null = null;
      let invoiceAccessToken: string | null = null;

      if (isDraft) {
        const createdAtMs = new Date(booking.createdAt).getTime();
        const expiresAtMs = createdAtMs + BOOKING_DRAFT_WINDOW_HOURS * 60 * 60 * 1000;
        draftExpiresAt = new Date(expiresAtMs).toISOString();
        draftExpiryStatus = now.getTime() < expiresAtMs ? "ACTIVE" : "EXPIRED";

        // Only mint a payment-resume token while the draft is still payable.
        if (draftExpiryStatus === "ACTIVE" && invoice?.id) {
          invoiceId = invoice.id;
          try {
            invoiceAccessToken = signPublicInvoiceAccessToken(invoice.id, booking.id);
          } catch {
            invoiceAccessToken = null;
          }
        }
      }

      const draftAvailability = isDraft
        ? await computeDraftBookingAvailability(booking, { excludeBookingId: booking.id })
        : null;

      const property = booking.property
        ? {
            id: booking.property.id,
            title: booking.property.title,
            type: booking.property.type,
            regionName: booking.property.regionName,
            district: booking.property.district,
            city: booking.property.city,
            slug: buildPropertySlug(String(booking.property.title || ""), Number(booking.property.id)),
          }
        : null;

      return {
        id: booking.id,
        property,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        status: booking.status,
        totalAmount: booking.totalAmount,
        roomType: (booking as any).roomType || booking.roomCode || null,
        rooms: (booking as any).rooms || 1,
        services: (booking as any).services || null,
        isValid,
        isPaid,
        bookingCode: booking.code?.code || null,
        codeStatus: booking.code?.status || null,
        invoice: invoice,
        dashboardBucket,
        draftExpiresAt,
        draftExpiryStatus,
        invoiceId,
        invoiceAccessToken,
        draftAvailability,
        lifecycle: mapPropertyLifecycle({
          bookingStatus: booking.status,
          invoiceStatus: invoice?.status,
          hasInvoice: Boolean(invoice),
          receiptNumber: invoice?.receiptNumber,
          checkInCodeStatus: booking.code?.status,
          draftExpired: draftExpiryStatus === "EXPIRED",
          cancellationLoaded: false,
        }),
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      };
    }));

    return res.json({
      items: bookingsWithValidity,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (error: any) {
    console.error("GET /customer/bookings error:", error);
    return res.status(500).json({ error: "Failed to fetch bookings" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/bookings/property-slugs
 * Returns the derived slugs of all properties the user has a confirmed/paid booking for.
 * Used by the public listing to show a "Booked" badge on previously-booked properties.
 */
router.get("/property-slugs", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const userContact = await getUserContact(userId);
    const tail9 = getTail9Digits(userContact.phone);
    const legacyBookingIds = tail9 ? await findLegacyBookingIdsByPhoneTail(tail9) : [];

    const bookings = await prisma.booking.findMany({
      where: {
        AND: [
          buildCustomerBookingWhere({ id: userId }, legacyBookingIds),
          { status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] } },
          { code: { isNot: null } },
        ],
      },
      select: {
        property: { select: { id: true, title: true } },
      },
    });

    // Derive slug the same way publicPropertyDto does: slugify(title) + "-" + id
    function slugify(s: string) {
      return String(s || "").toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
    }
    const slugs = Array.from(
      new Set(bookings.map((b) => {
        const base = slugify(b.property.title);
        return base ? `${base}-${b.property.id}` : String(b.property.id);
      }))
    );

    res.json({ slugs });
  } catch (err) {
    console.error("GET /api/customer/bookings/property-slugs error:", err);
    res.status(500).json({ error: "Failed to load booked properties" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/bookings/:id
 * Get detailed booking information including full details
 */
router.get("/:id", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const bookingId = Number(req.params.id);

    const userContact = await getUserContact(userId);

    const tail9 = getTail9Digits(userContact.phone);
    const legacyBookingIds = tail9 ? await findLegacyBookingIdsByPhoneTail(tail9) : [];

    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...buildCustomerBookingWhere({ id: userId }, legacyBookingIds),
        // A check-in code only exists after payment, so `code` already gates this to
        // paid bookings. Don't restrict to a narrow status set — a paid booking whose
        // status wasn't flipped to CONFIRMED (e.g. a missed webhook) must still resolve.
        status: { notIn: ["CANCELED"] },
        code: { isNot: null },
      },
      include: {
        property: {
          include: {
            owner: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        code: true,
        invoices: {
          take: 1,
          orderBy: { createdAt: "desc" },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Calculate validity
    const now = new Date();
    const checkOut = new Date(booking.checkOut);
    const isValid = checkOut >= now && booking.status !== "CANCELED";
    const invoice = (booking as any).invoices?.[0] || null;
    const isPaid =
      invoice?.status === "PAID" ||
      (invoice?.status === "CUSTOMER_PAID" && Boolean((invoice as any)?.receiptNumber));

    return res.json({
      ...booking,
      isValid,
      isPaid,
    });
  } catch (error: any) {
    console.error("GET /customer/bookings/:id error:", error);
    return res.status(500).json({ error: "Failed to fetch booking" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/bookings/:id/pdf
 * Generate and download PDF reservation form for a booking
 */
router.get("/:id/pdf", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const bookingId = Number(req.params.id);

    const userContact = await getUserContact(userId);

    const tail9 = getTail9Digits(userContact.phone);
    const legacyBookingIds = tail9 ? await findLegacyBookingIdsByPhoneTail(tail9) : [];

    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...buildCustomerBookingWhere({ id: userId }, legacyBookingIds),
        // A check-in code only exists after payment, so `code` already gates this to
        // paid bookings. Don't restrict to a narrow status set — a paid booking whose
        // status wasn't flipped to CONFIRMED (e.g. a missed webhook) must still resolve.
        status: { notIn: ["CANCELED"] },
        code: { isNot: null },
      },
      include: {
        property: true,
        code: true,
        user: {
          select: {
            name: true,
            phone: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Allow generating PDF for both valid and expired bookings as long as a booking code exists.
    // (Expired means after checkout; code may have been USED.)
    if (!booking.code?.codeVisible) {
      return res.status(400).json({ error: "Booking code not available" });
    }

    // Prepare booking details for PDF
    const bookingDetails = {
      bookingId: booking.id,
      bookingCode: booking.code!.codeVisible,
      guestName: booking.guestName || booking.user?.name || "Guest",
      guestPhone: booking.guestPhone || booking.user?.phone || undefined,
      propertyName: booking.property?.title || "Property",
      propertyLocation: [booking.property?.regionName, booking.property?.district, booking.property?.city]
        .filter(Boolean).join(", ") || null,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      rooms: booking.roomsQty ?? 1,
      totalAmount: Number(booking.totalAmount || 0),
      confirmedAt: (booking as any).confirmedAt ?? null,
    };

    const nights = Math.max(1, Math.ceil(
      (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86400000
    ));
    const codeVisible = booking.code!.codeVisible;
    const propertySlug = (booking.property?.title ?? "booking").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    const filename = `Reservation-${codeVisible}-${propertySlug}.pdf`;

    // Generate real binary PDF using pdfkit (no browser print dialog needed)
    const pdfBuffer = await generateBookingTicketPdf({ ...bookingDetails, nights } as any);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    return res.send(pdfBuffer);
  } catch (error: any) {
    console.error("GET /customer/bookings/:id/pdf error:", error);
    return res.status(500).json({ error: "Failed to generate PDF" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/bookings/:id/receipt.html
 * Returns the same HTML receipt the admin sees — rendered client-side to PDF via html2pdf.js.
 */
router.get("/:id/receipt.html", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const bookingId = Number(req.params.id);
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const userContact = await getUserContact(userId);
    const tail9 = getTail9Digits(userContact.phone);
    const legacyBookingIds = tail9 ? await findLegacyBookingIdsByPhoneTail(tail9) : [];

    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...buildCustomerBookingWhere({ id: userId }, legacyBookingIds),
        // A check-in code only exists after payment, so `code` already gates this to
        // paid bookings. Don't restrict to a narrow status set — a paid booking whose
        // status wasn't flipped to CONFIRMED (e.g. a missed webhook) must still resolve.
        status: { notIn: ["CANCELED"] },
        code: { isNot: null },
      },
      include: {
        property: true,
        code: true,
        user: { select: { name: true, phone: true } },
        invoices: {
          select: { invoiceNumber: true, receiptNumber: true, paidAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (!booking.code?.codeVisible) return res.status(400).json({ error: "Booking code not available" });

    const inv: any = (booking as any).invoices?.[0] ?? null;
    const nights = Math.max(1, Math.ceil(
      (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86400000
    ));

    const bookingDetails: any = {
      bookingId: booking.id,
      bookingCode: booking.code.codeVisible,
      guestName: booking.guestName || booking.user?.name || "Guest",
      guestPhone: booking.guestPhone || booking.user?.phone || undefined,
      property: {
        title: booking.property?.title || "Property",
        type: (booking.property as any)?.type || "Property",
        regionName: booking.property?.regionName || undefined,
        district: booking.property?.district || undefined,
        city: booking.property?.city || undefined,
        country: booking.property?.country || "Tanzania",
      },
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      roomType: (booking as any).roomType || (booking as any).roomCode || undefined,
      rooms: (booking as any).roomsQty || undefined,
      nights,
      totalAmount: Number(booking.totalAmount || 0),
      invoice: inv ? {
        invoiceNumber: inv.invoiceNumber || undefined,
        receiptNumber: inv.receiptNumber || undefined,
        paidAt: inv.paidAt || undefined,
      } : undefined,
    };

    const { html } = await generateBookingPDF(bookingDetails);
    if (!html) return res.status(500).json({ error: "Failed to generate receipt" });

    const codeVisible = booking.code.codeVisible;
    const safeFilename = `Booking Reservation - ${codeVisible}.pdf`.replace(/"/g, '\\"');
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${safeFilename}"`);
    res.setHeader("X-NoLSAF-Filename", safeFilename);
    return res.send(html);
  } catch (error: any) {
    console.error("GET /customer/bookings/:id/receipt.html error:", error);
    return res.status(500).json({ error: "Failed to generate receipt" });
  }
}) as RequestHandler);

// Get authenticated user's booking count for a specific property
router.get("/property/:propertyId/my-count", (async (req, res) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.id) return res.status(401).json({ error: "unauthorized" });

    const propertyId = parseInt(req.params.propertyId, 10);
    if (isNaN(propertyId)) return res.status(400).json({ error: "invalid_property_id" });

    const { phone, email } = await getUserContact(user.id);
    const phoneVariants = buildPhoneVariants(phone);

    const count = await prisma.booking.count({
      where: {
        propertyId,
        status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
        code: { isNot: null },
        OR: [
          { userId: user.id },
          ...(email ? [{ guestEmail: email }] : []),
          ...(phoneVariants.length > 0 ? [{ guestPhone: { in: phoneVariants } }] : []),
        ],
      },
    });

    return res.json({ count });
  } catch (error: any) {
    console.error("GET /customer/bookings/property/:propertyId/my-count error:", error);
    return res.status(500).json({ error: "server_error" });
  }
}) as RequestHandler);

export default router;
