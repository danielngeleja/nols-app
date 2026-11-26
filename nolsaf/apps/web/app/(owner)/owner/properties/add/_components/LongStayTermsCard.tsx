"use client";

/**
 * Monthly rent and terms of a long-stay listing (docs/LONG_STAY_RENTALS.md
 * section 3.1). The card shows a summary; "Edit rent and terms" opens a popup
 * that works on a draft, like the nightly price. Money comes from the
 * server's fee calculator; the popup only adds up what the server returns and
 * the landlord's own estimates. The server validates every field again.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Banknote, CalendarRange, Check, Droplets, FileText, Home, Info, Minus, Pencil, Plus, ShieldCheck, Wallet, Wifi, X, Zap } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { useLongStayApiBase } from "@/components/longStay/longStayApiBase";

type UtilityKey = "water" | "electricity" | "internet" | "security" | "serviceCharge";
type Num = number | "";

export type LongStayTermsDraft = {
  monthlyRent: Num;
  currency: "TZS" | "USD";
  minTermMonths: 3 | 6 | 12;
  maxTermMonths: 6 | 12 | 24 | null;
  upfrontMonths: number;
  furnished: "FURNISHED" | "SEMI" | "UNFURNISHED";
  utilities: Record<UtilityKey, "INCLUDED" | "TENANT">;
  billEstimates: Partial<Record<UtilityKey, Num>>;
  discounts: { m6: Num; m12: Num };
  securityDepositMonths: 0 | 1 | 2;
  noticePeriodDays: 30 | 60 | 90;
  balanceMethods: Array<"BANK" | "MOBILE_MONEY">;
  petsAllowed: boolean;
  maxOccupants: Num;
  availableFrom: string;
};

const UTILITIES: Array<[UtilityKey, string, typeof Droplets]> = [
  ["water", "Water", Droplets],
  ["electricity", "Electricity (LUKU)", Zap],
  ["internet", "Internet", Wifi],
  ["security", "Security guard", ShieldCheck],
  ["serviceCharge", "Service charge", Home],
];

export const EMPTY_LONG_STAY_TERMS: LongStayTermsDraft = {
  monthlyRent: "",
  currency: "TZS",
  minTermMonths: 6,
  maxTermMonths: null,
  upfrontMonths: 6,
  furnished: "FURNISHED",
  utilities: { water: "INCLUDED", electricity: "TENANT", internet: "TENANT", security: "INCLUDED", serviceCharge: "INCLUDED" },
  billEstimates: {},
  discounts: { m6: "", m12: "" },
  securityDepositMonths: 1,
  noticePeriodDays: 30,
  balanceMethods: ["BANK", "MOBILE_MONEY"],
  petsAllowed: false,
  maxOccupants: "",
  availableFrom: "",
};

/** Mirrors the server's rules closely enough to know when the terms are worth sending. */
export function longStayTermsComplete(t: LongStayTermsDraft): boolean {
  const rent = Number(t.monthlyRent);
  const wholeOk = t.currency === "TZS" ? Number.isInteger(rent) : Math.round(rent * 100) === rent * 100;
  const d6 = Number(t.discounts.m6) || 0;
  const d12 = Number(t.discounts.m12) || 0;
  return rent > 0 && wholeOk
    && t.upfrontMonths >= 1 && t.upfrontMonths <= t.minTermMonths
    && (t.maxTermMonths == null || t.maxTermMonths >= t.minTermMonths)
    && d6 <= 30 && d12 <= 30 && (!d6 || !d12 || d12 >= d6)
    && t.balanceMethods.length > 0
    && Number.isInteger(Number(t.maxOccupants)) && Number(t.maxOccupants) >= 1 && Number(t.maxOccupants) <= 30
    && /^\d{4}-\d{2}-\d{2}$/.test(t.availableFrom);
}

/** The body the listing save sends as `longStay`. */
export function longStayTermsForServer(t: LongStayTermsDraft) {
  const estimates = Object.fromEntries(Object.entries(t.billEstimates).filter(([k, v]) => v !== "" && Number(v) > 0 && t.utilities[k as UtilityKey] === "TENANT").map(([k, v]) => [k, Number(v)]));
  const m6 = Number(t.discounts.m6) || null;
  const m12 = Number(t.discounts.m12) || null;
  return {
    monthlyRent: Number(t.monthlyRent),
    currency: t.currency,
    minTermMonths: t.minTermMonths,
    maxTermMonths: t.maxTermMonths,
    upfrontMonths: t.upfrontMonths,
    furnished: t.furnished,
    utilities: t.utilities,
    billEstimates: Object.keys(estimates).length ? estimates : null,
    discounts: m6 || m12 ? { m6, m12 } : null,
    securityDepositMonths: t.securityDepositMonths,
    noticePeriodDays: t.noticePeriodDays,
    balanceMethods: t.balanceMethods,
    residencyRules: { petsAllowed: t.petsAllowed, maxOccupants: Number(t.maxOccupants) },
    availableFrom: t.availableFrom,
  };
}

