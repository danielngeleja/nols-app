import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { invalidateOwnerReports } from "../lib/cache.js";
import { getEffectiveCommissionPercent, resolveOwnerPayoutAmount } from "../lib/accommodationPayout.js";
import { notifyAdmins } from "../lib/notifications.js";
import { NOLSAF_BILLING_CONTACT } from "../lib/companyBillingContact.js";
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("OWNER") as unknown as RequestHandler);

const OWNER_INVOICE_PREFIX = "OINV-";

/** GET /owner/invoices/for-booking/:bookingId — check if invoice already exists (used to lock Generate Invoice UI) */
router.get("/for-booking/:bookingId", async (req, res) => {
  const r = req as AuthedRequest;
  const ownerId = r.user!.id;
  const bookingId = Number(req.params.bookingId);
  if (!bookingId) return res.status(400).json({ error: "bookingId is required" });

  // IMPORTANT:
  // - "Customer payment invoices" created by the public payment flow use paymentRef like "INVREF-..."
  //   and historically used statuses like APPROVED. Those must NOT lock the owner's "Generate Invoice".
  // - Owner-submitted invoices are identified by invoiceNumber prefix "OINV-".
  const inv = await prisma.invoice.findFirst({
    where: { ownerId, bookingId, invoiceNumber: { startsWith: OWNER_INVOICE_PREFIX } } as any,
    orderBy: { id: "desc" } as any,
    select: { id: true, status: true, invoiceNumber: true, paymentRef: true, commissionPercent: true } as any,
  });

  return res.json({
    ok: true,
    exists: !!inv,
    invoiceId: inv?.id ?? null,
    status: inv?.status ?? null,
    invoiceNumber: inv?.invoiceNumber ?? null,
  });
});

