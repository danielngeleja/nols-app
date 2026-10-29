import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { adminBookingReference } from "../lib/adminBookingReference.js";
import { customerBookingReference } from "../lib/customerBookingReference.js";
import { bookingPaymentCaseReference, resolveBookingPaymentCaseReference } from "../lib/bookingPaymentCaseReference.js";
import { maskPhone } from "../lib/guestCodeRequests.js";
import { deliverBookingCaseConfirmation } from "../lib/bookingPaymentCaseDelivery.js";
import { paidInvoiceForRepair, paymentCaseEvidenceState, verifiedSuccessForRepair } from "../lib/bookingPaymentCase.js";
import { expectedInvoicePaymentAmount } from "../lib/paymentAmount.js";
import { confirmNoLsafBooking, MARKETPLACE_CONNECT_TX_OPTIONS, NoLsafInventoryConflictError } from "../lib/nolsafMarketplaceNrms.js";
import { generateBookingCodeForBooking } from "../lib/bookingCodeService.js";
import { markInvoicePaid } from "./webhooks.payments.js";

const router = Router();
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler);
const db = prisma as any;

const bookingInclude = {
  property: { select: { title: true, owner: { select: { phone: true } } } },
  user: { select: { id: true, name: true, email: true } },
  code: { select: { status: true, generatedAt: true, issuedAt: true, usedAt: true } },
  invoices: {
    orderBy: { id: "desc" },
    select: {
      id: true, invoiceNumber: true, status: true, total: true, netPayable: true,
      paymentMethod: true, paymentRef: true, receiptNumber: true, paidAt: true, createdAt: true,
      paymentEvents: { orderBy: { id: "desc" }, select: {
        id: true, eventId: true, provider: true, status: true, amount: true, currency: true,
        phone: true, payload: true, createdAt: true,
      } },
    },
  },
} as const;

function describeCase(row: any, detail = false) {
  const booking = row.booking;
  const evidenceState = paymentCaseEvidenceState(booking);
  return {
    reference: bookingPaymentCaseReference(row.id),
    status: row.status,
    resolution: row.resolution,
    customerReference: row.customerReference,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    evidenceState,
    booking: {
      adminReference: adminBookingReference(booking.id),
      customerReference: customerBookingReference(booking.id),
      status: booking.status,
      propertyTitle: booking.property.title,
      guestName: booking.guestName || booking.user?.name || "Guest",
      guestPhoneMasked: maskPhone(booking.guestPhone),
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      amount: Number(booking.totalAmount),
      codeStatus: booking.code?.status ?? null,
      codeIssuedAt: booking.code?.issuedAt ?? booking.code?.generatedAt ?? null,
    },
    ...(detail ? {
      invoices: booking.invoices.map((invoice: any) => ({
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        expectedAmount: expectedInvoicePaymentAmount(invoice),
        paymentRef: invoice.paymentRef,
        receiptNumber: invoice.receiptNumber,
        paidAt: invoice.paidAt,
        createdAt: invoice.createdAt,
        events: invoice.paymentEvents.map((event: any) => ({
          eventId: event.eventId,
          provider: event.provider,
          status: event.status,
          amount: Number(event.amount),
          currency: event.currency,
          phoneMasked: maskPhone(event.phone),
          createdAt: event.createdAt,
        })),
      })),
      timeline: row.events?.map((event: any) => ({
        type: event.type, actorRole: event.actorRole,
        note: event.note,
        metadata: {
          paymentMethod: ["MOBILE_MONEY", "CARD", "BANK", "OTHER"].includes(event.metadata?.paymentMethod) ? event.metadata.paymentMethod : undefined,
          approximatePaidAt: typeof event.metadata?.approximatePaidAt === "string" ? event.metadata.approximatePaidAt : undefined,
          payerPhoneLast4: /^\d{4}$/.test(String(event.metadata?.payerPhoneLast4 || "")) ? event.metadata.payerPhoneLast4 : undefined,
          recordedAttempt: event.metadata?.recordedAttempt === true,
          channels: Array.isArray(event.metadata?.channels) ? event.metadata.channels : undefined,
          destinationMasked: event.metadata?.destinationMasked || undefined,
          ownerPhoneOverlap: Boolean(event.metadata?.ownerPhoneOverlap),
          result: typeof event.metadata?.result === "string" ? event.metadata.result : undefined,
        },
        createdAt: event.createdAt,
      })) ?? [],
    } : {}),
  };
}

