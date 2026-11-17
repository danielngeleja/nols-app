// =============================================================================
// Tour recovery offset: an operator who owes NoLSAF a recovery (money paid out
// for a trip that was later cancelled and refunded) settles it from their next
// tour balance payouts, as the Tour Operator Disbursement Policy (6.4) and the
// operator agreement (v2.0.0, 9.4) say.
//
// How it stays exact:
//  - A recovery row (TourFinancialTransaction kind PAYOUT_RECOVERY, status
//    PENDING) keeps what has been offset so far in metadata.offsetApplied. Its
//    outstanding amount is amount - offsetApplied. Fully offset rows become
//    RECOVERED, exactly as when an admin records a repayment.
//  - A balance payout's deduction is never stored up front: it is always
//    balance - disbursement amount, both fixed while the payout is in flight.
//  - While a balance payout is in flight, its deduction is "reserved": other
//    balances can only deduct what is outstanding minus those reservations, so
//    one debt is never taken twice.
//  - The deduction is applied to the oldest recoveries first when the payout
//    is confirmed paid, inside the same transaction that marks it paid.
//
// Only recoveries in the balance's own currency are offset.
// =============================================================================

import { Prisma } from "@prisma/client";
import { prisma } from "@nolsaf/prisma";
import { ADVANCE_PAID_STATUSES, balanceAfterAdvances } from "./tourPayoutPolicy.js";
import { isAdvanceRow } from "./tourPayouts.js";

type Db = Prisma.TransactionClient | typeof prisma;

const CENT = 0.005;
const money = (value: number) => Math.max(0, Math.round(value * 100) / 100);

/** Disbursement statuses after which a balance's deduction has either been applied (PAID) or released (FAILED). */
const SETTLED_DISBURSEMENT_STATUSES = ["PAID", "FAILED", "RECOVERY_PENDING", "RECOVERED"];

export type RecoveryRow = { id: number; tourBookingId: number; amount: number; offsetApplied: number; createdAt: Date };

