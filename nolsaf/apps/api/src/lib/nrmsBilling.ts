import crypto from "crypto";
import { getCheckoutSettlement } from "./nrmsFolio.js";
import { markRoomsDirtyOnCheckout } from "./nrmsHousekeeping.js";
import { evaluateNrmsDunning } from "./nrmsDunning.js";
import { accrueNrmsSalesCommission } from "./salesCommission.js";
import { getMasterCheckoutBlocker, transferredToMasterForReservation } from "./nrmsMasterFolio.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function chargeRequiresCheckoutVerification(charge: {
  outletOrder?: { status?: string | null; settlementMode?: string | null } | null;
}): boolean {
  return !(
    charge.outletOrder?.status === "POSTED_TO_FOLIO" &&
    charge.outletOrder?.settlementMode === "ROOM_FOLIO"
  );
}

function billedKey(allocationId: number, day: Date): string {
  return `${allocationId}:${day.toISOString().slice(0, 10)}`;
}

/**
 * One row per elapsed night, capped at `postThroughDate` when given (nightly accrual
 * only wants nights that have actually happened, not the rest of a future stay) and
 * skipping any night already present in `alreadyBilled` (checkout re-running this for
 * a stay that nightly accrual already posted most of must not re-bill those nights -
 * the DB unique constraint is keyed on policyId too, so it alone can't be trusted if
 * the account moved to a newer policy mid-stay).
 */
export function buildNrmsUsageRows(input: {
  accountId: number; propertyId: number; reservationId: number; policyId: number;
  trialEndsAt: Date; currency: string; roomNightPrice: number; source: string;
  bookingId?: number | null;
  allocations: Array<{ id: number; startDate: Date; endDate: Date }>;
  postThroughDate?: Date;
  alreadyBilled?: Set<string>;
}) {
  const trialEnd = utcDay(input.trialEndsAt);
  // A linked Booking is the authoritative marketplace signal: NoLSAF already
  // earned commission on that stay, so the PAYG room-night fee must not apply
  // on top. The source string is only a fallback, because the FK is what every
  // other marketplace code path keys on and the two must never disagree.
  const commissionOnly = input.bookingId != null || input.source.trim().toUpperCase() === "NOLSAF";
  const cutoff = input.postThroughDate ? utcDay(input.postThroughDate) : null;
  const rows: any[] = [];
  for (const allocation of input.allocations) {
    const stayEnd = utcDay(allocation.endDate);
    const end = cutoff && cutoff < stayEnd ? cutoff : stayEnd;
    for (let day = utcDay(allocation.startDate); day < end; day = new Date(day.getTime() + DAY_MS)) {
      if (input.alreadyBilled?.has(billedKey(allocation.id, day))) continue;
      const trialFree = day < trialEnd;
      const classification = commissionOnly ? "COMMISSION_ONLY" : trialFree ? "TRIAL_FREE" : "BILLABLE_EXTERNAL";
      rows.push({
        accountId: input.accountId, propertyId: input.propertyId, reservationId: input.reservationId,
        allocationId: allocation.id, policyId: input.policyId, serviceDate: day,
        classification, source: input.source,
        currency: input.currency, amount: commissionOnly || trialFree ? 0 : input.roomNightPrice,
      });
    }
  }
  return rows;
}

/** Nights already posted for these allocations, regardless of which policy billed them. */
export async function getAlreadyBilledNights(tx: any, allocationIds: number[]): Promise<Set<string>> {
  if (!allocationIds.length) return new Set();
  const existing = await tx.nrmsUsageEvent.findMany({
    where: { allocationId: { in: allocationIds } },
    select: { allocationId: true, serviceDate: true },
  });
  return new Set(existing.map((row: any) => billedKey(row.allocationId, utcDay(row.serviceDate))));
}

/**
 * Shared by checkout and nightly accrual: insert usage rows, roll the balance,
 * re-evaluate dunning, and open a payable statement the moment PAYMENT_REQUIRED
 * is reached. Both callers must go through here so a night can never be billed
 * by one path without the other's dunning/statement side effects applying too.
 */
