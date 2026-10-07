/**
 * Owner payout recovery (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md, Phase 4;
 * owner policy 6.3.3). Decisions of 2026-10-07:
 *
 *   - Amount: the owner's share only, refund x (owner payout / guest paid),
 *     never more than the owner was actually paid. NoLSAF absorbs its own
 *     commission share (policy 6.3.2.2).
 *   - Collection: deducted automatically from the owner's next payouts; while
 *     a debt is open their payouts go to an admin, not the AUTO lane. Not
 *     covered within 7 business days: the owner is asked to repay.
 *   - Chargebacks: recorded manually by an admin from the provider's notice.
 *
 * A recovery is only created when the owner was PAID for the stay. Before
 * that, the payout hold (release.ts) stops the money instead.
 */

import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { notifyAdmins, notifyOwner } from "../../lib/notifications.js";
import { retentionFields } from "../../lib/auditRetention.js";
import { confirmedCustomerPaymentForBooking } from "./eligibility.js";

const OWNER_INVOICE_PREFIX = "OINV-";
const DUE_BUSINESS_DAYS = 7;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const CENT = 0.005;

export type RecoveryKind = "REFUND" | "CHARGEBACK";

export class RecoveryError extends Error {
  constructor(readonly code: "NOT_PAID" | "NOTHING_TO_RECOVER" | "NOT_FOUND" | "NOT_OPEN", message: string) {
    super(message);
    this.name = "RecoveryError";
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatTzs(amount: number): string {
  return `TZS ${Math.round(amount).toLocaleString("en-US")}`;
}

/** Adds business days (Monday to Friday, East Africa Time). */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    d.setTime(d.getTime() + 24 * 60 * 60 * 1000);
    const weekday = new Date(d.getTime() + EAT_OFFSET_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) added++;
  }
  return d;
}

/**
 * The owner's share of what the guest got back. Proportional to the owner's
 * part of the guest payment, and capped at what the owner was paid.
 */
export function ownerShareOfGuestAmount(input: { guestAmount: number; ownerNet: number; guestPaid: number; ownerPaid: number }): number {
  const { guestAmount, ownerNet, guestPaid, ownerPaid } = input;
  if (!(guestAmount > 0) || !(ownerPaid > 0)) return 0;
  const share = guestPaid > 0 ? (guestAmount * ownerNet) / guestPaid : guestAmount;
  return round2(Math.min(share, ownerPaid));
}

/** The paid owner claim for a stay, or null when the owner has not been paid. */
async function paidOwnerClaim(bookingId: number) {
  const claim = await prisma.invoice.findFirst({
    where: { bookingId, invoiceNumber: { startsWith: OWNER_INVOICE_PREFIX } },
    orderBy: { id: "asc" },
    select: { id: true, ownerId: true, netPayable: true },
  });
  if (!claim) return null;
  const paid = await prisma.disbursement.aggregate({
    where: { sourceType: "OWNER_INVOICE", sourceId: claim.id, status: "PAID" },
    _sum: { amount: true },
  });
  const ownerPaid = Number(paid._sum.amount ?? 0);
  if (!(ownerPaid > 0)) return null;
  return { invoiceId: claim.id, ownerId: claim.ownerId, ownerNet: Number(claim.netPayable ?? 0), ownerPaid };
}

