import crypto from "node:crypto";

/**
 * NRMS usage statements: the one place that decides what an owner is asked to pay.
 *
 * Rules, enforced here so the three callers (usage billing at PAYMENT_REQUIRED,
 * the dunning worker, and the owner pressing Pay) can never drift apart:
 *
 * 1. The account's unpaidBalance is authoritative. Open statements together
 *    never ask for more than it.
 * 2. Statements are built from net usage. Reversals (admin credits) are
 *    folded in alongside charges, so credited nights cannot be billed again.
 * 3. One open statement at a time. New usage joins the open statement instead
 *    of starting a second one, unless a payment for it is already in flight.
 * 4. A statement with a provider payment in flight (token PROCESSING) is never
 *    changed: the amount the provider is charging must stay the amount owed.
 */

export const NRMS_STATEMENT_TOKEN_TTL_MS = 7 * 86_400_000;

export class NrmsPaymentInFlightError extends Error {
  readonly code = "NRMS_PAYMENT_IN_FLIGHT";
  constructor() {
    super("A payment for this NRMS statement is already being processed. Try again once it completes.");
    this.name = "NrmsPaymentInFlightError";
  }
}

type AccountLike = { id: number; propertyId: number; policyId: number; unpaidBalance: unknown; policy: { currency: string } };

const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const newTokenValue = () => `NRMS-${crypto.randomBytes(18).toString("hex").toUpperCase()}`;

async function paymentInFlight(tx: any, statementId: number): Promise<boolean> {
  const row = await tx.nrmsServicePaymentToken.findFirst({ where: { statementId, status: "PROCESSING" }, select: { id: true } });
  return Boolean(row);
}

/**
 * Point the statement's payment link at `amount`: unused links are voided and,
 * when something is still owed, one fresh link is issued for exactly that sum.
 */
export async function refreshNrmsStatementToken(tx: any, statement: { id: number; currency: string }, amount: number, now: Date) {
  await tx.nrmsServicePaymentToken.updateMany({
    where: { statementId: statement.id, status: { in: ["PENDING", "FAILED", "EXPIRED"] } },
    data: { status: "VOID" },
  });
  if (amount <= 0) return null;
  return tx.nrmsServicePaymentToken.create({
    data: { statementId: statement.id, token: newTokenValue(), amount, currency: statement.currency, expiresAt: new Date(now.getTime() + NRMS_STATEMENT_TOKEN_TTL_MS) },
  });
}

export type NrmsStatementSync = {
  /** The open statement after syncing, or null when nothing is payable. */
  statementId: number | null;
  amount: number;
  /** Usage rows (charges and reversals) attached by this call. */
  folded: number;
  /** True when an open statement was left untouched because a payment is in flight. */
  deferred: boolean;
};

/**
 * Brings the account's open statement in line with its unbilled usage and its
 * balance. Safe to call repeatedly; does nothing when there is nothing to do.
 */