export async function applyNrmsUsageRows(tx: any, account: any, rows: any[]) {
  if (rows.length) await tx.nrmsUsageEvent.createMany({ data: rows, skipDuplicates: true });
  const billable = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const newBalance = Number(account.unpaidBalance) + billable;
  const dunning = evaluateNrmsDunning({
    balance: newBalance,
    reminderAmount: Number(account.policy.reminderAmount),
    warningAmount: Number(account.policy.warningAmount),
    unpaidLimit: Number(account.unpaidLimit),
    graceDays: account.policy.graceDays,
    limitReachedAt: account.limitReachedAt,
    trialEndsAt: account.trialEndsAt,
    currentStatus: account.status,
  });
  const status = dunning.status;
  await tx.ownerPaygAccount.update({ where: { id: account.id }, data: { unpaidBalance: newBalance, status, limitReachedAt: dunning.limitReachedAt } });

  if (status === "PAYMENT_REQUIRED") {
    const unstated = await tx.nrmsUsageEvent.findMany({
      where: { accountId: account.id, amount: { gt: 0 }, statementItem: null }, select: { id: true, amount: true },
    });
    if (unstated.length) {
      const amount = unstated.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
      const statement = await tx.nrmsBillingStatement.create({ data: { accountId: account.id, amount, currency: account.policy.currency } });
      await tx.nrmsBillingStatementItem.createMany({ data: unstated.map((row: any) => ({ statementId: statement.id, usageEventId: row.id, amount: row.amount })) });
      await tx.nrmsServicePaymentToken.create({
        data: { statementId: statement.id, token: `NRMS-${crypto.randomBytes(18).toString("hex").toUpperCase()}`, amount, currency: account.policy.currency, expiresAt: new Date(Date.now() + 7 * DAY_MS) },
      });
    }
  }
  return { usageEvents: rows.length, billableAmount: billable, paygStatus: status, unpaidBalance: newBalance };
}

export async function completeMarketplaceBookingCheckout(tx: any, reservation: any) {
  if (reservation.bookingId == null) return { linked: false, alreadyCheckedOut: false };

  const bookingChanged = await tx.booking.updateMany({
    where: {
      id: reservation.bookingId,
      propertyId: reservation.propertyId,
      status: "CHECKED_IN",
    },
    data: { status: "CHECKED_OUT" },
  });
  if (bookingChanged.count === 1) return { linked: true, alreadyCheckedOut: false };

  const linkedBooking = await tx.booking.findUnique({
    where: { id: reservation.bookingId },
    select: { propertyId: true, status: true },
  });
  const linkedStatus = linkedBooking?.propertyId === reservation.propertyId
    ? String(linkedBooking.status || "UNKNOWN").toUpperCase()
    : "MISSING";
  if (linkedStatus !== "CHECKED_OUT") {
    throw new Error(`NRMS_MARKETPLACE_STATUS_CONFLICT:${linkedStatus}`);
  }
  return { linked: true, alreadyCheckedOut: true };
}