async function loadCase(id: number) {
  return db.bookingPaymentCase.findUnique({
    where: { id },
    include: { booking: { include: bookingInclude }, events: { orderBy: { id: "asc" } } },
  });
}

async function loadCaseByReference(reference: string) {
  const id = await resolveBookingPaymentCaseReference(reference);
  return id ? loadCase(id) : null;
}

async function recordEvent(caseId: number, type: string, actorId: number | null, note?: string | null, metadata?: Record<string, unknown>) {
  await db.bookingPaymentCaseEvent.create({ data: {
    caseId, type, actorId, actorRole: actorId ? "ADMIN" : "SYSTEM",
    note: note || null, metadata: metadata || undefined,
  } });
}

async function inventoryConflict(caseId: number, actorId: number, reason: string) {
  await db.bookingPaymentCase.update({ where: { id: caseId }, data: { status: "INVENTORY_CONFLICT" } });
  await recordEvent(caseId, "INVENTORY_CONFLICT", actorId, reason);
}

router.get("/", (async (req: AuthedRequest, res) => {
  const parsed = z.object({
    status: z.enum(["OPEN", "UNVERIFIED", "RESOLVED", "ALL"]).default("OPEN"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
    q: z.string().trim().max(80).default(""),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filters" });
  const { status, page, pageSize, q } = parsed.data;
  try {
    const caseId = q.startsWith("pc_") ? await resolveBookingPaymentCaseReference(q) : null;
    const statusWhere = status === "ALL" ? {} : status === "RESOLVED" ? { status: "RESOLVED" } : status === "UNVERIFIED" ? { status: "UNVERIFIED_REPORT" } : { status: { notIn: ["RESOLVED", "UNVERIFIED_REPORT"] } };
    const searchWhere = q ? { OR: [
      ...(caseId ? [{ id: caseId }] : []),
      { customerReference: { contains: q } },
      { booking: { is: { guestName: { contains: q } } } },
      { booking: { is: { property: { is: { title: { contains: q } } } } } },
    ] } : {};
    const where = { AND: [statusWhere, searchWhere] };
    const [items, total, groups] = await Promise.all([
      prisma.bookingPaymentCase.findMany({ where, orderBy: status === "RESOLVED" ? { updatedAt: "desc" } : { createdAt: "asc" }, skip: (page - 1) * pageSize, take: pageSize, include: { booking: { include: bookingInclude } } }),
      prisma.bookingPaymentCase.count({ where }),
      prisma.bookingPaymentCase.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(groups.map((group: any) => [group.status, group._count._all]));
    const resolved = Number(byStatus.RESOLVED || 0);
    const all = Object.values(byStatus).reduce((sum: number, count: any) => sum + Number(count), 0);
    return res.json({ items: items.map((row: any) => describeCase(row)), total, page, pageSize, summary: {
      needsAttention: all - resolved - Number(byStatus.UNVERIFIED_REPORT || 0),
      unverified: Number(byStatus.UNVERIFIED_REPORT || 0),
      awaitingProvider: Number(byStatus.AWAITING_PROVIDER || 0),
      roomOrRefund: Number(byStatus.INVENTORY_CONFLICT || 0) + Number(byStatus.REFUND_REQUIRED || 0),
      resolved,
    } });
  } catch (error: any) {
    if (["P2021", "P2022"].includes(error?.code)) return res.status(503).json({ error: "Payment case migration is pending" });
    console.error("[booking-payment-case] list failed", error);
    return res.status(500).json({ error: "Could not load payment cases" });
  }
}) as RequestHandler);

router.get("/:reference", (async (req: AuthedRequest, res) => {
  try {
    const row = await loadCaseByReference(String(req.params.reference || ""));
    if (!row) return res.status(404).json({ error: "Case not found" });
    return res.json({ paymentCase: describeCase(row, true) });
  } catch (error: any) {
    if (["P2021", "P2022"].includes(error?.code)) return res.status(503).json({ error: "Payment case migration is pending" });
    return res.status(500).json({ error: "Could not load the payment case" });
  }
}) as RequestHandler);

/** Re-read authenticated provider callbacks linked to this exact customer
 * invoice. An absent result remains unresolved and must go to provider follow-up. */
router.post("/:reference/check-payment", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res) => {
  try {
    const row = await loadCaseByReference(String(req.params.reference || ""));
    if (!row) return res.status(404).json({ error: "Case not found" });
    const id = row.id;
    const recent = [...row.events].reverse().find((event: any) => event.type === "PROVIDER_EVIDENCE_CHECKED");
    if (recent && Date.now() - new Date(recent.createdAt).getTime() < 30_000) return res.status(429).json({ error: "Payment evidence was checked recently" });
    const paid = paidInvoiceForRepair(row.booking.invoices);
    const verified = verifiedSuccessForRepair(row.booking.invoices);
    const evidence = paid ? "PAID_NEEDS_REPAIR" : verified ? "VERIFIED_EVENT" : paymentCaseEvidenceState(row.booking);
    await recordEvent(id, "PROVIDER_EVIDENCE_CHECKED", req.user!.id,
      paid || verified ? "Matched an authenticated provider result to the customer invoice." : "No matching provider confirmation is recorded; follow up with the provider.",
      { invoiceId: paid?.id ?? verified?.invoice.id ?? null, providerEventId: verified?.event.id ?? null, result: evidence });
    return res.json({ evidenceState: evidence, matched: Boolean(paid || verified) });
  } catch (error: any) {
    console.error("[booking-payment-case] evidence check failed", { reference: req.params.reference, message: error?.message });
    return res.status(500).json({ error: "Could not recheck payment evidence" });
  }
}) as RequestHandler);

router.post("/:reference/recover", blockImpersonated as RequestHandler, requireAdminFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  try {
    const row = await loadCaseByReference(String(req.params.reference || ""));
    if (!row) return res.status(404).json({ error: "Case not found" });
    const id = row.id;
    if (!["REPAIRING", "SENDING_CODE"].includes(row.status)) return res.status(409).json({ error: "No stalled action is recorded" });
    if (Date.now() - new Date(row.updatedAt).getTime() < 10 * 60_000) return res.status(409).json({ error: "The action is still within its processing window" });
    const nextStatus = paymentCaseEvidenceState(row.booking) === "CODE_READY" ? "CODE_READY" : "OPEN";
    const claimed = await db.bookingPaymentCase.updateMany({ where: { id, status: row.status, updatedAt: row.updatedAt }, data: { status: nextStatus } });
    if (claimed.count !== 1) return res.status(409).json({ error: "This case changed. Reload before acting." });
    await recordEvent(id, "STALLED_ACTION_RECOVERED", req.user!.id, `Recovered ${row.status} after 10 minutes. Verify prior delivery before retrying.`);
    return res.json({ ok: true, status: nextStatus });
  } catch (error: any) {
    console.error("[booking-payment-case] recovery failed", { reference: req.params.reference, message: error?.message });
    return res.status(500).json({ error: "Could not recover the stalled action" });
  }
}) as RequestHandler);

/** Re-run the established idempotent settlement and confirmation path only for
 * an already paid invoice or a linked, matching SUCCESS provider event. */
router.post("/:reference/repair", blockImpersonated as RequestHandler, requireAdminFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const row = await loadCaseByReference(String(req.params.reference || ""));
  if (!row) return res.status(404).json({ error: "Case not found" });
  const id = row.id;
  if (row.status === "RESOLVED") return res.status(409).json({ error: "Case is resolved. Use secure resend if the guest still needs the code." });
  if (["INVENTORY_CONFLICT", "REFUND_REQUIRED"].includes(row.status)) return res.status(409).json({ error: "This case is on the rebooking or refund path; the original booking cannot be repaired here." });
  if (["REPAIRING", "SENDING_CODE"].includes(row.status)) return res.status(409).json({ error: "Another staff action is already in progress" });
  const booking = row.booking;
  if (booking.status === "CANCELED" || (booking.code && booking.code.status !== "ACTIVE")) {
    return res.status(409).json({ error: "This booking cannot be repaired automatically; review its cancellation or used code." });
  }
  const paid = paidInvoiceForRepair(booking.invoices);
  const verified = verifiedSuccessForRepair(booking.invoices);
  if (!paid && !verified) {
    await recordEvent(id, "PROVIDER_EVIDENCE_REQUIRED", req.user!.id);
    return res.status(409).json({ error: "No matched provider payment is recorded. Request a provider check; the customer's claim alone cannot issue a code." });
  }
  if (new Date(booking.checkOut).getTime() + 24 * 60 * 60 * 1000 <= Date.now()) {
    await inventoryConflict(id, req.user!.id, "Payment is verified, but the stay has ended. Arrange an approved refund or another stay with the traveller.");
    return res.status(409).json({ error: "Payment verified after the stay ended. Arrange a refund or a new stay; no check-in code can be issued.", status: "INVENTORY_CONFLICT" });
  }

  const claimed = await db.bookingPaymentCase.updateMany({ where: { id, status: row.status }, data: { status: "REPAIRING" } });
  if (claimed.count !== 1) return res.status(409).json({ error: "This case changed. Reload before acting." });

  try {
    await recordEvent(id, "REPAIR_STARTED", req.user!.id, null, { paidInvoiceId: paid?.id ?? null, providerEventId: verified?.event.id ?? null });
    if (!paid && verified) {
      await markInvoicePaid(
        verified.invoice.id,
        verified.event.provider,
        String((verified.event.payload as any)?.paymentRef || verified.event.eventId),
        verified.event.phone || undefined,
        verified.invoice.paymentMethod || verified.event.provider,
        verified.event.eventId,
        Math.round(Number(verified.event.amount)),
      );
    }

    const settled = await prisma.invoice.findFirst({
      where: { bookingId: booking.id, invoiceNumber: { startsWith: "INV-" }, OR: [{ status: "PAID" }, { status: "CUSTOMER_PAID", receiptNumber: { not: null } }] },
      select: { id: true },
    });
    if (!settled) {
      await db.bookingPaymentCase.update({ where: { id }, data: { status: row.status } });
      return res.status(409).json({ error: "The payment has not settled. Keep this case open for provider investigation." });
    }

    const fresh = await prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true, code: { select: { status: true } } } });
    if (!fresh || fresh.status === "CANCELED" || (fresh.code && fresh.code.status !== "ACTIVE")) {
      await db.bookingPaymentCase.update({ where: { id }, data: { status: row.status } });
      return res.status(409).json({ error: "The booking changed while this case was being reviewed. Reload it before acting." });
    }
    if (fresh.status === "NEW") {
      await prisma.$transaction((tx: any) => confirmNoLsafBooking(tx, booking.id), MARKETPLACE_CONNECT_TX_OPTIONS);
    }
    await generateBookingCodeForBooking(booking.id);
    const delivery = await deliverBookingCaseConfirmation(booking.id);
    const resolved = delivery.channels.length > 0;
    await db.bookingPaymentCase.update({ where: { id }, data: {
      status: resolved ? "RESOLVED" : "CODE_READY",
      resolution: resolved ? "CODE_DELIVERED" : null,
      resolvedById: resolved ? req.user!.id : null,
      resolvedAt: resolved ? new Date() : null,
    } });
    await recordEvent(id, "BOOKING_REPAIRED", req.user!.id, null, {
      invoiceId: settled.id, channels: delivery.channels,
      destinationMasked: delivery.destinationMasked, ownerPhoneOverlap: delivery.ownerPhoneOverlap,
    });
    return res.json({ ok: true, status: resolved ? "RESOLVED" : "CODE_READY", deliveredVia: delivery.channels });
  } catch (error: any) {
    if (error instanceof NoLsafInventoryConflictError || error?.code === "ROOM_UNAVAILABLE_AFTER_PAYMENT") {
      await inventoryConflict(id, req.user!.id, "Payment is verified, but the original room cannot be confirmed. Arrange an alternative with the guest or follow the approved refund process.");
      return res.status(409).json({ error: "Payment verified; room unavailable. Keep funds protected and arrange a rebooking or approved refund.", status: "INVENTORY_CONFLICT" });
    }
    await db.bookingPaymentCase.update({ where: { id }, data: { status: row.status } }).catch(() => {});
    await recordEvent(id, "REPAIR_FAILED", req.user!.id, "Automatic repair failed; no manual code was issued.");
    console.error("[booking-payment-case] repair failed", { caseId: id, message: error?.message });
    return res.status(500).json({ error: "Repair did not complete. Review the booking and payment evidence before retrying." });
  }
}) as RequestHandler);

