// apps/api/src/routes/admin.bookings.ts
import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import type { RequestHandler } from 'express';
import { generateReadableCode, hashCode } from "../lib/codes";
import { audit } from "../lib/audit";
import { invalidateOwnerReports } from "../lib/cache";
import { sendMail, type MailAttachment } from "../lib/mailer.js";
import { getBookingConfirmedEmail, getBookingCancelledEmail } from "../lib/bookingEmailTemplates.js";
import { generateBookingTicketPdf } from "../lib/pdfDocuments.js";
import { mapPropertyLifecycle } from "../lib/serviceLifecycle.js";
import {
  confirmNoLsafBooking,
  NoLsafInventoryConflictError,
  syncNoLsafBookingToNrms,
  updateNoLsafBookingStatus,
} from "../lib/nolsafMarketplaceNrms.js";
import { findUnitConflicts, getRoomTypeAvailability, lockPropertyInventory } from "../lib/nrmsAvailability.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

/** Hours an unpaid booking draft stays payable before it flips to EXPIRED.
 *  Mirrors BOOKING_DRAFT_WINDOW_HOURS in customer.bookings.ts / PAYMENT_ACCESS_TOKEN_HOURS. */
const BOOKING_DRAFT_WINDOW_HOURS = 12;

/* ----------------------------- Utilities ------------------------------ */

type ConfirmAndCodeResult =
  | { error: string; status: number }
  | { bookingId: number; codeVisible: string };

async function idempotentConfirmAndCode(tx: typeof prisma, bookingId: number): Promise<ConfirmAndCodeResult> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: { code: true, property: true, invoices: { select: { status: true, receiptNumber: true } } },
  });
  if (!booking) return { error: "Booking not found", status: 404 as const };

  // Payment gate: never manually confirm / issue a code for an unpaid booking.
  // The check-in code is issued automatically by the payment webhook once an
  // invoice is PAID. A NEW booking with no paid invoice is an unpaid "draft" and
  // confirming it here would bypass payment. The only legitimate manual case is a
  // paid booking whose status wasn't flipped (webhook miss) — allowed below.
  const hasPaidInvoice = (booking.invoices ?? []).some((inv: any) => {
    const s = String(inv?.status ?? "").toUpperCase();
    return s === "PAID" || (s === "CUSTOMER_PAID" && Boolean(inv?.receiptNumber));
  });
  const alreadyReal = ["CONFIRMED", "CHECKED_IN", "PENDING_CHECKIN", "CHECKED_OUT"].includes(
    String(booking.status || "").toUpperCase()
  );
  if (!alreadyReal && !hasPaidInvoice) {
    return {
      error:
        "Cannot confirm an unpaid booking. The check-in code is generated automatically once payment is completed.",
      status: 409 as const,
    };
  }

  // Confirm under the shared property inventory lock and create/update the
  // linked NRMS operational reservation. Existing real lifecycle states are
  // preserved instead of being downgraded to CONFIRMED.
  await confirmNoLsafBooking(tx, bookingId);

  // If code already exists, return it (idempotent)
  if (booking.code) {
    return { bookingId, codeVisible: booking.code.codeVisible };
  }

  // Create new single-use code (store hash + visible copy for UI/notification)
  const visible = generateReadableCode(8); // e.g. ABCD9F3A (no ambiguous chars)
  const hashed = hashCode(visible);
  const created = await tx.checkinCode.create({
    data: {
      bookingId,
      codeHash: hashed,
      codeVisible: visible,
      status: "ACTIVE",
      generatedAt: new Date(),
    },
  });

  return { bookingId, codeVisible: created.codeVisible };
}

/* ------------------------------ Listings ------------------------------ */

/**
 * GET /admin/bookings
 * Query: date=YYYY-MM-DD OR start=YYYY-MM-DD&end=YYYY-MM-DD
 *        &status=&propertyId=&ownerId=&userId=&q=&page=&pageSize=
 */