export async function finalizeNrmsCheckout(tx: any, reservation: any, ownerId: number, verifiedChargeIds: number[] = []) {
  const [currentFolio, paymentAggregate, chargeAggregate, activeCharges, openOutletOrderCount, unclassifiedOutletPaymentCount, transferredToMaster] = await Promise.all([
    tx.reservation.findUnique({
      where: { id: reservation.id },
      select: { status: true, totalAmount: true, groupId: true },
    }),
    tx.externalPaymentRecord.aggregate({
      where: { reservationId: reservation.id, voidedAt: null },
      _sum: { amount: true },
    }),
    tx.reservationCharge.aggregate({
      where: { reservationId: reservation.id, voidedAt: null },
      _sum: { amount: true },
    }),
    tx.reservationCharge.findMany({
      where: { reservationId: reservation.id, voidedAt: null },
      select: {
        id: true,
        outletOrder: { select: { status: true, settlementMode: true } },
      },
    }),
    tx.nrmsOutletOrder.count({
      where: { reservationId: reservation.id, status: { in: ["CONFIRMED", "PREPARING", "SERVING"] } },
    }),
    tx.nrmsOutletOrder.count({
      where: {
        reservationId: reservation.id,
        status: "SETTLED",
        settlementMode: "OUTLET_PAYMENT",
        settlementMethod: null,
        voidedAt: null,
      },
    }),
    transferredToMasterForReservation(tx, reservation.id),
  ]);
  if (!currentFolio || currentFolio.status !== "CHECKED_IN") throw new Error("NRMS_INVALID_TRANSITION_RACE");
  if (openOutletOrderCount > 0) throw new Error(`NRMS_OPEN_OUTLET_ORDERS:${openOutletOrderCount}`);
  if (unclassifiedOutletPaymentCount > 0) throw new Error(`NRMS_UNCLASSIFIED_OUTLET_PAYMENTS:${unclassifiedOutletPaymentCount}`);
  const amountPaid = paymentAggregate._sum.amount ?? 0;
  const chargesTotal = chargeAggregate._sum.amount ?? 0;
  const settlement = getCheckoutSettlement(currentFolio.totalAmount, chargesTotal, Number(amountPaid) + transferredToMaster);
  if (!settlement.settled) throw new Error(`NRMS_${settlement.code}:${settlement.balance}`);
  const verified = new Set(verifiedChargeIds);
  const missingChargeIds = activeCharges
    .filter(chargeRequiresCheckoutVerification)
    .map((charge: { id: number }) => charge.id)
    .filter((id: number) => !verified.has(id));
  if (missingChargeIds.length > 0) throw new Error(`NRMS_CHARGES_NOT_VERIFIED:${missingChargeIds.join(",")}`);

  const masterBlocker = currentFolio.groupId || transferredToMaster > 0
    ? await getMasterCheckoutBlocker(tx, currentFolio.groupId, { reservationId: reservation.id })
    : null;
  if (masterBlocker) throw new Error(`NRMS_${masterBlocker.code}:${masterBlocker.balance}`);

  const account = await tx.ownerPaygAccount.findUnique({ where: { propertyId: reservation.propertyId }, include: { policy: true } });
  if (!account) throw new Error("NRMS_PAYG_ACCOUNT_MISSING");
  const changed = await tx.reservation.updateMany({
    where: { id: reservation.id, ownerId, status: "CHECKED_IN" },
    data: { status: "CHECKED_OUT", checkedOutAt: new Date(), amountPaid, chargesTotal },
  });
  if (changed.count !== 1) throw new Error("NRMS_INVALID_TRANSITION_RACE");

  // A marketplace stay has two deliberately different records: Reservation
  // owns operations and Booking owns commerce. Checkout must advance both in
  // this same transaction so neither workspace can observe a split state.
  await completeMarketplaceBookingCheckout(tx, reservation);

  const allocations = await tx.reservationRoomAllocation.findMany({ where: { reservationId: reservation.id, status: "ACTIVE" } });
  await markRoomsDirtyOnCheckout(tx, {
    propertyId: reservation.propertyId,
    reservationId: reservation.id,
    roomUnitIds: allocations.map((allocation: any) => allocation.roomUnitId).filter((id: any) => id != null),
    actorId: ownerId,
  });
  // Nightly accrual may have already posted most of this stay's nights while the
  // guest was still checked in - only bill whatever it hasn't gotten to yet.
  const alreadyBilled = await getAlreadyBilledNights(tx, allocations.map((allocation: any) => allocation.id));
  const rows = buildNrmsUsageRows({
    accountId: account.id, propertyId: reservation.propertyId, reservationId: reservation.id, policyId: account.policyId,
    trialEndsAt: account.trialEndsAt, currency: account.policy.currency, roomNightPrice: Number(account.policy.roomNightPrice),
    source: reservation.source, bookingId: reservation.bookingId ?? null, allocations, alreadyBilled,
  });
  const result = await applyNrmsUsageRows(tx, account, rows);
  await tx.reservationEvent.create({ data: { reservationId: reservation.id, type: "CHECKED_OUT", actorId: ownerId, data: { usageEvents: result.usageEvents, billableAmount: result.billableAmount } } });
  return result;
}

export type NrmsPaymentReconcileInput = {
  token: string;
  provider: string;
  providerRef: string;
  idempotencyKey: string;
  amount: number;
};

