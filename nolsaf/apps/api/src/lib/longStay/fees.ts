/**
 * Long-stay money rules (docs/LONG_STAY_RENTALS.md sections 4 and 5).
 *
 * The only place long-stay amounts are computed. Routes never accept an
 * amount from a client: they pass the snapshotted terms here and store the
 * result. All arithmetic runs in integer minor units, so the same inputs
 * always give the same amounts on every server.
 *
 *   T = min(tenantPercent   x M x n, tenantCapMonths   x M)   tenant fee
 *   L = min(landlordPercent x M x n, landlordCapMonths x M)   landlord commission
 *   tenant pays NoLSAF by card:   M + T
 *   tenant pays landlord direct:  M x (upfront - 1)
 *   NoLSAF releases to landlord:  M - L   (before any payout transfer fee)
 *
 * n is the signed lease term, so a landlord cannot lower the commission by
 * prepaying fewer months.
 */

/**
 * Whether long stays are open to tenants: env LONG_STAY_OPEN=1. Off by default
 * and off in production until request, lease and payment are all built
 * (milestones 4 to 6). While off, long-stay listings can be drafted, submitted
 * and reviewed, but never approved, so none can appear publicly, take a viewing
 * request or be booked by the night. Staging may switch it on to test.
 */
export function longStayOpen(): boolean {
  return process.env.LONG_STAY_OPEN === "1";
}

/** Minimum terms a landlord may offer (decision 8). */
export const LONG_STAY_TERM_MONTHS = [3, 6, 12] as const;
export type LongStayTermMonths = (typeof LONG_STAY_TERM_MONTHS)[number];

/** Longest lease NoLSAF will write in v1. */
export const LONG_STAY_MAX_TERM_MONTHS = 24;

/** Property types that may rent long stay (decision 9). */
export const LONG_STAY_PROPERTY_TYPES = ["HOUSE", "APARTMENT", "CONDO", "VILLA", "TOWNHOUSE", "BUNGALOW"] as const;

/** Currencies a long-stay rent may be quoted in (card checkout supports both). */
export const LONG_STAY_CURRENCIES = ["TZS", "USD"] as const;
export type LongStayCurrency = (typeof LONG_STAY_CURRENCIES)[number];

/** Guards against typos like an extra zero; well above any real monthly rent. */
const MAX_MONTHLY_RENT: Record<LongStayCurrency, number> = { TZS: 200_000_000, USD: 100_000 };
const MINOR_DIGITS: Record<LongStayCurrency, number> = { TZS: 0, USD: 2 };

export type LongStayRates = {
  landlordPercent: number;
  tenantPercent: number;
  landlordCapMonths: number;
  tenantCapMonths: number;
};

export const DEFAULT_LONG_STAY_RATES: LongStayRates = {
  landlordPercent: 5,
  tenantPercent: 4,
  landlordCapMonths: 0.5,
  tenantCapMonths: 0.25,
};

export type LongStayQuote = {
  currency: LongStayCurrency;
  monthlyRent: number;
  termMonths: number;
  upfrontMonths: number;
  /** M x n: the rent the lease covers, which the fees are based on. */
  termRent: number;
  tenantFee: number;
  landlordCommission: number;
  /** M + T, charged by card. */
  bookingAmount: number;
  /** M x (upfront - 1), paid to the landlord at move-in. */
  balanceDue: number;
  /** M - L, released to the landlord after move-in (before transfer fees). */
  landlordPayout: number;
  rates: LongStayRates;
};

export class LongStayQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LongStayQuoteError";
  }
}

export function isLongStayCurrency(value: unknown): value is LongStayCurrency {
  return typeof value === "string" && (LONG_STAY_CURRENCIES as readonly string[]).includes(value);
}

export function isLongStayPropertyType(value: unknown): boolean {
  return typeof value === "string" && (LONG_STAY_PROPERTY_TYPES as readonly string[]).includes(value.toUpperCase());
}

/** Validates a rate set (from SystemSetting or a tenancy snapshot). */
export function normalizeLongStayRates(input: Partial<Record<keyof LongStayRates, unknown>> | null | undefined): LongStayRates {
  const pick = (key: keyof LongStayRates, min: number, max: number) => {
    const raw = input?.[key];
    const value = raw == null ? DEFAULT_LONG_STAY_RATES[key] : Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) throw new LongStayQuoteError(`Invalid long-stay rate ${key}.`);
    return value;
  };
  return {
    landlordPercent: pick("landlordPercent", 0, 20),
    tenantPercent: pick("tenantPercent", 0, 20),
    // The commission is collected from the first month NoLSAF holds, so its
    // cap can never exceed one month (decision 3).
    landlordCapMonths: pick("landlordCapMonths", 0, 1),
    tenantCapMonths: pick("tenantCapMonths", 0, 1),
  };
}