// Helper to format an invoice number (YYYYMM-<bookingId>-<codeId>)
function makeInvoiceNumber(bookingId: number, codeId: number) {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2, "0")}`;
  // Separate owner-submitted invoices from public payment invoices (INV-...).
  // Premium, consistent format; deterministic for idempotency.
  // Example: OINV-202602-000123-0042
  return `OINV-${ym}-${String(bookingId).padStart(6, "0")}-${String(codeId).padStart(4, "0")}`;
}

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    typeof (error as any)?.code === "string"
  ) && (error as any)?.code === code;
}

async function findOwnerInvoiceForBooking(ownerId: number, bookingId: number) {
  return prisma.invoice.findFirst({
    where: { ownerId, bookingId, invoiceNumber: { startsWith: OWNER_INVOICE_PREFIX } } as any,
    orderBy: { id: "desc" } as any,
    select: { id: true, status: true } as any,
  });
}

const bookingUserSelect = {
  id: true,
  name: true,
  fullName: true,
  email: true,
  phone: true,
} as const;

router.post("/from-booking", async (req, res) => {
  try {
    const authReq = req as AuthedRequest;
    const ownerId = authReq.user!.id;
    const { bookingId } = authReq.body as { bookingId: number };

    if (!bookingId) return res.status(400).json({ error: "bookingId is required" });

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, property: { ownerId } },
      include: {
        property: { select: { id: true, title: true, type: true, basePrice: true, currency: true, services: true } },
        code: true,
      },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.status !== "CHECKED_IN") return res.status(400).json({ error: "Booking must be CHECKED_IN" });
    if (!booking.code || booking.code.status !== "USED") return res.status(400).json({ error: "Check-in code must be USED" });

    const existingForBooking = await findOwnerInvoiceForBooking(ownerId, booking.id);
    if (existingForBooking) {
      return res.status(200).json({
        ok: true,
        existed: true,
        invoiceId: existingForBooking.id,
        status: existingForBooking.status,
      });
    }

    // Compute line item amount
    const nights = Math.max(1, Math.ceil((+booking.checkOut - +booking.checkIn) / (1000*60*60*24)));
    // Prefer totalAmount if you already computed; otherwise fallback to nights * pricePerNight
    const pricePerNight = (booking as any).pricePerNight ?? booking.property?.basePrice ?? null;
    const transportFare = (booking as any).includeTransport ? Number((booking as any).transportFare || 0) : 0;
    const accommodationGross = booking.totalAmount
      ? Math.max(0, Number(booking.totalAmount) - transportFare)
      : (pricePerNight ? (pricePerNight as any) * nights : 0);

    // Create invoice + item atomically
    type MinimalInvoice = Prisma.InvoiceGetPayload<{ select: { id: true; status: true } }>;

    interface InvoiceCreationDuplicate {
      duplicate: number;
      status: string;
    }

    interface InvoiceCreationSuccess {
      invoiceId: number;
    }

    type InvoiceCreationResult = InvoiceCreationDuplicate | InvoiceCreationSuccess;

    const invoiceNumber = makeInvoiceNumber(booking.id, booking.code!.id);
    const commissionPercent = await getEffectiveCommissionPercent((booking.property as any)?.services);
    const ownerPayout = resolveOwnerPayoutAmount({
      invoiceNumber,
      invoiceTotal: accommodationGross,
      bookingTotalAmount: booking.totalAmount,
      transportFare,
      commissionPercent,
    });

    const created: InvoiceCreationResult = await prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<InvoiceCreationResult> => {
        // Prevent duplicates for this booking and prefix, including invoices created in a prior month.
        const exists: MinimalInvoice | null = await tx.invoice.findFirst({
          where: { ownerId, bookingId: booking.id, invoiceNumber: { startsWith: OWNER_INVOICE_PREFIX } } as any,
          select: { id: true, status: true },
        });
        if (exists) {
          return { duplicate: exists.id, status: exists.status };
        }

        // IMPORTANT: Prisma schema for Invoice in this codebase does NOT include
        // sender/receiver fields or invoice items. Keep creation aligned to schema.
        const invoice: MinimalInvoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            ownerId,
            bookingId: booking.id,
            // Enforce one-time flow:
            // - Create once as DRAFT
            // - Explicit submit later moves it to REQUESTED
            status: "DRAFT",
            total: ownerPayout as any,
            taxPercent: 0 as any,
            commissionPercent: null,
            commissionAmount: null,
            netPayable: ownerPayout as any,
          } as any,
          select: { id: true, status: true },
        });

        return { invoiceId: invoice.id };
      }
    );

    if ("duplicate" in created) {
      // Idempotent: return existing invoice as success (avoid "error" UX and prevent retries creating duplicates).
      return res.status(200).json({ ok: true, existed: true, invoiceId: created.duplicate, status: created.status });
    }

    return res.status(201).json({ ok: true, existed: false, invoiceId: created.invoiceId, status: "DRAFT" });
  } catch (err: any) {
    console.error("POST /api/owner/invoices/from-booking error:", {
      message: err?.message,
      code: err?.code,
      meta: err?.meta,
    });

    // If a retry/double-click races, invoiceNumber uniqueness may throw P2002.
    // Resolve by returning the existing invoiceId (idempotent behavior).
    try {
      if (isPrismaErrorCode(err, "P2002")) {
        const authReq = req as AuthedRequest;
        const ownerId = authReq.user!.id;
        const { bookingId } = authReq.body as { bookingId: number };
        if (bookingId) {
          const existing = await findOwnerInvoiceForBooking(ownerId, Number(bookingId));
          if (existing?.id) {
            return res.status(200).json({ ok: true, existed: true, invoiceId: existing.id, status: existing.status });
          }
        }
      }
    } catch {
      // fall through to 500
    }
    return res.status(500).json({ error: "Failed to create invoice", detail: err?.message || String(err) });
  }
});

/** GET /owner/invoices/:id — fetch full invoice (for preview) */
router.get("/:id", async (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const id = Number(authReq.params.id);
  const inv = await prisma.invoice.findFirst({
    where: { id, ownerId: authReq.user!.id, invoiceNumber: { startsWith: OWNER_INVOICE_PREFIX } } as any,
    include: {
      booking: {
        include: {
          property: { select: { id: true, title: true, type: true, basePrice: true, currency: true } },
          user: { select: bookingUserSelect },
          code: true,
        },
      },
    },
  });
  if (!inv) return res.status(404).json({ error: "Not found" });

  // Enrich response for the owner UI (these are derived fields, not stored on Invoice).
  const owner = await prisma.user.findUnique({
    where: { id: authReq.user!.id },
    select: { id: true, name: true, phone: true, address: true } as any,
  });
  const checkIn = (inv as any).booking?.checkIn ? new Date((inv as any).booking.checkIn) : null;
  const checkOut = (inv as any).booking?.checkOut ? new Date((inv as any).booking.checkOut) : null;
  const nights =
    checkIn && checkOut ? Math.max(1, Math.ceil((+checkOut - +checkIn) / (1000 * 60 * 60 * 24))) : null;
  const propertyTitle = (inv as any).booking?.property?.title ?? "property";
  const lineDescription = `Accommodation at ${propertyTitle}${nights ? ` (${nights} nights)` : ""}`;
  const total = Number((inv as any).total ?? 0);
  const taxPercent = Number((inv as any).taxPercent ?? 0) || 0;
  const taxAmount = Number((inv as any).taxAmount ?? 0) || 0;
  const subtotal = Number((inv as any).subtotal ?? (total - taxAmount)) || total;

  return res.json({
    ...inv,
    title: `${propertyTitle} | Accommodation Invoice`,
    currency: "TZS",
    senderName: owner?.name ?? `Owner #${authReq.user!.id}`,
    senderPhone: owner?.phone ?? null,
    senderAddress: (owner as any)?.address ?? null,
    receiverName: NOLSAF_BILLING_CONTACT.name,
    receiverEmail: NOLSAF_BILLING_CONTACT.email,
    receiverAddress: NOLSAF_BILLING_CONTACT.address,
    subtotal,
    taxPercent,
    taxAmount,
    items: [
      {
        id: `synthetic-${inv.id}-1`,
        description: lineDescription,
        quantity: 1,
        unitPrice: total,
        amount: total,
      },
    ],
    checkinCode: (inv as any).booking?.code ?? null,
  });
});

