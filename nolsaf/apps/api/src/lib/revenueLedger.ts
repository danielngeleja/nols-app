// apps/api/src/lib/revenueLedger.ts
//
// The writer for `revenue_entry`, the book of record for money NoLSAF has
// earned (docs/REVENUE_LEDGER.md).
//
// Rules this module enforces, so no caller has to:
//   * Append only. A row is never updated. A correction is a new REVERSAL row
//     carrying negated amounts and pointing at the entry it cancels, so SUM()
//     over the table is always the true position.
//   * Idempotent on sourceKey ("<stream>:<sourceType>:<sourceId>", UNIQUE). A
//     webhook retry, a callback plus postback pair, or a backfill re-run finds
//     the row already there and writes nothing.
//   * Frozen money. fxTzsPerUnit and the TZS amounts are fixed when the row is
//     written; a later FX or commission edit cannot restate a closed period. A
//     reversal reuses the rate of the entry it reverses, so a full refund nets
//     to exactly zero in TZS.
//   * businessDate is the Africa/Dar_es_Salaam (EAT, UTC+3, no DST) calendar day.
//
// Every function takes the Prisma client or an interactive transaction client
// as `db`. Callers pass the transaction that changes the source status, so the
// status change and the revenue record commit or roll back together.

import { Prisma } from "@prisma/client";
import { BASE_CURRENCY, getFxRates } from "./fx.js";

export const REVENUE_STREAMS = ["ACCOMMODATION", "TOUR", "TRANSPORT", "GROUP_STAY", "SUBSCRIPTION"] as const;
export type RevenueStream = (typeof REVENUE_STREAMS)[number];

export const RECOGNIZED = "RECOGNIZED" as const;
export const REVERSAL = "REVERSAL" as const;

/** EAT is a fixed UTC+3 offset: Tanzania has no daylight saving. */
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const CENT = 0.005;
const SOURCE_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,29}$/;

/** Minimal shape of the client this module needs. A Prisma client or tx fits. */
export type RevenueDb = {
  revenueEntry: {
    findUnique: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
  };
  $queryRaw?: (...args: any[]) => Promise<unknown>;
};

export type LedgerResult =
  | { status: "created"; entry: any }
  | { status: "existing"; entry: any }
  | { status: "skipped"; entry: null; reason: string };

export type Amounts = { gross: number; commission: number; partnerNet: number };
export type TzsAmounts = { grossTzs: number; commissionTzs: number; partnerNetTzs: number };

/** Round half away from zero to cents, symmetric for negatives. */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-9)) / 100;
}

const num = (value: unknown): number => {
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? x : 0;
};

const dec = (value: number, places = 2) => new Prisma.Decimal(value.toFixed(places));

export function revenueSourceKey(stream: RevenueStream, sourceType: string, sourceId: number): string {
  if (!REVENUE_STREAMS.includes(stream)) throw new Error(`REVENUE_UNKNOWN_STREAM:${stream}`);
  if (!SOURCE_TYPE_PATTERN.test(sourceType)) throw new Error(`REVENUE_BAD_SOURCE_TYPE:${sourceType}`);
  if (!Number.isInteger(sourceId) || sourceId <= 0) throw new Error(`REVENUE_BAD_SOURCE_ID:${sourceId}`);
  return `${stream}:${sourceType}:${sourceId}`;
}

/**
 * The EAT calendar day of an instant, as a Date at UTC midnight of that day.
 * Prisma writes a @db.Date column from the UTC date part, so this is what lands
 * in `businessDate`. 2026-11-08T21:00:00Z is 00:00 EAT on 9 November.
 */
