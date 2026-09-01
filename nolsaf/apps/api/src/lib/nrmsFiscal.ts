// Owner-activated TRA fiscal receipting (VFD). See docs/NRMS_FISCAL_RECEIPTS.md.
//
// This file is the regime-neutral half: what counts as a taxable event, how the
// counters TRA validates are allocated, and how a receipt is queued. The TRA
// adapter (XML, PKCS12 signing, token grant) is deliberately not here and is
// blocked on the official specification, which TRA issues at registration and
// does not publish openly.
//
// Two rules from that specification shape everything below:
//
//   1. We generate the numbering, TRA validates it. The global counter starts at
//      1, never resets, and must always equal the receipt number. The daily
//      counter resets at CALENDAR midnight. A cancelled transaction burns its
//      number and the next one takes the next number, never the burned one.
//
//   2. Fiscalisation must never block a settle. TRA's own guidance is to keep
//      transacting while offline, record each document as pending, and resend in
//      order once the connection returns. So a receipt is queued inside the
//      settle transaction and delivered later by a worker.

import crypto from "node:crypto";

/** Modes an owner can choose. OFF is the default and the state of every property today. */
export type FiscalMode = "OFF" | "ON_REQUEST" | "ALWAYS";

const PUBLIC_FISCAL_ERROR_MESSAGES: Record<string, string> = {
  FISCAL_ADAPTER_UNAVAILABLE: "TRA delivery is not available yet.",
  FISCAL_PROVIDER_UNAVAILABLE: "TRA could not be reached. NRMS will retry automatically.",
  FISCAL_PROVIDER_REJECTED: "TRA rejected this document. Review the fiscal connection and retry.",
  FISCAL_DELIVERY_INTERRUPTED: "Delivery was interrupted before confirmation. NRMS will reconcile and retry safely.",
};

/** Convert any adapter exception into a small allow-listed operational code. */
export function fiscalErrorCode(error: unknown): keyof typeof PUBLIC_FISCAL_ERROR_MESSAGES {
  const value = error instanceof Error ? error.message : String(error ?? "");
  if (value === "TRA_ADAPTER_NOT_IMPLEMENTED" || value === "FISCAL_ADAPTER_UNAVAILABLE") return "FISCAL_ADAPTER_UNAVAILABLE";
  if (value === "FISCAL_PROVIDER_REJECTED") return "FISCAL_PROVIDER_REJECTED";
  if (value === "FISCAL_DELIVERY_INTERRUPTED") return "FISCAL_DELIVERY_INTERRUPTED";
  return "FISCAL_PROVIDER_UNAVAILABLE";
}

/** Safe for persistence, APIs and owner/admin screens; never includes provider text. */
export function fiscalErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return PUBLIC_FISCAL_ERROR_MESSAGES[code] ?? PUBLIC_FISCAL_ERROR_MESSAGES.FISCAL_PROVIDER_UNAVAILABLE;
}

/**
 * Money movements that are a sale to a guest, keyed by the ledger `sourceType`
 * the night audit uses for the same event.
 *
 * Everything absent from these two maps is an internal accrual, not a sale:
 * `ROOM` and `FOLIO_CHARGE` accrue what a guest owes, `PLATFORM_FEE` and
 * `OPERATING_EXPENSE` are our own costs, `OUTLET_TIP` is money held for staff.
 * Posting a bar order to a room folio is therefore not a taxable event; the
 * guest paying that folio at checkout is.
 */
export const FISCAL_SALE_SOURCE_TYPES = new Set(["OUTLET_SALE", "FOLIO_PAYMENT", "MASTER_FOLIO_PAYMENT"]);

/** Reversals of the above. Each produces a credit note against the original. */
export const FISCAL_REVERSAL_SOURCE_TYPES = new Set([
  "OUTLET_SALE_REVERSAL",
  "PAYMENT_REVERSAL",
  "MASTER_FOLIO_PAYMENT_REVERSAL",
]);

export function isFiscalisableSourceType(sourceType: string): boolean {
  return FISCAL_SALE_SOURCE_TYPES.has(sourceType) || FISCAL_REVERSAL_SOURCE_TYPES.has(sourceType);
}

export function fiscalKindFor(sourceType: string): "RECEIPT" | "CREDIT_NOTE" {
  return FISCAL_REVERSAL_SOURCE_TYPES.has(sourceType) ? "CREDIT_NOTE" : "RECEIPT";
}

/**
 * The identity a fiscal receipt shares with the night-audit ledger posting for
 * the same money movement.
 *
 * These strings must stay byte-identical to the ones built in
 * owner.nrms.finance.ts, because that is the whole point: the ledger derives its
 * postings at night audit from the payment and order rows, while a receipt is
 * created hours earlier at the counter, and `sourceKey` is what lets the two be
 * reconciled afterwards without either system knowing about the other.
 */