/** Terms returned by GET /api/owner/properties/:id, back into the form. */
export function longStayTermsFromServer(value: any): LongStayTermsDraft | null {
  if (!value || typeof value !== "object") return null;
  const term = [3, 6, 12].includes(Number(value.minTermMonths)) ? (Number(value.minTermMonths) as 3 | 6 | 12) : 6;
  const max = [6, 12, 24].includes(Number(value.maxTermMonths)) ? (Number(value.maxTermMonths) as 6 | 12 | 24) : null;
  return {
    ...EMPTY_LONG_STAY_TERMS,
    monthlyRent: Number(value.monthlyRent) || "",
    currency: value.currency === "USD" ? "USD" : "TZS",
    minTermMonths: term,
    maxTermMonths: max && max >= term ? max : null,
    upfrontMonths: Math.min(term, Math.max(1, Number(value.upfrontMonths) || term)),
    furnished: ["FURNISHED", "SEMI", "UNFURNISHED"].includes(value.furnished) ? value.furnished : "FURNISHED",
    utilities: { ...EMPTY_LONG_STAY_TERMS.utilities, ...(value.utilities || {}) },
    billEstimates: Object.fromEntries(Object.entries(value.billEstimates || {}).map(([k, v]) => [k, Number(v) || ""])),
    discounts: { m6: Number(value.discounts?.m6) || "", m12: Number(value.discounts?.m12) || "" },
    securityDepositMonths: [0, 1, 2].includes(Number(value.securityDepositMonths)) ? Number(value.securityDepositMonths) as 0 | 1 | 2 : 1,
    noticePeriodDays: [30, 60, 90].includes(Number(value.noticePeriodDays)) ? Number(value.noticePeriodDays) as 30 | 60 | 90 : 30,
    balanceMethods: Array.isArray(value.balanceMethods) ? value.balanceMethods.filter((m: string) => m === "BANK" || m === "MOBILE_MONEY") : ["BANK"],
    petsAllowed: Boolean(value.residencyRules?.petsAllowed),
    maxOccupants: Number(value.residencyRules?.maxOccupants) || "",
    availableFrom: typeof value.availableFrom === "string" ? value.availableFrom.slice(0, 10) : "",
  };
}

type Quote = { monthlyRent: number; termRent: number; tenantFee: number; landlordCommission: number; bookingAmount: number; balanceDue: number; landlordPayout: number };