export async function syncNrmsStatement(tx: any, account: AccountLike, options: { now?: Date } = {}): Promise<NrmsStatementSync> {
  const now = options.now ?? new Date();
  const owed = Math.max(0, money(account.unpaidBalance));
  const open: any[] = await tx.nrmsBillingStatement.findMany({ where: { accountId: account.id, status: "PAYABLE" }, orderBy: { id: "asc" } });
  const unbilled: Array<{ id: number; amount: unknown }> = await tx.nrmsUsageEvent.findMany({
    where: { accountId: account.id, statementItem: null, amount: { not: 0 } },
    select: { id: true, amount: true },
    orderBy: { id: "asc" },
  });
  const net = money(unbilled.reduce((sum, row) => sum + Number(row.amount), 0));

  // Fold into the newest open statement that has no payment in flight.
  let target: any = null;
  let inFlight = false;
  for (let index = open.length - 1; index >= 0; index -= 1) {
    if (await paymentInFlight(tx, open[index].id)) { inFlight = true; continue; }
    target = open[index];
    break;
  }
  const othersTotal = money(open.filter((row) => row !== target).reduce((sum, row) => sum + Number(row.amount), 0));
  const room = Math.max(0, money(owed - othersTotal));

  if (!target) {
    if (inFlight) return { statementId: open[open.length - 1]?.id ?? null, amount: money(open[open.length - 1]?.amount), folded: 0, deferred: true };
    if (!unbilled.length) return { statementId: null, amount: 0, folded: 0, deferred: false };
    // A credit larger than the usage waits for future usage instead of being consumed now.
    if (net <= 0) return { statementId: null, amount: 0, folded: 0, deferred: false };
    const amount = Math.min(net, room);
    const statement = await tx.nrmsBillingStatement.create({
      data: { accountId: account.id, amount, currency: account.policy.currency, status: amount > 0 ? "PAYABLE" : "VOID" },
    });
    await tx.nrmsBillingStatementItem.createMany({ data: unbilled.map((row) => ({ statementId: statement.id, usageEventId: row.id, amount: row.amount })) });
    if (amount > 0) await refreshNrmsStatementToken(tx, statement, amount, now);
    return { statementId: amount > 0 ? statement.id : null, amount, folded: unbilled.length, deferred: false };
  }

  const current = money(target.amount);
  // Unbilled rows join the statement unless their net credit is bigger than the
  // statement itself; then they wait, so the excess credit is not thrown away.
  const absorb = unbilled.length && money(current + net) >= 0 ? unbilled : [];
  const nextAmount = Math.max(0, Math.min(absorb.length ? money(current + net) : current, room));
  if (absorb.length) {
    await tx.nrmsBillingStatementItem.createMany({ data: absorb.map((row) => ({ statementId: target.id, usageEventId: row.id, amount: row.amount })) });
  }
  const changed = nextAmount !== current;
  if (changed) {
    await tx.nrmsBillingStatement.update({ where: { id: target.id }, data: { amount: nextAmount, status: nextAmount > 0 ? "PAYABLE" : "VOID" } });
  }
  const liveToken = await tx.nrmsServicePaymentToken.findFirst({
    where: { statementId: target.id, status: "PENDING", expiresAt: { gt: now } },
    select: { id: true, amount: true },
  });
  if (changed || !liveToken || money(liveToken.amount) !== nextAmount) await refreshNrmsStatementToken(tx, target, nextAmount, now);
  return { statementId: nextAmount > 0 ? target.id : null, amount: nextAmount, folded: absorb.length, deferred: inFlight };
}

export type NrmsCreditResult = {
  usageEventIds: number[];
  appliedToStatements: Array<{ statementId: number; amount: number; remaining: number }>;
  /** Credit not matched to a statement; it is subtracted from the next one. */
  carried: number;
};

/**
 * Applies an admin credit. It covers open statements oldest first, splitting
 * into one reversal row per statement (a usage row can belong to one statement
 * only), and keeps any remainder as an unbilled reversal so the next statement
 * nets it. The caller lowers unpaidBalance by the same amount in the same
 * transaction.
 */
export async function applyNrmsCredit(tx: any, account: AccountLike, amount: number, options: { now?: Date } = {}): Promise<NrmsCreditResult> {
  const now = options.now ?? new Date();
  const open: any[] = await tx.nrmsBillingStatement.findMany({ where: { accountId: account.id, status: "PAYABLE" }, orderBy: { id: "asc" } });
  for (const statement of open) {
    if (await paymentInFlight(tx, statement.id)) throw new NrmsPaymentInFlightError();
  }
  const reversal = (value: number) => tx.nrmsUsageEvent.create({
    data: {
      accountId: account.id, propertyId: account.propertyId, reservationId: null, allocationId: null, policyId: account.policyId,
      serviceDate: now, classification: "REVERSAL", source: "ADMIN", currency: account.policy.currency, amount: -value,
    },
  });

  let remaining = money(amount);
  const usageEventIds: number[] = [];
  const appliedToStatements: NrmsCreditResult["appliedToStatements"] = [];
  for (const statement of open) {
    if (remaining <= 0) break;
    const current = money(statement.amount);
    const take = Math.min(remaining, current);
    if (take <= 0) continue;
    const event = await reversal(take);
    usageEventIds.push(event.id);
    await tx.nrmsBillingStatementItem.create({ data: { statementId: statement.id, usageEventId: event.id, amount: -take } });
    const left = money(current - take);
    await tx.nrmsBillingStatement.update({ where: { id: statement.id }, data: { amount: left, status: left > 0 ? "PAYABLE" : "VOID" } });
    await refreshNrmsStatementToken(tx, statement, left, now);
    appliedToStatements.push({ statementId: statement.id, amount: take, remaining: left });
    remaining = money(remaining - take);
  }
  if (remaining > 0) {
    const event = await reversal(remaining);
    usageEventIds.push(event.id);
  }
  return { usageEventIds, appliedToStatements, carried: remaining };
}
