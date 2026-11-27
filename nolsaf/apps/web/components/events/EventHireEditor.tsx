"use client";

/**
 * The event hire form, shared by the owner (/owner/properties/[id]/events) and
 * the sales partner (/sales/leads/[id]/events). It edits and saves terms; the
 * page around it decides what happens next (consent, SMS to the owner).
 */
import { useEffect, useMemo, useState } from "react";
import { photoAreaLabel } from "@/lib/photoAreas";
import { uploadImageSigned } from "@/lib/cloudinarySignedUpload";

/** Same rule as the server (EVENT_MIN_PHOTOS / EVENT_MAX_PHOTOS): 7 to 12 photos of the space in all. */
const MIN_PHOTOS = 7;
const MAX_PHOTOS = 12;
import { Armchair, Bath, BedDouble, Building2, CalendarRange, Car, Check, CookingPot, Droplets, FileText, Home, ImageIcon, ImagePlus, Loader2, Lock, Minus, Music, PartyPopper, Plus, Receipt, Save, ShieldCheck, Sparkles, Sun, Table2, Trees, UtensilsCrossed, Waves, Wine, X, Zap } from "lucide-react";
import { ALLOWED, DAY_DISCOUNTS, DEPOSIT_PERCENTS, EVENT_TYPES, eventMoney, feesOf, MAX_EVENT_DAYS, NO_MULTI_DAY, SPACE_TYPES, TIMES, depositFor, multiDayPrice, requiredProblems, endLabel, tsh, type EventHireView, type EventTerms } from "./eventHireTypes";

const card = "min-w-0 rounded-lg border border-solid border-slate-300 bg-white";
const input = "mt-1.5 block min-h-10 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";
const field = "block min-w-0 text-xs font-medium text-slate-600";
const compact = "h-9 rounded-md border border-solid border-slate-300 bg-white pl-2.5 pr-8 text-sm font-semibold text-slate-800 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";

const digits = (v: string, max = 12) => v.replace(/\D/g, "").slice(0, max);
const num = (v: string) => (v === "" ? null : Number(v));
const show = (n: number | null | undefined) => (n == null ? "" : String(n));

/** Red asterisk for a required field; `either` marks "this one or the other". */
function Req({ either }: { either?: boolean }) {
  return (
    <span className="ml-0.5 font-semibold text-rose-600" title={either ? "Required: this or the other price" : "Required"}>
      *{either ? <span className="ml-1 text-[10px] font-medium text-slate-400">one of two</span> : null}
    </span>
  );
}

