import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { confirmedCustomerPayment } from "../services/payouts/eligibility.js";
import { invalidateOwnerReports } from "../lib/cache.js";
import { makeQR } from "../lib/qr.js";
import { allocateReceiptNumber } from "../lib/documentSequence.js";
import {
  getEffectiveCommissionPercent,
  isOwnerSubmittedInvoice,
  normalizeCommissionPercent,
  resolveCommissionAmount,
  resolveOwnerPayoutAmount,
} from "../lib/accommodationPayout.js";
import { accrueMarketplaceSalesCommission } from "../lib/salesCommission.js";
import type { AuthedRequest } from "../middleware/auth.js";

export const router = Router();
import type { RequestHandler } from "express";

router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler);

async function getInvoiceOwnerValidationState(invoiceId: number) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      bookingId: true,
      booking: {
        select: {
          id: true,
          code: {
            select: {
              id: true,
              status: true,
              usedByOwner: true,
              usedAt: true,
            },
          },
        },
      },
    },
  });

  if (!inv) return { exists: false as const };
  const code = (inv as any).booking?.code ?? null;
  const validated = !!(code?.usedByOwner);
  return {
    exists: true as const,
    bookingId: inv.bookingId,
    validated,
    code: code
      ? {
          id: code.id,
          status: code.status,
          usedByOwner: code.usedByOwner,
          usedAt: code.usedAt,
        }
      : null,
  };
}

async function requireOwnerValidatedForInvoice(invoiceId: number, res: any) {
  const v = await getInvoiceOwnerValidationState(invoiceId);
  if (!v.exists) {
    res.status(404).json({ error: "Invoice not found" });
    return false;
  }
  if (!v.validated) {
    res.status(403).json({
      error: "Owner validation required",
      detail: "Owner must validate the booking code before admin can process payout/payment actions for this invoice.",
      bookingId: v.bookingId,
      code: v.code,
    });
    return false;
  }
  return true;
}

async function createAdminAuditSafe(data: { adminId: number; targetUserId?: number | null; action: string; details?: any }) {
  try {
    await prisma.adminAudit.create({
      data: {
        adminId: data.adminId,
        targetUserId: data.targetUserId ?? null,
        action: data.action,
        details: data.details ?? null,
      },
    });
  } catch (e) {
    console.warn("adminAudit.create failed:", String(e));
  }
}

/** GET /admin/invoices - List invoices with pagination */
router.get("/", async (req, res) => {
  try {
    const { status, ownerId, propertyId, from, to, q, page = "1", pageSize = "50" } = req.query as any;

    const where: any = {};
    if (status) where.status = status;
    if (ownerId) where.ownerId = Number(ownerId);
    if (from || to) {
      where.issuedAt = {};
      if (from) where.issuedAt.gte = new Date(String(from));
      if (to) where.issuedAt.lte = new Date(String(to));
    }
    if (propertyId) {
      where.booking = { propertyId: Number(propertyId) };
    }
    if (q) {
      // MySQL doesn't support mode: "insensitive", so we use contains which is case-sensitive
      // For case-insensitive search, we'd need to use raw SQL, but contains works for most cases
      // Handle null-safe queries for optional relations
      const searchTerm = String(q).trim();
      if (searchTerm) {
        where.OR = [
          { invoiceNumber: { contains: searchTerm } },
          { receiptNumber: { contains: searchTerm } },
          { booking: { property: { title: { contains: searchTerm } } } },
        ];
      }
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { 
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              role: true,
            }
          },
          booking: { 
            include: { 
              property: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                }
              },
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                }
              }
            } 
          },
          verifiedByUser: {
            select: {
              id: true,
              name: true,
            }
          },
          approvedByUser: {
            select: {
              id: true,
              name: true,
            }
          },
          paidByUser: {
            select: {
              id: true,
              name: true,
            }
          },
        },
        orderBy: { id: "desc" },
        skip, take,
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({ total, page: Number(page), pageSize: take, items });
  } catch (err: any) {
    // If the DB schema is out-of-date (missing column), Prisma will throw P2022
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2022") {
        console.error("Prisma schema mismatch error in /admin/invoices:", err.message);
        return res.status(500).json({ error: "Database schema mismatch: missing column(s). Please run migrations.", detail: err.message });
      }
      if (err.code === "P2025") {
        console.error("Prisma record not found in /admin/invoices:", err.message);
        return res.status(404).json({ error: "Record not found", detail: err.message });
      }
    }
    console.error("Unhandled error in GET /admin/invoices:", err);
    console.error("Error stack:", err?.stack);
    res.status(500).json({ error: "Internal server error", detail: err?.message || String(err) });
  }
});