export function offsetAppliedOf(metadata: unknown): number {
  const value = Number((metadata as any)?.offsetApplied ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function outstandingOf(row: Pick<RecoveryRow, "amount" | "offsetApplied">): number {
  return money(row.amount - row.offsetApplied);
}

/**
 * Pure: how much of a balance goes to recoveries, given what is owed and what
 * other in-flight balances have already reserved.
 */
export function planRecoveryDeduction(balance: number, totalOutstanding: number, reserved: number): number {
  const available = money(totalOutstanding - reserved);
  return money(Math.min(Math.max(0, balance), available));
}

/** Pure: spread a deduction over recoveries, oldest first. */
export function allocateDeduction(
  deduction: number,
  rows: RecoveryRow[]
): { allocations: Array<{ recoveryId: number; tourBookingId: number; amount: number; settles: boolean }>; unallocated: number } {
  let left = money(deduction);
  const allocations: Array<{ recoveryId: number; tourBookingId: number; amount: number; settles: boolean }> = [];
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  for (const row of ordered) {
    if (left <= CENT) break;
    const outstanding = outstandingOf(row);
    if (outstanding <= CENT) continue;
    const take = money(Math.min(outstanding, left));
    allocations.push({ recoveryId: row.id, tourBookingId: row.tourBookingId, amount: take, settles: take + CENT >= outstanding });
    left = money(left - take);
  }
  return { allocations, unallocated: left };
}

/** The operator's unpaid recoveries in one currency. */
export async function loadPendingRecoveries(db: Db, operatorAgentId: number, currency: string): Promise<RecoveryRow[]> {
  const rows = await db.tourFinancialTransaction.findMany({
    where: { kind: "PAYOUT_RECOVERY", status: "PENDING", currency, booking: { operatorAgentId } },
    select: { id: true, tourBookingId: true, amount: true, metadata: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    tourBookingId: row.tourBookingId,
    amount: Number(row.amount),
    offsetApplied: offsetAppliedOf(row.metadata),
    createdAt: row.createdAt,
  }));
}

/** A booking's balance before any recovery deduction: net share minus advances paid. */
export async function grossBalanceOf(db: Db, bookingId: number, operatorPayoutAmount: number): Promise<number> {
  const rows = await db.tourFinancialTransaction.findMany({
    where: { tourBookingId: bookingId, kind: "PAYOUT", status: { in: [...ADVANCE_PAID_STATUSES] } },
    select: { amount: true, metadata: true },
  });
  const paid = rows.filter((row) => isAdvanceRow(row.metadata)).reduce((sum, row) => sum + Number(row.amount), 0);
  return balanceAfterAdvances(operatorPayoutAmount, paid);
}

/**
 * Deductions held by this operator's balance payouts that are still in flight.
 * `excludeBookingId` leaves out the balance being evaluated.
 */
export async function reservedRecoveryDeductions(db: Db, operatorAgentId: number, currency: string, excludeBookingId?: number): Promise<number> {
  const live = await db.disbursement.findMany({
    where: { sourceType: "TOUR_BOOKING", currency, status: { notIn: SETTLED_DISBURSEMENT_STATUSES } },
    select: { sourceId: true, amount: true },
  });
  if (!live.length) return 0;
  const bookings = await db.tourBooking.findMany({
    where: { id: { in: live.map((d) => d.sourceId).filter((id) => id !== excludeBookingId) }, operatorAgentId },
    select: { id: true, operatorPayoutAmount: true },
  });
  let reserved = 0;
  for (const booking of bookings) {
    const disbursement = live.find((d) => d.sourceId === booking.id);
    if (!disbursement) continue;
    const gross = await grossBalanceOf(db, booking.id, Number(booking.operatorPayoutAmount));
    reserved += Math.max(0, gross - Number(disbursement.amount));
  }
  return money(reserved);
}

/** What a balance would pay now: the gross balance less the recovery deduction. */
export async function quoteBalanceWithRecovery(
  db: Db,
  params: { bookingId: number; operatorAgentId: number; currency: string; grossBalance: number }
): Promise<{ grossBalance: number; deduction: number; net: number; outstanding: number }> {
  const [rows, reserved] = await Promise.all([
    loadPendingRecoveries(db, params.operatorAgentId, params.currency),
    reservedRecoveryDeductions(db, params.operatorAgentId, params.currency, params.bookingId),
  ]);
  const outstanding = money(rows.reduce((sum, row) => sum + outstandingOf(row), 0));
  const deduction = planRecoveryDeduction(params.grossBalance, outstanding, reserved);
  return { grossBalance: money(params.grossBalance), deduction, net: money(params.grossBalance - deduction), outstanding };
}

/**
 * For the operator's revenues page: how much of each unpaid balance goes to
 * recoveries. A balance already in a payout shows its exact deduction; the
 * rest share what is still owed, oldest trip first, as the deduction expected
 * if they are paid in that order.
 */
export async function previewRecoveryDeductions(
  operatorAgentId: number,
  balances: Array<{ bookingId: number; currency: string; grossBalance: number; createdAt: Date | string | null; open: boolean }>
): Promise<Map<number, { deduction: number; exact: boolean }>> {
  const out = new Map<number, { deduction: number; exact: boolean }>();
  const open = balances.filter((b) => b.open && b.grossBalance > CENT);
  if (!open.length) return out;

  const live = await prisma.disbursement.findMany({
    where: { sourceType: "TOUR_BOOKING", sourceId: { in: open.map((b) => b.bookingId) }, status: { notIn: SETTLED_DISBURSEMENT_STATUSES } },
    select: { sourceId: true, amount: true },
  });
  const liveBy = new Map<number, number>(live.map((d) => [d.sourceId, Number(d.amount)] as [number, number]));

  for (const currency of new Set(open.map((b) => b.currency))) {
    const rows = await loadPendingRecoveries(prisma, operatorAgentId, currency);
    const owed = money(rows.reduce((sum, row) => sum + outstandingOf(row), 0));
    if (owed <= CENT) continue;
    const reserved = await reservedRecoveryDeductions(prisma, operatorAgentId, currency);
    let available = money(owed - reserved);
    const inCurrency = open
      .filter((b) => b.currency === currency)
      .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    for (const b of inCurrency) {
      const paying = liveBy.get(b.bookingId);
      if (paying != null) {
        out.set(b.bookingId, { deduction: money(Math.max(0, b.grossBalance - paying)), exact: true });
        continue;
      }
      const take = money(Math.min(b.grossBalance, available));
      if (take > CENT) out.set(b.bookingId, { deduction: take, exact: false });
      available = money(available - take);
    }
  }
  return out;
}

/**
 * Settles an approved balance that the operator's recoveries absorb entirely:
 * no money is sent, the whole balance is applied to the recoveries, and the
 * balance is closed as paid by offset. Returns null when it no longer applies
 * (the balance is not approved, or there is now money left to send).
 */
export async function settleBalanceByRecoveryOffset(
  bookingId: number,
  adminId: number
): Promise<{ bookingCode: string; operatorAgentId: number; currency: string; grossBalance: number; applied: number } | null> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.tourBooking.findUnique({
      where: { id: bookingId },
      select: { id: true, bookingCode: true, payoutStatus: true, operatorAgentId: true, operatorPayoutAmount: true, currency: true },
    });
    if (!booking || booking.payoutStatus !== "APPROVED") return null;
    const grossBalance = await grossBalanceOf(tx, booking.id, Number(booking.operatorPayoutAmount));
    if (grossBalance <= CENT) return null;
    const quote = await quoteBalanceWithRecovery(tx, { bookingId: booking.id, operatorAgentId: booking.operatorAgentId, currency: booking.currency, grossBalance });
    if (quote.net > CENT) return null;

    const now = new Date();
    const reference = `OFFSET-${booking.bookingCode}`.slice(0, 120);
    const offset = await applyRecoveryDeduction(tx, {
      operatorAgentId: booking.operatorAgentId,
      currency: booking.currency,
      deduction: grossBalance,
      sourceBookingId: booking.id,
      sourceBookingCode: booking.bookingCode,
      reference,
      now,
    });
    await tx.tourBooking.update({
      where: { id: booking.id },
      data: { payoutStatus: "DISBURSED", operatorPayoutRef: reference, payoutPaidAt: now },
    });
    await tx.tourFinancialTransaction.create({
      data: {
        tourBookingId: booking.id,
        kind: "PAYOUT",
        status: "DISBURSED",
        reference,
        currency: booking.currency,
        amount: 0,
        metadata: {
          via: "recovery_offset",
          grossBalance,
          recoveryDeduction: grossBalance,
          recoveryApplied: offset.applied,
          recoveryUnallocated: offset.unallocated,
          recoveryAllocations: offset.allocations,
          settledBy: adminId,
        } as Prisma.InputJsonValue,
      },
    });
    return { bookingCode: booking.bookingCode, operatorAgentId: booking.operatorAgentId, currency: booking.currency, grossBalance, applied: offset.applied };
  });
}