function money(value: number, currency: string) {
  const d = currency === "TZS" ? 0 : 2;
  return `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
const amount = (raw: string, currency: string): Num => {
  const clean = raw.replace(currency === "TZS" ? /[^0-9]/g : /[^0-9.]/g, "").slice(0, 12);
  return clean === "" ? "" : Number(clean);
};
/** The discount a lease of this length gets, as the server applies it. */
function discountFor(t: LongStayTermsDraft, months: number) {
  const m6 = Number(t.discounts.m6) || 0;
  const m12 = Number(t.discounts.m12) || 0;
  if (months >= 12) return m12 || m6;
  if (months >= 6) return m6;
  return 0;
}

/** Asks the server what a lease of the minimum term costs and pays. */
function useQuote(t: LongStayTermsDraft, term: number = t.minTermMonths) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const discount = discountFor(t, term);
  const apiBase = useLongStayApiBase();
  useEffect(() => {
    const rent = Number(t.monthlyRent);
    if (!(rent > 0)) { setQuote(null); setError(""); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      apiClient.post<{ quote: Quote }>(`${apiBase}/quote`, {
        monthlyRent: rent, termMonths: term, upfrontMonths: Math.min(t.upfrontMonths, term), currency: t.currency, discountPercent: discount,
      }).then((response) => { if (active) { setQuote(response.data.quote); setError(""); } })
        .catch((e) => { if (active) { setQuote(null); setError(e?.response?.data?.error || ""); } });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [t.monthlyRent, term, t.upfrontMonths, t.currency, discount, apiBase]);
  return { quote, error, discount };
}

/** Everything the summary and the popup show, from the server quote plus the landlord's own numbers. */
function totalsOf(t: LongStayTermsDraft, quote: Quote | null) {
  if (!quote) return null;
  const deposit = quote.monthlyRent * t.securityDepositMonths;
  const bills = UTILITIES.reduce((sum, [key]) => sum + (t.utilities[key] === "TENANT" ? Number(t.billEstimates[key]) || 0 : 0), 0);
  return {
    deposit,
    bills,
    moveInTotal: quote.bookingAmount + quote.balanceDue + deposit,
    monthlyCost: quote.monthlyRent + bills,
    youAtMoveIn: quote.balanceDue + deposit,
    youOverLease: quote.termRent - quote.landlordCommission,
  };
}

export function LongStayTermsCard({ value, onChange, number, bookingsOpen, onPreviewLease }: {
  value: LongStayTermsDraft;
  onChange: (next: LongStayTermsDraft) => void;
  number: number;
  bookingsOpen: boolean;
  /** Opens the full lease built from these terms. */
  onPreviewLease?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { quote, error } = useQuote(value);
  const totals = totalsOf(value, quote);
  const complete = longStayTermsComplete(value);
  const hasRent = Number(value.monthlyRent) > 0;
  const c = value.currency;
  const d6 = Number(value.discounts.m6) || 0;
  const d12 = Number(value.discounts.m12) || 0;
  const tenantBills = UTILITIES.filter(([k]) => value.utilities[k] === "TENANT");
  const included = UTILITIES.filter(([k]) => value.utilities[k] === "INCLUDED");

  return (
    <section className="ap-card">
      <header className="ap-card-head">
        <span className="ap-card-head-no">{number}</span>
        <div className="ap-card-head-copy">
          <h3 className="ap-card-title">Monthly rent and terms</h3>
          <p className="ap-card-sub">What the tenant pays and agrees to. These go into the lease.</p>
        </div>
        <span className={`ap-card-tag${complete ? "" : " is-todo"}`}>{complete ? "Complete" : "To do"}</span>
      </header>
      <div className="ap-card-body space-y-3">
        {!hasRent ? (
          <button type="button" onClick={() => setOpen(true)} className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed border-white/20 bg-white/[0.03] p-4 text-left hover:border-teal-400/60 [font-family:inherit]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-teal-400/15 text-teal-300"><Wallet className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-white">Set the monthly rent and terms</span>
              <span className="block text-[12.5px] text-white/55">Rent, lease length, discounts, bills, deposit and house rules, with the totals worked out for you.</span>
            </span>
            <Plus className="h-5 w-5 text-teal-300" />
          </button>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="m-0 text-[12px] text-white/55">Monthly rent</p>
                <p className="m-0 text-[24px] font-bold leading-tight text-white tabular-nums">{money(Number(value.monthlyRent), c)}</p>
                {d6 || d12 ? (
                  <p className="m-0 mt-0.5 text-[12.5px] text-teal-300">
                    {[d6 ? `${d6}% off for 6+ months` : null, d12 ? `${d12}% off for 12 months` : null].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {onPreviewLease ? (
                  <button type="button" onClick={onPreviewLease} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-teal-400/15 px-3.5 text-[13px] font-semibold text-teal-200 hover:bg-teal-400/25 [font-family:inherit]">
                    <FileText className="h-4 w-4" />Read the lease
                  </button>
                ) : null}
                <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-white/15 bg-white/[0.06] px-3.5 text-[13px] font-semibold text-white hover:bg-white/[0.1] [font-family:inherit]">
                  <Pencil className="h-4 w-4" />Edit rent and terms
                </button>
              </div>
            </div>

            <dl className="m-0 grid gap-px overflow-hidden rounded-md border border-solid border-white/10 bg-white/10 text-[12.5px] sm:grid-cols-3">
              <Fact label="Lease">{value.minTermMonths} months min{value.maxTermMonths ? `, up to ${value.maxTermMonths}` : ""}; {value.upfrontMonths} paid up front</Fact>
              <Fact label="Available from">{value.availableFrom ? new Date(`${value.availableFrom}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : <span className="text-amber-300">Not set</span>}</Fact>
              <Fact label="Deposit (to you)">{value.securityDepositMonths ? `${value.securityDepositMonths} month${value.securityDepositMonths === 1 ? "" : "s"}${totals ? `, ${money(totals.deposit, c)}` : ""}` : "None"}</Fact>
              <Fact label="In the rent">{included.length ? included.map(([, l]) => l.replace(" (LUKU)", "")).join(", ") : "No bills"}</Fact>
              <Fact label="Tenant pays">{tenantBills.length ? tenantBills.map(([k, l]) => `${l.replace(" (LUKU)", "")}${Number(value.billEstimates[k]) ? ` ~${money(Number(value.billEstimates[k]), c)}` : ""}`).join(", ") : "Nothing extra"}</Fact>
              <Fact label="Rules">{value.maxOccupants ? `Up to ${value.maxOccupants}` : <span className="text-amber-300">Occupants not set</span>}, pets {value.petsAllowed ? "allowed" : "no"}, {value.noticePeriodDays} days notice</Fact>
            </dl>

            <div className="grid gap-2 sm:grid-cols-3">
              <Total label={`Tenant pays at move-in (${value.minTermMonths}-month lease)`} value={totals ? money(totals.moveInTotal, c) : "-"} />
              <Total label="Tenant's monthly cost after" value={totals ? `${money(totals.monthlyCost, c)}${totals.bills ? " approx." : ""}` : "-"} />
              <Total label="You receive over the lease" value={totals ? money(totals.youOverLease, c) : "-"} strong />
            </div>
            {error ? <p className="m-0 text-[12.5px] text-amber-300">{error}</p> : null}
          </>
        )}

        <p className="m-0 flex items-start gap-2 text-[12px] leading-5 text-white/50">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {bookingsOpen
            ? "Tenants reserve at these terms and you confirm within 24 hours. Only the first month passes through NoLSAF; the rest is paid to you on move-in day."
            : "NoLSAF reviews long-stay listings now. They go on sale when tenant booking opens."}
        </p>
      </div>
      <LongStayTermsDialog open={open} value={value} onClose={() => setOpen(false)} onSave={(next) => { onChange(next); setOpen(false); }} />
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-[#10181a] px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{label}</dt>
      <dd className="m-0 mt-0.5 text-white/85">{children}</dd>
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-md px-3 py-2.5 ${strong ? "bg-teal-400/15" : "bg-white/[0.04]"}`}>
      <p className={`m-0 text-[11.5px] ${strong ? "text-teal-200" : "text-white/55"}`}>{label}</p>
      <p className={`m-0 mt-0.5 text-[16px] font-bold tabular-nums ${strong ? "text-teal-200" : "text-white"}`}>{value}</p>
    </div>
  );
}

// ---------- The popup ----------

const TERM_CHOICES = [3, 6, 12, 24] as const;

function LongStayTermsDialog({ open, value, onClose, onSave }: { open: boolean; value: LongStayTermsDraft; onClose: () => void; onSave: (next: LongStayTermsDraft) => void }) {
  const [draft, setDraft] = useState<LongStayTermsDraft>(value);
  const [offerDiscount, setOfferDiscount] = useState(false);
  const [previewTerm, setPreviewTerm] = useState<number>(value.minTermMonths);
  useEffect(() => {
    if (open) {
      setDraft(value);
      setOfferDiscount(Boolean(Number(value.discounts.m6) || Number(value.discounts.m12)));
      setPreviewTerm(value.minTermMonths);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [open, onClose]);

  // The preview term follows the lease limits as they change.
  const maxTerm = draft.maxTermMonths ?? 24;
  const terms = TERM_CHOICES.filter((m) => m >= draft.minTermMonths && m <= maxTerm);
  const term = terms.includes(previewTerm as any) ? previewTerm : draft.minTermMonths;
  const { quote, error } = useQuote(draft, term);
  const totals = totalsOf(draft, quote);
  const c = draft.currency;
  const rent = Number(draft.monthlyRent) || 0;
  const today = new Date().toISOString().slice(0, 10);
  const yearOut = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const d6 = Number(draft.discounts.m6) || 0;
  const d12 = Number(draft.discounts.m12) || 0;
  const discountBad = d6 > 30 || d12 > 30 || Boolean(d6 && d12 && d12 < d6);
  const discounted = (pct: number) => (c === "TZS" ? Math.round((rent * (100 - pct)) / 100) : Math.round(rent * (100 - pct)) / 100);
  const upfront = Math.min(draft.upfrontMonths, term);
  const missing = [
    !(rent > 0) ? "Rent" : null,
    !draft.availableFrom ? "Available from" : null,
    !(Number(draft.maxOccupants) >= 1) ? "Most people" : null,
    !draft.balanceMethods.length ? "Payment method" : null,
  ].filter(Boolean) as string[];

  if (!open || typeof document === "undefined") return null;
  const set = <K extends keyof LongStayTermsDraft>(key: K, next: LongStayTermsDraft[K]) => setDraft((d) => ({ ...d, [key]: next }));
  const m = (n: number) => money(n, c);
  const tenantBills = UTILITIES.filter(([k]) => draft.utilities[k] === "TENANT");

  return createPortal(
    <div className="np-backdrop" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="ls-dialog-title" className="np-card" style={{ maxWidth: "62rem", height: "min(52rem, calc(100dvh - 2rem))" }} onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-0 border-b border-solid border-slate-200 px-5 py-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><CalendarRange className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="ls-dialog-title" className="m-0 text-[17px] font-bold text-slate-900">Monthly rent and terms</h2>
            <p className="m-0 text-[12.5px] text-slate-500">The whole home, rented for months. Everything here goes into the lease.</p>
          </div>
          {rent > 0 ? <span className="hidden rounded-full bg-[#02665e] px-3 py-1 text-[13px] font-bold text-white tabular-nums sm:inline">{m(rent)} / month</span> : null}
          <button type="button" className="np-close" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_auto] overflow-y-auto md:grid-cols-[minmax(0,1fr)_21rem] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
          {/* Form */}
          <div className="min-h-0 space-y-3 bg-slate-50/60 p-4 md:overflow-y-auto">
            <Block n={1} title="Rent" sub="What the tenant pays you each month, before any discount.">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className={`np-money is-big${draft.monthlyRent !== "" && !(rent > 0) ? " is-bad" : ""}`}>
                  <span>{c}</span>
                  <input autoFocus inputMode="decimal" aria-label="Monthly rent" placeholder={c === "TZS" ? "1,500,000" : "1,200"}
                    value={draft.monthlyRent === "" ? "" : c === "TZS" ? Number(draft.monthlyRent).toLocaleString("en-US") : String(draft.monthlyRent)}
                    onChange={(e) => set("monthlyRent", amount(e.target.value, c))} />
                </div>
                <Seg value={c} options={[["TZS", "TZS"], ["USD", "USD"]]} onChange={(x) => set("currency", x as "TZS" | "USD")} tall />
              </div>
            </Block>

            <Block n={2} title="Lease" sub="How long tenants can sign for, what they pay before moving in, and from when.">
              <div className="space-y-5">
                {/* Length */}
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="From">
                      <Seg value={String(draft.minTermMonths)} options={[["3", "3 months"], ["6", "6 months"], ["12", "12 months"]]}
                        onChange={(x) => { const mm = Number(x) as 3 | 6 | 12; setDraft((d) => ({ ...d, minTermMonths: mm, upfrontMonths: d.upfrontMonths === d.minTermMonths ? mm : Math.min(d.upfrontMonths, mm), maxTermMonths: d.maxTermMonths && d.maxTermMonths < mm ? null : d.maxTermMonths })); setPreviewTerm(mm); }} />
                    </Field>
                    <Field label="Up to">
                      <Seg value={String(draft.maxTermMonths ?? "none")} options={([["12", "12 months"], ["24", "24 months"], ["none", "Any"]] as Array<[string, string]>).filter(([k]) => k === "none" || Number(k) >= draft.minTermMonths)}
                        onChange={(x) => set("maxTermMonths", x === "none" ? null : (Number(x) as 12 | 24))} />
                    </Field>
                  </div>
                  <p className="m-0 mt-2 flex items-center gap-1.5 text-[12.5px] text-slate-600">
                    <CalendarRange className="h-3.5 w-3.5 text-[#02665e]" />
                    Tenants can sign for <b className="text-slate-900">{draft.minTermMonths} {draft.maxTermMonths ? `to ${draft.maxTermMonths} months` : "months or longer"}</b>.
                  </p>
                </div>

                {/* Up front, as a row of months */}
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <p className="m-0 text-[12.5px] font-semibold text-slate-700">Paid before move-in</p>
                    <p className="m-0 text-[12px] text-slate-500">Tap a month to change it</p>
                  </div>
                  <div className="flex gap-1" role="radiogroup" aria-label="Months paid before move-in">
                    {Array.from({ length: draft.minTermMonths }, (_, i) => i + 1).map((n) => {
                      const tone = n === 1 ? "bg-[#02665e] text-white" : n <= draft.upfrontMonths ? "bg-[#02665e]/20 text-[#02665e]" : "bg-slate-100 text-slate-400";
                      return (
                        <button key={n} type="button" role="radio" aria-checked={draft.upfrontMonths === n} aria-label={`${n} month${n === 1 ? "" : "s"} before move-in`} onClick={() => set("upfrontMonths", n)}
                          className={`flex h-11 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center rounded-md border-0 text-[11px] font-semibold [font-family:inherit] ${tone} ${draft.upfrontMonths === n ? "ring-2 ring-[#02665e] ring-offset-1" : ""}`}>
                          <span className="text-[13px] font-bold">{n}</span>
                          <span className="hidden text-[10px] font-medium sm:block">{n === 1 ? "NoLSAF" : n <= draft.upfrontMonths ? "You" : "Monthly"}</span>
                        </button>
                      );
                    })}
                  </div>
                  <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px] text-slate-600">
                    <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#02665e]" />Month 1 at booking, through NoLSAF</li>
                    {draft.upfrontMonths > 1 ? <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#02665e]/25" />{draft.upfrontMonths === 2 ? "Month 2" : `Months 2 to ${draft.upfrontMonths}`} to you on move-in day</li> : null}
                    {draft.upfrontMonths < draft.minTermMonths ? <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" />The rest monthly, to you</li> : null}
                  </ul>
                </div>

                {/* Available from */}
                <div>
                  <p className="m-0 mb-1.5 text-[12.5px] font-semibold text-slate-700">Available from</p>
                  {(() => {
                    const now = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
                    const d = new Date(`${now}T00:00:00Z`);
                    const firstNext = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
                    const quick = draft.availableFrom === now ? "now" : draft.availableFrom === firstNext ? "next" : draft.availableFrom ? "date" : "";
                    return (
                      <div className="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <Seg value={quick || "none"} options={[["now", "Now"], ["next", `1 ${new Date(`${firstNext}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`], ["date", "Pick a date"]]}
                          onChange={(x) => { if (x === "now") set("availableFrom", now); else if (x === "next") set("availableFrom", firstNext); else if (!draft.availableFrom || quick !== "date") set("availableFrom", ""); }} />
                        <DatePickerField label="Available from" value={draft.availableFrom} min={today} max={yearOut} size="sm" squared strongBorder widthClassName="w-full" onChangeAction={(iso) => set("availableFrom", String(iso).slice(0, 10))} />
                      </div>
                    );
                  })()}
                  <p className="m-0 mt-1.5 text-[12px] text-slate-500">
                    {draft.availableFrom ? <>Tenants can move in from <b className="text-slate-800">{new Date(`${draft.availableFrom}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</b>, and choose a date up to 60 days ahead.</> : "The earliest day a tenant can move in."}
                  </p>
                </div>
              </div>
            </Block>

            <Block n={3} title="Discount for longer stays" sub="Optional. Fewer empty months is worth a small discount." aside={
              <Seg value={offerDiscount ? "on" : "off"} options={[["off", "None"], ["on", "Offer"]]} onChange={(x) => { setOfferDiscount(x === "on"); if (x === "off") set("discounts", { m6: "", m12: "" }); }} small />
            }>
              {offerDiscount ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {([["m6", "6 months or longer"], ["m12", "12 months or longer"]] as const).map(([key, label]) => {
                    const pct = Number(draft.discounts[key]) || 0;
                    return (
                      <div key={key} className="flex items-center gap-3 rounded-md border border-solid border-slate-200 bg-white p-2.5">
                        <div className="np-money" style={{ width: "5.5rem", height: 38 }}>
                          <input inputMode="numeric" aria-label={`Discount for ${label}`} placeholder="0" value={draft.discounts[key] === "" ? "" : String(draft.discounts[key])}
                            onChange={(e) => { const raw = e.target.value.replace(/\D/g, "").slice(0, 2); set("discounts", { ...draft.discounts, [key]: raw === "" ? "" : Number(raw) }); }} />
                          <span>%</span>
                        </div>
                        <div className="min-w-0 text-[12.5px]">
                          <p className="m-0 font-semibold text-slate-800">{label}</p>
                          <p className="m-0 text-slate-500">{pct && rent ? <>Tenant pays <b className="text-[#02665e]">{m(discounted(pct))}</b> a month</> : "Up to 30%"}</p>
                        </div>
                      </div>
                    );
                  })}
                  {discountBad ? <p className="np-error sm:col-span-2">Up to 30%, and the 12-month discount cannot be smaller than the 6-month one.</p> : null}
                </div>
              ) : <p className="m-0 text-[12.5px] text-slate-500">Every lease pays the full rent.</p>}
            </Block>

            <Block n={4} title="Bills" sub="What the rent covers. For bills the tenant pays, a monthly estimate helps them decide.">
              <ul className="m-0 list-none divide-y divide-slate-100 overflow-hidden rounded-md border border-solid border-slate-200 bg-white p-0">
                {UTILITIES.map(([key, label, Icon]) => {
                  const tenant = draft.utilities[key] === "TENANT";
                  return (
                    <li key={key} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_12.5rem_9.5rem]">
                      <span className="flex items-center gap-2 text-[13px] font-medium text-slate-800"><Icon className="h-4 w-4 text-[#02665e]" />{label}</span>
                      <Seg value={draft.utilities[key]} options={[["INCLUDED", "In the rent"], ["TENANT", "Tenant pays"]]} onChange={(v) => set("utilities", { ...draft.utilities, [key]: v as "INCLUDED" | "TENANT" })} small />
                      {tenant ? (
                        <div className="np-money" style={{ height: 32 }}>
                          <span>~{c}</span>
                          <input inputMode="decimal" aria-label={`${label} a month, estimate`} placeholder="/ month" value={draft.billEstimates[key] === undefined || draft.billEstimates[key] === "" ? "" : String(draft.billEstimates[key])}
                            onChange={(e) => set("billEstimates", { ...draft.billEstimates, [key]: amount(e.target.value, c) })} />
                        </div>
                      ) : <span className="hidden text-right text-[12px] text-emerald-700 sm:block">Included</span>}
                    </li>
                  );
                })}
              </ul>
            </Block>

            <Block n={5} title="Security deposit" sub="Paid to you at move-in and held by you, never by NoLSAF. Returned at the end, less any damage.">
              <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Seg value={String(draft.securityDepositMonths)} options={[["0", "None"], ["1", "1 month"], ["2", "2 months"]]} onChange={(x) => set("securityDepositMonths", Number(x) as 0 | 1 | 2)} />
                {draft.securityDepositMonths && quote ? <span className="rounded-md bg-white px-3 py-2 text-[13px] text-slate-600 ring-1 ring-slate-200">= <b className="text-slate-900">{m(quote.monthlyRent * draft.securityDepositMonths)}</b></span> : null}
              </div>
            </Block>

            <Block n={6} title="Home and rules">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Furnishing"><Seg value={draft.furnished} options={[["FURNISHED", "Furnished"], ["SEMI", "Semi"], ["UNFURNISHED", "Unfurnished"]]} onChange={(x) => set("furnished", x as LongStayTermsDraft["furnished"])} /></Field>
                <Field label="Notice to end early"><Seg value={String(draft.noticePeriodDays)} options={[["30", "30 days"], ["60", "60 days"], ["90", "90 days"]]} onChange={(x) => set("noticePeriodDays", Number(x) as 30 | 60 | 90)} /></Field>
                <Field label="Most people living there"><Stepper value={Number(draft.maxOccupants) || 0} min={1} max={30} onChange={(n) => set("maxOccupants", n)} unit="person" plural="people" /></Field>
                <Field label="Pets"><Seg value={draft.petsAllowed ? "yes" : "no"} options={[["no", "Not allowed"], ["yes", "Allowed"]]} onChange={(x) => set("petsAllowed", x === "yes")} /></Field>
                <div className="sm:col-span-2">
                  <Field label="The tenant pays you the balance by" hint="Choose one or both">
                    <div className="flex flex-wrap gap-2">
                      {([["BANK", "Bank transfer"], ["MOBILE_MONEY", "Mobile money"]] as const).map(([k, l]) => {
                        const on = draft.balanceMethods.includes(k);
                        return (
                          <button key={k} type="button" aria-pressed={on} onClick={() => set("balanceMethods", on ? draft.balanceMethods.filter((x) => x !== k) : [...draft.balanceMethods, k])}
                            className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-solid px-3.5 text-[13px] font-semibold [font-family:inherit] ${on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
                            {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{l}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </div>
              </div>
            </Block>
          </div>

          {/* Summary */}
          <aside className="min-h-0 border-0 border-t border-solid border-slate-200 bg-white md:overflow-y-auto md:border-l md:border-t-0">
            <div className="sticky top-0 z-[1] border-0 border-b border-solid border-slate-100 bg-white px-4 pb-3 pt-4">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Summary for a lease of</p>
              <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Lease length to preview">
                {terms.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={term === t} onClick={() => setPreviewTerm(t)}
                    className={`h-8 flex-1 cursor-pointer rounded-md border-0 text-[12.5px] font-semibold [font-family:inherit] ${term === t ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{t} mo</button>
                ))}
              </div>
            </div>

            {quote && totals ? (() => {
              const n = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: c === "TZS" ? 0 : 2, maximumFractionDigits: c === "TZS" ? 0 : 2 });
              const disc = discountFor(draft, term);
              const nolsaf = quote.tenantFee + quote.landlordCommission;
              const later = upfront < term ? quote.monthlyRent * (term - upfront) : 0;
              const parts = [
                { key: "fee", label: "NoLSAF fee", value: quote.tenantFee, cls: "bg-amber-400" },
                { key: "m1", label: "Month 1", value: quote.monthlyRent, cls: "bg-[#02665e]" },
                { key: "rest", label: upfront > 2 ? `Months 2 to ${upfront}` : "Month 2", value: quote.balanceDue, cls: "bg-[#5fb3aa]" },
                { key: "dep", label: "Deposit", value: totals.deposit, cls: "bg-slate-300" },
              ].filter((x) => x.value > 0);
              const directItems: Array<[string, string]> = [];
              if (quote.balanceDue) directItems.push([upfront > 2 ? `Rent, months 2 to ${upfront}` : "Rent, month 2", n(quote.balanceDue)]);
              if (totals.deposit) directItems.push(["Deposit (refundable)", n(totals.deposit)]);
              return (
                <div className="space-y-4 px-4 py-4">
                  {/* Hero: what moving in costs, and how it splits */}
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="m-0 text-[12px] font-semibold text-slate-500">Tenant pays to move in</p>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-500">{c}</span>
                    </div>
                    <p className="m-0 text-[26px] font-bold leading-tight text-slate-900 tabular-nums">{n(totals.moveInTotal)}</p>
                    <p className="m-0 text-[12px] text-slate-500">
                      {n(quote.monthlyRent)} a month{disc ? <span className="font-semibold text-[#02665e]"> ({disc}% off {n(rent)})</span> : null} · {term}-month lease
                    </p>
                    <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                      {parts.map((x) => <span key={x.key} className={x.cls} style={{ width: `${(x.value / totals.moveInTotal) * 100}%` }} />)}
                    </div>
                    <ul className="m-0 mt-2 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0">
                      {parts.map((x) => (
                        <li key={x.key} className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-slate-600">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${x.cls}`} /><span className="truncate">{x.label}</span><span className="ml-auto tabular-nums text-slate-900">{n(x.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* When each payment happens */}
                  <ol className="m-0 list-none p-0">
                    <Step dot="bg-amber-400" when="At booking" title="Card payment to NoLSAF" amount={n(quote.bookingAmount)}
                      items={[["First month", n(quote.monthlyRent)], ["Service fee, tenant's", n(quote.tenantFee)]]} />
                    {directItems.length ? (
                      <Step dot="bg-[#5fb3aa]" when="Move-in day" title="Tenant pays you directly" amount={n(quote.balanceDue + totals.deposit)} items={directItems} />
                    ) : null}
                    <Step dot="bg-[#02665e]" when="After move-in" title="NoLSAF pays you month 1" amount={n(quote.landlordPayout)}
                      items={[["First month", n(quote.monthlyRent)], ["Commission", `-${n(quote.landlordCommission)}`]]} last={upfront >= term} />
                    {upfront < term ? (
                      <Step dot="bg-slate-300" when={`Months ${upfront + 1} to ${term}`} title="Monthly rent to you" amount={`${n(quote.monthlyRent)} /mo`}
                        items={[[`${term - upfront} month${term - upfront === 1 ? "" : "s"} in all`, n(later)]]} last />
                    ) : null}
                  </ol>

                  {/* Bills */}
                  {tenantBills.length ? (
                    <div className="rounded-lg border border-solid border-slate-200 px-3 py-2.5">
                      <p className="m-0 flex items-baseline justify-between text-[12px] font-semibold text-slate-700">Bills the tenant pays <span className="tabular-nums text-slate-900">{totals.bills ? `~${n(totals.bills)} /mo` : "not estimated"}</span></p>
                      <p className="m-0 mt-0.5 truncate text-[11.5px] text-slate-500">{tenantBills.map(([k, l]) => `${l.replace(" (LUKU)", "")}${Number(draft.billEstimates[k]) ? ` ${n(Number(draft.billEstimates[k]))}` : ""}`).join(" · ")}</p>
                    </div>
                  ) : null}

                  {/* NoLSAF and you */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-amber-50 px-3 py-2.5">
                      <p className="m-0 text-[11.5px] font-semibold text-amber-800">NoLSAF earns, once</p>
                      <p className="m-0 text-[17px] font-bold tabular-nums text-amber-900">{n(nolsaf)}</p>
                      <p className="m-0 text-[10.5px] leading-4 text-amber-800/80">{n(quote.tenantFee)} fee + {n(quote.landlordCommission)} from month 1</p>
                    </div>
                    <div className="rounded-lg bg-[#02665e] px-3 py-2.5 text-white">
                      <p className="m-0 text-[11.5px] font-semibold text-white/80">You keep in rent</p>
                      <p className="m-0 text-[17px] font-bold tabular-nums">{n(totals.youOverLease)}</p>
                      <p className="m-0 text-[10.5px] leading-4 text-white/70">over {term} months{totals.deposit ? `, plus the ${n(totals.deposit)} deposit you hold` : ""}</p>
                    </div>
                  </div>
                  <p className="m-0 text-[11px] leading-4 text-slate-400">NoLSAF takes nothing from the deposit, later months or bills. All amounts in {c}.</p>
                </div>
              );
            })() : (
              <div className="px-4 py-8 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400"><Wallet className="h-5 w-5" /></span>
                <p className="m-0 mt-2 text-[13px] font-semibold text-slate-700">Your totals appear here</p>
                <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">{error || "Enter the monthly rent to see what the tenant pays and what you receive."}</p>
              </div>
            )}
          </aside>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-200 bg-white px-5 py-3">
          {missing.length ? (
            <span className="mr-auto flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
              Still to fill:{missing.map((x) => <span key={x} className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">{x}</span>)}
            </span>
          ) : <span className="mr-auto flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><Check className="h-3.5 w-3.5" />Ready for the lease</span>}
          <button type="button" className="np-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="np-btn is-primary" disabled={!(rent > 0) || discountBad} onClick={() => onSave({ ...draft, discounts: offerDiscount ? draft.discounts : { m6: "", m12: "" } })}>
            <Check className="h-4 w-4" /> Save terms
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Block({ n, title, sub, aside, children }: { n: number; title: string; sub?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-solid border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#02665e] text-[12px] font-bold text-white">{n}</span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] font-bold text-slate-900">{title}</p>
          {sub ? <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">{sub}</p> : null}
        </div>
        {aside ? <div className="w-40 shrink-0">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="m-0 mb-1.5 text-[12.5px] font-semibold text-slate-700">{label}</p>
      {children}
      {hint ? <p className="m-0 mt-1 text-[11.5px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** One segmented control used everywhere in the popup, so every choice looks the same. */
function Seg({ value, options, onChange, small, tall }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void; small?: boolean; tall?: boolean }) {
  return (
    <div className="flex rounded-lg bg-slate-100 p-1" role="radiogroup">
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`flex-1 cursor-pointer whitespace-nowrap rounded-md border-0 px-2 font-semibold [font-family:inherit] ${tall ? "h-11 text-[14px]" : small ? "h-7 text-[12px]" : "h-8 text-[13px]"} ${value === k ? "bg-white text-[#02665e] shadow-sm ring-1 ring-[#02665e]/30" : "bg-transparent text-slate-500 hover:text-slate-800"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Step({ dot, when, title, amount, items, last }: { dot: string; when: string; title: string; amount: string; items: Array<[string, string]>; last?: boolean }) {
  return (
    <li className="relative flex gap-3 pb-3">
      {!last ? <span className="absolute bottom-0 left-[5px] top-4 w-px bg-slate-200" aria-hidden /> : null}
      <span className={`relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full ring-2 ring-white ${dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{when}</p>
        <div className="flex items-baseline justify-between gap-2">
          <p className="m-0 truncate text-[13px] font-semibold text-slate-900">{title}</p>
          <p className="m-0 shrink-0 text-[13px] font-bold tabular-nums text-slate-900">{amount}</p>
        </div>
        {items.map(([l, v]) => (
          <div key={l} className="flex items-baseline justify-between gap-2 text-[11.5px] text-slate-500">
            <span className="truncate">{l}</span><span className="shrink-0 tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </li>
  );
}

function SummaryGroup({ icon: Icon, title, children }: { icon: typeof Wallet; title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="m-0 mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-slate-800"><Icon className="h-3.5 w-3.5 text-[#02665e]" />{title}</p>
      <div className="rounded-lg border border-solid border-slate-100 px-3 py-1">{children}</div>
    </section>
  );
}

function Stepper({ value, min, max, onChange, unit, plural }: { value: number; min: number; max: number; onChange: (n: number) => void; unit: string; plural?: string }) {
  const shown = value || min;
  return (
    <div className="flex h-10 items-center overflow-hidden rounded-lg border border-solid border-slate-300 bg-white">
      <button type="button" aria-label={`Fewer ${plural ?? `${unit}s`}`} disabled={shown <= min} onClick={() => onChange(Math.max(min, shown - 1))} className="grid h-full w-10 cursor-pointer place-items-center border-0 bg-transparent text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"><Minus className="h-4 w-4" /></button>
      <span className="flex-1 text-center text-[13.5px] font-semibold text-slate-900" aria-live="polite">{value ? `${value} ${value === 1 ? unit : plural ?? `${unit}s`}` : "Choose"}</span>
      <button type="button" aria-label={`More ${plural ?? `${unit}s`}`} disabled={shown >= max} onClick={() => onChange(value ? Math.min(max, value + 1) : min)} className="grid h-full w-10 cursor-pointer place-items-center border-0 bg-transparent text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"><Plus className="h-4 w-4" /></button>
    </div>
  );
}

function Line({ label, value, strong, muted, heading, sub }: { label: string; value: string; strong?: boolean; muted?: boolean; heading?: boolean; sub?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-[12.5px] ${
      strong ? "mt-0.5 border-0 border-t border-solid border-slate-200 py-1.5 pt-2 text-[13.5px] font-bold text-slate-900"
      : heading ? "mt-1 py-1.5 font-semibold text-slate-800"
      : sub ? "py-0.5 pl-3 text-[12px] text-slate-500"
      : muted ? "py-1.5 text-slate-400" : "py-1.5 text-slate-600"}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

export function RentalModeSwitch({ value, onChange, lockedReason, blocker, onClearAndSwitch, onKeepNightly }: {
  value: "NIGHTLY" | "LONG_STAY";
  onChange: (next: "NIGHTLY" | "LONG_STAY") => void;
  lockedReason: string | null;
  /** Saved rooms or units that stop the switch to monthly, when the owner just asked for it. */
  blocker?: { count: number; units: boolean } | null;
  onClearAndSwitch?: () => void;
  onKeepNightly?: () => void;
}) {
  const what = blocker ? `${blocker.count} saved ${blocker.units ? (blocker.count === 1 ? "unit" : "units") : (blocker.count === 1 ? "room type" : "room types")}` : "";
  return (
    <div className="ap-mode-bar">
      <div className="ap-mode-row">
        <p className="ap-mode-q">How do you rent it out?</p>
        <div className="ap-mode-seg" role="radiogroup" aria-label="How you rent it" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          {([["NIGHTLY", "By the night"], ["LONG_STAY", "Monthly (long stay)"]] as const).map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={value === key} disabled={key === "LONG_STAY" && Boolean(lockedReason) && value !== "LONG_STAY"}
              className={`ap-mode-seg-btn${value === key ? " is-on" : ""}`} onClick={() => onChange(key)}>
              {key === "LONG_STAY" ? <CalendarRange className="h-4 w-4" aria-hidden /> : null}{label}
            </button>
          ))}
        </div>
      </div>
      {blocker ? (
        <div role="alertdialog" aria-labelledby="monthly-ask-title" className="mt-3 rounded-lg border border-solid border-amber-200 bg-amber-50/70 p-3.5">
          <p id="monthly-ask-title" className="m-0 flex items-center gap-2 text-[13.5px] font-semibold text-amber-900">
            <Home className="h-4 w-4 shrink-0" aria-hidden />Monthly rents the whole home to one tenant
          </p>
          <p className="m-0 mt-1 text-[13px] leading-5 text-amber-900/80">
            This listing has {what}, which only work for nightly guests. Switching removes them from this draft and sets the home up as one whole place. Your photos, location, description and amenities stay as they are.
          </p>
          <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[12.5px] text-amber-900/80">
            <li className="flex items-start gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Nothing changes until you save.</li>
            <li className="flex items-start gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />A live listing goes back to review, and a NoLSAF Sales Partner inspects the home before it takes tenants.</li>
            <li className="flex items-start gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Upcoming nightly bookings must finish first.</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onClearAndSwitch} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3.5 text-[13px] font-semibold text-white hover:bg-[#014e47] [font-family:inherit]">
              <CalendarRange className="h-4 w-4" aria-hidden />Remove them and switch to monthly
            </button>
            <button type="button" onClick={onKeepNightly} className="inline-flex h-9 cursor-pointer items-center rounded-md border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">
              Keep it by the night
            </button>
          </div>
        </div>
      ) : (
        <p className="ap-mode-hint">
          <Info className="h-3.5 w-3.5" aria-hidden />
          {lockedReason || (value === "LONG_STAY"
            ? "Tenants rent the whole home for months. You set the monthly rent and terms below instead of a nightly price."
            : "Guests book nights. Choose monthly to rent the whole home for 3, 6 or 12 months.")}
        </p>
      )}
    </div>
  );
}
