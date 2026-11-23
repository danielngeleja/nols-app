"use client";

/**
 * Side card for a long-stay home (docs/LONG_STAY_RENTALS.md section 13).
 * Everything a tenant needs is on the listing: rent, terms, availability and
 * NoLSAF's on-site inspection. The tenant reserves at the listed terms; the
 * landlord confirms within 24 hours. Questions and visits go to NoLSAF, never
 * straight to the landlord, until the booking is paid.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Armchair, BadgeCheck, CalendarCheck, CalendarRange, Check, CheckCircle2, Footprints, Loader2, Lock, MessageCircleQuestion, PawPrint, Plus, Timer, UsersRound, X, type LucideIcon } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import type { PublicInspectionReport } from "./LongStayInspectionReport";

export type PublicLongStay = {
  monthlyRent: number;
  currency: string;
  minTermMonths: number;
  maxTermMonths: number | null;
  upfrontMonths: number;
  furnished: "FURNISHED" | "SEMI" | "UNFURNISHED";
  utilities: Record<string, "INCLUDED" | "TENANT">;
  securityDepositMonths: number;
  noticePeriodDays: number;
  residencyRules: { petsAllowed: boolean; maxOccupants: number } | null;
  discounts?: { m6: number | null; m12: number | null } | null;
  billEstimates?: Partial<Record<string, number>> | null;
  depositAmount?: number;
  availableFrom: string | null;
  availableNow: boolean;
  inspected: { inspectedOn: string | null; validUntil: string | null } | null;
  inspectionReport?: PublicInspectionReport | null;
  open: boolean;
};
type Quote = { currency: string; monthlyRent: number; discountPercent?: number; tenantFee: number; bookingAmount: number; balanceDue: number };

const UTILITY_LABEL: Record<string, string> = { water: "Water", electricity: "Electricity", internet: "Internet", security: "Security", serviceCharge: "Service charge" };
const FURNISHED = { FURNISHED: "Furnished", SEMI: "Semi-furnished", UNFURNISHED: "Unfurnished" } as const;
const TERMS = [3, 6, 12];
const TIMES = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"];

function money(value: number, currency: string) {
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: currency === "TZS" ? 0 : 2 })}`;
}
function dayLabel(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function addDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
/** A date and time in Dar es Salaam (UTC+3, no daylight saving) as an ISO instant. */
function eatInstant(day: string, time: string) {
  return new Date(`${day}T${time}:00+03:00`).toISOString();
}

