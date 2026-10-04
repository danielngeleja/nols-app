"use client";

import { useMemo } from "react";
import { BedDouble, Check, Cigarette, CigaretteOff, Dog, Lock, Minus, PawPrint, Plus, Tag, Users } from "lucide-react";
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

export function TotalsStep({
  isVisible,
  sectionRef,
  totalBedrooms,
  totalBathrooms,
  setTotalBathrooms,
  maxGuests,
  setMaxGuests,
  desc,
  setDesc,
  acceptGroupBooking,
  setAcceptGroupBooking,
  houseRules,
  setHouseRules,
  goToPreviousStep,
  goToNextStep,
  currentStep,
}: {
  isVisible: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  totalBedrooms: number | "";
  totalBathrooms: number | "";
  setTotalBathrooms: NumSetter;
  maxGuests: number | "";
  setMaxGuests: NumSetter;
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
  };
  setHouseRules: (updater: (prev: any) => any) => void;
  goToPreviousStep: () => void;
  goToNextStep: () => void;
  currentStep: number;
}) {
  const baths = Number(totalBathrooms) || 0;
  const guests = Number(maxGuests) || 0;
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
                  <label htmlFor="max-guests" className="ap-stat-label">Max guests</label>
                  <div className={`ap-stepper ap-stat-stepper${guests > 0 ? " is-set" : ""}`}>
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
                  </div>
                  <span className="ap-stat-note">Everyone who can sleep here at once</span>
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
                      <label className="sr-only" htmlFor={`rule-${row.from}`}>{row.label} from</label>
                      <input
                        id={`rule-${row.from}`}
                        type="time"
                        title={`${row.label} time (from)`}
                        value={(houseRules as any)[row.from]}
                        onChange={(e) => setRule({ [row.from]: e.target.value })}
                      />
                      <span className="ap-range-sep">to</span>
                      <label className="sr-only" htmlFor={`rule-${row.to}`}>{row.label} to</label>
                      <input
                        id={`rule-${row.to}`}
                        type="time"
                        title={`${row.label} time (to)`}
                        value={(houseRules as any)[row.to]}
                        onChange={(e) => setRule({ [row.to]: e.target.value })}
                      />
                    </div>
                  </div>
                ))}

                <div className="ap-rule-cell">
                  <span className="ap-stat-label">Pets</span>
                  <div className="ap-toggles is-compact" role="radiogroup" aria-label="Pets">
                    {[
                      { label: "Allowed", v: true, Icon: PawPrint },
                      { label: "Not allowed", v: false, Icon: Dog },
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
                  <div className="ap-toggles is-compact" role="radiogroup" aria-label="Smoking">
                    {[
                      { label: "Allowed", notAllowed: false, Icon: Cigarette },
                      { label: "Not allowed", notAllowed: true, Icon: CigaretteOff },
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
                      Other rules <span className="font-normal normal-case tracking-normal text-white/35">optional</span>
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

            {/* ---------------------------------------------------------------
                4. Group bookings: one switch, and what it means once on
               --------------------------------------------------------------- */}
            <section className="ap-card">
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
                  <span className="ap-switch-text">{acceptGroupBooking ? "Accepting" : "Off"}</span>
                  <span className="ap-switch-track" aria-hidden>
                    <span className="ap-switch-knob" />
                  </span>
                </button>
              </header>
              {acceptGroupBooking ? (
                <div className="ap-card-body">
                  <ul className="ap-points">
                    <li>
                      <span className="ap-svc-ico is-on"><BedDouble className="h-3.5 w-3.5" /></span>
                      Several rooms in one booking
                    </li>
                    <li>
                      <span className="ap-svc-ico is-on"><Users className="h-3.5 w-3.5" /></span>
                      Weddings, teams, tours and families
                    </li>
                    <li>
                      <span className="ap-svc-ico is-on"><Tag className="h-3.5 w-3.5" /></span>
                      Tagged as Group stay in search
                    </li>
                  </ul>
                </div>
              ) : null}
            </section>
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
