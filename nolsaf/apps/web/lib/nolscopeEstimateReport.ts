import type { EstimatePrintInput } from "@/lib/nolscopeEstimatePrint";

/**
 * NoLScope estimate data shared by the in-page estimator and the shareable
 * report page (/public/nolscope/report/[ref]). Kept free of React and browser
 * APIs so the report can be rendered on the server from a saved estimate and
 * still match what the traveller saw in the estimator, line for line.
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const NATIONALITIES = [
  { code: "XX", label: "Other" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "IT", label: "Italy" },
  { code: "ES", label: "Spain" },
  { code: "NL", label: "Netherlands" },
  { code: "SE", label: "Sweden" },
  { code: "NO", label: "Norway" },
  { code: "DK", label: "Denmark" },
  { code: "CH", label: "Switzerland" },
  { code: "AT", label: "Austria" },
  { code: "BE", label: "Belgium" },
  { code: "PT", label: "Portugal" },
  { code: "PL", label: "Poland" },
  { code: "CZ", label: "Czech Republic" },
  { code: "AU", label: "Australia" },
  { code: "NZ", label: "New Zealand" },
  { code: "CA", label: "Canada" },
  { code: "JP", label: "Japan" },
  { code: "KR", label: "South Korea" },
  { code: "CN", label: "China" },
  { code: "IN", label: "India" },
  { code: "ZA", label: "South Africa" },
  { code: "NG", label: "Nigeria" },
  { code: "KE", label: "Kenya" },
  { code: "UG", label: "Uganda" },
  { code: "RW", label: "Rwanda" },
  { code: "TZ", label: "Tanzania (local)" },
  { code: "IL", label: "Israel" },
  { code: "SA", label: "Saudi Arabia" },
  { code: "AE", label: "UAE" },
  { code: "BR", label: "Brazil" },
  { code: "AR", label: "Argentina" },
  { code: "MX", label: "Mexico" },
];

export const TRANSPORT_LABELS: Record<string, string> = {
  any: "Best available",
  "shared-taxi": "Shared / public",
  "private-car": "Private vehicle",
  flight: "Charter / flight",
  bus: "Bus / ferry",
};

/** Cost categories, in the order they appear, each with its own colour. */
export const ESTIMATE_CATEGORIES = [
  { key: "visa", label: "Visa", hex: "#0f766e" },
  { key: "parkFees", label: "Park fees", hex: "#10b981" },
  { key: "transport", label: "Transport", hex: "#f59e0b" },
  { key: "activities", label: "Activities", hex: "#8b5cf6" },
  { key: "accommodation", label: "Accommodation", hex: "#ec4899" },
  { key: "tips", label: "Tips and gratuities", hex: "#f97316" },
  { key: "travelInsurance", label: "Travel insurance", hex: "#06b6d4" },
  { key: "serviceCharge", label: "Planning fee", hex: "#64748b" },
] as const;

export type EstimateCategoryKey = (typeof ESTIMATE_CATEGORIES)[number]["key"];

export type ReportDestination = {
  code: string;
  name: string;
  bestMonths: number[];
  peakMonths: number[];
  offPeakMonths: number[];
};

/** The parts of an estimate the report reads; both the POST and the by-reference responses carry them. */
export type ReportEstimate = {
  estimateId?: number | null;
  reference?: string | null;
  travelers: { adults: number; children: number; total: number };
  totalDays: number;
  season: string;
  tier: string;
  breakdown: any;
  totalMin: number;
  totalAvg: number;
  totalMax: number;
  perAdultAvg: number;
  confidence: number;
  appliedRules?: { ruleName: string; seasonName: string; multiplier: number; description?: string }[];
  dataFreshness?: { lastUpdatedAt?: string | null; categories?: Record<string, string | null | undefined> } | null;
};