/**
 * Applies a deduction to the operator's oldest recoveries. Call inside the
 * transaction that settles the balance. Fully covered recoveries become
 * RECOVERED and their booking's payoutStatus RECOVERED; each gets a case event
 * so both NoLSAF and the operator can see where the money came from.
 */
export async function applyRecoveryDeduction(
  tx: Prisma.TransactionClient,
  params: { operatorAgentId: number; currency: string; deduction: number; sourceBookingId: number; sourceBookingCode: string; reference: string; now: Date }
): Promise<{ applied: number; unallocated: number; allocations: Array<{ recoveryId: number; tourBookingId: number; amount: number; settles: boolean }> }> {
  if (params.deduction <= CENT) return { applied: 0, unallocated: 0, allocations: [] };
  const rows = await loadPendingRecoveries(tx, params.operatorAgentId, params.currency);
  const { allocations, unallocated } = allocateDeduction(params.deduction, rows);

  for (const entry of allocations) {
    const current = await tx.tourFinancialTransaction.findUniqueOrThrow({ where: { id: entry.recoveryId }, select: { metadata: true, amount: true } });
    const meta = ((current.metadata as Record<string, unknown>) || {}) as Record<string, any>;
    const offsetApplied = money(offsetAppliedOf(meta) + entry.amount);
    const offsets = Array.isArray(meta.offsets) ? meta.offsets : [];
    await tx.tourFinancialTransaction.update({
      where: { id: entry.recoveryId },
      data: {
        ...(entry.settles ? { status: "RECOVERED", reference: `OFFSET:${params.reference}:${entry.recoveryId}`.slice(0, 160) } : {}),
        metadata: {
          ...meta,
          offsetApplied,
          offsets: [...offsets, { amount: entry.amount, fromBookingId: params.sourceBookingId, fromBookingCode: params.sourceBookingCode, payoutReference: params.reference, at: params.now.toISOString() }],
          ...(entry.settles ? { recordedAt: params.now.toISOString(), settledBy: "BALANCE_OFFSET" } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    if (entry.settles) {
      await tx.tourBooking.update({ where: { id: entry.tourBookingId }, data: { payoutStatus: "RECOVERED" } });
    }
    const caseId = Number(meta.caseId);
    if (Number.isFinite(caseId) && caseId > 0) {
      await tx.tourCaseEvent.create({
        data: {
          tourCaseId: caseId,
          type: entry.settles ? "RECORD_RECOVERY" : "RECOVERY_OFFSET",
          message: entry.settles
            ? `Recovery settled: ${params.currency} ${entry.amount.toLocaleString("en-US")} deducted from the balance of booking ${params.sourceBookingCode}.`
            : `${params.currency} ${entry.amount.toLocaleString("en-US")} deducted from the balance of booking ${params.sourceBookingCode}. ${params.currency} ${money(outstandingOf({ amount: Number(current.amount), offsetApplied })).toLocaleString("en-US")} still owed.`,
          data: { recoveryReference: `OFFSET:${params.reference}`, amount: entry.amount, settledBy: "BALANCE_OFFSET", fromBookingId: params.sourceBookingId } as Prisma.InputJsonValue,
        },
      });
    }
  }

  return { applied: money(params.deduction - unallocated), unallocated, allocations };
}