/** Creates the debt once per (kind, reference). Returns the existing one on a repeat. */
export async function recordRecovery(input: {
  kind: RecoveryKind;
  reference: string;
  bookingId: number;
  guestAmount: number;
  createdById?: number | null;
  note?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const existing = await prisma.ownerPayoutRecovery.findUnique({
    where: { kind_reference: { kind: input.kind, reference: input.reference } },
  });
  if (existing) return existing;

  const claim = await paidOwnerClaim(input.bookingId);
  if (!claim) throw new RecoveryError("NOT_PAID", "The owner has not been paid for this stay, so nothing is recovered. The payout hold applies instead.");

  const guestPaid = Number(await confirmedCustomerPaymentForBooking(input.bookingId, "TZS").catch(() => 0));
  const amount = ownerShareOfGuestAmount({ guestAmount: input.guestAmount, ownerNet: claim.ownerNet, guestPaid, ownerPaid: claim.ownerPaid });
  if (!(amount > 0)) throw new RecoveryError("NOTHING_TO_RECOVER", "The owner's share of this amount is zero.");

  let recovery;
  try {
    recovery = await prisma.ownerPayoutRecovery.create({
      data: {
        ownerId: claim.ownerId,
        bookingId: input.bookingId,
        sourceInvoiceId: claim.invoiceId,
        kind: input.kind,
        reference: input.reference,
        guestAmount: new Prisma.Decimal(round2(input.guestAmount)),
        amount: new Prisma.Decimal(amount),
        dueAt: addBusinessDays(now, DUE_BUSINESS_DAYS),
        createdById: input.createdById ?? null,
        note: input.note ? String(input.note).slice(0, 500) : null,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return prisma.ownerPayoutRecovery.findUniqueOrThrow({
        where: { kind_reference: { kind: input.kind, reference: input.reference } },
      });
    }
    throw err;
  }

  await prisma.auditLog
    .create({
      data: {
        actorId: input.createdById ?? null,
        actorRole: input.createdById ? "ADMIN" : "SYSTEM",
        action: "OWNER_PAYOUT_RECOVERY_OPENED",
        entity: "OwnerPayoutRecovery",
        entityId: recovery.id,
        afterJson: { kind: input.kind, reference: input.reference, bookingId: input.bookingId, guestAmount: input.guestAmount, amount },
        ...retentionFields("FINANCIAL", now),
      },
    })
    .catch(() => {});
  void notifyOwner(claim.ownerId, "owner_payout_recovery_opened", {
    amountText: formatTzs(amount),
    reasonText: input.kind === "CHARGEBACK" ? "a card payment the guest disputed with their bank" : "a refund approved for the guest",
  }).catch(() => {});
  return recovery;
}

/**
 * Hook for the accommodation cancellation flow: a refund was paid. Uses the
 * net amount actually paid to the guest. Never throws: a stay the owner was
 * not paid for simply has nothing to recover.
 */
export async function recordRefundRecovery(cancellationRequestId: number, adminId: number | null): Promise<void> {
  try {
    const request = await prisma.cancellationRequest.findUnique({
      where: { id: cancellationRequestId },
      select: { bookingId: true, status: true, refundAmount: true, refundChargesJson: true },
    });
    if (!request || request.status !== "REFUNDED") return;
    const charges = (request.refundChargesJson ?? null) as { netRefundAmount?: number } | null;
    const guestAmount = Number(charges?.netRefundAmount ?? request.refundAmount ?? 0);
    if (!(guestAmount > 0)) return;
    await recordRecovery({
      kind: "REFUND",
      reference: `cx:${cancellationRequestId}`,
      bookingId: request.bookingId,
      guestAmount,
      createdById: adminId,
      note: `Refund on cancellation request ${cancellationRequestId}`,
    });
  } catch (err: any) {
    if (err instanceof RecoveryError) return;
    console.error("[recovery] refund recovery failed", { cancellationRequestId, message: err?.message });
  }
}

/** What the owner still owes across open recoveries. */
export async function openRecoveryTotal(ownerId: number): Promise<number> {
  const rows = await prisma.ownerPayoutRecovery.findMany({
    where: { ownerId, status: "OPEN" },
    select: { amount: true, recoveredAmount: true },
  });
  return round2(rows.reduce((sum, r) => sum + Number(r.amount) - Number(r.recoveredAmount), 0));
}

/** Total already deducted from one owner claim. eligibility.loadOwnerInvoice subtracts it. */
export async function recoveredFromClaim(invoiceId: number): Promise<number> {
  const sum = await prisma.ownerPayoutRecoveryApplication.aggregate({ where: { invoiceId }, _sum: { amount: true } });
  return round2(Number(sum._sum.amount ?? 0));
}

/**
 * Deducts open debts, oldest first, from a claim that is about to be paid.
 * Each step is a conditional update on recoveredAmount, so two concurrent
 * withdrawals can never deduct the same debt twice. Returns what was deducted.
 */
export async function applyRecoveriesToClaim(ownerId: number, invoiceId: number, payable: number, now = new Date()): Promise<number> {
  let remaining = round2(payable);
  let deducted = 0;
  const open = await prisma.ownerPayoutRecovery.findMany({
    where: { ownerId, status: "OPEN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, amount: true, recoveredAmount: true },
  });
  for (const debt of open) {
    if (remaining <= CENT) break;
    const outstanding = round2(Number(debt.amount) - Number(debt.recoveredAmount));
    if (outstanding <= CENT) continue;
    const take = round2(Math.min(outstanding, remaining));
    const applied = await prisma.$transaction(async (tx) => {
      const moved = await tx.ownerPayoutRecovery.updateMany({
        where: { id: debt.id, status: "OPEN", recoveredAmount: debt.recoveredAmount },
        data: {
          recoveredAmount: { increment: new Prisma.Decimal(take) },
          ...(take >= outstanding - CENT ? { status: "RECOVERED", closedAt: now } : {}),
        },
      });
      if (moved.count !== 1) return false;
      await tx.ownerPayoutRecoveryApplication.create({
        data: { recoveryId: debt.id, invoiceId, amount: new Prisma.Decimal(take) },
      });
      return true;
    });
    if (!applied) continue;
    remaining = round2(remaining - take);
    deducted = round2(deducted + take);
  }
  if (deducted > 0) {
    await prisma.auditLog
      .create({
        data: {
          actorId: null,
          actorRole: "SYSTEM",
          action: "OWNER_PAYOUT_RECOVERY_DEDUCTED",
          entity: "Invoice",
          entityId: invoiceId,
          afterJson: { ownerId, payable, deducted },
          ...retentionFields("FINANCIAL", now),
        },
      })
      .catch(() => {});
  }
  return deducted;
}

/** 7 business days passed with debt left: ask the owner to repay (policy 6.3.3) and tell admins. Once per debt. */
export async function requestOverdueRepayments(now = new Date()): Promise<number> {
  const overdue = await prisma.ownerPayoutRecovery.findMany({
    where: { status: "OPEN", dueAt: { lte: now }, repayRequestedAt: null },
    select: { id: true, ownerId: true, amount: true, recoveredAmount: true, bookingId: true },
    take: 100,
  });
  let asked = 0;
  for (const debt of overdue) {
    const outstanding = round2(Number(debt.amount) - Number(debt.recoveredAmount));
    const claimed = await prisma.ownerPayoutRecovery.updateMany({
      where: { id: debt.id, repayRequestedAt: null },
      data: { repayRequestedAt: now },
    });
    if (claimed.count !== 1) continue;
    void notifyOwner(debt.ownerId, "owner_payout_recovery_repay", { amountText: formatTzs(outstanding) }).catch(() => {});
    void notifyAdmins("owner_payout_recovery_overdue", {
      ownerId: debt.ownerId,
      recoveryId: debt.id,
      bookingId: debt.bookingId,
      amountText: formatTzs(outstanding),
    }).catch(() => {});
    asked++;
  }
  return asked;
}

/** Admin closes a debt without collecting it (for example a goodwill decision). Needs a note. */
export async function waiveRecovery(id: number, adminId: number, note: string, now = new Date()) {
  const waived = await prisma.ownerPayoutRecovery.updateMany({
    where: { id, status: "OPEN" },
    data: { status: "WAIVED", closedAt: now, note: note.slice(0, 500) },
  });
  if (waived.count !== 1) {
    const exists = await prisma.ownerPayoutRecovery.findUnique({ where: { id }, select: { id: true } });
    throw new RecoveryError(exists ? "NOT_OPEN" : "NOT_FOUND", exists ? "This recovery is already closed." : "Recovery not found.");
  }
  await prisma.auditLog
    .create({
      data: {
        actorId: adminId,
        actorRole: "ADMIN",
        action: "OWNER_PAYOUT_RECOVERY_WAIVED",
        entity: "OwnerPayoutRecovery",
        entityId: id,
        afterJson: { note },
        ...retentionFields("FINANCIAL", now),
      },
    })
    .catch(() => {});
}