function MoneyInput({ label, value, onChange, hint }: { label: React.ReactNode; value: number | null; onChange: (v: number | null) => void; hint?: string }) {
  return (
    <label className={field}>
      {label}
      <span className="relative mt-1.5 block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">TSh</span>
        <input
          value={value == null ? "" : value.toLocaleString("en-US")}
          onChange={(e) => onChange(num(digits(e.target.value, 10)))}
          inputMode="numeric"
          className={input.replace("mt-1.5 ", "")}
          style={{ paddingLeft: 44 }}
        />
      </span>
      {hint ? <span className="mt-1 block text-[11px] font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

const SPACE_ICONS: Record<string, typeof Trees> = { GARDEN: Trees, HALL: Building2, ROOFTOP: Sun, WHOLE_HOUSE: Home, POOL_AREA: Waves, OTHER: Sparkles };
const COUNTS = [
  { key: "chairs", label: "Chairs", hint: "Ready for guests to use", Icon: Armchair, step: 10, max: 10_000 },
  { key: "tables", label: "Tables", hint: "Including serving tables", Icon: Table2, step: 5, max: 2_000 },
  { key: "parkingSpaces", label: "Parking spaces", hint: "Cars that fit at once", Icon: Car, step: 1, max: 2_000 },
  { key: "toilets", label: "Toilets", hint: "Guests can use during the event", Icon: Bath, step: 1, max: 500 },
] as const;
const ALLOWED_ICONS: Record<string, typeof Trees> ={ music: Music, decorations: PartyPopper, outsideCatering: UtensilsCrossed, cooking: CookingPot, alcohol: Wine, overnightGuests: BedDouble };

/** One numbered part of the form; a green tick replaces the number once it is filled. */
function Section({ step, done, title, sub, children }: { step: number; done?: boolean; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 gap-3 border-0 border-t border-solid border-slate-200 p-4 first:border-t-0 sm:gap-4 sm:p-5">
      <span
        aria-hidden
        className={`mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${done ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"}`}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : step}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-sm font-semibold text-slate-900">{title}</h3>
        {sub ? <p className="m-0 mt-0.5 text-xs text-slate-500">{sub}</p> : null}
        <div className="mt-3 min-w-0">{children}</div>
      </div>
    </section>
  );
}

export default function EventHireEditor({
  view,
  disabled,
  saving,
  onSave,
  photosHref,
  onPhotos,
  onExtraPhotos,
  photosSaving,
}: {
  view: EventHireView;
  disabled?: boolean;
  saving?: boolean;
  onSave: (terms: EventTerms) => void;
  /** Saves which listing photos are Event space (straight away, separate from the details). */
  onPhotos?: (urls: string[]) => void;
  /** Saves the event photos uploaded here (kept off the listing). */
  onExtraPhotos?: (urls: string[]) => Promise<void> | void;
  photosSaving?: boolean;
  /** Where to edit the listing's own photos. */
  photosHref?: string;
}) {
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [terms, setTerms] = useState<EventTerms>(view.terms);
  // Reset only when the saved terms change (a photo save returns the same version), so typing is never lost.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTerms(view.terms); }, [view.version]);
  const dirty = useMemo(() => JSON.stringify(terms) !== JSON.stringify(view.terms), [terms, view.terms]);
  // Every required detail must be filled before the details can be saved (the server checks too).
  const missing = useMemo(() => requiredProblems(terms), [terms]);
  const set = <K extends keyof EventTerms>(key: K, value: EventTerms[K]) => setTerms((t) => ({ ...t, [key]: value }));
  const setProvided = (key: keyof EventTerms["provided"], value: number | boolean | null) => setTerms((t) => ({ ...t, provided: { ...t.provided, [key]: value } }));

  return (
    <form className={`${card} overflow-hidden`} onSubmit={(e) => { e.preventDefault(); if (!disabled) onSave(terms); }}>
      {disabled ? (
        <p className="m-0 flex items-start gap-2.5 border-0 border-b border-solid border-slate-200 bg-slate-50 px-4 py-3 text-[13px] leading-5 text-slate-700 sm:px-5">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span>
            <span className="font-semibold text-slate-900">Locked. </span>
            {view.status === "PENDING"
              ? "This was sent to NoLSAF for review, so nothing can be changed. If something needs changing, NoLSAF returns it."
              : view.status === "APPROVED" || view.status === "PAUSED"
                ? "Approved event hire cannot be changed here. Call NoLSAF support to change it."
                : "The owner has this now. Changes go through the owner's own account."}
          </span>
        </p>
      ) : null}
      <fieldset disabled={disabled} className={`m-0 min-w-0 border-0 p-0 ${disabled ? "opacity-80" : ""}`}>
        <Section step={1} done={Boolean(terms.spaceType && terms.eventTypes?.length)} title="The space" sub="What guests get for their event, and which events it suits.">
          <p className="m-0 mb-1.5 text-xs font-medium text-slate-600">Kind of space<Req /></p>
          <div role="radiogroup" aria-label="Kind of space" className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {SPACE_TYPES.map((s) => {
              const on = terms.spaceType === s.key;
              const Icon = SPACE_ICONS[s.key] ?? Sparkles;
              return (
                <button key={s.key} type="button" role="radio" aria-checked={on} onClick={() => set("spaceType", s.key)}
                  className={`relative flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-lg border border-solid px-2 pt-3 text-xs font-semibold transition ${on ? "border-[#02665e] bg-[#02665e]/[0.06] text-[#02665e] ring-2 ring-[#02665e]/15" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}>
                  {/* The radio itself: one choice only */}
                  <span aria-hidden className={`absolute left-2 top-2 grid h-4 w-4 place-items-center rounded-full border-2 border-solid bg-white ${on ? "border-[#02665e]" : "border-slate-300"}`}>
                    {on ? <span className="h-2 w-2 rounded-full bg-[#02665e]" /> : null}
                  </span>
                  <Icon className={`h-5 w-5 ${on ? "text-[#02665e]" : "text-slate-400"}`} aria-hidden />
                  {s.label}
                </button>
              );
            })}
          </div>
          {/* Which events it suits: partners match client requests on this */}
          <div className="mt-4 min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="m-0 text-xs font-medium text-slate-600">Suitable for<Req /></p>
              <p className="m-0 text-[11px] text-slate-500">
                {(terms.eventTypes ?? []).length ? `${terms.eventTypes.length} chosen` : "Choose all that fit"}
              </p>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Events the space suits">
              {EVENT_TYPES.map((t) => {
                const on = (terms.eventTypes ?? []).includes(t.key);
                return (
                  <button key={t.key} type="button" role="checkbox" aria-checked={on}
                    onClick={() => set("eventTypes", on ? terms.eventTypes.filter((k) => k !== t.key) : EVENT_TYPES.map((e) => e.key).filter((k) => k === t.key || terms.eventTypes.includes(k)))}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-md border border-solid px-3 text-xs font-semibold transition ${on ? "border-[#02665e] bg-[#02665e]/[0.06] text-[#02665e]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
                    <span aria-hidden className={`grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border-2 border-solid ${on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white"}`}>
                      {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className={`${field} mt-4`}>Describe it (optional)
            <input value={terms.description ?? ""} onChange={(e) => set("description", e.target.value.slice(0, 600) || null)} placeholder="Flat lawn with shade trees, room for a tent and a stage" className={input} />
          </label>
        </Section>

        <Section step={2} done={Boolean(terms.capacitySeated && terms.capacityStanding && terms.capacityStanding >= terms.capacitySeated)} title="Guests" sub="Standing is the most people allowed at once.">
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:max-w-md">
            <label className={field}>Seated<Req /><input value={show(terms.capacitySeated)} onChange={(e) => set("capacitySeated", num(digits(e.target.value, 4)))} inputMode="numeric" placeholder="60" className={input} /></label>
            <label className={field}>Standing<Req /><input value={show(terms.capacityStanding)} onChange={(e) => set("capacityStanding", num(digits(e.target.value, 4)))} inputMode="numeric" placeholder="100" className={input} /></label>
          </div>
        </Section>

        <Section step={3} done={Boolean(terms.earliestStart && terms.latestEnd)} title="Hours" sub="An end earlier than the start means after midnight.">
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 sm:max-w-xl">
            <label className={field}>Earliest start<Req />
              <select value={terms.earliestStart ?? ""} onChange={(e) => set("earliestStart", e.target.value || null)} className={input}>
                <option value="">Choose</option>
                {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className={field}>Latest end<Req />
              <select value={terms.latestEnd ?? ""} onChange={(e) => set("latestEnd", e.target.value || null)} className={input}>
                <option value="">Choose</option>
                {TIMES.map((t) => <option key={t} value={t}>{endLabel(terms.earliestStart, t)}</option>)}
              </select>
            </label>
            <label className={field}>Quiet from (optional)
              <select value={terms.noiseCutoff ?? ""} onChange={(e) => set("noiseCutoff", e.target.value || null)} className={input}>
                <option value="">No set time</option>
                {TIMES.map((t) => <option key={t} value={t}>{endLabel(terms.earliestStart, t)}</option>)}
              </select>
            </label>
          </div>
        </Section>

        <Section
          step={4}
          done={Boolean((terms.halfDayPrice || terms.fullDayPrice) && (terms.depositMode === "FIXED" ? terms.deposit != null : terms.depositPercent != null))}
          title="Your prices"
          sub={`Your price for the space. NoLSAF keeps ${feesOf(view).owner}% of it, and the client pays a ${feesOf(view).client}% service fee on top.`}
        >
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyInput label={<>Half day (up to 5 hours)<Req either /></>} value={terms.halfDayPrice} onChange={(v) => set("halfDayPrice", v)} />
            <MoneyInput label={<>Full day<Req either /></>} value={terms.fullDayPrice} onChange={(v) => set("fullDayPrice", v)} />
            <MoneyInput label="Evening (optional)" value={terms.eveningPrice} onChange={(v) => set("eveningPrice", v)} />
            <MoneyInput label="Cleaning fee (optional)" value={terms.cleaningFee} onChange={(v) => set("cleaningFee", v)} />
          </div>

          {/* How the money works: what the owner gets, NoLSAF's fee, what the client pays */}
          {(() => {
            const fees = feesOf(view);
            const rows = [
              { label: "Half day", price: terms.halfDayPrice },
              { label: "Full day", price: terms.fullDayPrice },
              { label: "Evening", price: terms.eveningPrice },
            ].filter((r): r is { label: string; price: number } => Boolean(r.price));
            return (
              <div className="mt-4 min-w-0 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Receipt className="h-4 w-4 text-[#02665e]" aria-hidden />How the money works
                  </p>
                  <span className="flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">You: {fees.owner}%</span>
                    <span className="rounded-md bg-[#02665e]/[0.08] px-2 py-0.5 text-[11px] font-semibold text-[#02665e]">Client: {fees.client}%</span>
                  </span>
                </div>
                {rows.length ? (
                  <div className="min-w-0 overflow-x-auto border-0 border-t border-solid border-slate-200">
                    <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
                      <thead>
                        <tr className="bg-slate-50 text-[11px] text-slate-500">
                          <th className="px-4 py-2 font-medium">Booking</th>
                          <th className="px-4 py-2 text-right font-medium">Your price</th>
                          <th className="px-4 py-2 text-right font-medium">NoLSAF {fees.owner}%</th>
                          <th className="px-4 py-2 text-right font-medium">You receive</th>
                          <th className="px-4 py-2 text-right font-medium">Client pays</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const m = eventMoney(r.price, fees.owner, fees.client);
                          return (
                            <tr key={r.label} className="border-0 border-t border-solid border-slate-100">
                              <td className="px-4 py-2 font-medium text-slate-700">{r.label}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">{tsh(r.price)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-500">- {tsh(m.ownerFee)}</td>
                              <td className="px-4 py-2 text-right font-bold tabular-nums text-[#02665e]">{tsh(m.ownerReceives)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                                {tsh(m.clientPays)}
                                <span className="block text-[10.5px] text-slate-400">incl. {fees.client}% service fee</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <ul className="m-0 list-none space-y-1 border-0 border-t border-solid border-slate-200 bg-slate-50 px-4 py-2.5 text-[12px] leading-4 text-slate-600">
                  <li>NoLSAF&apos;s fee is {fees.owner + fees.client}% in all: {fees.owner}% kept from your price and a {fees.client}% service fee paid by the client. Payment costs come out of NoLSAF&apos;s share.</li>
                  <li>The refundable deposit and the cleaning fee carry no NoLSAF fee. You get the cleaning fee in full.</li>
                  <li>NoLSAF pays you after each event, through your payout account.</li>
                </ul>
              </div>
            );
          })()}

          {/* Events over several days in a row, with a discount for longer bookings */}
          {(() => {
            const m = terms.multiDay ?? NO_MULTI_DAY;
            const setM = (patch: Partial<EventTerms["multiDay"]>) => set("multiDay", { ...m, ...patch });
            const examples = [2, 3, 5, 7].filter((d) => d <= (m.maxDays ?? 0)).map((d) => multiDayPrice(terms, d)).filter(Boolean) as Array<NonNullable<ReturnType<typeof multiDayPrice>>>;
            return (
              <div className={`mt-4 min-w-0 overflow-hidden rounded-lg border border-solid ${m.enabled ? "border-[#02665e]/40" : "border-slate-200"} bg-white`}>
                <button type="button" role="switch" aria-checked={m.enabled}
                  onClick={() => setM(m.enabled ? { enabled: false } : { enabled: true, maxDays: m.maxDays ?? 3 })}
                  className="flex w-full min-w-0 items-center gap-3 border-0 bg-transparent px-4 py-3 text-left">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${m.enabled ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-400"}`}><CalendarRange className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">Events over several days</span>
                    <span className="block text-[12px] leading-4 text-slate-500">A conference or a wedding weekend. Each day is the full-day price, with a discount for longer bookings.</span>
                  </span>
                  <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition ${m.enabled ? "bg-[#02665e]" : "bg-slate-300"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${m.enabled ? "left-[18px]" : "left-0.5"}`} />
                  </span>
                </button>

                {m.enabled ? (
                  <>
                    <div className="grid min-w-0 gap-3 border-0 border-t border-solid border-slate-200 px-4 py-3 sm:grid-cols-4">
                      <label className={field}>Most days in a row<Req />
                        <select value={m.maxDays ?? ""} onChange={(e) => setM({ maxDays: e.target.value ? Number(e.target.value) : null })} className={`${compact} mt-1.5 block w-full`}>
                          <option value="">Choose</option>
                          {Array.from({ length: MAX_EVENT_DAYS - 1 }, (_, i) => i + 2).map((d) => <option key={d} value={d}>{d} days</option>)}
                        </select>
                      </label>
                      {([["off2", "2 days, off"], ["off3", "3 or 4 days, off"], ["off5", "5 days or more, off"]] as const).map(([key, label]) => (
                        <label key={key} className={field}>{label}
                          <select value={m[key]} onChange={(e) => setM({ [key]: Number(e.target.value) } as Partial<EventTerms["multiDay"]>)} className={`${compact} mt-1.5 block w-full tabular-nums`}>
                            {DAY_DISCOUNTS.map((p) => <option key={p} value={p}>{p ? `${p}%` : "No discount"}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                    {examples.length ? (
                      <div className="flex min-w-0 flex-wrap border-0 border-t border-solid border-slate-200 bg-[#02665e]/[0.035]">
                        {examples.map((x, i) => (
                          <div key={x.days} className={`min-w-[9rem] flex-1 px-4 py-3 ${i ? "border-0 border-l border-solid border-slate-200" : ""}`}>
                            <p className="m-0 text-[11px] font-medium text-slate-500">{x.days} days</p>
                            <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums text-[#02665e]">{tsh(x.total)}</p>
                            <p className="m-0 truncate text-[11px] tabular-nums text-slate-400">
                              {x.percent ? <><span className="line-through">{tsh(x.gross)}</span> · {x.percent}% off</> : "No discount"}
                            </p>
                            <p className="m-0 truncate text-[11px] tabular-nums text-slate-500">You receive {tsh(eventMoney(x.total, feesOf(view).owner, feesOf(view).client).ownerReceives)}</p>
                            <p className="m-0 truncate text-[11px] tabular-nums text-slate-500">Client pays {tsh(eventMoney(x.total, feesOf(view).owner, feesOf(view).client).clientPays)}</p>
                            <p className="m-0 truncate text-[11px] tabular-nums text-slate-500">Deposit {tsh(depositFor(terms, x.total))}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="m-0 border-0 border-t border-solid border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                        {terms.fullDayPrice ? "Choose the most days to see the prices." : "Enter the full-day price to see the prices."}
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            );
          })()}

          {/* Refundable deposit: worked out from whichever price the client books */}
          <div className="mt-4 min-w-0 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            {/* The rule, in one line */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <p className="m-0 mr-auto text-sm font-semibold text-slate-900">Refundable deposit<Req /></p>
              <select
                aria-label="How the deposit is set"
                value={terms.depositMode}
                onChange={(e) => {
                  const mode = e.target.value as EventTerms["depositMode"];
                  setTerms((t) => ({
                    ...t,
                    depositMode: mode,
                    depositPercent: mode === "PERCENT" && t.depositPercent == null ? 25 : t.depositPercent,
                    deposit: mode === "FIXED" && t.deposit == null ? view.suggestedDeposit ?? null : t.deposit,
                  }));
                }}
                className={compact}
              >
                <option value="PERCENT">Percent of the price</option>
                <option value="FIXED">Same amount every time</option>
              </select>
              {terms.depositMode === "PERCENT" ? (
                <select aria-label="Deposit percent" value={terms.depositPercent ?? ""} onChange={(e) => set("depositPercent", e.target.value === "" ? null : Number(e.target.value))} className={`${compact} tabular-nums`}>
                  {Array.from(new Set([...DEPOSIT_PERCENTS, ...(terms.depositPercent != null ? [terms.depositPercent] : [])])).sort((a, b) => a - b).map((p) => (
                    <option key={p} value={p}>{p}%{p === 25 ? " (suggested)" : ""}</option>
                  ))}
                </select>
              ) : (
                <span className="relative block w-40">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">TSh</span>
                  <input
                    aria-label="Deposit amount"
                    value={terms.deposit == null ? "" : terms.deposit.toLocaleString("en-US")}
                    onChange={(e) => set("deposit", num(digits(e.target.value, 10)))}
                    inputMode="numeric"
                    placeholder={view.suggestedDeposit ? view.suggestedDeposit.toLocaleString("en-US") : "0"}
                    className={`${compact} w-full tabular-nums`}
                    style={{ paddingLeft: 40 }}
                  />
                </span>
              )}
            </div>

            {/* What the client leaves for each price */}
            {(() => {
              const rows = [
                { label: "Half day", price: terms.halfDayPrice },
                { label: "Full day", price: terms.fullDayPrice },
                { label: "Evening", price: terms.eveningPrice },
              ].filter((r) => r.price);
              if (!rows.length) {
                return <p className="m-0 border-0 border-t border-solid border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">Enter a price above to see the deposit for it.</p>;
              }
              return (
                <div className="flex min-w-0 flex-wrap border-0 border-t border-solid border-slate-200 bg-[#02665e]/[0.035]">
                  {rows.map((r, i) => {
                    const amount = depositFor(terms, r.price);
                    return (
                      <div key={r.label} className={`min-w-[9rem] flex-1 px-4 py-3 ${i ? "border-0 border-l border-solid border-slate-200" : ""}`}>
                        <p className="m-0 text-[11px] font-medium text-slate-500">{r.label} deposit</p>
                        <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums text-[#02665e]">{amount == null ? "-" : tsh(amount)}</p>
                        <p className="m-0 truncate text-[11px] tabular-nums text-slate-400">of {tsh(r.price)}</p>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <p className="m-0 flex items-start gap-2 border-0 border-t border-solid border-slate-200 px-4 py-2.5 text-[11.5px] leading-4 text-slate-500">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
              Held by NoLSAF and returned to the client after the event. Kept only for damage proven with photos and costs.
            </p>
          </div>
        </Section>

        <Section
          step={5}
          done={Object.values(terms.allowed || {}).some(Boolean)}
          title="What is allowed"
          sub={`Switch on what guests may do. ${ALLOWED.filter((a) => terms.allowed?.[a.key]).length} of ${ALLOWED.length} allowed.`}
        >
          <div className="grid min-w-0 gap-2 md:grid-cols-2">
            {ALLOWED.map((a) => {
              const on = Boolean(terms.allowed?.[a.key]);
              const Icon = ALLOWED_ICONS[a.key] ?? Sparkles;
              return (
                <button
                  key={a.key}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => set("allowed", { ...terms.allowed, [a.key]: !on })}
                  className={`flex min-w-0 items-center gap-3 rounded-lg border border-solid px-3 py-2.5 text-left transition ${on ? "border-[#02665e]/40 bg-[#02665e]/[0.04]" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${on ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-400"}`}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold leading-5 ${on ? "text-slate-900" : "text-slate-700"}`}>{a.label}</span>
                    <span className="block text-[12px] leading-4 text-slate-500">{a.hint}</span>
                  </span>
                  <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-[#02665e]" : "bg-slate-300"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section step={6} done={Object.values(terms.provided || {}).some((v) => Boolean(v))} title="What is provided" sub="Set a number for what you have. Leave 0 for what you do not provide.">
          {/* Counts, with - and + so a phone needs no keyboard */}
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            {COUNTS.map((c) => {
              const value = terms.provided[c.key] as number | null;
              const has = Boolean(value);
              const step = (delta: number) => setProvided(c.key, Math.min(c.max, Math.max(0, (value ?? 0) + delta)) || null);
              return (
                <div key={c.key} className={`flex min-w-0 items-center gap-3 rounded-lg border border-solid px-3 py-2.5 ${has ? "border-[#02665e]/40 bg-[#02665e]/[0.04]" : "border-slate-200 bg-white"}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${has ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-400"}`}><c.Icon className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-5 text-slate-800">{c.label}</span>
                    <span className="block text-[12px] leading-4 text-slate-500">{c.hint}</span>
                  </span>
                  <span className="flex shrink-0 items-center overflow-hidden rounded-md border border-solid border-slate-300 bg-white">
                    <button type="button" onClick={() => step(-c.step)} disabled={!value} aria-label={`Fewer ${c.label.toLowerCase()}`}
                      className="grid h-9 w-8 place-items-center border-0 bg-white text-slate-600 hover:bg-slate-50 disabled:text-slate-300"><Minus className="h-3.5 w-3.5" /></button>
                    <input
                      value={value ? String(value) : ""}
                      onChange={(e) => { const typed = Number(digits(e.target.value, 5)); setProvided(c.key, typed > 0 ? Math.min(c.max, typed) : null); }}
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={c.label}
                      className="h-9 w-12 border-0 border-x border-solid border-slate-200 bg-white text-center text-sm font-semibold tabular-nums text-slate-900 outline-none focus:bg-[#02665e]/[0.04]"
                    />
                    <button type="button" onClick={() => step(c.step)} aria-label={`More ${c.label.toLowerCase()}`}
                      className="grid h-9 w-8 place-items-center border-0 bg-white text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /></button>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Yes or no */}
          <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
            {([
              { key: "powerBackup", label: "Backup power", hint: "Generator or solar if power goes", Icon: Zap },
              { key: "water", label: "Water", hint: "Running water for guests", Icon: Droplets },
            ] as const).map((s) => {
              const on = Boolean(terms.provided[s.key]);
              return (
                <button key={s.key} type="button" role="switch" aria-checked={on} onClick={() => setProvided(s.key, !on)}
                  className={`flex min-w-0 items-center gap-3 rounded-lg border border-solid px-3 py-2.5 text-left transition ${on ? "border-[#02665e]/40 bg-[#02665e]/[0.04]" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${on ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-400"}`}><s.Icon className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-5 text-slate-800">{s.label}</span>
                    <span className="block text-[12px] leading-4 text-slate-500">{s.hint}</span>
                  </span>
                  <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-[#02665e]" : "bg-slate-300"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                  </span>
                </button>
              );
            })}
          </div>

          <label className="mt-4 block min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden />Permit note (optional)</span>
            <input value={terms.permitNote ?? ""} onChange={(e) => set("permitNote", e.target.value.slice(0, 300) || null)} placeholder="For example: events over 100 guests need a permit from the ward office" className={input} />
          </label>
        </Section>

        <Section step={7} done={view.eventSpacePhotos > 0} title="Photos of the space" sub="Add new photos of where the event happens, or tap listing photos that already show it. Clients see these first.">
          {(() => {
            const photos = view.photos ?? [];
            const extras = view.extraPhotos ?? [];
            const chosen = photos.filter((p) => p.area === "EVENT_SPACE").map((p) => p.url);
            const total = chosen.length + extras.length;
            const busy = Boolean(photosSaving) || uploading > 0;
            const canPick = Boolean(onPhotos) && !disabled && !busy;
            const full = total >= MAX_PHOTOS;
            const enough = total >= MIN_PHOTOS;
            const canUpload = Boolean(onExtraPhotos) && !disabled && !busy && !full;
            const upload = async (files: FileList | null) => {
              if (!files?.length || !onExtraPhotos) return;
              const room = MAX_PHOTOS - total;
              if (files.length > room) setUploadError(`Only ${room} more photo${room === 1 ? "" : "s"} fit (${MAX_PHOTOS} at most). The first ${room} were added.`);
              const list = Array.from(files).slice(0, room);
              if (files.length <= room) setUploadError("");
              setUploading(list.length);
              const done: string[] = [];
              for (const file of list) {
                try { done.push(await uploadImageSigned(file, "properties/events")); }
                catch (e: any) { setUploadError(e?.message || "A photo could not be uploaded."); }
                setUploading((n) => Math.max(0, n - 1));
              }
              if (done.length) await onExtraPhotos([...extras, ...done]);
            };
            return (
              <>
                <div className="mb-3 min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${enough ? "text-emerald-800" : "text-amber-800"}`}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : enough ? <Check className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                      {uploading
                        ? `Uploading ${uploading} photo${uploading === 1 ? "" : "s"}`
                        : enough
                          ? `${total} photos of the space${full ? ", the most allowed" : ""}`
                          : `${total} of ${MIN_PHOTOS} photos needed. Add ${MIN_PHOTOS - total} more.`}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-[11px] font-medium text-slate-500">{MIN_PHOTOS} to {MAX_PHOTOS} photos</span>
                      {photosHref ? <a href={photosHref} className="text-xs font-semibold text-[#02665e] no-underline hover:underline">Edit listing photos</a> : null}
                    </span>
                  </div>
                  {/* 12 slots: filled up to the count, the 7th marks the minimum */}
                  <div className="mt-2 grid grid-cols-12 gap-1" aria-hidden>
                    {Array.from({ length: MAX_PHOTOS }, (_, i) => (
                      <span key={i} className={`h-1.5 rounded-full ${i < total ? (enough ? "bg-[#02665e]" : "bg-amber-500") : i < MIN_PHOTOS ? "bg-amber-100" : "bg-slate-200"}`} />
                    ))}
                  </div>
                </div>
                {uploadError ? <p role="alert" className="m-0 mb-2 text-xs font-medium text-rose-700">{uploadError}</p> : null}
                <ul className="m-0 grid min-w-0 list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4 lg:grid-cols-6">
                  {/* Upload new photos of the space */}
                  {onExtraPhotos && !disabled ? (
                    <li className="min-w-0">
                      <label className={`flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-center transition ${canUpload ? "cursor-pointer border-[#02665e]/40 bg-[#02665e]/[0.03] text-[#02665e] hover:border-[#02665e] hover:bg-[#02665e]/[0.06]" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"}`}>
                        <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!canUpload} className="sr-only"
                          onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
                        {uploading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ImagePlus className="h-5 w-5" aria-hidden />}
                        <span className="px-1 text-[11px] font-semibold leading-tight">{uploading ? "Uploading" : full ? `${MAX_PHOTOS} is the most` : "Add photos"}</span>
                      </label>
                    </li>
                  ) : null}
                  {/* Uploaded on the add-on */}
                  {extras.map((url) => (
                    <li key={url} className="relative min-w-0">
                      <div className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-slate-100 ring-[3px] ring-[#02665e]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-[11px] font-semibold text-white">Event space · new</span>
                      </div>
                      {onExtraPhotos && !disabled ? (
                        <button type="button" disabled={busy} onClick={() => void onExtraPhotos(extras.filter((u) => u !== url))} aria-label="Remove this photo"
                          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-0 bg-black/60 text-white hover:bg-rose-600 disabled:opacity-50">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                  {photos.map((p) => {
                    const on = p.area === "EVENT_SPACE";
                    return (
                      <li key={p.url} className="min-w-0">
                        <button
                          type="button"
                          aria-pressed={on}
                          // At 12, a photo can still be unmarked but no new one marked.
                          disabled={!canPick || (full && !on)}
                          title={full && !on ? `${MAX_PHOTOS} photos is the most. Unmark one first.` : undefined}
                          onClick={() => onPhotos?.(on ? chosen.filter((u) => u !== p.url) : [...chosen, p.url])}
                          className={`relative block aspect-[4/3] w-full overflow-hidden rounded-lg border-0 bg-slate-100 p-0 transition disabled:cursor-default ${on ? "ring-[3px] ring-[#02665e]" : "ring-1 ring-slate-200 hover:ring-2 hover:ring-[#02665e]/40"}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt="" loading="lazy" className={`h-full w-full object-cover transition ${on ? "" : "opacity-90"}`} />
                          {on ? (
                            <>
                              <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[#02665e] text-white shadow"><Check className="h-3.5 w-3.5" aria-hidden /></span>
                              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-left text-[11px] font-semibold text-white">Event space</span>
                            </>
                          ) : p.area ? (
                            <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">{photoAreaLabel(p.area)}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="m-0 mt-2 text-[11.5px] text-slate-500">New photos stay with event hire and are checked by NoLSAF with it. Your listing is not changed.</p>
              </>
            );
          })()}
        </Section>
      </fieldset>

      {!disabled ? (
        <div className="border-0 border-t border-solid border-slate-300 bg-slate-50 px-4 py-3">
          {missing.length ? (
            <div className="mb-3 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2.5">
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-rose-800">
                <span className="text-rose-600">*</span>
                Fill {missing.length === 1 ? "this required detail" : `these ${missing.length} required details`} to save
              </p>
              <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-rose-800">
                {missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={saving || !dirty || missing.length > 0}
              className={`inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold transition ${dirty && !missing.length
                ? "border-0 bg-[#02665e] text-white hover:bg-[#014d47]"
                : "cursor-not-allowed border border-solid border-slate-300 bg-white text-slate-500"}`}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {missing.length ? `${missing.length} required left` : dirty ? "Save details" : "Saved"}
            </button>
            {dirty && !missing.length ? <span className="text-xs text-slate-500">You have changes that are not saved.</span> : null}
            <span className="ml-auto text-[11px] text-slate-400"><span className="text-rose-600">*</span> required</span>
          </div>
        </div>
      ) : null}
    </form>
  );
}