// helpers
function receiptNumberFor(id: number) {
  const now = new Date();
  return `RCT-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}-${id}`;
}

// Receipt numbers come from lib/documentSequence (the document_sequence table),
// not from a COUNT(*) of PAID invoices.

function buildReceiptQrPayload(inv: any) {
  if (typeof inv?.receiptQrPayload === "string" && inv.receiptQrPayload.trim()) {
    return inv.receiptQrPayload;
  }
  if (!inv?.receiptNumber) return null;
  return JSON.stringify({
    receipt: inv.receiptNumber,
    invoice: inv.invoiceNumber,
    amount: inv.netPayable ?? inv.total,
    property: inv.booking?.property?.title,
    bookingId: inv.bookingId,
    issuedAt: inv.issuedAt,
    ref: inv.paymentRef,
  });
}

/**
 * POST /admin/invoices/:id/approve
 *
 * APPROVED is the state services/payouts/eligibility.ts reads to decide an
 * owner invoice may be disbursed, so this is the write that creates the
 * liability. Three things changed here:
 *
 *  - blockImpersonated. Every other step of the money chain has it; this one
 *    did not, so the write that authorises a payout was reachable from an
 *    impersonated session while the disbursement that merely executes it
 *    was not.
 *  - The status write is now an atomic conditional claim instead of an
 *    unconditional update, so two admins cannot both "approve" the same
 *    invoice and a REJECTED or already-APPROVED invoice cannot be walked
 *    back into the payout queue.
 *  - The confirmed customer payment is recorded on the audit row. It is not
 *    enforced here on purpose: the hard solvency gate lives in
 *    eligibility.loadOwnerInvoice, immediately before money can move, so it
 *    covers every request path rather than just this one, and approving an
 *    invoice stays possible for flows that settle outside the gateway.
 */
router.post("/:id/approve", blockImpersonated as RequestHandler, async (req, res) => {
  const id = Number(req.params.id);
  if (!(await requireOwnerValidatedForInvoice(id, res))) return;
  const me = (req as AuthedRequest).user?.id;
  const before = await prisma.invoice.findUnique({ where: { id }, select: { status: true, ownerId: true, invoiceNumber: true, netPayable: true } });
  if (!before) return res.status(404).json({ error: "Invoice not found" });

  const claimed = await prisma.invoice.updateMany({
    where: { id, status: { notIn: ["APPROVED", "REJECTED", "PAID"] } },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return res.status(409).json({
      error: `Invoice ${id} is ${before.status} and cannot be approved. It was already approved, rejected, or changed by another administrator.`,
    });
  }
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });

  // Recorded, not enforced. An approval where nothing has been collected is
  // the shape of the unpaid-booking walk, and the audit row is where that
  // becomes reviewable after the fact.
  const collected = await confirmedCustomerPayment(id, "TZS").catch(() => null);

  await invalidateOwnerReports(inv.ownerId); // invalidate cache for the owner
  if (me) {
    await createAdminAuditSafe({
      adminId: me,
      targetUserId: before?.ownerId ?? inv.ownerId,
      action: "INVOICE_APPROVE",
      details: {
        invoiceId: inv.id,
        invoiceNumber: before?.invoiceNumber ?? null,
        fromStatus: before?.status ?? null,
        toStatus: inv.status,
        netPayable: before?.netPayable?.toString() ?? null,
        confirmedCustomerPayment: collected?.toString() ?? null,
      },
    });
  }
  req.app.get("io").emit("admin:invoice:status", { id: inv.id, status: inv.status });
  res.json({ ok: true, status: inv.status });
});

/** POST /admin/invoices/:id/process */
router.post("/:id/process", async (req, res) => {
  const id = Number(req.params.id);
  if (!(await requireOwnerValidatedForInvoice(id, res))) return;
  const me = (req as AuthedRequest).user?.id;
  const before = await prisma.invoice.findUnique({ where: { id }, select: { status: true, ownerId: true, invoiceNumber: true } });
  if (!before) return res.status(404).json({ error: "Invoice not found" });
  const claimed = await prisma.invoice.updateMany({
    where: { id, status: { not: "PAID" } },
    data: { status: "PROCESSING" },
  });
  if (claimed.count !== 1) return res.status(409).json({ error: "A paid invoice cannot return to processing" });
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  await invalidateOwnerReports(inv.ownerId); // invalidate cache for the owner
  if (me) {
    await createAdminAuditSafe({
      adminId: me,
      targetUserId: before?.ownerId ?? inv.ownerId,
      action: "INVOICE_PROCESS",
      details: { invoiceId: inv.id, invoiceNumber: before?.invoiceNumber ?? null, fromStatus: before?.status ?? null, toStatus: inv.status },
    });
  }
  req.app.get("io").emit("admin:invoice:status", { id: inv.id, status: inv.status });
  res.json({ ok: true, status: inv.status });
});

