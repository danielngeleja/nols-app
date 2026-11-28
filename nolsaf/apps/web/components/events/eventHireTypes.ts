/**
 * Event hire add-on (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 4).
 * Mirrors apps/api/src/lib/eventHire.ts; the server cleans and checks every value.
 */
export const SPACE_TYPES: Array<{ key: string; label: string }> = [
  { key: "GARDEN", label: "Garden" },
  { key: "HALL", label: "Hall" },
  { key: "ROOFTOP", label: "Rooftop" },
  { key: "WHOLE_HOUSE", label: "Whole house" },
  { key: "POOL_AREA", label: "Pool area" },
  { key: "OTHER", label: "Other" },
];

/** Same keys and order as the server (EVENT_TYPES). */
export const EVENT_TYPES: Array<{ key: string; label: string }> = [
  { key: "WEDDING", label: "Wedding" },
  { key: "SEND_OFF", label: "Send-off" },
  { key: "KITCHEN_PARTY", label: "Kitchen party" },
  { key: "BIRTHDAY", label: "Birthday" },
  { key: "HOUSE_PARTY", label: "House party" },
  { key: "GRADUATION", label: "Graduation" },
  { key: "MEETING", label: "Meeting" },
  { key: "WORKSHOP", label: "Workshop or training" },
  { key: "CHURCH", label: "Church or fellowship" },
  { key: "PHOTO_SHOOT", label: "Photo or video shoot" },
];

export const ALLOWED:Array<{ key: string; label: string; hint: string }> = [
  { key: "music", label: "Loud music", hint: "Speakers or a DJ, until the quiet time" },
  { key: "decorations", label: "Decorations", hint: "Balloons, lights, tents, cleared after" },
  { key: "outsideCatering", label: "Outside catering", hint: "The client brings their own caterer" },
  { key: "cooking", label: "Cooking on site", hint: "Food cooked at the venue" },
  { key: "alcohol", label: "Alcohol", hint: "Guests may serve drinks" },
  { key: "overnightGuests", label: "Guests stay the night", hint: "Booked as a separate stay" },
];

export type EventTerms = {
  spaceType: string | null;
  eventTypes: string[];
  description: string | null;
  capacitySeated: number | null;
  capacityStanding: number | null;
  earliestStart: string | null;
  latestEnd: string | null;
  noiseCutoff: string | null;
  halfDayPrice: number | null;
  fullDayPrice: number | null;
  eveningPrice: number | null;
  multiDay: { enabled: boolean; maxDays: number | null; off2: number; off3: number; off5: number };
  depositMode: "PERCENT" | "FIXED";
  depositPercent: number | null;
  deposit: number | null;
  cleaningFee: number | null;
  currency: string;
  allowed: Record<string, boolean>;
  provided: { chairs: number | null; tables: number | null; parkingSpaces: number | null; toilets: number | null; powerBackup: boolean; water: boolean };
  permitNote: string | null;
};

export type EventHireView = {
  available?: boolean;
  status: "NONE" | "DRAFT" | "AWAITING_OWNER" | "PENDING" | "APPROVED" | "RETURNED" | "PAUSED";
  /** True once sent for review: nothing can be edited until NoLSAF returns it. */
  locked?: boolean;
  /** NoLSAF's fee on event hire, added on top for the client (never taken from the owner). */
  /** NoLSAF's share kept from the owner's price (10%). */
  ownerFeePercent?: number;
  /** Service fee added for the client (6%). */
  clientFeePercent?: number;
  terms: EventTerms;
  version: string;
  problems: string[];
  eventSpacePhotos: number;
  photos?: Array<{ url: string; area: string | null }>;
  /** Event space photos uploaded on the add-on (kept off the listing). */
  extraPhotos?: string[];
  suggestedDeposit: number | null;
  filledBy: string | null;
  ownerConsentAt: string | null;
  ownerConsentVia: string | null;
  consentCurrent: boolean;
  confirmSentAt: string | null;
  confirmOpenedAt: string | null;
  ownerObjectionNote: string | null;
  ownerObjectedAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  returnReason: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
  propertyTitle: string | null;
  propertyStatus: string | null;
  ownerPhone?: string;
  smsSent?: boolean;
};

export const STATUS_LABEL: Record<string, string> = {
  NONE: "Not set up",
  DRAFT: "Draft",
  AWAITING_OWNER: "Waiting for the owner",
  PENDING: "In review",
  APPROVED: "Approved",
  RETURNED: "Needs changes",
  PAUSED: "Paused",
};

export const STATUS_TONE: Record<string, string> = {
  NONE: "bg-slate-100 text-slate-600",
  DRAFT: "bg-slate-100 text-slate-700",
  AWAITING_OWNER: "bg-sky-50 text-sky-800",
  PENDING: "bg-amber-50 text-amber-800",
  APPROVED: "bg-emerald-50 text-emerald-800",
  RETURNED: "bg-rose-50 text-rose-800",
  PAUSED: "bg-slate-200 text-slate-700",
};

/** Every half hour, 24h clock. */
export const TIMES: string[] = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Minutes from the start to `at`, past midnight when earlier. Same as the server. */
export function eventWindowMinutes(start: string, at: string): number {
  const d = minutesOf(at) - minutesOf(start);
  return d <= 0 ? d + 24 * 60 : d;
}

