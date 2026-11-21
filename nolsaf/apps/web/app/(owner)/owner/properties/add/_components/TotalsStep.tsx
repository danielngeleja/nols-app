"use client";

import { Fragment, useMemo } from "react";
import { ArrowRight, BedDouble, Check, Cigarette, CigaretteOff, Dog, FileText, Lock, Minus, MoonStar, PawPrint, Plus, ShieldCheck, Tag, Users } from "lucide-react";
import { AddPropertySection } from "./AddPropertySection";
import { StepFooter } from "./StepFooter";

type NumSetter = (v: number | "") => void;

/** Writing prompts that tick themselves when the description mentions them */
const PROMPTS: { label: string; hint: string; test: RegExp }[] = [
  { label: "Where it is", hint: "Area, street or landmark", test: /\b(located|location|near|close to|minutes?|km|walk|street|road|area|town|city|beach|centre|center)\b/i },
  { label: "What stands out", hint: "The one thing guests remember", test: /\b(view|views|garden|pool|rooftop|terrace|balcony|quiet|spacious|modern|cosy|cozy|unique|special|best)\b/i },
  { label: "What is nearby", hint: "Shops, food, sights, transport", test: /\b(restaurant|shop|shops|mall|market|airport|bus|park|museum|attraction|attractions|hospital|nearby)\b/i },
  { label: "Who it suits", hint: "Families, business, couples", test: /\b(famil(y|ies)|business|couples?|travell?ers?|groups?|students?|guests?|kids|children)\b/i },
];

/** Check-in and check-out choices, every half hour. */
const RULE_TIMES: string[] = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** Long stay: the clauses every lease already carries, so owners do not repeat them. */
const LEASE_BASICS = ["No subletting or nightly re-letting", "Visits with 24h notice", "Repairs split", "No changes without your OK", "Residential use only", "Respect for neighbours"];

/** One living rule per row: label on the left, the answer on the right; stacked on phones. */
const RULE_ROW = "grid items-center gap-x-6 gap-y-2.5 border-0 border-t border-solid border-white/[0.06] py-4 first:border-t-0 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]";

function RuleLabel({ Icon, label, hint, optional, htmlFor }: { Icon: typeof Users; label: string; hint: string; optional?: boolean; htmlFor?: string }) {
  const Wrap = htmlFor ? "label" : "div";
  return (
    <Wrap {...(htmlFor ? { htmlFor } : {})} className="flex min-w-0 items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-400/10 text-teal-300"><Icon className="h-4 w-4" aria-hidden /></span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[13.5px] font-semibold text-white/90">
          {label}
          {optional ? <span className="rounded bg-white/[0.06] px-1.5 py-px text-[10.5px] font-medium text-white/45">Optional</span> : null}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-white/45">{hint}</span>
      </span>
    </Wrap>
  );
}