router.post("/:reference/resend", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res) => {
  let id: number | null = null;
  let previousStatus: string | null = null;
  try {
    const row = await loadCaseByReference(String(req.params.reference || ""));
    if (!row) return res.status(404).json({ error: "Case not found" });
    id = row.id;
    if (["INVENTORY_CONFLICT", "REFUND_REQUIRED"].includes(row.status)) return res.status(409).json({ error: "This case is on the rebooking or refund path; do not resend a code." });
    if (["REPAIRING", "SENDING_CODE"].includes(row.status)) return res.status(409).json({ error: "Another staff action is already in progress" });
    if (paymentCaseEvidenceState(row.booking) !== "CODE_READY") return res.status(409).json({ error: "No active confirmed code is available for secure resend" });
    const lastDelivery = [...row.events].reverse().find((event: any) => ["AUTO_RESEND", "ADMIN_RESEND", "BOOKING_REPAIRED"].includes(event.type));
    if (lastDelivery && Date.now() - new Date(lastDelivery.createdAt).getTime() < 2 * 60_000) {
      return res.status(429).json({ error: "A confirmation was sent recently. Wait before trying again." });
    }
    const claimed = await db.bookingPaymentCase.updateMany({ where: { id, status: row.status }, data: { status: "SENDING_CODE" } });
    if (claimed.count !== 1) return res.status(409).json({ error: "This case changed. Reload before acting." });
    previousStatus = row.status;
    await recordEvent(row.id, "RESEND_STARTED", req.user!.id);
    const delivery = await deliverBookingCaseConfirmation(row.bookingId);
    await recordEvent(row.id, "ADMIN_RESEND", req.user!.id, null, { channels: delivery.channels, destinationMasked: delivery.destinationMasked, ownerPhoneOverlap: delivery.ownerPhoneOverlap });
    if (delivery.channels.length) {
      await db.bookingPaymentCase.update({ where: { id }, data: { status: "RESOLVED", resolution: "CODE_DELIVERED", resolvedById: req.user!.id, resolvedAt: new Date() } });
    } else {
      await db.bookingPaymentCase.update({ where: { id }, data: { status: "CODE_READY" } });
    }
    return res.json({ ok: true, status: delivery.channels.length ? "RESOLVED" : "CODE_READY", deliveredVia: delivery.channels });
  } catch (error: any) {
    if (previousStatus && id) await db.bookingPaymentCase.updateMany({ where: { id, status: "SENDING_CODE" }, data: { status: previousStatus } }).catch(() => {});
    console.error("[booking-payment-case] resend failed", { reference: req.params.reference, message: error?.message });
    return res.status(500).json({ error: "Could not resend the confirmation" });
  }
}) as RequestHandler);

