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
import { BadgeCheck, CalendarCheck, CalendarRange, CheckCircle2, Footprints, Loader2, Lock, MessageCircleQuestion, Plus, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";

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
  open: boolean;
};
type Quote = { currency: string; monthlyRent: number; listedRent?: number; discountPercent?: number; upfrontMonths: number; tenantFee: number; bookingAmount: number; balanceDue: number };

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
  const [quote, setQuote] = useState<Quote | null>(null);
  const [mode, setMode] = useState<"reserve" | "ask" | "visit">("reserve");
  const [text, setText] = useState("");
  const [slots, setSlots] = useState<Array<{ day: string; time: string }>>([{ day: "", time: "10:00" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ kind: "reserved"; ref: string } | { kind: "asked" } | null>(null);

  const included = Object.entries(longStay.utilities).filter(([, v]) => v === "INCLUDED").map(([k]) => UTILITY_LABEL[k] || k);
  const tenantBills = Object.entries(longStay.utilities).filter(([, v]) => v === "TENANT").map(([k]) => {
    const est = longStay.billEstimates?.[k];
    return `${UTILITY_LABEL[k] || k}${est ? ` ~${money(est, longStay.currency)}` : ""}`;
  });
  const d6 = longStay.discounts?.m6 ?? 0;
  const d12 = longStay.discounts?.m12 ?? 0;
  const deposit = longStay.depositAmount ?? 0;
  const earliest = [longStay.availableFrom ?? addDays(2), addDays(2)].sort().pop() as string;
  const latest = addDays(60);
  const canReserve = longStay.open && Boolean(longStay.availableFrom) && earliest <= latest;

  useEffect(() => {
    if (!longStay.open) return;
    let cancelled = false;
    apiClient.get<{ quote: Quote }>(`/api/customer/long-stay/quote?property=${encodeURIComponent(propertySlug)}&termMonths=${term}`)
      .then((r) => { if (!cancelled) setQuote(r.data.quote); })
      .catch(() => { if (!cancelled) setQuote(null); });
    return () => { cancelled = true; };
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

  const tab = (key: typeof mode, label: string) => (
    <button type="button" onClick={() => { setMode(key); setError(""); }} aria-pressed={mode === key}
      className={`h-8 flex-1 cursor-pointer rounded-md border-0 text-[12.5px] font-semibold [font-family:inherit] ${mode === key ? "bg-white text-slate-900 shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-800"}`}>
      {label}
    </button>
  );

  return (
    <div id="booking-card" className="box-border scroll-mt-24 rounded-2xl border border-solid border-slate-200 bg-white p-5 shadow-[0_18px_40px_-24px_rgba(2,40,36,0.35)]">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[24px] font-bold leading-none tracking-tight text-slate-900">{money(longStay.monthlyRent, longStay.currency)}</span>
        <span className="text-[13px] text-slate-500">/ month</span>
      </div>
      {d6 || d12 ? (
        <p className="m-0 mt-1 text-[12.5px] font-semibold text-[#02665e]">{[d6 ? `${d6}% off for 6+ months` : null, d12 ? `${d12}% off for 12 months` : null].filter(Boolean).join(" · ")}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-semibold ${longStay.availableFrom ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-600"}`}>
          <CalendarRange className="h-3.5 w-3.5" />
          {longStay.availableFrom ? (longStay.availableNow ? "Available now" : `Available from ${dayLabel(longStay.availableFrom)}`) : "Let at the moment"}
        </span>
        {longStay.inspected?.inspectedOn ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-800" title="A NoLSAF Sales Partner visited this home and checked it against NoLSAF's standards.">
            <BadgeCheck className="h-3.5 w-3.5" />Inspected by NoLSAF, {dayLabel(longStay.inspected.inspectedOn)}
          </span>
        ) : null}
      </div>

      <dl className="m-0 mt-4 space-y-1.5 border-0 border-t border-solid border-slate-100 pt-3 text-[13px]">
        <Row label="Stay" value={`${longStay.minTermMonths} months minimum${longStay.maxTermMonths ? `, up to ${longStay.maxTermMonths}` : ""}`} />
        <Row label="Paid before move-in" value={`${longStay.upfrontMonths} ${longStay.upfrontMonths === 1 ? "month" : "months"}`} />
        <Row label="Deposit (to the landlord)" value={longStay.securityDepositMonths ? `${deposit ? money(deposit, longStay.currency) : `${longStay.securityDepositMonths} ${longStay.securityDepositMonths === 1 ? "month" : "months"}`}` : "None"} />
        <Row label="Furnishing" value={FURNISHED[longStay.furnished]} />
        <Row label="Bills included" value={included.length ? included.join(", ") : "None"} />
        {tenantBills.length ? <Row label="You pay" value={tenantBills.join(", ")} /> : null}
        <Row label="Notice to leave" value={`${longStay.noticePeriodDays} days`} />
        {longStay.residencyRules ? <Row label="Occupants, pets" value={`Up to ${longStay.residencyRules.maxOccupants}, pets ${longStay.residencyRules.petsAllowed ? "allowed" : "not allowed"}`} /> : null}
      </dl>

      {done?.kind === "reserved" ? (
        <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-[13px] text-emerald-900">
          <p className="m-0 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />Reserved, waiting for the landlord</p>
          <p className="m-0 mt-1 text-emerald-800">The landlord confirms within 24 hours. Then you sign the lease and pay the first month through NoLSAF. Nothing is charged yet.</p>
          <button type="button" onClick={() => router.push(`/account/long-stays/${done.ref}`)} className="mt-2 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-[#02665e] hover:underline [font-family:inherit]">Open my reservation</button>
        </div>
      ) : done?.kind === "asked" ? (
        <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-[13px] text-emerald-900">
          <p className="m-0 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />Sent to NoLSAF</p>
          <p className="m-0 mt-1 text-emerald-800">{mode === "visit" ? "NoLSAF arranges the visit and a Sales Partner goes with you." : "NoLSAF answers, asking the landlord where needed."} You will get a notice in Long stays.</p>
        </div>
      ) : !longStay.open ? (
        <p className="m-0 mt-4 rounded-lg bg-slate-50 p-3 text-[13px] text-slate-600">{longStay.inspected ? "Reservations open soon." : "This home is waiting for its NoLSAF inspection."}</p>
      ) : (
        <div className="mt-4 border-0 border-t border-solid border-slate-100 pt-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="What would you like to do?">
            {tab("reserve", "Reserve")}
            {tab("ask", "Ask NoLSAF")}
            {tab("visit", "Visit")}
          </div>

          {mode === "reserve" ? (
            <div className="mt-3 space-y-3">
              <div>
                <span className="block text-[12.5px] font-semibold text-slate-700">How long</span>
                <div className="mt-1.5 flex gap-2">
                  {terms.map((t) => (
                    <button key={t} type="button" onClick={() => setTerm(t)} aria-pressed={term === t}
                      className={`h-9 flex-1 cursor-pointer rounded-md border border-solid text-[13px] font-semibold [font-family:inherit] ${term === t ? "border-[#02665e] bg-[#02665e]/5 text-[#02665e]" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                      {t} months
                    </button>
                  ))}
                </div>
              </div>
              {canReserve ? (
                <div>
                <span className="block text-[12.5px] font-semibold text-slate-700">Move-in date</span>
                <div className="mt-1.5"><DatePickerField label="Move-in date" value={moveIn} min={earliest} max={latest} size="sm" widthClassName="w-full" onChangeAction={(iso) => { setMoveIn(String(iso).slice(0, 10)); setError(""); }} /></div>
                </div>
              ) : (
                <p className="m-0 rounded-md bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">Move-in dates open within 60 days of {longStay.availableFrom ? dayLabel(longStay.availableFrom) : "the home being free"}. Ask NoLSAF to hear first.</p>
              )}
              {quote ? (
                <dl className="m-0 space-y-1 rounded-md bg-slate-50 px-3 py-2.5 text-[13px]">
                  {quote.discountPercent ? <Row label={`${term}-month discount`} value={`${quote.discountPercent}% off ${money(quote.listedRent ?? 0, quote.currency)}`} /> : null}
                  <Row label="First month, through NoLSAF" value={money(quote.monthlyRent, quote.currency)} />
                  <Row label="NoLSAF service fee" value={money(quote.tenantFee, quote.currency)} />
                  <div className="flex items-baseline justify-between gap-3 border-0 border-t border-solid border-slate-200 pt-1 font-semibold text-slate-900">
                    <dt>To pay after you sign</dt><dd className="m-0">{money(quote.bookingAmount, quote.currency)}</dd>
                  </div>
                  {quote.balanceDue ? <Row label="Rent to the landlord on move-in day" value={money(quote.balanceDue, quote.currency)} /> : null}
                  {longStay.securityDepositMonths ? <Row label="Deposit to the landlord (returned at the end)" value={money(quote.monthlyRent * longStay.securityDepositMonths, quote.currency)} /> : null}
                </dl>
              ) : null}
              {error ? <p className="m-0 text-[13px] text-red-700">{error}</p> : null}
              <button type="button" disabled={busy || !canReserve} onClick={reserve} className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] text-sm font-semibold text-white hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-60 [font-family:inherit]">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Reserve
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="ls-ask" className="block text-[12.5px] font-semibold text-slate-700">{mode === "visit" ? "Who is coming, and anything to check" : "Your question to NoLSAF"}</label>
                <textarea id="ls-ask" value={text} onChange={(event) => { setText(event.target.value); setError(""); }} maxLength={1000}
                  placeholder={mode === "visit" ? "Two of us; we want to see the water pressure and parking" : "Is there parking? Is the road passable in the rains?"}
                  className="mt-1.5 min-h-20 w-full resize-y rounded-md border border-solid border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
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
                          className="h-9 rounded-md border border-solid border-slate-300 bg-white px-2 text-sm">
                          {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {slots.length > 1 ? (
                          <button type="button" aria-label="Remove this time" onClick={() => setSlots((list) => list.filter((_, i) => i !== index))} className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><X className="h-4 w-4" /></button>
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
              <button type="button" disabled={busy} onClick={ask} className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-solid border-[#02665e] bg-white text-sm font-semibold text-[#02665e] hover:bg-[#02665e]/5 disabled:opacity-60 [font-family:inherit]">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "visit" ? <Footprints className="h-4 w-4" /> : <MessageCircleQuestion className="h-4 w-4" />}
                {mode === "visit" ? "Ask for a visit" : "Send to NoLSAF"}
              </button>
            </div>
          )}
        </div>
      )}

      <p className="m-0 mt-3 flex items-start gap-2 text-[12px] leading-5 text-slate-500">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Nothing is charged to reserve. Only the first month and the service fee are paid through NoLSAF, after you sign the lease; the rest goes to the landlord on move-in day, once you have the keys.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="m-0 text-right text-slate-800">{value}</dd>
    </div>
  );
}