export function fmt(n: number) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function fmtUSD(n: number) {
  return `$${fmt(n)}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

/** Month lists arrive as arrays, JSON strings or "6,7,8"; all read as numbers 1 to 12. */
export function parseMonths(value: unknown): number[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = value.split(/[,\s]+/);
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => Number(m)).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
}

/** Readable ranges from month numbers: [6,7,8,9,10] -> "Jun to Oct". */
export function monthRanges(months: number[]): string {
  const set = new Set(months);
  if (!set.size) return "";
  if (set.size === 12) return "All year";
  const next = (m: number) => (m % 12) + 1;
  const prev = (m: number) => ((m + 10) % 12) + 1;
  // Runs start at a month whose previous month is not in the set; this also
  // handles runs that wrap past December (e.g. Dec to Feb)
  const starts = [...set].filter((m) => !set.has(prev(m))).sort((a, b) => a - b);
  return starts
    .map((first) => {
      let last = first;
      while (set.has(next(last))) last = next(last);
      return first === last ? MONTHS[first - 1] : `${MONTHS[first - 1]} to ${MONTHS[last - 1]}`;
    })
    .join(", ");
}

/** How a destination fits the chosen travel month. */
export function seasonFit(dest: Pick<ReportDestination, "bestMonths" | "peakMonths" | "offPeakMonths">, month: number | null): { label: string; tone: string; text: string } | null {
  if (!month) return null;
  if (dest.peakMonths.includes(month)) return { label: "Peak season", tone: "bg-amber-100 text-amber-900", text: "Busy and pricier; book early" };
  if (dest.bestMonths.includes(month)) return { label: "Great time to go", tone: "bg-emerald-100 text-emerald-800", text: "Best conditions this month" };
  if (dest.offPeakMonths.includes(month)) return { label: "Off-peak", tone: "bg-sky-100 text-sky-800", text: "Quieter, often lower prices" };
  return { label: "Shoulder month", tone: "bg-slate-100 text-slate-700", text: "Mixed conditions" };
}

export function cleanLabel(s: string | undefined | null) {
  return String(s || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function confidenceText(c: number) {
  if (c >= 0.8) return "High accuracy";
  if (c >= 0.6) return "Medium accuracy";
  return "Low accuracy";
}

export function nationalityLabel(code: string) {
  return (NATIONALITIES.find((n) => n.code === code) ?? NATIONALITIES[0]).label;
}

/** Category totals in display order. */
export function estimateAmounts(result: Pick<ReportEstimate, "breakdown">) {
  return ESTIMATE_CATEGORIES.map((c) => ({ ...c, amount: Number(result.breakdown?.[c.key]?.total) || 0 }));
}

/** "Know before you book" points, drawn from the estimate's own detail. */
export function estimateInsights(result: Pick<ReportEstimate, "breakdown">, nameOf: (code: string) => string): string[] {
  const transportLegs: any[] = Array.isArray(result.breakdown?.transport?.detail) ? result.breakdown.transport.detail : [];
  const parkRows: any[] = Array.isArray(result.breakdown?.parkFees?.detail) ? result.breakdown.parkFees.detail : [];
  const leadDays = Math.max(0, ...transportLegs.map((l) => Number(l.bookingLeadDays) || 0));
  const insights: string[] = [];
  if (leadDays > 0) insights.push(`Book transport at least ${leadDays} days ahead; some legs need advance booking.`);
  parkRows.filter((p) => p.note).forEach((p) => insights.push(`${p.parkName}: ${p.note}`));
  transportLegs
    .filter((l) => l.status === "no-data")
    .forEach((l) => insights.push(l.note || `No fare on record between ${nameOf(l.from)} and ${nameOf(l.to)}. Confirm with an operator.`));
  if (result.breakdown?.parkFees?.note) insights.push(result.breakdown.parkFees.note);
  return insights;
}

/** The printable reference shown on the document: the shareable es_ reference when there is one. */
export function estimateDisplayReference(result: Pick<ReportEstimate, "estimateId" | "reference">) {
  if (result.reference) return result.reference;
  return result.estimateId ? `EST-${result.estimateId}` : "EST-DRAFT";
}

export function estimatePrintInput(args: {
  result: ReportEstimate;
  route: Array<{ code: string; days: number }>;
  startDate: string | null;
  month: number | null;
  transportPref: string;
  nationality: string;
  destByCode: Map<string, ReportDestination>;
  logoUrl: string;
  verifyUrl: string;
  qrDataUrl: string | null;
  generatedAt: Date;
}): EstimatePrintInput {
  const { result, route, startDate, month, transportPref, nationality, destByCode } = args;
  const b = result.breakdown ?? {};
  const nameOf = (code: string) => destByCode.get(String(code).toUpperCase())?.name ?? cleanLabel(code);
  const pax = Math.max(1, result.travelers.total);
  const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
  const end = start ? new Date(start.getTime() + result.totalDays * 86_400_000) : null;
  const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const listText = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v ? String(v) : "");
  const transportLegs: any[] = Array.isArray(b.transport?.detail) ? b.transport.detail : [];
  const parkRows: any[] = Array.isArray(b.parkFees?.detail) ? b.parkFees.detail : [];
  const fresh = result.dataFreshness?.categories ?? {};

  return {
    logoUrl: args.logoUrl,
    qrDataUrl: args.qrDataUrl,
    verifyUrl: args.verifyUrl,
    reference: estimateDisplayReference(result),
    generatedAt: args.generatedAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT",
    nationalityLabel: nationalityLabel(nationality),
    travellers: result.travelers,
    dateRange: start && end ? `${fmtDay(start)} to ${fmtDay(end)}` : "Not set",
    totalNights: result.totalDays,
    season: `${cleanLabel(result.season)} season`,
    tier: cleanLabel(result.tier),
    transport: TRANSPORT_LABELS[transportPref] ?? TRANSPORT_LABELS.any,
    confidence: confidenceText(result.confidence),
    totalAvg: result.totalAvg,
    totalMin: result.totalMin,
    totalMax: result.totalMax,
    perAdultAvg: result.perAdultAvg,
    perPersonPerDay: result.totalAvg / pax / Math.max(1, result.totalDays),
    categories: estimateAmounts(result).map((a) => ({ key: a.key, label: a.label, hex: a.hex, amount: a.amount })),
    route: route.map((r) => {
      const dest = destByCode.get(r.code.toUpperCase());
      return { name: dest?.name ?? cleanLabel(r.code), nights: r.days, season: dest ? seasonFit(dest, month)?.label ?? null : null, best: dest ? monthRanges(dest.bestMonths) || null : null };
    }),
    parks: parkRows.map((p) => ({
      name: p.parkName || nameOf(p.destination),
      days: p.days,
      rate: p.adultFeePerDay,
      rateType: cleanLabel(p.rateCategory),
      extras: [p.vehicleFee ? `Vehicle ${fmtUSD(p.vehicleFee)}` : "", p.guideFee ? `Guide ${fmtUSD(p.guideFee)}` : ""].filter(Boolean).join(", "),
      subtotal: p.subtotal,
      note: p.note,
    })),
    legs: transportLegs.map((l) => ({
      from: nameOf(l.from),
      to: nameOf(l.to),
      how: l.status === "no-data" ? "No fare on record" : [l.type ? cleanLabel(l.type) : "", l.provider || "", l.durationHours ? `about ${l.durationHours} h` : ""].filter(Boolean).join(" · "),
      unit: l.unitCostAvg != null ? `${fmtUSD(l.unitCostAvg)} ${l.priceUnit === "per-vehicle" ? "per vehicle" : "per person"}` : "",
      cost: l.legCostAvg ?? null,
      note: l.bookingLeadDays ? `Book ${l.bookingLeadDays} days ahead` : l.status === "no-data" ? l.note : undefined,
    })),
    activities: (Array.isArray(b.activities?.detail) ? b.activities.detail : []).map((a: any) => ({
      name: a.activityName,
      unit: `${fmtUSD(a.unitCostAvg)} ${a.priceUnit === "per-vehicle" ? "per vehicle" : a.priceUnit === "per-group" ? "per group" : "per adult"}`,
      includes: listText(a.includes),
      cost: a.totalCostAvg,
    })),
    stays: (Array.isArray(b.accommodation?.detail) ? b.accommodation.detail : []).map((s: any) => ({
      name: nameOf(s.destination),
      nights: s.nights,
      perNight: s.perNightPerAdultAvg,
      tier: cleanLabel(s.tier),
      subtotal: s.subtotalAvg,
    })),
    visa: {
      perAdult: b.visa?.perAdult ?? 0,
      entry: cleanLabel(b.visa?.entries ?? "single"),
      validity: `${b.visa?.durationDays ?? 90} days`,
      processing: cleanLabel(b.visa?.processingTime ?? "on arrival"),
    },
    notes: estimateInsights(result, nameOf),
    seasonalRules: (result.appliedRules || []).map((r) => ({
      name: cleanLabel(r.seasonName),
      change: r.multiplier > 1 ? `+${Math.round((r.multiplier - 1) * 100)}%` : r.multiplier < 1 ? `${Math.round((r.multiplier - 1) * 100)}%` : "Standard rate",
      description: r.description || r.ruleName,
    })),
    freshness: [
      { label: "Park fees", value: fmtDate(fresh.parkFees) },
      { label: "Visa fees", value: fmtDate(fresh.visaFees) },
      { label: "Transport", value: fmtDate(fresh.transport) },
      { label: "Activities", value: fmtDate(fresh.activities) },
      { label: "Seasonal rules", value: fmtDate(fresh.pricingRules) },
      { label: "Accommodation", value: "NoLSAF verified" },
    ],
  };
}

/** Path of the shareable printable report for a saved estimate. */
export function estimateReportPath(reference: string) {
  return `/public/nolscope/report/${encodeURIComponent(reference)}`;
}
