import crypto from "crypto";
import { getCheckoutSettlement } from "./nrmsFolio.js";
import { markRoomsDirtyOnCheckout } from "./nrmsHousekeeping.js";
import { evaluateNrmsDunning } from "./nrmsDunning.js";

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

export function buildNrmsUsageRows(input: {
  accountId: number; propertyId: number; reservationId: number; policyId: number;
  trialEndsAt: Date; currency: string; roomNightPrice: number; source: string;
  allocations: Array<{ id: number; startDate: Date; endDate: Date }>;
}) {
  const trialEnd = utcDay(input.trialEndsAt);
  const commissionOnly = input.source.trim().toUpperCase() === "NOLSAF";
  const rows: any[] = [];
  for (const allocation of input.allocations) {
    for (let day = utcDay(allocation.startDate); day < utcDay(allocation.endDate); day = new Date(day.getTime() + DAY_MS)) {
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

export async function finalizeNrmsCheckout(tx: any, reservation: any, ownerId: number, verifiedChargeIds: number[] = []) {
  const [currentFolio, paymentAggregate, chargeAggregate, activeCharges, openOutletOrderCount, unclassifiedOutletPaymentCount] = await Promise.all([
    tx.reservation.findUnique({
      where: { id: reservation.id },
      select: { status: true, totalAmount: true },
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
  ]);
  if (!currentFolio || currentFolio.status !== "CHECKED_IN") throw new Error("NRMS_INVALID_TRANSITION_RACE");
  if (openOutletOrderCount > 0) throw new Error(`NRMS_OPEN_OUTLET_ORDERS:${openOutletOrderCount}`);
  if (unclassifiedOutletPaymentCount > 0) throw new Error(`NRMS_UNCLASSIFIED_OUTLET_PAYMENTS:${unclassifiedOutletPaymentCount}`);
  const amountPaid = paymentAggregate._sum.amount ?? 0;
  const chargesTotal = chargeAggregate._sum.amount ?? 0;
  const settlement = getCheckoutSettlement(currentFolio.totalAmount, chargesTotal, amountPaid);
  if (!settlement.settled) throw new Error(`NRMS_${settlement.code}:${settlement.balance}`);
  const verified = new Set(verifiedChargeIds);
  const missingChargeIds = activeCharges
    .filter(chargeRequiresCheckoutVerification)
    .map((charge: { id: number }) => charge.id)
    .filter((id: number) => !verified.has(id));
  if (missingChargeIds.length > 0) throw new Error(`NRMS_CHARGES_NOT_VERIFIED:${missingChargeIds.join(",")}`);

  const account = await tx.ownerPaygAccount.findUnique({ where: { propertyId: reservation.propertyId }, include: { policy: true } });
  if (!account) throw new Error("NRMS_PAYG_ACCOUNT_MISSING");
  const changed = await tx.reservation.updateMany({
    where: { id: reservation.id, ownerId, status: "CHECKED_IN" },
    data: { status: "CHECKED_OUT", checkedOutAt: new Date(), amountPaid, chargesTotal },
  });
  if (changed.count !== 1) throw new Error("NRMS_INVALID_TRANSITION_RACE");

  const allocations = await tx.reservationRoomAllocation.findMany({ where: { reservationId: reservation.id, status: "ACTIVE" } });
  await markRoomsDirtyOnCheckout(tx, {
    propertyId: reservation.propertyId,
    reservationId: reservation.id,
    roomUnitIds: allocations.map((allocation: any) => allocation.roomUnitId).filter((id: any) => id != null),
    actorId: ownerId,
  });
  const data = buildNrmsUsageRows({
    accountId: account.id, propertyId: reservation.propertyId, reservationId: reservation.id, policyId: account.policyId,
    trialEndsAt: account.trialEndsAt, currency: account.policy.currency, roomNightPrice: Number(account.policy.roomNightPrice),
    source: reservation.source, allocations,
  });
  if (data.length) await tx.nrmsUsageEvent.createMany({ data, skipDuplicates: true });
  const billable = data.reduce((sum, row) => sum + Number(row.amount), 0);
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
  await tx.reservationEvent.create({ data: { reservationId: reservation.id, type: "CHECKED_OUT", actorId: ownerId, data: { usageEvents: data.length, billableAmount: billable } } });
  return { usageEvents: data.length, billableAmount: billable, paygStatus: status, unpaidBalance: newBalance };
}

export async function reconcileNrmsPayment(tx: any, input: { token: string; provider: string; providerRef: string; idempotencyKey: string; amount: number }) {
  const token = await tx.nrmsServicePaymentToken.findUnique({ where: { token: input.token }, include: { statement: { include: { account: { include: { policy: true } } } }, payment: true } });
  if (!token) throw new Error("NRMS_TOKEN_NOT_FOUND");
  // A repeated callback for the token that already won is idempotent. It must
  // never create another payment or reduce the account balance twice.
  if (token.payment) return token.payment;
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
  return payment;
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