/** Hundredths, as an exact integer (5.25 -> 525). */
function hundredths(value: number): number {
  return Math.round(value * 100);
}

/** a x b / divisor rounded half up, all non-negative integers. */
function mulDivRound(a: number, b: number, divisor: number): number {
  const product = a * b;
  if (!Number.isSafeInteger(product)) throw new LongStayQuoteError("Amount too large.");
  return Math.floor((product + Math.floor(divisor / 2)) / divisor);
}

export function computeLongStayQuote(input: {
  monthlyRent: number | string;
  termMonths: number;
  upfrontMonths: number;
  currency: string;
  rates?: Partial<Record<keyof LongStayRates, unknown>> | null;
}): LongStayQuote {
  const currency = String(input.currency || "").toUpperCase();
  if (!isLongStayCurrency(currency)) throw new LongStayQuoteError("Long stays are priced in TZS or USD.");
  const digits = MINOR_DIGITS[currency];
  const scale = 10 ** digits;

  const rent = Number(input.monthlyRent);
  if (!Number.isFinite(rent) || rent <= 0) throw new LongStayQuoteError("Monthly rent must be more than zero.");
  if (rent > MAX_MONTHLY_RENT[currency]) throw new LongStayQuoteError("Monthly rent is above the allowed maximum.");
  const rentMinor = Math.round(rent * scale);
  if (rentMinor <= 0 || Math.abs(rentMinor / scale - rent) > 1e-9) {
    throw new LongStayQuoteError(digits === 0 ? `${currency} rent must be a whole number.` : `${currency} rent can have at most ${digits} decimals.`);
  }

  const n = input.termMonths;
  if (!Number.isInteger(n) || n < LONG_STAY_TERM_MONTHS[0] || n > LONG_STAY_MAX_TERM_MONTHS) {
    throw new LongStayQuoteError(`The term must be between ${LONG_STAY_TERM_MONTHS[0]} and ${LONG_STAY_MAX_TERM_MONTHS} months.`);
  }
  const upfront = input.upfrontMonths;
  if (!Number.isInteger(upfront) || upfront < 1 || upfront > n) {
    throw new LongStayQuoteError("Months paid up front must be between 1 and the term.");
  }

  const rates = normalizeLongStayRates(input.rates);

  const termRentMinor = rentMinor * n;
  const tenantFeeMinor = Math.min(
    mulDivRound(termRentMinor, hundredths(rates.tenantPercent), 10_000),
    mulDivRound(rentMinor, hundredths(rates.tenantCapMonths), 100),
  );
  const landlordCommissionMinor = Math.min(
    mulDivRound(termRentMinor, hundredths(rates.landlordPercent), 10_000),
    mulDivRound(rentMinor, hundredths(rates.landlordCapMonths), 100),
    rentMinor,
  );

  const toMajor = (minor: number) => minor / scale;
  return {
    currency,
    monthlyRent: toMajor(rentMinor),
    termMonths: n,
    upfrontMonths: upfront,
    termRent: toMajor(termRentMinor),
    tenantFee: toMajor(tenantFeeMinor),
    landlordCommission: toMajor(landlordCommissionMinor),
    bookingAmount: toMajor(rentMinor + tenantFeeMinor),
    balanceDue: toMajor(rentMinor * (upfront - 1)),
    landlordPayout: toMajor(rentMinor - landlordCommissionMinor),
    rates,
  };
}

/**
 * Whether the balance both sides confirmed matches the lease. Exact match in
 * minor units; anything else holds the payout for admin review (section 5.3).
 */
export function balanceMatchesLease(confirmed: number | string | null | undefined, balanceDue: number | string, currency: string): boolean {
  const code = String(currency || "").toUpperCase();
  if (!isLongStayCurrency(code) || confirmed == null) return false;
  const scale = 10 ** MINOR_DIGITS[code];
  const a = Math.round(Number(confirmed) * scale);
  const b = Math.round(Number(balanceDue) * scale);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}