const SOURCE_KEY_PREFIX: Record<string, string> = {
  OUTLET_SALE: "OUTLET",
  OUTLET_SALE_REVERSAL: "OUTLET_VOID",
  FOLIO_PAYMENT: "PAYMENT",
  PAYMENT_REVERSAL: "PAYMENT_VOID",
  MASTER_FOLIO_PAYMENT: "MASTER_PAYMENT",
  MASTER_FOLIO_PAYMENT_REVERSAL: "MASTER_PAYMENT_VOID",
};

export function fiscalSourceKey(sourceType: string, propertyId: number, sourceId: number): string {
  const prefix = SOURCE_KEY_PREFIX[sourceType];
  if (!prefix) throw new Error(`No ledger source key prefix for ${sourceType}`);
  return `${prefix}:${propertyId}:${sourceId}`;
}

/**
 * The calendar day a document belongs to, in Tanzanian time.
 *
 * This is NOT the NRMS business day and the two must never be conflated. A
 * business day routinely runs past midnight with night audit at 02:00, while
 * TRA's daily counter resets at calendar midnight and its Z report covers a
 * calendar day. A sale rung at 01:30 belongs to yesterday's business day and to
 * today's fiscal day, and both statements are true at once.
 *
 * Tanzania is UTC+3 with no daylight saving, ever, so the offset is a constant
 * and this needs no timezone library.
 */
const EAT_OFFSET_MINUTES = 180;