/** POST /owner/invoices/:id/submit — move DRAFT → REQUESTED (one-time) and notify admin */
router.post("/:id/submit", async (req, res) => {
  const authReq = req as AuthedRequest;
  const id = Number(authReq.params.id);
  const ownerId = authReq.user!.id;

  const inv = await prisma.invoice.findFirst({ where: { id, ownerId, invoiceNumber: { startsWith: OWNER_INVOICE_PREFIX } } as any });
  if (!inv) return res.status(404).json({ error: "Not found" });

  // Idempotent: if already submitted/processed, do nothing (prevents repeats + duplicate admin events).
  if (inv.status !== "DRAFT") {
    return res.json({ ok: true, status: inv.status, alreadySubmitted: true });
  }

  const claimed = await prisma.invoice.updateMany({
    where: { id: inv.id, status: "DRAFT" },
    // Align to schema statuses: REQUESTED → (admin) VERIFIED → APPROVED → PROCESSING → PAID / REJECTED
    data: { status: "REQUESTED" },
  });
  if (claimed.count !== 1) {
    const current = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    return res.json({ ok: true, status: current.status, alreadySubmitted: true });
  }
  const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
  await invalidateOwnerReports(updated.ownerId);
  // Notify admins only once, when the invoice first transitions to REQUESTED.
  try {
    await notifyAdmins("owner_payout_claim_submitted", {
      ownerId: updated.ownerId,
      invoiceId: updated.id,
      invoiceNumber: updated.invoiceNumber,
      bookingId: updated.bookingId,
      amount: updated.netPayable ?? updated.total ?? null,
    });
  } catch {
    // Notification delivery must not fail an otherwise successful payout claim.
  }
  try {
    authReq.app.get("io")?.to?.("admin")?.emit?.("admin:invoice:submitted", {
      invoiceId: updated.id,
      bookingId: updated.bookingId,
    });
  } catch {}

  return res.json({ ok: true, status: updated.status, alreadySubmitted: false });
});
export default router;