export function eatBusinessDate(at: Date): Date {
  const day = new Date(at.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
  return new Date(`${day}T00:00:00.000Z`);
}

/** TZS per one unit of `currency`: 1 for TZS, the frozen rate when given, else the current rate. */
export async function resolveFxTzsPerUnit(currency: string, frozen?: unknown): Promise<number> {
  const cur = String(currency || BASE_CURRENCY).toUpperCase();
  if (cur === BASE_CURRENCY) return 1;
  const pinned = Number(frozen);
  if (frozen != null && Number.isFinite(pinned) && pinned > 0) return pinned;
  const rate = (await getFxRates()).tzsPerUnit[cur];
  if (!Number.isFinite(rate) || !(rate > 0)) throw new Error(`REVENUE_FX_RATE_UNAVAILABLE:${cur}`);
  return rate;
}

function isUniqueViolation(err: any): boolean {
  return err?.code === "P2002" || /Unique constraint|Duplicate entry/i.test(String(err?.message ?? ""));
}

async function findByKey(db: RevenueDb, sourceKey: string) {
  return db.revenueEntry.findUnique({ where: { sourceKey } });
}

/** Create, or return the row that won a concurrent insert of the same key. */
async function insertOnce(db: RevenueDb, data: Record<string, unknown>): Promise<LedgerResult> {
  try {
    return { status: "created", entry: await db.revenueEntry.create({ data }) };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const entry = await findByKey(db, String(data.sourceKey));
    if (!entry) throw err;
    return { status: "existing", entry };
  }
}

export type RecognizeInput = {
  stream: RevenueStream;
  sourceType: string;
  sourceId: number;
  /** In the transaction's own currency. */
  currency?: string | null;
  gross: number;
  commission: number;
  partnerNet: number;
  /** Rate frozen elsewhere (e.g. TourBooking.fxTzsPerUnit). Looked up when absent. */
  fxTzsPerUnit?: unknown;
  /** When the money was recognized. Defaults to now. */
  recognizedAt?: Date;
  /** The instant whose EAT day is the business date. Defaults to recognizedAt. */
  occurredAt?: Date;
  paymentEventId?: number | null;
  reason?: string | null;
};

/**
 * Record that revenue was earned. Writes one RECOGNIZED row per sourceKey; a
 * second call for the same source returns the first row untouched, even when
 * the amounts passed differ (the first recognition is the record).
 */
export async function recognizeRevenue(db: RevenueDb, input: RecognizeInput): Promise<LedgerResult> {
  const sourceKey = revenueSourceKey(input.stream, input.sourceType, input.sourceId);
  const existing = await findByKey(db, sourceKey);
  if (existing) return { status: "existing", entry: existing };

  const amounts: Amounts = { gross: round2(num(input.gross)), commission: round2(num(input.commission)), partnerNet: round2(num(input.partnerNet)) };
  for (const [field, value] of Object.entries(amounts)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`REVENUE_NEGATIVE_${field.toUpperCase()}`);
  }

  const currency = String(input.currency || BASE_CURRENCY).toUpperCase().slice(0, 3);
  const fx = await resolveFxTzsPerUnit(currency, input.fxTzsPerUnit);
  const recognizedAt = input.recognizedAt ?? new Date();

  return insertOnce(db, {
    stream: input.stream,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceKey,
    currency,
    gross: dec(amounts.gross),
    commission: dec(amounts.commission),
    partnerNet: dec(amounts.partnerNet),
    fxTzsPerUnit: dec(fx, 6),
    grossTzs: dec(round2(amounts.gross * fx)),
    commissionTzs: dec(round2(amounts.commission * fx)),
    partnerNetTzs: dec(round2(amounts.partnerNet * fx)),
    entryType: RECOGNIZED,
    reversesId: null,
    reason: input.reason ? String(input.reason).slice(0, 300) : null,
    recognizedAt,
    businessDate: eatBusinessDate(input.occurredAt ?? recognizedAt),
    paymentEventId: input.paymentEventId ?? null,
  });
}

type EntryAmounts = Amounts & TzsAmounts;

function entryAmounts(row: any): EntryAmounts {
  return {
    gross: num(row.gross),
    commission: num(row.commission),
    partnerNet: num(row.partnerNet),
    grossTzs: num(row.grossTzs),
    commissionTzs: num(row.commissionTzs),
    partnerNetTzs: num(row.partnerNetTzs),
  };
}

/**
 * The positive amounts a reversal takes out, never more than what is left.
 *
 * `requestedGross` is the money returned to the customer in the original
 * currency. Commission and partner net are taken in the same proportion of the
 * original, which is owner policy 6.3.2.2 (NoLSAF gives back its own share of
 * a refund). Reversing all or more than what is left takes exactly the
 * remainder, so a full refund nets every field to zero with no cent drift.
 * Returns null when nothing is left or nothing was requested.
 */