export default function LongStayRequestCard({ propertySlug, longStay }: { propertySlug: string; longStay: PublicLongStay }) {
  const router = useRouter();
  const terms = TERMS.filter((t) => t >= longStay.minTermMonths && t <= (longStay.maxTermMonths ?? 24));
  const [term, setTerm] = useState<number>(terms[0] ?? longStay.minTermMonths);
  const [moveIn, setMoveIn] = useState("");
  const [pricing, setPricing] = useState<{ propertySlug: string; term: number; quote: Quote | null } | null>(null);
  const [mode, setMode] = useState<"reserve" | "ask" | "visit">("reserve");
  const [text, setText] = useState("");
  const [slots, setSlots] = useState<Array<{ day: string; time: string }>>([{ day: "", time: "10:00" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ kind: "reserved"; ref: string } | { kind: "asked" } | null>(null);

  const included = Object.entries(longStay.utilities).filter(([, v]) => v === "INCLUDED").map(([k]) => UTILITY_LABEL[k] || k);
  const tenantBills = Object.entries(longStay.utilities).filter(([, v]) => v === "TENANT").map(([k]) => {
    const est = longStay.billEstimates?.[k];
    return { key: k, label: UTILITY_LABEL[k] || k, estimate: est && est > 0 ? money(est, longStay.currency) : null };
  });
  const d6 = longStay.discounts?.m6 ?? 0;
  const d12 = longStay.discounts?.m12 ?? 0;
  const deposit = longStay.securityDepositMonths === 0 ? "No deposit"
    : longStay.depositAmount ? money(longStay.depositAmount, longStay.currency)
    : longStay.securityDepositMonths === 1 ? "1 month’s rent" : `${longStay.securityDepositMonths} months’ rent`;
  const earliest = [longStay.availableFrom ?? addDays(2), addDays(2)].sort().pop() as string;
  const latest = addDays(60);
  const canReserve = longStay.open && Boolean(longStay.availableFrom) && earliest <= latest;
  const stayLength = longStay.maxTermMonths && longStay.maxTermMonths !== longStay.minTermMonths
    ? `${longStay.minTermMonths}–${longStay.maxTermMonths} months`
    : `${longStay.minTermMonths} months${longStay.maxTermMonths ? "" : " minimum"}`;
  const matchingPricing = pricing?.propertySlug === propertySlug && pricing.term === term ? pricing : null;
  const quote = matchingPricing?.quote ?? null;

  useEffect(() => {
    if (!longStay.open) return;
    const controller = new AbortController();
    apiClient.get<{ quote: Quote }>(`/api/customer/long-stay/quote?property=${encodeURIComponent(propertySlug)}&termMonths=${term}`, { signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) setPricing({ propertySlug, term, quote: r.data.quote }); })
      .catch(() => { if (!controller.signal.aborted) setPricing({ propertySlug, term, quote: null }); });
    return () => controller.abort();
  }, [propertySlug, term, longStay.open]);

  const signIn = () => router.push(`/login?next=${encodeURIComponent(`/public/properties/${propertySlug}`)}`);

  const reserve = async () => {
    setError("");
    if (!moveIn) { setError("Choose your move-in date."); return; }
    setBusy(true);
    try {
      const response = await apiClient.post<{ ref: string }>("/api/customer/long-stay/reservations", { property: propertySlug, moveInDate: moveIn, termMonths: term });
      setDone({ kind: "reserved", ref: response.data.ref });
    } catch (requestError: any) {
      if (requestError?.response?.status === 401) return signIn();
      setError(requestError?.response?.data?.error || "Could not reserve. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    setError("");
    const chosen = slots.filter((s) => s.day);
    if (text.trim().length < 5) { setError(mode === "visit" ? "Tell NoLSAF who is coming (at least 5 characters)." : "Write your question (at least 5 characters)."); return; }
    if (mode === "visit" && !chosen.length) { setError("Pick at least one day that suits you."); return; }
    setBusy(true);
    try {
      await apiClient.post("/api/customer/long-stay/enquiries", {
        property: propertySlug,
        kind: mode === "visit" ? "VISIT" : "QUESTION",
        text: text.trim(),
        slots: mode === "visit" ? chosen.map((s) => eatInstant(s.day, s.time)) : null,
      });
      setDone({ kind: "asked" });
    } catch (requestError: any) {
      if (requestError?.response?.status === 401) return signIn();
      setError(requestError?.response?.data?.error || "Could not send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const tab = (key: typeof mode, label: string, Icon: LucideIcon) => (
    <button type="button" onClick={() => { setMode(key); setError(""); }} aria-pressed={mode === key}
      className={`inline-flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-solid px-1.5 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#02665e] [font-family:inherit] ${mode === key ? "border-[#d4e6df] bg-[#eaf4f0] text-[#215b50]" : "border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </button>
  );

  return (
    <section id="booking-card" aria-label="Long-stay terms and reservations" className="box-border min-w-0 scroll-mt-24 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      <header className="px-4 pb-4 pt-5 sm:px-5">
        <p className={`m-0 flex items-center gap-2 text-xs font-semibold ${longStay.availableFrom ? "text-[#02665e]" : "text-slate-600"}`}>
          <span className={`size-1.5 shrink-0 rounded-full ${longStay.availableFrom ? "bg-[#02665e]" : "bg-slate-400"}`} aria-hidden />
          {longStay.availableFrom ? (longStay.availableNow ? "Available now" : `Available from ${dayLabel(longStay.availableFrom)}`) : "Currently let"}
        </p>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="m-0 min-w-0 text-[clamp(1.75rem,5vw,2.375rem)] font-bold leading-tight tracking-tight text-slate-950 tabular-nums [overflow-wrap:anywhere]">{money(longStay.monthlyRent, longStay.currency)}</h2>
          <span className="text-sm text-slate-600">per month</span>
        </div>
        {d6 || d12 ? (
          <p className="m-0 mt-2 text-xs font-semibold text-[#02665e]">{[d6 ? `${d6}% off for 6+ months` : null, d12 ? `${d12}% off for 12 months` : null].filter(Boolean).join(" · ")}</p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs font-medium text-slate-600">
          <span className="inline-flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />{stayLength}</span>
          <span className="inline-flex items-center gap-1.5"><Armchair className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />{FURNISHED[longStay.furnished]}</span>
          {longStay.inspected?.inspectedOn ? (
            <span className="inline-flex items-center gap-1.5 text-[#02665e]" title={`Visited on ${dayLabel(longStay.inspected.inspectedOn)}`}><BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />Inspected by NoLSAF</span>
          ) : null}
        </div>
      </header>

      <div className="space-y-3 px-4 pb-4 sm:px-5">
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-2">
          <div className="min-w-0 rounded-md border border-solid border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <dt className="text-xs font-medium text-slate-600">Rent paid upfront</dt>
            <dd className="m-0 mt-1 text-[15px] font-semibold text-slate-950">{longStay.upfrontMonths} {longStay.upfrontMonths === 1 ? "month" : "months"}</dd>
            <dd className="m-0 mt-0.5 text-[11px] text-slate-500">Includes the first month</dd>
          </div>
          <div className="min-w-0 rounded-md border border-solid border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <dt className="text-xs font-medium text-slate-600">Security deposit</dt>
            <dd className="m-0 mt-1 break-words text-[15px] font-semibold tabular-nums text-slate-950">{deposit}</dd>
            {longStay.securityDepositMonths > 0 ? <dd className="m-0 mt-0.5 text-[11px] text-slate-500">Pay to landlord</dd> : null}
          </div>
        </dl>

        {done?.kind === "reserved" ? (
          <div className="rounded-md border border-solid border-emerald-200 bg-emerald-50/60 p-3 text-[13px] text-emerald-900">
            <p className="m-0 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />Reserved, waiting for the landlord</p>
            <p className="m-0 mt-1 text-emerald-800">The landlord confirms within 24 hours. Then you sign the lease and pay the first month through NoLSAF. Nothing is charged yet.</p>
            <button type="button" onClick={() => router.push(`/account/long-stays/${done.ref}`)} className="mt-2 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-[#02665e] hover:underline [font-family:inherit]">Open my reservation</button>
          </div>
        ) : done?.kind === "asked" ? (
          <div className="rounded-md border border-solid border-emerald-200 bg-emerald-50/60 p-3 text-[13px] text-emerald-900">
            <p className="m-0 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />Sent to NoLSAF</p>
            <p className="m-0 mt-1 text-emerald-800">{mode === "visit" ? "NoLSAF arranges the visit and a Sales Partner goes with you." : "NoLSAF answers, asking the landlord where needed."} You will get a notice in Long stays.</p>
          </div>
        ) : !longStay.open ? (
          <div className={`flex items-start gap-2.5 rounded-md border border-solid px-3 py-2.5 text-[13px] text-slate-900 ${longStay.inspected ? "border-slate-200 bg-slate-50" : "border-[#eedfc0] bg-[#fcf8ee]"}`}>
            <span className={`grid size-7 shrink-0 place-items-center rounded-sm ${longStay.inspected ? "bg-slate-100 text-slate-600" : "bg-[#f5ead2] text-amber-800"}`}>
              <CalendarCheck className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="m-0 font-semibold">{longStay.inspected ? "Reservations are closed for now" : "Inspection pending"}</p>
              {!longStay.inspected ? <p className="m-0 mt-0.5 text-xs leading-relaxed text-slate-600">Reservations are closed while NoLSAF checks this home.</p> : null}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex gap-1 rounded-md border border-solid border-slate-200 bg-slate-50 p-1" role="group" aria-label="What would you like to do?">
              {tab("reserve", "Reserve", CalendarCheck)}
              {tab("ask", "Ask NoLSAF", MessageCircleQuestion)}
              {tab("visit", "Visit", Footprints)}
            </div>

            {mode === "reserve" ? (
              <div className="mt-3 space-y-3">
                <fieldset className="m-0 min-w-0 border-0 p-0">
                  <legend className="p-0 text-[12.5px] font-semibold text-slate-700">Lease length</legend>
                  <div className="mt-1.5 flex gap-2">
                    {terms.map((t) => (
                      <button key={t} type="button" onClick={() => setTerm(t)} aria-pressed={term === t}
                        className={`h-9 flex-1 cursor-pointer rounded-sm border border-solid text-[13px] font-semibold [font-family:inherit] ${term === t ? "border-[#02665e] bg-[#02665e]/5 text-[#02665e]" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                        {t} months
                      </button>
                    ))}
                  </div>
                </fieldset>
                {canReserve ? (
                  <div>
                    <span className="block text-[12.5px] font-semibold text-slate-700">Move-in date</span>
                    <div className="mt-1.5"><DatePickerField label="Move-in date" value={moveIn} min={earliest} max={latest} size="sm" widthClassName="w-full" onChangeAction={(iso) => { setMoveIn(String(iso).slice(0, 10)); setError(""); }} /></div>
                  </div>
                ) : (
                  <p className="m-0 rounded-md border border-solid border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">{longStay.availableFrom ? "Reservations can be made up to 60 days before move-in." : "There are no move-in dates available yet."} Ask NoLSAF about availability.</p>
                )}
                {quote ? (
                  <section aria-label="Payment breakdown" className="border-0 border-y border-solid border-slate-200">
                    <div className="py-2.5">
                      <h3 className="m-0 text-xs font-bold text-slate-900">Pay NoLSAF after signing</h3>
                      <dl className="m-0 mt-1.5 space-y-1 text-xs">
                        {quote.discountPercent ? <Row label={`${term}-month offer`} value={`${quote.discountPercent}% off the listed rent`} /> : null}
                        <Row label="First month’s rent" value={money(quote.monthlyRent, quote.currency)} />
                        <Row label="Service fee" value={money(quote.tenantFee, quote.currency)} />
                      </dl>
                      <p className="m-0 mt-2 flex flex-wrap items-center justify-between gap-x-2 border-0 border-t border-solid border-slate-200 pt-2 text-xs font-semibold text-[#02665e]">
                        <span>Total after signing</span>
                        <strong className="text-sm tabular-nums">{money(quote.bookingAmount, quote.currency)}</strong>
                      </p>
                    </div>
                    {quote.balanceDue || longStay.securityDepositMonths ? (
                      <div className="border-0 border-t border-solid border-slate-200 py-2.5">
                        <h3 className="m-0 text-xs font-bold text-slate-900">Pay the landlord on move-in day</h3>
                        <dl className="m-0 mt-1.5 space-y-1 text-xs">
                          {quote.balanceDue ? <Row label="Remaining upfront rent" value={money(quote.balanceDue, quote.currency)} /> : null}
                          {longStay.securityDepositMonths ? <Row label="Security deposit" value={money(quote.monthlyRent * longStay.securityDepositMonths, quote.currency)} /> : null}
                        </dl>
                      </div>
                    ) : null}
                  </section>
                ) : <p role="status" className="m-0 text-xs text-slate-500">{matchingPricing ? "The payment breakdown is temporarily unavailable." : "Calculating your payment breakdown…"}</p>}
                {error ? <p className="m-0 text-[13px] text-red-700">{error}</p> : null}
                <button type="button" disabled={busy || !canReserve} onClick={reserve} className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-sm border-0 bg-[#02665e] text-sm font-semibold text-white hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-60 [font-family:inherit]">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Reserve
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="ls-ask" className="block text-[12.5px] font-semibold text-slate-700">{mode === "visit" ? "Who is coming, and anything to check" : "Your question to NoLSAF"}</label>
                  <textarea id="ls-ask" value={text} onChange={(event) => { setText(event.target.value); setError(""); }} maxLength={1000}
                    placeholder={mode === "visit" ? "Two of us; we want to see the water pressure and parking" : "Is there parking? Is the road passable in the rains?"}
                    className="mt-1.5 min-h-20 w-full resize-y rounded-sm border border-solid border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
                </div>
                {mode === "visit" ? (
                  <div>
                    <span className="block text-[12.5px] font-semibold text-slate-700">Times that suit you (up to 3, EAT)</span>
                    <div className="mt-1.5 space-y-2">
                      {slots.map((slot, index) => (
                        <div key={index} className="grid grid-cols-[minmax(0,1fr)_88px_auto] items-end gap-2">
                          <DatePickerField label={`Day ${index + 1}`} value={slot.day} min={addDays(1)} max={addDays(30)} size="sm" widthClassName="w-full"
                            onChangeAction={(iso) => setSlots((list) => list.map((s, i) => (i === index ? { ...s, day: String(iso).slice(0, 10) } : s)))} />
                          <select value={slot.time} aria-label={`Time ${index + 1}`} onChange={(event) => setSlots((list) => list.map((s, i) => (i === index ? { ...s, time: event.target.value } : s)))}
                            className="h-9 rounded-sm border border-solid border-slate-300 bg-white px-2 text-sm">
                            {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                          {slots.length > 1 ? (
                            <button type="button" aria-label="Remove this time" onClick={() => setSlots((list) => list.filter((_, i) => i !== index))} className="grid h-9 w-9 cursor-pointer place-items-center rounded-sm border border-solid border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><X className="h-4 w-4" /></button>
                          ) : <span className="w-9" />}
                        </div>
                      ))}
                    </div>
                    {slots.length < 3 ? (
                      <button type="button" onClick={() => setSlots((list) => [...list, { day: "", time: "10:00" }])} className="mt-1.5 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline [font-family:inherit]">
                        <Plus className="h-3.5 w-3.5" /> Add another time
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {error ? <p className="m-0 text-[13px] text-red-700">{error}</p> : null}
                <button type="button" disabled={busy} onClick={ask} className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-sm border border-solid border-[#02665e] bg-white text-sm font-semibold text-[#02665e] hover:bg-[#02665e]/5 disabled:opacity-60 [font-family:inherit]">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "visit" ? <Footprints className="h-4 w-4" /> : <MessageCircleQuestion className="h-4 w-4" />}
                  {mode === "visit" ? "Ask for a visit" : "Send to NoLSAF"}
                </button>
              </div>
            )}
          </div>
        )}

        {longStay.open && mode === "reserve" && !done ? (
          <p className="m-0 flex items-start gap-1.5 text-xs leading-5 text-slate-600">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
            Reserving is free. Pay the landlord on move-in day once you have the keys.
          </p>
        ) : null}
      </div>

      <div className="space-y-4 border-0 border-t border-solid border-slate-200 px-4 py-4 sm:px-5">
        <section aria-label="Utilities and bills">
          <h3 className="m-0 text-[15px] font-semibold tracking-tight text-slate-950">Utilities and bills</h3>
          {included.length ? (
            <div className="mt-2.5 flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
              <div className="min-w-0">
                <p className="m-0 text-xs font-semibold text-[#02665e]">Included in rent</p>
                <p className="m-0 mt-0.5 text-[13px] leading-5 text-slate-700">{included.join(", ")}</p>
              </div>
            </div>
          ) : <p className="m-0 mt-1 text-xs text-slate-600">No utilities included</p>}
          {tenantBills.length ? (
            <div className="mt-3 border-0 border-t border-solid border-slate-100 pt-2.5">
              <p className="m-0 text-xs font-semibold text-slate-600">Paid separately</p>
              <dl className="m-0 mt-1 divide-y divide-slate-100 text-[13px]">
                {tenantBills.map(({ key, label, estimate }) => (
                  <div key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                    <dt className="text-slate-700">{label}</dt>
                    <dd className="m-0 font-semibold tabular-nums text-slate-900">{estimate ? <><span className="mr-1 text-xs font-normal text-slate-600">Est.</span>{estimate}<span className="ml-1 text-xs font-normal text-slate-600">/ mo</span></> : "Cost varies"}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </section>
        <section aria-label="Living rules" className="border-0 border-t border-solid border-slate-200 pt-3">
          <h3 className="m-0 text-[15px] font-semibold tracking-tight text-slate-950">Living rules</h3>
          <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-3 gap-y-2 p-0 text-xs text-slate-700">
            <li className="inline-flex items-center gap-1.5"><Timer className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />{longStay.noticePeriodDays} days’ notice</li>
            {longStay.residencyRules ? (
              <>
                <li className="inline-flex items-center gap-1.5"><UsersRound className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />Up to {longStay.residencyRules.maxOccupants} {longStay.residencyRules.maxOccupants === 1 ? "occupant" : "occupants"}</li>
                <li className="inline-flex items-center gap-1.5"><PawPrint className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />{longStay.residencyRules.petsAllowed ? "Pets allowed" : "No pets"}</li>
              </>
            ) : null}
          </ul>
        </section>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="m-0 text-right font-medium tabular-nums text-slate-800">{value}</dd>
    </div>
  );
}