/**
 * Required details still missing, worded like the server (lib/eventHire.ts
 * requiredTermsProblems). The server checks again; this only keeps Save off.
 */
export function requiredProblems(t: EventTerms): string[] {
  const out: string[] = [];
  if (!t.spaceType) out.push("Choose what kind of space it is.");
  if (!(t.eventTypes ?? []).length) out.push("Choose at least one kind of event the space suits.");
  if (!t.capacitySeated || !t.capacityStanding) out.push("Enter how many guests fit, seated and standing.");
  else if (t.capacityStanding < t.capacitySeated) out.push("Standing guests cannot be fewer than seated guests.");
  if (!t.earliestStart || !t.latestEnd) out.push("Enter the earliest start and the latest end.");
  else {
    const span = eventWindowMinutes(t.earliestStart, t.latestEnd);
    if (span < 60) out.push("Allow at least one hour between the start and the end.");
    if (span > 18 * 60) out.push("Events can run up to 18 hours a day.");
    if (t.noiseCutoff && eventWindowMinutes(t.earliestStart, t.noiseCutoff) > span) out.push("The quiet time must fall between the start and the end.");
  }
  if (!t.halfDayPrice && !t.fullDayPrice) out.push("Enter a half-day or a full-day price.");
  if (t.halfDayPrice && t.fullDayPrice && t.halfDayPrice > t.fullDayPrice) out.push("The half-day price cannot be more than the full-day price.");
  if (t.multiDay?.enabled) {
    if (!t.fullDayPrice) out.push("Events over several days are priced from the full-day price. Enter it.");
    if (!t.multiDay.maxDays) out.push("Choose the most days in a row an event can take.");
    if (t.multiDay.off3 < t.multiDay.off2 || t.multiDay.off5 < t.multiDay.off3) out.push("Longer events should get the same or a bigger discount, not a smaller one.");
  }
  if (t.depositMode === "PERCENT" && t.depositPercent == null) out.push("Choose the deposit as a percent of the price (it can be 0%).");
  if (t.depositMode === "FIXED" && t.deposit == null) out.push("Enter the refundable deposit (it can be 0).");
  return out;
}

/** Fees when the server did not send them (same as EVENT_OWNER_FEE_PERCENT / EVENT_CLIENT_FEE_PERCENT). */
export const OWNER_FEE_PERCENT = 10;
export const CLIENT_FEE_PERCENT = 6;

/** The money for one owner price, worked out like the server (lib/eventHire.ts eventMoney). */
export function eventMoney(ownerPrice: number, ownerFee = OWNER_FEE_PERCENT, clientFee = CLIENT_FEE_PERCENT) {
  const ownerFeeAmount = Math.round((ownerPrice * ownerFee) / 100);
  const clientFeeAmount = Math.round((ownerPrice * clientFee) / 100);
  return { ownerFee: ownerFeeAmount, ownerReceives: ownerPrice - ownerFeeAmount, clientFee: clientFeeAmount, clientPays: ownerPrice + clientFeeAmount };
}

/** The two fee percents from a view, with the defaults. */
export const feesOf = (v: { ownerFeePercent?: number; clientFeePercent?: number } | null | undefined) => ({
  owner: v?.ownerFeePercent ?? OWNER_FEE_PERCENT,
  client: v?.clientFeePercent ?? CLIENT_FEE_PERCENT,
});

export const DAY_DISCOUNTS =[0, 5, 10, 15, 20, 25, 30, 40, 50];
export const MAX_EVENT_DAYS = 14;
export const NO_MULTI_DAY: EventTerms["multiDay"] = { enabled: false, maxDays: null, off2: 0, off3: 0, off5: 0 };

/** Same rule as the server (lib/eventHire.ts multiDayPrice). */
export function multiDayPrice(t: Pick<EventTerms, "fullDayPrice" | "multiDay">, days: number) {
  const m = t.multiDay ?? NO_MULTI_DAY;
  if (!m.enabled || !t.fullDayPrice || days < 2 || days > (m.maxDays ?? 0)) return null;
  const percent = days >= 5 ? m.off5 : days >= 3 ? m.off3 : m.off2;
  const gross = t.fullDayPrice * days;
  const total = Math.round(gross * (1 - percent / 100));
  return { days, gross, percent, total, saving: gross - total };
}

export const DEPOSIT_PERCENTS = [0, 10, 15, 20, 25, 30, 40, 50];

/** Same rule as the server (lib/eventHire.ts depositFor): percent rounds to TSh 1,000. */
export function depositFor(terms: Pick<EventTerms, "depositMode" | "depositPercent" | "deposit">, price: number | null): number | null {
  if (terms.depositMode === "FIXED") return terms.deposit;
  if (terms.depositPercent == null || !price) return null;
  return Math.round((price * terms.depositPercent) / 100 / 1_000) * 1_000;
}

export const tsh =(n: number | null | undefined) => (n == null ? "-" : `TSh ${Math.round(n).toLocaleString("en-US")}`);

/** "22:00" after a "14:00" start is the same day; "02:00" is after midnight. */
export function endLabel(start: string | null, end: string | null): string {
  if (!end) return "-";
  return start && end <= start ? `${end} (next day)` : end;
}

export const eat = (v: string | null | undefined) =>
  v ? `${new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" })} EAT` : "-";