const noteSchema = z.object({ note: z.string().trim().min(10).max(500), status: z.enum(["AWAITING_PROVIDER", "REFUND_REQUIRED"]) });
router.post("/:reference/next-step", blockImpersonated as RequestHandler, requireAdminFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const parsed = noteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Choose a next step and explain it" });
  const row = await loadCaseByReference(String(req.params.reference || ""));
  if (!row) return res.status(404).json({ error: "Case not found" });
  const id = row.id;
  if (row.status === "RESOLVED") return res.status(409).json({ error: "Case is already resolved" });
  if (["REPAIRING", "SENDING_CODE"].includes(row.status)) return res.status(409).json({ error: "Another staff action is already in progress" });
  if (parsed.data.status === "REFUND_REQUIRED" && paymentCaseEvidenceState(row.booking) !== "PAID_NEEDS_REPAIR" && paymentCaseEvidenceState(row.booking) !== "VERIFIED_EVENT" && row.status !== "INVENTORY_CONFLICT") {
    return res.status(409).json({ error: "A refund path requires verified payment evidence" });
  }
  await db.bookingPaymentCase.update({ where: { id }, data: { status: parsed.data.status } });
  await recordEvent(id, parsed.data.status, req.user!.id, parsed.data.note);
  return res.json({ ok: true, status: parsed.data.status });
}) as RequestHandler);

export default router;