export async function reconcileNrmsPayment(tx: any, input: NrmsPaymentReconcileInput) {
  const token = await tx.nrmsServicePaymentToken.findUnique({ where: { token: input.token }, include: { statement: { include: { account: { include: { policy: true } } } }, payment: true } });
  if (!token) throw new Error("NRMS_TOKEN_NOT_FOUND");
  // A repeated callback for the token that already won is idempotent. It must
  // never create another payment or reduce the account balance twice.
  if (token.payment) return { payment: token.payment, statementId: token.statementId };
  const tokenStatus = String(token.status || "").toUpperCase();
  if (!["PENDING", "PROCESSING"].includes(tokenStatus)) throw new Error("NRMS_TOKEN_INVALID_STATUS");
  if (token.expiresAt <= new Date()) throw new Error("NRMS_TOKEN_EXPIRED");
  if (String(token.statement.status || "").toUpperCase() !== "PAYABLE") throw new Error("NRMS_STATEMENT_NOT_PAYABLE");
  if (input.amount !== Number(token.amount)) throw new Error("NRMS_PAYMENT_AMOUNT_MISMATCH");

  // Atomically claim the statement. Concurrent callbacks for sibling tokens
  // cannot both change PAYABLE -> PAID, so exactly one payment can win.
  const paidAt = new Date();
  const claimed = await tx.nrmsBillingStatement.updateMany({
    where: { id: token.statementId, status: "PAYABLE" },
    data: { status: "PAID", paidAt },
  });
  if (claimed.count !== 1) throw new Error("NRMS_STATEMENT_NOT_PAYABLE");

  const payment = await tx.nrmsServicePayment.create({ data: { tokenId: token.id, provider: input.provider, providerRef: input.providerRef, idempotencyKey: input.idempotencyKey, amount: input.amount, currency: token.currency, status: "VERIFIED", verifiedAt: new Date() } });
  await tx.nrmsServicePaymentToken.update({ where: { id: token.id }, data: { status: "PAID" } });
  await tx.nrmsServicePaymentToken.updateMany({
    where: {
      statementId: token.statementId,
      id: { not: token.id },
      status: { in: ["PENDING", "PROCESSING", "FAILED", "EXPIRED"] },
    },
    data: { status: "VOID" },
  });
  const account = token.statement.account;
  const balance = Math.max(0, Number(account.unpaidBalance) - input.amount);
  const dunning = evaluateNrmsDunning({ balance, reminderAmount: Number(account.policy.reminderAmount), warningAmount: Number(account.policy.warningAmount), unpaidLimit: Number(account.unpaidLimit), graceDays: account.policy.graceDays, trialEndsAt: account.trialEndsAt });
  await tx.ownerPaygAccount.update({ where: { id: account.id }, data: { unpaidBalance: balance, status: dunning.status, limitReachedAt: dunning.limitReachedAt, reminderNotifiedAt: balance < Number(account.policy.reminderAmount) ? null : undefined, warningNotifiedAt: balance < Number(account.policy.warningAmount) ? null : undefined, freezeNotifiedAt: balance < Number(account.unpaidLimit) ? null : undefined } });
  return { payment, statementId: token.statementId };
}

export async function accrueNrmsSalesCommissionAfterCommit(
  client: any,
  statementId: number,
  context = "NRMS",
) {
  try {
    return await accrueNrmsSalesCommission(client, statementId);
  } catch (error: any) {
    // Payment settlement remains authoritative. Commission accrual is
    // idempotent and the lifecycle worker can retry a deferred attempt.
    console.warn(`[sales commission] ${context} accrual deferred:`, error?.message || String(error));
    return null;
  }
}

export async function reconcileNrmsPaymentAndAccrue(
  client: any,
  input: NrmsPaymentReconcileInput,
  context = "NRMS",
) {
  // Keep the authoritative payment transaction short. Commission attribution
  // performs several independent reads and must never consume the transaction's
  // timeout or poison its commit when that secondary work is slow.
  const settled = await client.$transaction((tx: any) => reconcileNrmsPayment(tx, input));
  await accrueNrmsSalesCommissionAfterCommit(client, settled.statementId, context);
  return settled.payment;
}

export async function markNrmsPaymentFailed(tx: any, tokenValue: string) {
  const token = await tx.nrmsServicePaymentToken.findUnique({
    where: { token: tokenValue },
    include: { statement: { include: { account: { include: { policy: true } } } }, payment: true },
  });
  if (!token || token.payment) return;
  if (String(token.statement.status || "").toUpperCase() !== "PAYABLE") return;
  if (!["PENDING", "PROCESSING"].includes(String(token.status || "").toUpperCase())) return;
  const changed = await tx.nrmsServicePaymentToken.updateMany({
    where: { id: token.id, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "FAILED" },
  });
  if (changed.count !== 1) return;
  const account = token.statement.account;
  const balance = Number(account.unpaidBalance);
  const dunning = evaluateNrmsDunning({ balance, reminderAmount: Number(account.policy.reminderAmount), warningAmount: Number(account.policy.warningAmount), unpaidLimit: Number(account.unpaidLimit), graceDays: account.policy.graceDays, limitReachedAt: account.limitReachedAt, trialEndsAt: account.trialEndsAt });
  await tx.ownerPaygAccount.update({ where: { id: account.id }, data: { status: dunning.status, limitReachedAt: dunning.limitReachedAt } });
}