export function TotalsStep({
  isVisible,
  sectionRef,
  totalBedrooms,
  totalBathrooms,
  setTotalBathrooms,
  maxGuests,
  setMaxGuests,
  declaredInventoryGuests,
  desc,
  setDesc,
  acceptGroupBooking,
  setAcceptGroupBooking,
  houseRules,
  setHouseRules,
  goToPreviousStep,
  goToNextStep,
  currentStep,
  monthly = false,
  onPreviewLease,
}: {
  isVisible: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  totalBedrooms: number | "";
  totalBathrooms: number | "";
  setTotalBathrooms: NumSetter;
  maxGuests: number | "";
  setMaxGuests: NumSetter;
  declaredInventoryGuests: number | null;
  desc: string;
  setDesc: (v: string) => void;
  acceptGroupBooking: boolean;
  setAcceptGroupBooking: (v: boolean) => void;
  houseRules: {
    checkInFrom: string;
    checkInTo: string;
    checkOutFrom: string;
    checkOutTo: string;
    petsAllowed: boolean | null;
    petsNote: string;
    smokingNotAllowed: boolean | null;
    other: string;
    smokingPolicy?: "" | "outside" | "none" | "allowed";
    overnightGuests?: "" | "allowed" | "limited" | "none";
    overnightNights?: number;
    quietFrom?: string;
    quietTo?: string;
  };
  setHouseRules: (updater: (prev: any) => any) => void;
  goToPreviousStep: () => void;
  goToNextStep: () => void;
  currentStep: number;
  /** Long stay: a few living rules here; the full rules are in the lease. */
  monthly?: boolean;
  onPreviewLease?: () => void;
}) {
  const baths = Number(totalBathrooms) || 0;
  const guests = declaredInventoryGuests ?? (Number(maxGuests) || 0);
  const bedrooms = Number(totalBedrooms) || 0;

  const descLength = desc.trim().length;
  const descLevel = descLength >= 300 ? 3 : descLength >= 80 ? 2 : descLength > 0 ? 1 : 0;
  const descWord = ["Not started", "Too short", "Good", "Great"][descLevel];
  const prompts = useMemo(() => PROMPTS.map((p) => ({ ...p, done: p.test.test(desc) })), [desc]);

  const rulesSet = [
    houseRules.checkInFrom || houseRules.checkInTo,
    houseRules.checkOutFrom || houseRules.checkOutTo,
    houseRules.petsAllowed !== null,
    houseRules.smokingNotAllowed !== null,
    houseRules.other.trim(),
  ].filter(Boolean).length;

  const setRule = (patch: Record<string, unknown>) => setHouseRules((prev: any) => ({ ...prev, ...patch }));

  return (
    <AddPropertySection as="section" sectionRef={sectionRef} isVisible={isVisible} className="add-property-step-surface">
      {isVisible && (
        <div className="w-full">
          <div className="ap-step-ground">
            {/* ---------------------------------------------------------------
                1. Capacity, read at a glance
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">1</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">Capacity</h3>
                  <p className="ap-card-sub">What the whole property holds.</p>
                </div>
                {baths > 0 && guests > 0 ? (
                  <span className="ap-card-tag">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Set
                  </span>
                ) : (
                  <span className="ap-card-tag is-todo">Required</span>
                )}
              </header>

              <div className="ap-stats">
                <div className="ap-stat">
                  <span className="ap-stat-label">
                    Bedrooms
                    <span className="ap-stat-auto">
                      <Lock className="h-2.5 w-2.5" aria-hidden /> Auto
                    </span>
                  </span>
                  <span className="ap-stat-value" aria-label={`Total bedrooms ${bedrooms}`}>{bedrooms}</span>
                  <span className="ap-stat-note">Counted from your saved room groups</span>
                </div>

                <div className="ap-stat">
                  <label htmlFor="total-bathrooms" className="ap-stat-label">Bathrooms</label>
                  <div className={`ap-stepper ap-stat-stepper${baths > 0 ? " is-set" : ""}`}>
                    <button type="button" aria-label="One less bathroom" onClick={() => setTotalBathrooms(baths <= 1 ? 0 : baths - 1)} disabled={baths === 0} className="ap-step-btn">
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      id="total-bathrooms"
                      type="text"
                      inputMode="numeric"
                      value={totalBathrooms === "" ? "" : String(totalBathrooms)}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                        setTotalBathrooms(raw === "" ? "" : Number(raw));
                      }}
                      onFocus={(e) => e.target.select()}
                      placeholder="0"
                    />
                    <button type="button" aria-label="One more bathroom" onClick={() => setTotalBathrooms(baths + 1)} className="ap-step-btn is-plus">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <span className="ap-stat-note">Private and shared, across the property</span>
                </div>

                <div className="ap-stat">
                  {declaredInventoryGuests !== null ? <span className="ap-stat-label">Max guests</span> : <label htmlFor="max-guests" className="ap-stat-label">Max guests</label>}
                  {declaredInventoryGuests !== null ? <div className="ap-sum is-set"><Users className="h-4 w-4 text-teal-300" aria-hidden /><span id="max-guests" className="ap-sum-value">{declaredInventoryGuests}</span></div> : <div className={`ap-stepper ap-stat-stepper${guests > 0 ? " is-set" : ""}`}>
                    <button type="button" aria-label="One guest less" onClick={() => setMaxGuests(Math.max(1, guests - 1))} disabled={guests <= 1} className="ap-step-btn">
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      id="max-guests"
                      type="text"
                      inputMode="numeric"
                      value={maxGuests === "" ? "" : String(maxGuests)}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                        setMaxGuests(raw === "" ? "" : Number(raw));
                      }}
                      onFocus={(e) => e.target.select()}
                      placeholder="1"
                    />
                    <button type="button" aria-label="One guest more" onClick={() => setMaxGuests(guests + 1)} className="ap-step-btn is-plus">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>}
                  <span className="ap-stat-note">{declaredInventoryGuests !== null ? "Total declared across the saved rooms. Edit room capacity to change this." : "Everyone who can sleep here at once"}</span>
                </div>
              </div>
            </section>

            {/* ---------------------------------------------------------------
                2. Description, with prompts that tick as you write
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">2</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">Description</h3>
                  <p className="ap-card-sub">The first thing guests read after the photos.</p>
                </div>
                <span className={`ap-card-tag${descLevel >= 2 ? "" : " is-todo"}`}>
                  {descLevel >= 2 ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                  {descWord}
                </span>
              </header>

              <div className="ap-split">
                <div className="ap-split-main">
                  <label htmlFor="property-description" className="sr-only">Property description</label>
                  <textarea
                    id="property-description"
                    rows={7}
                    className="ap-input ap-textarea"
                    placeholder="e.g. A calm guest house five minutes from the beach, with a rooftop terrace and garden. Close to shops and the bus stand, ideal for families and business travellers."
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                  />
                  <div className="ap-desc-meter">
                    <span className="ap-photo-meter" aria-hidden>
                      {[1, 2, 3].map((n) => (
                        <span key={n} className={descLevel >= n ? "is-done" : ""} />
                      ))}
                    </span>
                    <span className="text-white/70">{descWord}</span>
                    <span className="ml-auto font-mono tabular-nums text-white/50">{descLength} characters</span>
                  </div>
                </div>

                <aside className="ap-split-side">
                  <span className="ap-label">A strong description covers</span>
                  <ul className="ap-checklist is-stacked ap-prompts">
                    {prompts.map((p) => (
                      <li key={p.label} className={p.done ? "is-done" : ""}>
                        <span className="ap-checklist-dot">{p.done ? <Check className="h-3 w-3" /> : null}</span>
                        <span className="min-w-0">
                          <span className="block">{p.label}</span>
                          <span className="block text-[11px] font-normal text-white/40">{p.hint}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </aside>
              </div>
            </section>

            {monthly ? (
              <section className="ap-card">
                <header className="ap-card-head">
                  <span className="ap-card-head-no">3</span>
                  <div className="ap-card-head-copy">
                    <h3 className="ap-card-title">Living rules</h3>
                    <p className="ap-card-sub">What tenants ask first. Written into the lease.</p>
                  </div>
                  <span className={`ap-card-tag${houseRules.smokingPolicy || houseRules.overnightGuests ? "" : " is-todo"}`}>
                    {[houseRules.smokingPolicy, houseRules.overnightGuests, houseRules.quietFrom || houseRules.quietTo].filter(Boolean).length} of 3 set
                  </span>
                </header>
                <div>
                  {/* One rule per row: what it is on the left, the answer on the right */}
                  <div className="px-4 sm:px-5" style={{ boxSizing: "border-box" }}>
                    {([
                      {
                        key: "smoking", label: "Smoking", hint: "Inside the home and on balconies", Icon: CigaretteOff,
                        value: houseRules.smokingPolicy || "",
                        options: [["outside", "Outside only"], ["none", "Not at all"], ["allowed", "Allowed"]] as Array<[string, string]>,
                        pick: (v: string) => setRule({ smokingPolicy: v, smokingNotAllowed: v !== "allowed" }),
                      },
                      {
                        key: "guests", label: "Overnight visitors", hint: "Friends or family staying the night", Icon: Users,
                        value: houseRules.overnightGuests || "",
                        options: [["allowed", "Welcome"], ["limited", "Some nights"], ["none", "Not allowed"]] as Array<[string, string]>,
                        pick: (v: string) => setRule({ overnightGuests: v }),
                      },
                    ]).map((row) => (
                      <div key={row.key} className={RULE_ROW} style={{ boxSizing: "border-box" }}>
                        <RuleLabel Icon={row.Icon} label={row.label} hint={row.hint} />
                        <div className="min-w-0">
                          <div className="flex w-full rounded-lg bg-white/[0.05] p-0.5" role="radiogroup" aria-label={row.label} style={{ boxSizing: "border-box" }}>
                            {row.options.map(([v, l]) => (
                              <button key={v} type="button" role="radio" aria-checked={row.value === v} onClick={() => row.pick(v)}
                                className={`h-9 min-w-0 flex-1 cursor-pointer truncate rounded-md border-0 px-2 text-[13px] font-semibold transition-colors [font-family:inherit] ${row.value === v ? "bg-teal-500/90 text-white shadow-sm" : "bg-transparent text-white/55 hover:text-white/85"}`}>{l}</button>
                            ))}
                          </div>
                          {row.key === "guests" && houseRules.overnightGuests === "limited" ? (
                            <div className="mt-2 flex items-center justify-end gap-1.5 text-[12px] text-white/55">
                              Up to
                              <button type="button" aria-label="Fewer nights" disabled={(houseRules.overnightNights || 7) <= 1} onClick={() => setRule({ overnightNights: Math.max(1, (houseRules.overnightNights || 7) - 1) })} className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border-0 bg-white/[0.06] p-0 text-white/70 hover:bg-white/10 disabled:opacity-30"><Minus className="h-3 w-3" /></button>
                              <span className="w-6 text-center text-[13px] font-semibold tabular-nums text-white">{houseRules.overnightNights || 7}</span>
                              <button type="button" aria-label="More nights" disabled={(houseRules.overnightNights || 7) >= 30} onClick={() => setRule({ overnightNights: Math.min(30, (houseRules.overnightNights || 7) + 1) })} className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border-0 bg-white/[0.06] p-0 text-white/70 hover:bg-white/10 disabled:opacity-30"><Plus className="h-3 w-3" /></button>
                              nights a month
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}

                    {/* Quiet hours */}
                    <div className={RULE_ROW} style={{ boxSizing: "border-box" }}>
                      <RuleLabel Icon={MoonStar} label="Quiet hours" hint="When noise should stop" optional />
                      <div className="ap-range" style={{ width: "100%", height: 40, margin: 0, boxSizing: "border-box" }}>
                        {([["from", "quietFrom", "From"], ["to", "quietTo", "Until"]] as const).map(([edge, field, ph], i) => {
                          const current = String((houseRules as any)[field] || "");
                          const options = current && !RULE_TIMES.includes(current) ? [...RULE_TIMES, current].sort() : RULE_TIMES;
                          return <Fragment key={edge}>
                            {i === 1 ? <span className="ap-range-sep" aria-hidden><ArrowRight className="h-3.5 w-3.5" /></span> : null}
                            <label className="sr-only" htmlFor={`rule-${field}`}>Quiet hours {edge}</label>
                            <select id={`rule-${field}`} value={current} onChange={(e) => setRule({ [field]: e.target.value })} className={current ? "is-set" : ""}>
                              <option value="">{ph}</option>
                              {options.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </Fragment>;
                        })}
                      </div>
                    </div>

                    {/* Anything else */}
                    <div className={RULE_ROW} style={{ boxSizing: "border-box" }}>
                      <RuleLabel Icon={Tag} label="Anything else" hint="One short rule, in your words" optional htmlFor="rule-other-monthly" />
                      <input id="rule-other-monthly" value={houseRules.other} onChange={(e) => setRule({ other: e.target.value })} maxLength={300}
                        className="block h-10 w-full rounded-lg border border-solid border-white/10 bg-white/[0.04] px-3 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-teal-400/60 [font-family:inherit]"
                        style={{ boxSizing: "border-box", margin: 0 }} placeholder="e.g. The gate closes at 22:00" />
                    </div>
                  </div>

                  {/* What every lease already says, so the owner does not repeat it */}
                  <div className="border-0 border-t border-solid border-white/[0.06] bg-white/[0.015] px-4 py-4 sm:px-5" style={{ boxSizing: "border-box" }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-white/85"><ShieldCheck className="h-4 w-4 text-teal-300" />Already in every lease</span>
                      {onPreviewLease ? (
                        <button type="button" onClick={onPreviewLease} className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-teal-400/15 px-3 text-[12.5px] font-semibold text-teal-200 hover:bg-teal-400/25 [font-family:inherit]">
                          <FileText className="h-3.5 w-3.5" />Read the lease
                        </button>
                      ) : null}
                    </div>
                    <ul className="m-0 mt-3 flex list-none flex-wrap gap-1.5 p-0">
                      {LEASE_BASICS.map((item) => (
                        <li key={item} className="inline-flex items-center gap-1.5 rounded-md border border-solid border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[12px] text-white/60">
                          <Check className="h-3 w-3 text-teal-300/80" aria-hidden />{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            ) : <>
            {/* ---------------------------------------------------------------
                3. House rules, one row each
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">3</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">House rules</h3>
                  <p className="ap-card-sub">Shown to guests on the property page before they book.</p>
                </div>
                <span className={`ap-card-tag${rulesSet > 0 ? "" : " is-todo"}`}>
                  {rulesSet > 0 ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {rulesSet} of 5 set
                    </>
                  ) : (
                    "Optional"
                  )}
                </span>
              </header>

              {/* Row one: four short rules side by side */}
              <div className="ap-rules">
                {[
                  { key: "in", label: "Check-in", from: "checkInFrom", to: "checkInTo" },
                  { key: "out", label: "Check-out", from: "checkOutFrom", to: "checkOutTo" },
                ].map((row) => (
                  <div key={row.key} className="ap-rule-cell">
                    <span className="ap-stat-label">{row.label}</span>
                    <div className="ap-range">
                      {([["from", row.from], ["to", row.to]] as const).map(([edge, field], i) => {
                        const current = String((houseRules as any)[field] || "");
                        const options = current && !RULE_TIMES.includes(current) ? [...RULE_TIMES, current].sort() : RULE_TIMES;
                        return <Fragment key={edge}>
                          {i === 1 ? <span className="ap-range-sep" aria-hidden><ArrowRight className="h-3.5 w-3.5" /></span> : null}
                          <label className="sr-only" htmlFor={`rule-${field}`}>{row.label} {edge}</label>
                          <select
                            id={`rule-${field}`}
                            value={current}
                            onChange={(e) => setRule({ [field]: e.target.value })}
                            className={current ? "is-set" : ""}
                          >
                            <option value="">{edge === "from" ? "From" : "Until"}</option>
                            {options.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </Fragment>;
                      })}
                    </div>
                  </div>
                ))}

                <div className="ap-rule-cell">
                  <span className="ap-stat-label">Pets</span>
                  <div className="ap-toggles is-compact is-seg" role="radiogroup" aria-label="Pets">
                    {[
                      { label: "Allowed", v: true, Icon: PawPrint },
                      { label: "No pets", v: false, Icon: Dog },
                    ].map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        role="radio"
                        aria-checked={houseRules.petsAllowed === o.v}
                        onClick={() => setRule({ petsAllowed: o.v })}
                        className={`ap-toggle${houseRules.petsAllowed === o.v ? " is-on" : ""}`}
                      >
                        <o.Icon className="h-4 w-4" />
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ap-rule-cell">
                  <span className="ap-stat-label">Smoking</span>
                  <div className="ap-toggles is-compact is-seg" role="radiogroup" aria-label="Smoking">
                    {[
                      { label: "Allowed", notAllowed: false, Icon: Cigarette },
                      { label: "No smoking", notAllowed: true, Icon: CigaretteOff },
                    ].map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        role="radio"
                        aria-checked={houseRules.smokingNotAllowed === o.notAllowed}
                        onClick={() => setRule({ smokingNotAllowed: o.notAllowed })}
                        className={`ap-toggle${houseRules.smokingNotAllowed === o.notAllowed ? " is-on" : ""}`}
                      >
                        <o.Icon className="h-4 w-4" />
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row two: the written parts */}
              <div className="ap-card-body ap-divided">
                <div className="flex flex-col gap-3 lg:flex-row">
                  {houseRules.petsAllowed === true ? (
                    <div className="lg:w-[calc(25%-0.5rem)] lg:flex-shrink-0">
                      <label htmlFor="rule-pets-note" className="ap-stat-label mb-2">Pet conditions</label>
                      <input
                        id="rule-pets-note"
                        type="text"
                        value={houseRules.petsNote}
                        onChange={(e) => setRule({ petsNote: e.target.value })}
                        className="ap-input"
                        placeholder="e.g. Small pets only"
                      />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <label htmlFor="rule-other" className="ap-stat-label mb-2">
                      Other rules <span className="ap-label-opt">optional</span>
                    </label>
                    <textarea
                      id="rule-other"
                      rows={2}
                      value={houseRules.other}
                      onChange={(e) => setRule({ other: e.target.value })}
                      className="ap-input ap-textarea"
                      placeholder="e.g. Quiet hours after 22:00, no outside visitors"
                    />
                  </div>
                </div>
              </div>
            </section>

            </>}

            {/* ---------------------------------------------------------------
                4. Group bookings: one switch, and what it means once on
               --------------------------------------------------------------- */}
            {monthly ? null : <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">4</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">Group bookings</h3>
                  <p className="ap-card-sub">Let one guest book several rooms for a group.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={acceptGroupBooking}
                  aria-label="Accept group bookings"
                  onClick={() => setAcceptGroupBooking(!acceptGroupBooking)}
                  className={`ap-switch${acceptGroupBooking ? " is-on" : ""}`}
                >
                  <span className="ap-switch-text">{acceptGroupBooking ? "On" : "Off"}</span>
                  <span className="ap-switch-track" aria-hidden>
                    <span className="ap-switch-knob" />
                  </span>
                </button>
              </header>
              <div className="ap-card-body">
                {acceptGroupBooking ? (
                  <ul className="ap-points">
                    <li><BedDouble className="h-4 w-4" aria-hidden />Several rooms in one booking</li>
                    <li><Users className="h-4 w-4" aria-hidden />Weddings, teams, tours and families</li>
                    <li><Tag className="h-4 w-4" aria-hidden />Shown as a Group stay in search</li>
                  </ul>
                ) : (
                  <p className="ap-points-off">Turn on to welcome weddings, teams, tours and families who need several rooms at once.</p>
                )}
              </div>
            </section>}
          </div>
        </div>
      )}

      {isVisible && (
        <StepFooter
          onPrev={goToPreviousStep}
          onNext={goToNextStep}
          prevDisabled={currentStep <= 0}
          nextDisabled={currentStep >= 5}
        />
      )}
    </AddPropertySection>
  );
}