router.get("/", async (req, res) => {
  const { date, start, end, status, propertyId, ownerId, userId, q, page = "1", pageSize = "30" } = req.query as any;

  const where: any = {};
  const hasStatusFilter = typeof status === "string" && status.trim().length > 0;
  if (hasStatusFilter) {
    // Draft = a created-but-unpaid invoice: the checkout reached the invoice stage
    // (status still NEW, no check-in code) but no payment has cleared. These mirror
    // the tour-revenue "Draft" bucket and are otherwise hidden from admin lists.
    if (status === 'DRAFT') {
      where.status = 'NEW';
      where.invoices = { some: {}, none: { status: { in: ['PAID', 'CUSTOMER_PAID'] } } };
    } else if (status === 'CHECKED_IN') {
      // When filtering by CHECKED_IN, include PENDING_CHECKIN as well (matches frontend count display)
      where.status = { in: ['CHECKED_IN', 'PENDING_CHECKIN'] };
    } else {
      where.status = status;
    }
  } else {
    // "All" = every meaningful booking across all statuses (the union of all tabs):
    // real bookings (CONFIRMED / CHECKED_IN / PENDING_CHECKIN / CHECKED_OUT / CANCELED)
    // PLUS unpaid drafts (NEW with a created-but-unpaid invoice).
    // Abandoned NEW holds with no invoice at all stay hidden.
    where.AND = [
      {
        OR: [
          { status: { in: ["CONFIRMED", "CHECKED_IN", "PENDING_CHECKIN", "CHECKED_OUT", "CANCELED"] } },
          { status: "NEW", invoices: { some: {}, none: { status: { in: ["PAID", "CUSTOMER_PAID"] } } } },
        ],
      },
    ];
  }
  if (propertyId) where.propertyId = Number(propertyId);
  if (ownerId) where.property = { is: { ownerId: Number(ownerId) } };
  if (userId) where.userId = Number(userId);

  // Date filtering
  // - date=YYYY-MM-DD filters to bookings overlapping that day
  // - start/end filters to bookings overlapping the inclusive range
  if (date) {
    const d = new Date(String(date));
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: "Invalid date" });
    }
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    where.AND = [...(where.AND || []), { checkIn: { lt: next } }, { checkOut: { gt: d } }];
  } else if (start || end) {
    const s = start ? new Date(String(start) + "T00:00:00.000Z") : new Date(0);
    const e = end ? new Date(String(end) + "T00:00:00.000Z") : new Date();
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      return res.status(400).json({ error: "Invalid start/end" });
    }
    // inclusive end-day: checkIn < (end + 1 day)
    const endExclusive = new Date(e);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    where.AND = [...(where.AND || []), { checkIn: { lt: endExclusive } }, { checkOut: { gt: s } }];
  }

  // MySQL doesn't support `mode: "insensitive"`; default collations are typically case-insensitive.
  const search = typeof q === 'string' ? q.trim().slice(0, 120) : '';
  if (search) {
    where.OR = [
      { guestName: { contains: search } },
      { property: { is: { title: { contains: search } } } },
      { code: { is: { codeVisible: { contains: search } } } },
      { user: { is: { email: { contains: search } } } },
    ];
  }

  const skip = (Number(page) - 1) * Number(pageSize);
  const take = Math.min(Number(pageSize), 100);

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: {
        property: { 
          select: { 
            id: true, 
            title: true, 
            ownerId: true,
            regionName: true,
            city: true,
            owner: { select: { id: true, name: true, email: true } }
          } 
        },
        code: { 
          select: { 
            id: true, 
            codeVisible: true, 
            status: true,
            generatedAt: true,
            usedAt: true,
            usedByOwner: true
          } 
        },
        user: { select: { id: true, name: true, email: true, phone: true } },
        invoices: {
          select: {
            id: true,
            status: true,
            total: true,
            paidAt: true,
            createdAt: true,
            updatedAt: true,
            paymentEvents: {
              where: { status: 'SUCCESS' },
              select: { amount: true, currency: true, status: true, provider: true, createdAt: true, updatedAt: true },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { id: 'desc' },
          take: 1,
        },
        reviews: {
          select: { id: true, rating: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        cancellationRequests: {
          select: {
            id: true,
            reason: true,
            createdAt: true,
            status: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1, // Get the most recent cancellation request
        },
      },
      orderBy: { id: "desc" },
      skip,
      take,
    }),
    prisma.booking.count({ where }),
  ]);

  const response = {
    total,
    page: Number(page),
    pageSize: take,
    items: items.map((b: any) => {
      const latestCancellation = b.cancellationRequests && b.cancellationRequests.length > 0 
        ? b.cancellationRequests[0] 
        : null;
      const latestInvoice = Array.isArray(b.invoices) && b.invoices.length > 0 ? b.invoices[0] : null;
      const latestReview = Array.isArray(b.reviews) && b.reviews.length > 0 ? b.reviews[0] : null;

      const paymentEvents = Array.isArray(latestInvoice?.paymentEvents) ? latestInvoice.paymentEvents : [];
      const paidTotal = paymentEvents.reduce((sum: number, ev: any) => sum + Number(ev?.amount ?? 0), 0);
      const paidAtFromEvent =
        paymentEvents.length > 0
          ? paymentEvents
              .map((ev: any) => ev?.updatedAt ?? ev?.createdAt ?? null)
              .filter((d: any) => d)
              .sort((a: any, b: any) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
          : null;
      const invoiceStatus = String(latestInvoice?.status ?? '').toUpperCase();

      // Draft payment window: a NEW booking with a created-but-unpaid invoice is
      // payable for BOOKING_DRAFT_WINDOW_HOURS from creation, then it EXPIRES.
      const isPaidInvoice = invoiceStatus === 'PAID' || invoiceStatus === 'CUSTOMER_PAID';
      const isDraft = String(b.status ?? '').toUpperCase() === 'NEW' && !!latestInvoice && !isPaidInvoice;
      let draftExpiresAt: string | null = null;
      let draftExpiryStatus: 'ACTIVE' | 'EXPIRED' | null = null;
      if (isDraft && b.createdAt) {
        const expiresMs = new Date(b.createdAt).getTime() + BOOKING_DRAFT_WINDOW_HOURS * 60 * 60 * 1000;
        draftExpiresAt = new Date(expiresMs).toISOString();
        draftExpiryStatus = Date.now() < expiresMs ? 'ACTIVE' : 'EXPIRED';
      }

      const paymentSummary = {
        amount:
          Number.isFinite(paidTotal) && paidTotal > 0
            ? paidTotal
            : invoiceStatus === 'PAID'
              ? (latestInvoice?.total ?? null)
              : null,
        method: paymentEvents.length > 0
          ? (paymentEvents[0].provider ?? null)
          : (latestInvoice?.paymentMethod ?? null),
        paidAt:
          paidAtFromEvent ??
          latestInvoice?.paidAt ??
          (invoiceStatus === 'PAID' ? (latestInvoice?.updatedAt ?? latestInvoice?.createdAt ?? null) : null),
      };
      
      return {
      id: b.id,
      status: b.status,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
        guestName: b.guestName ?? null,
        guestPhone: b.guestPhone ?? null,
        sex: b.sex ?? null,
        nationality: b.nationality ?? null,
        roomCode: b.roomCode ?? null,
      totalAmount: b.totalAmount,
        cancelReason: latestCancellation?.reason ?? null,
        canceledAt: latestCancellation?.createdAt ?? null,
      property: b.property,
        code: b.code ? { 
          id: b.code.id, 
          code: b.code.codeVisible, 
          status: b.code.status,
          generatedAt: b.code.generatedAt,
          usedAt: b.code.usedAt,
          usedByOwner: b.code.usedByOwner
        } : null,
        invoice: latestInvoice
          ? {
              id: latestInvoice.id,
              status: latestInvoice.status,
              total: latestInvoice.total,
              paidAt: latestInvoice.paidAt,
              createdAt: latestInvoice.createdAt,
            }
          : null,
        payment: paymentSummary,
        review: latestReview,
        user: b.user,
        createdAt: b.createdAt,
        draftExpiresAt,
        draftExpiryStatus,
      };
    }),
  };
  
  res.json(response);
});