export function computeReversalAmounts(original: EntryAmounts, remaining: EntryAmounts, requestedGross?: number | null): EntryAmounts | null {
  const left = Object.values(remaining).some((v) => v > CENT);
  if (!left) return null;
  if (requestedGross == null || requestedGross >= remaining.gross - CENT) {
    const clamp = (v: number) => round2(Math.max(0, v));
    return {
      gross: clamp(remaining.gross),
      commission: clamp(remaining.commission),
      partnerNet: clamp(remaining.partnerNet),
      grossTzs: clamp(remaining.grossTzs),
      commissionTzs: clamp(remaining.commissionTzs),
      partnerNetTzs: clamp(remaining.partnerNetTzs),
    };
  }
  if (!(requestedGross > CENT) || !(original.gross > 0)) return null;
  const ratio = requestedGross / original.gross;
  const part = (field: keyof EntryAmounts) => round2(Math.min(Math.max(0, remaining[field]), original[field] * ratio));
  return {
    gross: round2(requestedGross),
    commission: part("commission"),
    partnerNet: part("partnerNet"),
    grossTzs: part("grossTzs"),
    commissionTzs: part("commissionTzs"),
    partnerNetTzs: part("partnerNetTzs"),
  };
}

export type ReverseInput = {
  /** The source whose RECOGNIZED entry is being reversed. */
  original: { stream: RevenueStream; sourceType: string; sourceId: number };
  /** What caused the reversal (a refund, a chargeback). Keys the reversal row. */
  sourceType: string;
  sourceId: number;
  /** Money returned, in the original currency. Omit to reverse everything left. */
  gross?: number | null;
  reason: string;
  recognizedAt?: Date;
  occurredAt?: Date;
  paymentEventId?: number | null;
};

/**
 * Record that earned revenue was given back. Writes one REVERSAL row per
 * sourceKey with negated amounts and `reversesId` set. Skips (never throws)
 * when the original was never recognized or is already fully reversed, so a
 * refund on a source the ledger has not seen yet is reported, not lost: the
 * backfill replays it once the original is in.
 */
export async function reverseRevenue(db: RevenueDb, input: ReverseInput): Promise<LedgerResult> {
  const sourceKey = revenueSourceKey(input.original.stream, input.sourceType, input.sourceId);
  const existing = await findByKey(db, sourceKey);
  if (existing) return { status: "existing", entry: existing };

  const originalKey = revenueSourceKey(input.original.stream, input.original.sourceType, input.original.sourceId);
  const original = await findByKey(db, originalKey);
  if (!original) return { status: "skipped", entry: null, reason: "NOT_RECOGNIZED" };
  if (original.entryType !== RECOGNIZED) throw new Error("REVENUE_REVERSAL_TARGET_NOT_RECOGNIZED");

  // Serialize reversals of the same entry (a refund and a chargeback racing)
  // so the remainder below cannot be spent twice. Plain row lock, valid on
  // both MySQL 8 and MariaDB 11.8.
  if (typeof db.$queryRaw === "function") {
    await db.$queryRaw`SELECT id FROM revenue_entry WHERE id = ${original.id} FOR UPDATE`;
  }

  const prior = await db.revenueEntry.findMany({
    where: { reversesId: original.id },
    select: { gross: true, commission: true, partnerNet: true, grossTzs: true, commissionTzs: true, partnerNetTzs: true },
  });
  const base = entryAmounts(original);
  const remaining = prior.reduce<EntryAmounts>((acc, row) => {
    const r = entryAmounts(row);
    return {
      gross: acc.gross + r.gross,
      commission: acc.commission + r.commission,
      partnerNet: acc.partnerNet + r.partnerNet,
      grossTzs: acc.grossTzs + r.grossTzs,
      commissionTzs: acc.commissionTzs + r.commissionTzs,
      partnerNetTzs: acc.partnerNetTzs + r.partnerNetTzs,
    };
  }, base);

  const take = computeReversalAmounts(base, remaining, input.gross);
  if (!take) return { status: "skipped", entry: null, reason: Object.values(remaining).some((v) => v > CENT) ? "ZERO_AMOUNT" : "ALREADY_REVERSED" };

  const recognizedAt = input.recognizedAt ?? new Date();
  return insertOnce(db, {
    stream: original.stream,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceKey,
    currency: original.currency,
    gross: dec(-take.gross),
    commission: dec(-take.commission),
    partnerNet: dec(-take.partnerNet),
    fxTzsPerUnit: original.fxTzsPerUnit,
    grossTzs: dec(-take.grossTzs),
    commissionTzs: dec(-take.commissionTzs),
    partnerNetTzs: dec(-take.partnerNetTzs),
    entryType: REVERSAL,
    reversesId: original.id,
    reason: String(input.reason).slice(0, 300),
    recognizedAt,
    businessDate: eatBusinessDate(input.occurredAt ?? recognizedAt),
    paymentEventId: input.paymentEventId ?? null,
  });
}
