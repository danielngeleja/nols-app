/**
 * The money terms an owner confirms when a sales partner lists their home as a
 * long stay (docs/LONG_STAY_RENTALS.md 15.1). Pure helpers: a fingerprint of
 * the terms (any change means a new confirmation) and plain-words summaries
 * for the SMS, the owner's page and the admin.
 */
import crypto from "node:crypto";

export type RentTermsRow = {
  monthlyRent: unknown;
  currency: string | null;
  minTermMonths: number;
  maxTermMonths: number | null;
  upfrontMonths: number;
  securityDepositMonths: number;
  noticePeriodDays: number;
  furnished?: string | null;
  utilities?: unknown;
  discounts?: unknown;
};

/** MariaDB can hand JSON columns back as strings. */
function json(value: unknown): any {
  if (typeof value !== "string") return value ?? null;
  try { return JSON.parse(value); } catch { return null; }
}

function pct(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** Only the terms that change what the tenant pays or what the owner signs. */
function canonical(t: RentTermsRow) {
  const discounts = json(t.discounts) || {};
  const utilities = json(t.utilities) || {};
  return {
    rent: Number(t.monthlyRent).toFixed(2),
    currency: String(t.currency || "TZS").toUpperCase(),
    minTerm: Number(t.minTermMonths),
    maxTerm: t.maxTermMonths == null ? null : Number(t.maxTermMonths),
    upfront: Number(t.upfrontMonths),
    deposit: Number(t.securityDepositMonths),
    notice: Number(t.noticePeriodDays),
    furnished: String(t.furnished || ""),
    m6: pct(discounts.m6),
    m12: pct(discounts.m12),
    utilities: Object.keys(utilities).sort().map((k) => `${k}:${String(utilities[k])}`).join(","),
  };
}

export function rentTermsFingerprint(t: RentTermsRow): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(t))).digest("hex");
}

export function formatRent(amount: unknown, currency: string | null): string {
  const cur = String(currency || "TZS").toUpperCase();
  const n = Number(amount);
  const text = Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
  return cur === "TZS" ? `TSh ${text}` : `${cur} ${text}`;
}

const months = (n: number) => `${n} month${n === 1 ? "" : "s"}`;

/** One line for an SMS: "TSh 500,000 a month, 6 to 12 months, 2 months upfront". */
export function rentTermsSummary(t: RentTermsRow): string {
  const c = canonical(t);
  const term = c.maxTerm && c.maxTerm !== c.minTerm ? `${c.minTerm} to ${c.maxTerm} months` : `${months(c.minTerm)} or more`;
  return `${formatRent(t.monthlyRent, c.currency)} a month, ${term}, ${months(c.upfront)} upfront`;
}

/** The owner's page: each term on its own line, in plain words. */
export function rentTermsLines(t: RentTermsRow): Array<{ label: string; value: string }> {
  const c = canonical(t);
  const lines = [
    { label: "Monthly rent", value: formatRent(t.monthlyRent, c.currency) },
    { label: "Lease length", value: c.maxTerm && c.maxTerm !== c.minTerm ? `${c.minTerm} to ${c.maxTerm} months` : `${months(c.minTerm)} or more` },
    { label: "Paid before move-in", value: months(c.upfront) },
    { label: "Security deposit", value: c.deposit ? `${months(c.deposit)}, kept by you` : "None" },
    { label: "Notice to end", value: `${c.notice} days` },
  ];
  const off = [c.m6 ? `${c.m6}% off for 6 months or more` : "", c.m12 ? `${c.m12}% off for 12 months` : ""].filter(Boolean);
  if (off.length) lines.push({ label: "Discounts", value: off.join(", ") });
  return lines;
}