/**
 * GET /admin/bookings/counts
 * Query: start=YYYY-MM-DD&end=YYYY-MM-DD  (inclusive start, inclusive end)
 *        OR no params for simple status counts
 * Returns: { "2025-10-23": { total: 10, statuses: { NEW: 5, CONFIRMED: 3, CHECKED_IN: 2, ... } }, ... }
 *          OR { "NEW": 5, "CONFIRMED": 3, ... } if no date params
 */
router.get("/counts", async (req, res) => {
  try {
    const { start, end, month } = req.query as any;

    // If no date params, return simple status counts (exclude NEW - unpaid bookings are never visible to admin)
    if (!start && !end && !month) {
      const statuses = ["CONFIRMED", "CHECKED_IN", "PENDING_CHECKIN", "CHECKED_OUT", "CANCELED"];
      const counts: Record<string, number> = {};

      for (const status of statuses) {
        try {
          counts[status] = await prisma.booking.count({ where: { status } });
        } catch (e) {
          counts[status] = 0;
        }
      }

      // Draft = NEW bookings with a created-but-unpaid invoice (mirrors tour-revenue Draft).
      try {
        counts["DRAFT"] = await prisma.booking.count({
          where: {
            status: "NEW",
            invoices: { some: {}, none: { status: { in: ["PAID", "CUSTOMER_PAID"] } } },
          },
        });
      } catch (e) {
        counts["DRAFT"] = 0;
      }

      return res.json(counts);
    }

    let s: Date | null = null;
    let e: Date | null = null;
    if (month) {
      // month format YYYY-MM
      const [y, m] = String(month).split("-").map(Number);
      if (!y || isNaN(m)) return res.status(400).json({ error: "Invalid month" });
      s = new Date(y, m - 1, 1);
      e = new Date(y, m, 0); // last day
    } else if (start && end) {
      s = new Date(String(start));
      e = new Date(String(end));
    } else if (start) {
      s = new Date(String(start));
      e = new Date(s);
    } else {
      return res.status(400).json({ error: "start/end or month required" });
    }

  // normalize to local midnight
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);

  // Optimize by fetching all bookings that overlap the requested range once,
  // then aggregating per-day counts in-process. This avoids N * M DB count queries.
  // NEW (unpaid) bookings are excluded — only paid bookings are visible to admin.
  const bookings = await prisma.booking.findMany({
    where: {
      AND: [
        { checkIn: { lt: new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1) } },
        { checkOut: { gt: s } },
        { status: { notIn: ['NEW', 'VOID'] } },
      ],
    },
    select: { checkIn: true, checkOut: true, status: true },
  });

  const statuses = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELED"];
  const out: Record<string, { total: number; statuses: Record<string, number> }> = {};

  // initialize days
  for (let dt = new Date(s); dt <= e; dt.setDate(dt.getDate() + 1)) {
    const d = new Date(dt);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out[iso] = { total: 0, statuses: {} };
    for (const st of statuses) out[iso].statuses[st] = 0;
  }

  // accumulate: iterate bookings and mark each day in the intersection correctly
  for (const b of bookings) {
    const bStart = new Date(b.checkIn);
    const bEnd = new Date(b.checkOut);
    // floor booking start to its date
    const bStartDate = new Date(bStart.getFullYear(), bStart.getMonth(), bStart.getDate());
    // determine inclusive last-day for the booking
    let bEndInclusive = new Date(bEnd.getFullYear(), bEnd.getMonth(), bEnd.getDate());
    // if checkOut is exactly at midnight (00:00:00), the booking does NOT include that date
    if (bEnd.getHours() === 0 && bEnd.getMinutes() === 0 && bEnd.getSeconds() === 0 && bEnd.getMilliseconds() === 0) {
      bEndInclusive.setDate(bEndInclusive.getDate() - 1);
    }

    const start = bStartDate > s ? bStartDate : new Date(s);
    const end = bEndInclusive < e ? bEndInclusive : new Date(e);
    for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
      const d = new Date(dt);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!out[iso]) continue;
      out[iso].statuses[b.status] = (out[iso].statuses[b.status] ?? 0) + 1;
      out[iso].total += 1;
    }
  }

    res.json(out);
  } catch (err: any) {
    console.error('Error in GET /admin/bookings/counts:', err);
    res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

/** GET /admin/bookings/:id — full detail */
router.get("/:id", async (req, res) => {
  try {
  const id = Number(req.params.id);
  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
        property: { 
          select: {
            id: true,
            title: true,
            type: true,
            regionName: true,
            city: true,
            district: true,
            ward: true,
            country: true,
            owner: { select: { id: true, name: true, email: true, phone: true } }
          },
        },
        code: {
          select: {
            id: true,
            codeVisible: true,
            status: true,
            generatedAt: true,
            usedAt: true,
            usedByOwner: true,
          },
        },
        invoices: {
          select: {
            id: true,
            status: true,
            total: true,
            issuedAt: true,
            approvedAt: true,
            paidAt: true,
            invoiceNumber: true,
            receiptNumber: true,
          },
          orderBy: { issuedAt: 'desc' },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            createdAt: true,
          },
        },
        cancellationRequests: {
          select: {
            id: true,
            reason: true,
            createdAt: true,
            status: true,
            policyRefundPercent: true,
            policyEligible: true,
            policyRule: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        reviews: {
          select: {
            id: true,
            rating: true,
            title: true,
            comment: true,
            categoryRatings: true,
            isVerified: true,
            ownerResponse: true,
            ownerResponseAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
  });
  if (!b) return res.status(404).json({ error: "Booking not found" });
    
    // Transform the response to include cancellation info
    const latestCancellation = b.cancellationRequests && b.cancellationRequests.length > 0 
      ? b.cancellationRequests[0] 
      : null;
    
    const response: any = {
      ...b,
      cancelReason: latestCancellation?.reason ?? null,
      canceledAt: latestCancellation?.createdAt ?? null,
      cancelRefundPercent: latestCancellation?.policyRefundPercent ?? null,
      cancelPolicyEligible: latestCancellation?.policyEligible ?? false,
      cancelPolicyRule: latestCancellation?.policyRule ?? null,
      cancelStatus: latestCancellation?.status ?? null,
      lifecycle: mapPropertyLifecycle({
        bookingStatus: b.status,
        invoiceStatus: b.invoices?.[0]?.status,
        hasInvoice: Boolean(b.invoices?.[0]),
        receiptNumber: b.invoices?.[0]?.receiptNumber,
        checkInCodeStatus: b.code?.status,
        cancellationStatus: latestCancellation?.status,
        cancellationLoaded: true,
      }),
    };
    
    // Remove cancellationRequests from response to keep it clean
    delete response.cancellationRequests;
    
    res.json(response);
  } catch (err: any) {
    console.error('Error in GET /admin/bookings/:id:', err);
    res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

/* -------------------------- Confirm & Codes --------------------------- */

/**
 * POST /admin/bookings/:id/confirm
 * - Idempotently sets CONFIRMED
 * - Generates single-use code if missing
 * - Emits socket event for dashboards
 */
router.post("/:id/confirm", async (req, res) => {
  const id = Number(req.params.id);
  let result: Awaited<ReturnType<typeof idempotentConfirmAndCode>>;
  try {
    result = await prisma.$transaction(async (tx: any) => idempotentConfirmAndCode(tx, id));
  } catch (error) {
    if (error instanceof NoLsafInventoryConflictError) {
      return res.status(409).json({ error: "room_unavailable", code: error.code, message: error.message, availability: error.availability });
    }
    throw error;
  }

  if ("error" in result) return res.status(result.status).json({ error: result.error });

  // notify dashboards (Socket.io instance set at app.set('io', io))
  const io = req.app.get("io");
  if (io) io.emit("admin:code:generated", { bookingId: result.bookingId, code: result.codeVisible });

  // Send confirmation email to guest (best-effort, never blocks the response)
  try {
    const bFull = await prisma.booking.findUnique({
      where: { id: result.bookingId },
      include: {
        property: { select: { title: true } },
        user: { select: { name: true, email: true } },
      },
    });
    if (bFull?.user?.email) {
      const { subject, html } = getBookingConfirmedEmail({
        guestName: bFull.guestName || bFull.user.name || "Guest",
        propertyName: (bFull.property as any)?.title ?? "your property",
        bookingId: bFull.id,
        checkIn: bFull.checkIn,
        checkOut: bFull.checkOut,
        totalAmount: bFull.totalAmount as any,
        roomsQty: bFull.roomsQty,
        checkinCode: result.codeVisible,
      });
      let attachments: MailAttachment[] | undefined;
      try {
        const pdfBuf = await generateBookingTicketPdf({
          bookingId: bFull.id,
          bookingCode: result.codeVisible,
          guestName: bFull.guestName || (bFull.user as any).name || "Guest",
          propertyName: (bFull.property as any)?.title ?? "your property",
          checkIn: bFull.checkIn,
          checkOut: bFull.checkOut,
          rooms: bFull.roomsQty ?? 1,
          totalAmount: Number(bFull.totalAmount ?? 0),
          confirmedAt: new Date(),
        });
        attachments = [{ filename: `Booking-${result.codeVisible}.pdf`, content: pdfBuf }];
      } catch (pdfErr) {
        console.warn("[BOOKING_CONFIRM] PDF generation failed (email will still be sent):", pdfErr);
      }
      await sendMail(bFull.user.email, subject, html, attachments, { replyTo: "bookings@nolsaf.com" });
    }
  } catch (e) {
    console.warn("[BOOKING_CONFIRM] Email send failed:", e);
  }

  return res.json({ ok: true, code: result.codeVisible });
});

/** POST /admin/bookings/:id/checkin - mark as CHECKED_IN (admin observed) */
router.post("/:id/checkin", async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.booking.findUnique({ where: { id }, select: { status: true, propertyId: true } });
  if (!before) return res.status(404).json({ error: "Booking not found" });
  if (before.status === "CHECKED_IN") return res.status(400).json({ error: "Already checked in" });

  const updated = await prisma.$transaction((tx: any) => updateNoLsafBookingStatus(tx, id, "CHECKED_IN"));
  try { await audit(req, "BOOKING_CHECKIN", "BOOKING", before, { status: "CHECKED_IN" }); } catch {}
  try {
    const b = await prisma.booking.findUnique({ where: { id }, include: { property: true } as any });
    if (b && b.property && (b.property as any).ownerId) await invalidateOwnerReports((b.property as any).ownerId);
  } catch {}
  try { req.app.get("io")?.emit?.("admin:booking:status", { bookingId: id, from: before.status, to: "CHECKED_IN" }); } catch {}
  res.json({ ok: true, booking: updated });
});

/** POST /admin/bookings/:id/checkout - mark as CHECKED_OUT (admin observed) */
router.post("/:id/checkout", async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.booking.findUnique({ where: { id }, select: { status: true, propertyId: true } });
  if (!before) return res.status(404).json({ error: "Booking not found" });
  if (before.status === "CHECKED_OUT") return res.status(400).json({ error: "Already checked out" });

  const updated = await prisma.$transaction((tx: any) => updateNoLsafBookingStatus(tx, id, "CHECKED_OUT"));
  try { await audit(req, "BOOKING_CHECKOUT", "BOOKING", before, { status: "CHECKED_OUT" }); } catch {}
  try {
    const b = await prisma.booking.findUnique({ where: { id }, include: { property: true } as any });
    if (b && b.property && (b.property as any).ownerId) await invalidateOwnerReports((b.property as any).ownerId);
  } catch {}
  try { req.app.get("io")?.emit?.("admin:booking:status", { bookingId: id, from: before.status, to: "CHECKED_OUT" }); } catch {}
  res.json({ ok: true, booking: updated });
});

/**
 * GET /admin/bookings/:id/code
 * - Fetch code (if exists) + status
 */
router.get("/:id/code", async (req, res) => {
  const id = Number(req.params.id);
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { code: true, property: true, user: true },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  return res.json({
    bookingId: booking.id,
    status: booking.status,
    code: booking.code
      ? {
          id: booking.code.id,
          visible: booking.code.codeVisible,
          status: booking.code.status,
          generatedAt: booking.code.generatedAt,
          usedAt: booking.code.usedAt,
          usedByOwner: booking.code.usedByOwner,
        }
      : null,
  });
});

/**
 * POST /admin/bookings/validate-by-code { code }
 * Minimal admin-facing endpoint to validate a booking using a visible code.
 * Note: owner-facing validation should live in a public or owner-scoped route.
 */
router.post("/validate-by-code", async (req, res) => {
  const code = String(req.body?.code ?? "").trim();
  if (!code) return res.status(400).json({ error: "Code is required" });

  const c = await prisma.checkinCode.findFirst({
    where: { codeVisible: code },
    include: {
      booking: {
        include: {
          cancellationRequests: {
            select: { id: true, status: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!c) return res.status(404).json({ error: "Code not found" });

  if (c.status !== "ACTIVE") {
    let error = `Code not active (status=${c.status})`;
    let cancellationStatus: string | null = null;

    if (c.status === "VOID") {
      const latestCancellation = (c.booking as any)?.cancellationRequests?.[0] ?? null;
      cancellationStatus = latestCancellation?.status ?? null;

      if (latestCancellation) {
        switch (latestCancellation.status) {
          case "SUBMITTED":
          case "REVIEWING":
            error = "This booking has a cancellation request currently under review. The code has been suspended pending admin decision.";
            break;
          case "PROCESSING":
            error = "This booking's cancellation has been approved and is being processed. The code has been voided, the guest will be refunded.";
            break;
          case "REFUNDED":
            error = "This booking was cancelled and the guest has been refunded. The check-in code is no longer valid.";
            break;
          case "REJECTED":
            error = "A cancellation request existed for this booking but was rejected. The code was voided by an admin, Please contact support.";
            break;
        }
      } else {
        const voidReason = (c as any).voidReason;
        error = voidReason
          ? `This check-in code has been voided: ${voidReason}`
          : "This check-in code has been voided.";
      }
    }

    return res.status(400).json({ error, codeStatus: c.status, cancellationStatus });
  }

  // idempotent: mark code used and set booking to CONFIRMED
  const updated = await prisma.$transaction(async (tx: any) => {
    await tx.checkinCode.update({ where: { id: c.id }, data: { status: 'USED', usedAt: new Date(), usedByOwner: true } });
    const b = await confirmNoLsafBooking(tx, c.bookingId);
    return b;
  });

  try { req.app.get("io")?.emit?.("admin:booking:validated", { bookingId: updated.id }); } catch {}
  return res.json({ ok: true, booking: updated });
});

/* ---------------------- Cancel & Reassign Room ------------------------ */

/**
 * POST /admin/bookings/:id/cancel { reason }
 * - Cancels booking
 * - Voids ACTIVE code (if any)
 */
router.post("/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason ?? "").trim();
  if (reason.length < 3) return res.status(400).json({ error: "Reason is required (min 3 chars)" });

  const before = await prisma.booking.findUnique({
    where: { id },
    include: {
      code: true,
      property: { select: { title: true } },
      user: { select: { name: true, email: true } },
    },
  });
  if (!before) return res.status(404).json({ error: "Booking not found" });
  if (before.status === "CANCELED") return res.status(400).json({ error: "Already canceled" });

  const updated = await prisma.$transaction((tx: any) => updateNoLsafBookingStatus(
    tx,
    id,
    "CANCELED",
    { cancelReason: reason, canceledAt: new Date() },
  ));

  if (before.code && before.code.status === "ACTIVE") {
    await prisma.checkinCode.update({
      where: { id: before.code.id },
      data: { status: "VOID", voidReason: "Booking canceled by admin", voidedAt: new Date() },
    });
    const io = req.app.get("io");
    if (io) io.emit("admin:code:voided", { bookingId: id, code: before.code.codeVisible });
  }

  // Send cancellation email to guest (best-effort)
  try {
    if ((before.user as any)?.email) {
      const { subject, html } = getBookingCancelledEmail({
        guestName: before.guestName || (before.user as any).name || "Guest",
        propertyName: (before.property as any)?.title ?? "your property",
        bookingId: before.id,
        checkIn: before.checkIn,
        checkOut: before.checkOut,
        totalAmount: before.totalAmount as any,
        cancelReason: reason,
      });
      await sendMail((before.user as any).email, subject, html, undefined, { replyTo: "bookings@nolsaf.com" });
    }
  } catch (e) {
    console.warn("[BOOKING_CANCEL] Email send failed:", e);
  }

  return res.json({ ok: true, booking: updated });
});

/**
 * POST /admin/bookings/:id/reassign-room { roomCode }
 * - Assigns/changes roomCode with overlap safety on same property
 */
router.post("/:id/reassign-room", async (req, res) => {
  const id = Number(req.params.id);
  const roomCode = String(req.body?.roomCode ?? "").trim();
  if (!roomCode) return res.status(400).json({ error: "roomCode is required" });

  const b = await prisma.booking.findUnique({
    where: { id },
    include: { property: true, nrmsReservation: { select: { id: true } } },
  });
  if (!b) return res.status(404).json({ error: "Booking not found" });
  let updated: any;
  try {
    updated = await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, b.propertyId);
      const unit = await tx.roomUnit.findFirst({ where: { propertyId: b.propertyId, code: roomCode }, select: { id: true, roomTypeId: true } });
      if (unit) {
        const conflicts = await findUnitConflicts(unit.id, b.checkIn, b.checkOut, {
          db: tx,
          excludeBookingId: b.id,
          excludeReservationId: b.nrmsReservation?.id,
        });
        if (conflicts.length) throw Object.assign(new Error("ROOM_ASSIGNMENT_CONFLICT"), { conflicts });
      } else {
        const key = roomCode.replace(/-\d+$/, "");
        const type = await tx.roomType.findFirst({
          where: { propertyId: b.propertyId, OR: [{ name: key }, { sourceSpecKey: key }] },
          select: { id: true, name: true },
        });
        const currentKey = String(b.roomCode ?? "").replace(/-\d+$/, "").toLowerCase();
        if (type && currentKey !== key.toLowerCase()) {
          const capacity = await getRoomTypeAvailability(tx, b.propertyId, type.id, b.checkIn, b.checkOut, { excludeReservationId: b.nrmsReservation?.id });
          if (capacity.available < Math.max(1, Number(b.roomsQty ?? 1))) {
            throw Object.assign(new Error("ROOM_ASSIGNMENT_CONFLICT"), { capacity });
          }
        }
      }
      const changed = await tx.booking.update({ where: { id }, data: { roomCode } });
      await syncNoLsafBookingToNrms(tx, id);
      return changed;
    });
  } catch (error: any) {
    if (error?.message === "ROOM_ASSIGNMENT_CONFLICT") {
      return res.status(409).json({ error: "Room already assigned or blocked for overlapping dates", conflicts: error.conflicts ?? null, capacity: error.capacity ?? null });
    }
    throw error;
  }
  return res.json({ ok: true, booking: updated });
});

/* ---------------------- Code Search / Void / List --------------------- */

/** POST /admin/codes/search { code } */
router.post("/codes/search", async (req, res) => {
  const code = String(req.body?.code ?? "").trim();
  if (!code) return res.status(400).json({ error: "Code is required" });

  const c = await prisma.checkinCode.findFirst({
    where: { codeVisible: code },
    include: { booking: { include: { property: true, user: true } } },
  });
  if (!c) return res.status(404).json({ error: "Not found" });
  res.json(c);
});

/** POST /admin/codes/:id/void { reason? } */
router.post("/codes/:id/void", async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason ?? "").trim() || "Voided by admin";
  const before = await prisma.checkinCode.findUnique({ where: { id }, include: { booking: true } });
  if (!before) return res.status(404).json({ error: "Code not found" });
  if (before.status !== "ACTIVE") return res.status(400).json({ error: `Cannot void from status ${before.status}` });

  const updated = await prisma.checkinCode.update({
    where: { id },
    data: { status: "VOID", voidReason: reason, voidedAt: new Date() },
  });

  const io = req.app.get("io");
  if (io) io.emit("admin:code:voided", { bookingId: before.bookingId, code: before.codeVisible, reason });

  res.json({ ok: true, code: updated });
});

/**
 * GET /admin/codes?status=ACTIVE|USED|VOID
 * - List codes (paged via take)
 */
router.get("/codes", async (req, res) => {
  const status = (req.query.status as string | undefined) ?? undefined;
  const take = Math.min(Number(req.query.take ?? 50), 100);

  const codes = await prisma.checkinCode.findMany({
    where: status ? { status } : undefined,
    include: {
      booking: {
        include: {
          property: true,
          user: true,
        },
      },
    },
    orderBy: { id: "desc" },
    take,
  });

  return res.json({ items: codes });
});

/* ---------------------- Archive & Export ------------------------ */

/**
 * POST /admin/bookings/:id/archive
 * - Archives a booking (soft delete - marks as archived)
 * - Requires reason in body
 */
router.post("/:id/archive", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 10) {
      return res.status(400).json({ error: "Archive reason is required (minimum 10 characters)" });
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    // Update booking with archive flag and reason
    // Note: This assumes you have an `archived` field and `archiveReason` field in your Booking model
    // If not, you may need to add these fields to the schema
    const updated = await prisma.booking.update({
      where: { id },
      data: {
        // If you have an archived field:
        // archived: true,
        // archivedAt: new Date(),
        // archiveReason: reason,
        // For now, we'll use a status or add a note
        cancelReason: `ARCHIVED: ${reason}`,
      } as any,
    });

    try {
      await audit(req, "BOOKING_ARCHIVED", "BOOKING", booking, { reason, archivedAt: new Date() });
    } catch {}

    const io = req.app.get("io");
    if (io) {
      io.emit("admin:booking:archived", { bookingId: id, reason });
    }

    res.json({ ok: true, booking: updated });
  } catch (err: any) {
    console.error('Error in POST /admin/bookings/:id/archive:', err);
    res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

/**
 * GET /admin/bookings/export.csv
 * - Exports bookings to CSV format
 * - Query params: selectedIds (comma-separated), status, date, etc.
 */
router.get("/export.csv", async (req, res) => {
  try {
    const { selectedIds, status, date, propertyId, ownerId } = req.query as any;

    const where: any = {};
    
    // If specific IDs are selected, filter by those
    if (selectedIds) {
      const ids = String(selectedIds).split(',').map(Number).filter(Boolean);
      if (ids.length > 0) {
        where.id = { in: ids };
      }
    } else {
      // Otherwise apply filters
      if (status) {
        where.status = status;
      } else {
        where.status = { in: ["CONFIRMED", "CHECKED_IN", "PENDING_CHECKIN", "CHECKED_OUT"] };
        where.code = { isNot: null };
      }
      if (propertyId) where.propertyId = Number(propertyId);
      if (ownerId) where.property = { ownerId: Number(ownerId) };
      if (date) {
        const d = new Date(String(date));
        const next = new Date(d); next.setDate(d.getDate() + 1);
        where.AND = [
          { checkIn: { lt: next } },
          { checkOut: { gt: d } },
        ];
      }
    }

    const bookings = await prisma.booking.findMany({
      where,
      include: {
        property: {
          select: {
            id: true,
            title: true,
            owner: { select: { id: true, name: true, email: true, phone: true } }
          }
        },
        user: { select: { id: true, name: true, email: true, phone: true } },
        code: { select: { codeVisible: true, status: true, usedAt: true, usedByOwner: true } },
        cancellationRequests: {
          select: { reason: true, createdAt: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { id: 'desc' },
    });

    // Generate CSV
    const headers = [
      'Booking ID',
      'Status',
      'Check-in',
      'Check-out',
      'Nights',
      'Guest Name',
      'Guest Email',
      'Guest Phone',
      'Property',
      'Property Owner',
      'Owner Email',
      'Owner Phone',
      'Total Amount',
      'Booking Code',
      'Code Status',
      'Code Used At',
      'Validation Method',
      'Cancel Reason',
      'Canceled At',
      'Created At',
    ];

    const rows = bookings.map((b: any) => {
      const nights = Math.ceil((new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / (1000 * 60 * 60 * 24));
      const latestCancel = b.cancellationRequests && b.cancellationRequests.length > 0 ? b.cancellationRequests[0] : null;
      const validationMethod = b.code?.usedByOwner ? 'Booking Code' : (b.code?.usedAt ? 'QR Code' : 'N/A');

      return [
        b.id,
        b.status,
        new Date(b.checkIn).toLocaleDateString(),
        new Date(b.checkOut).toLocaleDateString(),
        nights,
        b.guestName || b.user?.name || '',
        b.user?.email || '',
        b.user?.phone || '',
        b.property?.title || '',
        b.property?.owner?.name || '',
        b.property?.owner?.email || '',
        b.property?.owner?.phone || '',
        Number(b.totalAmount).toFixed(2),
        b.code?.codeVisible || '',
        b.code?.status || '',
        b.code?.usedAt ? new Date(b.code.usedAt).toLocaleString() : '',
        validationMethod,
        latestCancel?.reason || '',
        latestCancel?.createdAt ? new Date(latestCancel.createdAt).toLocaleString() : '',
        new Date(b.createdAt).toLocaleString(),
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map((row: any[]) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bookings-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    console.error('Error in GET /admin/bookings/export.csv:', err);
    res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

export default router;