export function fiscalDateFor(when: Date): string {
  const shifted = new Date(when.getTime() + EAT_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Whether a settle should fiscalise on its own.
 *
 * ON_REQUEST properties fiscalise only when a staff member asks, so an automatic
 * settle produces nothing and the action stays available on the bill afterwards.
 * A connection that is not ACTIVE produces nothing either: activation lands on a
 * business-day boundary precisely so a day never closes half fiscalised.
 */
export function shouldAutoFiscalise(connection: { mode: string; status: string } | null | undefined): boolean {
  if (!connection) return false;
  return connection.mode === "ALWAYS" && connection.status === "ACTIVE";
}

/** A connection can serve a manual "issue fiscal receipt" action in either live mode. */
export function canIssueOnRequest(connection: { mode: string; status: string } | null | undefined): boolean {
  if (!connection) return false;
  return (connection.mode === "ALWAYS" || connection.mode === "ON_REQUEST") && connection.status === "ACTIVE";
}

export type FiscalCounters = { receiptNumber: number; globalCounter: number; dailyCounter: number; fiscalDate: string };

/**
 * Take the next numbers for a property, inside the caller's transaction.
 *
 * Deliberately an UPDATE followed by a SELECT rather than a read-then-write: the
 * update takes the row lock, so concurrent settlements serialise on it and the
 * SELECT reads our own values. This is the same reasoning as
 * documentSequence.allocateSequenceValue, and the two must not be merged: that
 * allocator is scoped globally by (scope, period), while a fiscal series is
 * per property and per TRA registration.
 *
 * Both statements must run on one connection, which is why `tx` is required and
 * why this must never be called on the bare prisma client.
 */
export async function allocateFiscalCounters(tx: any, connectionId: number, when: Date): Promise<FiscalCounters> {
  const fiscalDate = fiscalDateFor(when);

  // The CASE is what resets the daily counter at calendar midnight without
  // needing a scheduled job: the first document of a new day sees a stale
  // dailyCounterDate and restarts at 1.
  await tx.$executeRaw`
    UPDATE nrms_fiscal_connection
    SET globalCounter = globalCounter + 1,
        dailyCounter = CASE WHEN dailyCounterDate = ${fiscalDate} THEN dailyCounter + 1 ELSE 1 END,
        dailyCounterDate = ${fiscalDate},
        updatedAt = NOW(3)
    WHERE id = ${connectionId}
  `;

  const rows = await tx.$queryRaw<Array<{ globalCounter: number; dailyCounter: number }>>`
    SELECT globalCounter, dailyCounter FROM nrms_fiscal_connection WHERE id = ${connectionId}
  `;
  const globalCounter = Number(rows[0]?.globalCounter);
  const dailyCounter = Number(rows[0]?.dailyCounter);
  if (!Number.isFinite(globalCounter) || globalCounter <= 0) {
    throw new Error(`nrms_fiscal_connection ${connectionId} returned no counter`);
  }

  // TRA's rule, not a convenience: the receipt number IS the global counter.
  return { receiptNumber: globalCounter, globalCounter, dailyCounter, fiscalDate };
}

export type FiscalReceiptInput = {
  propertyId: number;
  connectionId: number;
  sourceType: string;
  sourceId: number;
  saleOccurredAt: Date;
  currency: string;
  grossAmount: number;
  taxAmount?: number;
  taxBreakdown?: unknown;
  payload?: unknown;
  replacesReceiptId?: number | null;
};

/**
 * Queue one fiscal document, inside the transaction that is settling the money.
 *
 * Returns null when the same money movement already has one. That check is
 * belt-and-braces over the (propertyId, sourceKey, kind) unique index, which is
 * the actual guarantee: a retried settle, a double-tapped button and a replayed
 * request all collapse to one document.
 *
 * Nothing here calls TRA. The row is left PENDING for the delivery worker, so a
 * TRA outage cannot fail the settle that is committing around this call.
 */
export async function enqueueFiscalReceipt(tx: any, input: FiscalReceiptInput): Promise<{ id: number } | null> {
  const kind = fiscalKindFor(input.sourceType);
  const sourceKey = fiscalSourceKey(input.sourceType, input.propertyId, input.sourceId);

  const existing = await tx.nrmsFiscalReceipt.findFirst({
    where: { propertyId: input.propertyId, sourceKey, kind },
    select: { id: true },
  });
  if (existing) return null;

  const counters = await allocateFiscalCounters(tx, input.connectionId, input.saleOccurredAt);

  return tx.nrmsFiscalReceipt.create({
    data: {
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      kind,
      status: "PENDING",
      submissionKey: crypto.randomUUID(),
      receiptNumber: counters.receiptNumber,
      globalCounter: counters.globalCounter,
      dailyCounter: counters.dailyCounter,
      fiscalDate: new Date(`${counters.fiscalDate}T00:00:00.000Z`),
      saleOccurredAt: input.saleOccurredAt,
      currency: input.currency,
      grossAmount: input.grossAmount,
      taxAmount: input.taxAmount ?? 0,
      taxBreakdown: (input.taxBreakdown ?? null) as any,
      payload: (input.payload ?? null) as any,
      replacesReceiptId: input.replacesReceiptId ?? null,
      nextAttemptAt: new Date(),
    },
    select: { id: true },
  });
}

/**
 * Land any pending on/off switch that has reached its business date.
 *
 * Owners choose the mode whenever they like; the switch itself happens here, on
 * a day boundary, because a fiscal series has a daily close and a day that
 * started unfiscalised must not end fiscalised.
 *
 * Runs from the delivery worker rather than from ensureBusinessDay. That was the
 * obvious home for it and the wrong one: ensureBusinessDay is reached from
 * assertNrmsBusinessDayWritable on every financial write, so hanging this there
 * would have put a lookup on every settle, all day, to catch a change that
 * happens at most twice in a property's life. Two updateMany calls a minute
 * across every property costs less and means the same thing.
 */
export async function applyPendingFiscalDayTransitions(db: any, today: Date): Promise<{ activated: number; deactivated: number }> {
  // Off first, so that if both dates somehow landed on the same day the property
  // ends up off. Worst case it fiscalises less than intended, which is visible
  // and fixable, rather than more than intended, which is neither.
  const deactivated = await db.nrmsFiscalConnection.updateMany({
    where: { deactivatesOnBusinessDate: { lte: today }, mode: { not: "OFF" } },
    data: { mode: "OFF", pendingMode: null, status: "DISABLED", deactivatesOnBusinessDate: null, activatesOnBusinessDate: null },
  });
  // Resolve each pending mode explicitly. `updateMany` cannot copy pendingMode
  // into mode, and applying it early would change fiscal behaviour mid-day.
  const due = await db.nrmsFiscalConnection.findMany({
    where: {
      activatesOnBusinessDate: { lte: today },
      pendingMode: { in: ["ALWAYS", "ON_REQUEST"] },
      status: { in: ["VALIDATED", "ACTIVE", "FAILED"] },
    },
    select: { id: true, pendingMode: true },
  });
  let activated = 0;
  for (const connection of due) {
    const result = await db.nrmsFiscalConnection.updateMany({
      where: { id: connection.id, activatesOnBusinessDate: { lte: today } },
      data: { mode: connection.pendingMode, pendingMode: null, status: "ACTIVE", activatesOnBusinessDate: null },
    });
    activated += Number(result.count ?? 0);
  }
  return { activated, deactivated: Number(deactivated.count ?? 0) };
}

/**
 * The one call a settle path makes.
 *
 * Resolves the property's connection, applies the mode gate, and queues a
 * document if one is owed. Returns null in every other case, which is the
 * overwhelmingly common one: a property with no connection row at all.
 *
 * NOT wired into the settle routes yet, deliberately. Until the migration is
 * applied, touching these tables inside a settle transaction risks aborting that
 * transaction, and refusing a guest's payment because a tax table is missing is
 * the exact failure rule 7.1 exists to prevent. Wiring is one call at each of
 * the three settle sites once the tables exist.
 */
export async function fiscaliseSettlement(
  tx: any,
  input: Omit<FiscalReceiptInput, "connectionId">,
): Promise<{ id: number } | null> {
  if (!isFiscalisableSourceType(input.sourceType)) return null;

  const connection = await tx.nrmsFiscalConnection.findUnique({
    where: { propertyId: input.propertyId },
    select: { id: true, mode: true, status: true },
  });
  if (!shouldAutoFiscalise(connection)) return null;

  return enqueueFiscalReceipt(tx, { ...input, connectionId: connection.id });
}

export type FiscalSource = { saleOccurredAt: Date; currency: string; grossAmount: number; label: string };

/**
 * Find the money movement behind a manual "issue a receipt for this" request.
 *
 * Scoped to the property on every branch, so an id from another hotel resolves
 * to nothing rather than to someone else's sale. Voided and unsettled records
 * resolve to nothing too: there is no taxable event to report for either.
 *
 * A guest coming back on Wednesday for Monday's receipt is the ordinary case
 * this serves, which is why nothing here restricts the record to today.
 */
export async function resolveFiscalSource(db: any, propertyId: number, sourceType: string, sourceId: number): Promise<FiscalSource | null> {
  if (sourceType === "OUTLET_SALE") {
    const order = await db.nrmsOutletOrder.findFirst({
      where: { id: sourceId, propertyId, settlementMode: "OUTLET_PAYMENT", status: "SETTLED", settledAt: { not: null } },
      select: { settledAt: true, currency: true, total: true, orderNumber: true, customerLabel: true },
    });
    if (!order) return null;
    return {
      saleOccurredAt: order.settledAt,
      currency: order.currency,
      grossAmount: Number(order.total),
      label: `${order.orderNumber}${order.customerLabel ? ` · ${order.customerLabel}` : ""}`,
    };
  }

  if (sourceType === "FOLIO_PAYMENT") {
    const payment = await db.externalPaymentRecord.findFirst({
      where: { id: sourceId, voidedAt: null, reservation: { propertyId } },
      select: { createdAt: true, currency: true, amount: true, method: true, reservation: { select: { receiptNumber: true } } },
    });
    if (!payment) return null;
    return {
      saleOccurredAt: payment.createdAt,
      currency: payment.currency,
      grossAmount: Number(payment.amount),
      label: `${payment.reservation?.receiptNumber || "Reservation"} · ${String(payment.method).replace(/_/g, " ").toLowerCase()}`,
    };
  }

  if (sourceType === "MASTER_FOLIO_PAYMENT") {
    const payment = await db.nrmsMasterFolioPayment.findFirst({
      where: { id: sourceId, voidedAt: null, masterFolio: { propertyId } },
      select: { createdAt: true, currency: true, amount: true, masterFolio: { select: { billToName: true } } },
    });
    if (!payment) return null;
    return {
      saleOccurredAt: payment.createdAt,
      currency: payment.currency,
      grossAmount: Number(payment.amount),
      label: payment.masterFolio?.billToName || "Agency payment",
    };
  }

  return null;
}

/**
 * Record that a number was consumed without a document being issued.
 *
 * TRA forbids reusing it, so the alternative to writing this down is a silent
 * gap that nobody can explain at audit. The row stays, carrying its counters and
 * a reason.
 */
export async function burnFiscalReceipt(tx: any, receiptId: number, reason: string) {
  return tx.nrmsFiscalReceipt.update({
    where: { id: receiptId },
    data: { status: "BURNED", burnReason: reason.slice(0, 300) },
  });
}

/**
 * Backoff for the delivery worker.
 *
 * Longer than a channel delivery on purpose: an unreachable TRA is usually an
 * unreachable TRA for a while, and the queue is drained strictly in order, so
 * hammering the head of it just delays every document behind it.
 */
const RETRY_MINUTES = [1, 5, 15, 60, 180, 360];

/**
 * `attemptCount` is the number of attempts made INCLUDING the one that just
 * failed, which is what the caller has already written to the row. So the first
 * failure waits one minute, not five.
 */
export function nextFiscalAttemptAt(attemptCount: number, from: Date = new Date()): Date {
  const index = Math.min(Math.max(attemptCount - 1, 0), RETRY_MINUTES.length - 1);
  return new Date(from.getTime() + RETRY_MINUTES[index] * 60_000);
}

/** After this many failures a document stops retrying and waits for a human. */
export const FISCAL_MAX_ATTEMPTS = RETRY_MINUTES.length;

export function isFiscalDeadLetter(attemptCount: number): boolean {
  return attemptCount >= FISCAL_MAX_ATTEMPTS;
}