/** POST /admin/invoices/:id/pay
 * Body: { paymentRef?: string, commissionPercent?: number }
 * - computes commission & net, stamps receipt and marks PAID
 */
router.post("/:id/pay", async (req, res) => {
  return res.status(410).json({
    error: "Legacy manual settlement retired",
    detail: "Use POST /api/admin/invoices/:id/mark-paid so the atomic receipt and settlement guard is enforced.",
  });

  const id = Number(req.params.id);
  const { paymentRef, commissionPercent } = req.body ?? {};

  if (!(await requireOwnerValidatedForInvoice(id, res))) return;

  const me = (req as AuthedRequest).user?.id;
  const before = await prisma.invoice.findUnique({ where: { id }, select: { status: true, ownerId: true, invoiceNumber: true, total: true } });

  const updated = await prisma.$transaction(async (tx: { invoice: { findUnique: (arg0: { where: { id: number; }; include?: any; }) => any; update: (arg0: { where: { id: number; }; data: { status: string; paidAt: Date; commissionPercent: any; commissionAmount: any; netPayable: any; receiptNumber: any; paymentRef: any; }; }) => any; }; }) => {
  const inv = await tx.invoice.findUnique({
    where: { id },
    include: {
      booking: {
        select: {
          totalAmount: true,
          transportFare: true,
          property: { select: { services: true } },
        },
      },
    },
  });
  if (!inv) return null;
    const effectivePercent = commissionPercent != null
      ? normalizeCommissionPercent(commissionPercent)
      : (inv.commissionPercent != null
        ? normalizeCommissionPercent(inv.commissionPercent)
        : await getEffectiveCommissionPercent((inv as any)?.booking?.property?.services));
    const ownerInvoice = isOwnerSubmittedInvoice(inv.invoiceNumber);
    const netPayable = resolveOwnerPayoutAmount({
      invoiceNumber: inv.invoiceNumber,
      invoiceTotal: inv.total,
      netPayable: inv.netPayable,
      bookingTotalAmount: (inv as any)?.booking?.totalAmount,
      transportFare: (inv as any)?.booking?.transportFare,
      commissionPercent: effectivePercent,
    });
    const nextCommissionAmount = resolveCommissionAmount({
      invoiceNumber: inv.invoiceNumber,
      invoiceTotal: inv.total,
      commissionAmount: inv.commissionAmount,
      netPayable,
      bookingTotalAmount: (inv as any)?.booking?.totalAmount,
      transportFare: (inv as any)?.booking?.transportFare,
      commissionPercent: effectivePercent,
    });

    const paid = await tx.invoice.update({
      where: { id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        commissionPercent: ownerInvoice ? null : (effectivePercent > 0 ? effectivePercent as any : null),
        commissionAmount: ownerInvoice ? null : (nextCommissionAmount != null ? nextCommissionAmount as any : null),
        netPayable: netPayable as any,
        receiptNumber: inv.receiptNumber ?? receiptNumberFor(id),
        paymentRef: paymentRef ?? inv.paymentRef ?? undefined,
      },
    });
    await accrueMarketplaceSalesCommission(tx, paid.id).catch((error: any) => {
      console.warn("[sales commission] Admin invoice accrual deferred:", error?.message || String(error));
    });

    // Attempt to create a payout record for this invoice if the Payout model/table exists.
    // This is best-effort: if your Prisma schema doesn't have `payout`, the runtime will skip it.
    try {
      // gather some booking/driver info if available
      let booking: any = null;
      try {
        booking = await (tx as any).booking?.findUnique?.({ where: { id: inv.bookingId } });
      } catch (e) {
        // ignore if booking model is absent
      }

      if ((tx as any).payout) {
        await (tx as any).payout.create({
          data: {
            invoiceId: paid.id,
            invoiceNumber: paid.invoiceNumber ?? inv.invoiceNumber,
            tripCode: booking?.tripCode ?? booking?.code ?? null,
            paidAt: paid.paidAt,
            paymentMethod: paid.paymentMethod ?? null,
            paymentRef: paid.paymentRef ?? null,
            gross: inv.total as any,
            commissionAmount: (ownerInvoice ? null : nextCommissionAmount) as any,
            netPaid: netPayable as any,
            ownerId: inv.ownerId ?? null,
            driverId: booking?.driverId ?? null,
            createdAt: new Date(),
          },
        });
      }
    } catch (err) {
      // non-fatal: log and continue. Avoid making the transaction fail if payout model is missing.
      console.warn('create payout (admin.pay) skipped or failed:', String(err));
    }

    return paid;
  });

  if (!updated) return res.status(404).json({ error: "Not found" });
  try { await invalidateOwnerReports(updated.ownerId); } catch (e) { /* ignore */ }

  if (me) {
    await createAdminAuditSafe({
      adminId: me!,
      targetUserId: before?.ownerId ?? updated.ownerId,
      action: "INVOICE_PAY",
      details: {
        invoiceId: updated.id,
        invoiceNumber: before?.invoiceNumber ?? null,
        fromStatus: before?.status ?? null,
        toStatus: updated.status,
        paymentRef: updated.paymentRef ?? paymentRef ?? null,
        receiptNumber: updated.receiptNumber ?? null,
        total: before?.total ?? null,
      },
    });
  }
  
  const io = req.app.get("io");
  io.emit("admin:invoice:paid", { id: updated.id });

  // Owner notification + realtime refresh (no sensitive payload over socket)
  try {
    const invoiceFull = await prisma.invoice.findUnique({
      where: { id: updated.id },
      include: { booking: { include: { property: true } } } as any,
    });
    const propertyTitle = (invoiceFull as any)?.booking?.property?.title ?? null;
    const title = "New paid booking";
    const body =
      `Booking #${(invoiceFull as any)?.bookingId ?? updated.bookingId} has been paid` +
      (propertyTitle ? ` for ${propertyTitle}` : "") +
      ((invoiceFull as any)?.receiptNumber ? `. Receipt: ${(invoiceFull as any).receiptNumber}` : ".");

    let createdId: number | null = null;
    try {
      const existing = await prisma.notification.findFirst({
        where: {
          ownerId: updated.ownerId,
          type: "invoice",
          meta: { path: "$.invoiceId", equals: updated.id } as any,
        } as any,
        select: { id: true },
      });
      if (!existing) {
        const n = await prisma.notification.create({
          data: {
            ownerId: updated.ownerId,
            userId: updated.ownerId,
            title,
            body,
            type: "invoice",
            meta: { kind: "invoice_paid", invoiceId: updated.id, bookingId: (invoiceFull as any)?.bookingId ?? updated.bookingId, actionUrl: "/owner/bookings/recent" },
          },
          select: { id: true },
        });
        createdId = Number(n.id);
      }
    } catch {}

    io?.to?.(`owner:${updated.ownerId}`)?.emit?.("owner:bookings:updated", { bookingId: (invoiceFull as any)?.bookingId ?? updated.bookingId, invoiceId: updated.id });
    io?.to?.(`owner:${updated.ownerId}`)?.emit?.("notification:new", { id: createdId, title, type: "invoice" });
    io?.emit?.("owner:bookings:updated", { bookingId: (invoiceFull as any)?.bookingId ?? updated.bookingId, invoiceId: updated.id });

  } catch {}
  
  // Create referral earnings and emit updates if booking belongs to a referred user
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: updated.id },
      include: { booking: { select: { userId: true, id: true } } }
    });
    
    if (invoice?.booking?.userId) {
      // Import and create referral earning
      const { createReferralEarning } = await import('../lib/referral-earnings.js');
      const earning = await createReferralEarning(
        invoice.booking.userId,
        invoice.booking.id,
        updated.id,
        Number(invoice.total || 0)
      );

      if (earning) {
        // Check if this user was referred by a driver
        const user = await prisma.user.findUnique({
          where: { id: invoice.booking.userId },
          select: { referredBy: true, role: true }
        });
        
        if (user?.referredBy) {
          // Only emit for CUSTOMER/USER roles (they earn credits)
          if (user.role === 'CUSTOMER' || user.role === 'USER') {
            const bookingAmount = Number(invoice.total || 0);
            const creditsEarned = Number(earning.amount || 0);
            
            // Emit credit notification to referring driver
            io.to(`driver:${user.referredBy}`).emit('referral-notification', {
              type: 'credits_earned',
              message: `You earned ${creditsEarned.toLocaleString()} TZS credits from a booking!`,
              referralData: {
                userId: invoice.booking.userId,
                bookingId: invoice.bookingId,
                amount: bookingAmount,
                creditsEarned,
                earningId: earning.id,
              }
            });
            
            // Emit referral update to refresh dashboard
            io.to(`driver:${user.referredBy}`).emit('referral-update', {
              driverId: user.referredBy,
              timestamp: Date.now(),
              action: 'credits_earned',
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('Failed to create referral earning or emit update', e);
  }
  
  res.json({ ok: true, status: updated.status, receiptNumber: updated.receiptNumber });
});

/** POST /admin/invoices/:id/reject  Body: { reason } */
router.post("/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const me = (req as AuthedRequest).user?.id;
  const reason = (req.body?.reason as string) || "Not specified";
  const before = await prisma.invoice.findUnique({ where: { id }, select: { status: true, ownerId: true, invoiceNumber: true } });
  if (!before) return res.status(404).json({ error: "Invoice not found" });
  const claimed = await prisma.invoice.updateMany({
    where: { id, status: { not: "PAID" } },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedReason: reason } as any,
  });
  if (claimed.count !== 1) return res.status(409).json({ error: "A paid invoice cannot be rejected" });
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  await invalidateOwnerReports(inv.ownerId); // invalidate cache for the owner
  if (me) {
    await createAdminAuditSafe({
      adminId: me,
      targetUserId: before?.ownerId ?? inv.ownerId,
      action: "INVOICE_REJECT",
      details: { invoiceId: inv.id, invoiceNumber: before?.invoiceNumber ?? null, fromStatus: before?.status ?? null, toStatus: inv.status, reason },
    });
  }
  req.app.get("io").emit("admin:invoice:status", { id: inv.id, status: inv.status, reason });
  res.json({ ok: true, status: inv.status });
});

/** POST /admin/invoices/:id/mark-paid
 * body: { method, ref }
 * - stamps PAID, generates receiptNumber, QR payload & PNG
 * - emits socket "admin:invoice:paid" so Admin UI auto-refreshes
 */
router.post("/:id/mark-paid", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const authReq = req as AuthedRequest;
    const adminId = authReq.user?.id;
    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    if (!(await requireOwnerValidatedForInvoice(id, res))) return;
    
    const method = String(req.body?.method ?? "BANK");
    const ref = String(req.body?.ref ?? "");

    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: { booking: { include: { property: true } } },
    });
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    if (inv.status === "PAID") return res.status(400).json({ error: "Already PAID" });

    // Claim the invoice atomically. The status check above is a read, not a
    // lock: this route and the AzamPay webhook (webhooks.payments.markInvoicePaid)
    // can both pass it for the same invoice and both run the settlement side
    // effects. Only the writer whose conditional update matches a row continues.
    // The receipt number comes from the document_sequence allocator, so it is
    // unique by construction; a lost claim burns the allocated number.
    const receiptNumber = inv.receiptNumber ?? await allocateReceiptNumber();

    const payload = JSON.stringify({
      receipt: receiptNumber,
      invoice: inv.invoiceNumber,
      amount: inv.netPayable ?? inv.total,
      property: inv.booking?.property?.title,
      bookingId: inv.bookingId,
      issuedAt: inv.issuedAt,
      ref,
    });
    const { png, payload: qrPayload } = await makeQR(payload);

    const claimed = await prisma.invoice.updateMany({
      where: { id, status: { not: "PAID" } },
      data: {
        status: "PAID",
        paidBy: adminId,
        paidAt: new Date(),
        paymentMethod: method,
        paymentRef: ref || inv.paymentRef || null,
        receiptNumber,
        receiptQrPayload: qrPayload,
        receiptQrPng: png,
      },
    });
    if (claimed.count === 0) {
      // The webhook settled it while this request was in flight.
      return res.status(409).json({ error: "Invoice was just paid by another process" });
    }

    const updated = await prisma.invoice.findUniqueOrThrow({ where: { id }, include: { booking: true } });

    await createAdminAuditSafe({
      adminId,
      targetUserId: inv.ownerId,
      action: "INVOICE_MARK_PAID",
      details: {
        invoiceId: updated.id,
        invoiceNumber: inv.invoiceNumber ?? null,
        fromStatus: inv.status,
        toStatus: updated.status,
        method,
        ref,
        receiptNumber: updated.receiptNumber ?? null,
      },
    });

    await invalidateOwnerReports(updated.ownerId);

    // Notify Admin dashboards
    const io = req.app.get("io");
    try {
      io?.emit?.("admin:invoice:paid", {
        invoiceId: updated.id,
        ownerId: updated.ownerId,
      });

      // Owner notification + realtime refresh (no sensitive payload over socket)
      try {
        const propertyTitle = (inv as any).booking?.property?.title ?? null;
        const title = "New paid booking";
        const body =
          `Booking #${updated.bookingId} has been paid` +
          (propertyTitle ? ` for ${propertyTitle}` : "") +
          (updated.receiptNumber ? `. Receipt: ${updated.receiptNumber}` : ".");

        let createdId: number | null = null;
        try {
          const existing = await prisma.notification.findFirst({
            where: {
              ownerId: updated.ownerId,
              type: "invoice",
              meta: { path: "$.invoiceId", equals: updated.id } as any,
            } as any,
            select: { id: true },
          });
          if (!existing) {
            const n = await prisma.notification.create({
              data: {
                ownerId: updated.ownerId,
                userId: updated.ownerId,
                title,
                body,
                type: "invoice",
                meta: { kind: "invoice_paid", invoiceId: updated.id, bookingId: updated.bookingId, actionUrl: "/owner/bookings/recent" },
              },
              select: { id: true },
            });
            createdId = Number(n.id);
          }
        } catch {}

        io?.to?.(`owner:${updated.ownerId}`)?.emit?.("owner:bookings:updated", { bookingId: updated.bookingId, invoiceId: updated.id });
        io?.to?.(`owner:${updated.ownerId}`)?.emit?.("notification:new", { id: createdId, title, type: "invoice" });
        io?.emit?.("owner:bookings:updated", { bookingId: updated.bookingId, invoiceId: updated.id });

      } catch {}
      
      // Emit referral credit update if booking belongs to a referred user
      try {
        const booking = updated.booking;
        if (booking?.userId) {
          const user = await prisma.user.findUnique({
            where: { id: booking.userId },
            select: { referredBy: true, role: true }
          });
          
          if (user?.referredBy && io) {
            if (user.role === 'CUSTOMER' || user.role === 'USER') {
              const bookingAmount = Number(updated.total || updated.netPayable || 0);
              const creditsEarned = Math.round(bookingAmount * 0.0035); // 0.35% of booking
              
              io.to(`driver:${user.referredBy}`).emit('referral-notification', {
                type: 'credits_earned',
                message: `You earned ${creditsEarned.toLocaleString()} TZS credits from a booking!`,
                referralData: {
                  userId: booking.userId,
                  bookingId: booking.id,
                  amount: bookingAmount,
                  creditsEarned,
                }
              });
              
              io.to(`driver:${user.referredBy}`).emit('referral-update', {
                driverId: user.referredBy,
                timestamp: Date.now(),
                action: 'credits_earned',
              });
            }
          }
        }
      } catch (e) {
        console.warn('Failed to emit referral credit update', e);
      }
    } catch {}

    res.json({ ok: true, invoice: updated });
  } catch (err: any) {
    console.error("Error in POST /admin/invoices/:id/mark-paid", err);
    res.status(500).json({ error: "Internal server error", detail: err?.message || String(err) });
  }
});

/** GET /admin/invoices/:id/receipt.png — serve QR PNG */
router.get("/:id/receipt.png", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findUnique({
      where: { id },
      select: {
        receiptQrPng: true,
        receiptQrPayload: true,
        receiptNumber: true,
        invoiceNumber: true,
        netPayable: true,
        total: true,
        bookingId: true,
        issuedAt: true,
        paymentRef: true,
        booking: { select: { property: { select: { title: true } } } },
      },
    });
    if (!inv) {
      return res.status(404).json({ error: "Receipt not found" });
    }
    const qrPayload = buildReceiptQrPayload(inv);
    if (!qrPayload) {
      return res.status(404).json({ error: "Receipt not found" });
    }
    const { png } = await makeQR(qrPayload);

    res.setHeader("Content-Type", "image/png");
    res.send(png);
  } catch (err: any) {
    console.error("Error in GET /admin/invoices/:id/receipt.png", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// NOTE: index.ts imports this router as a default export.
export default router;
