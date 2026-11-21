"use client";

import type { ReactNode } from "react";
import { ArrowRight, Bath, BadgeCheck, BedDouble, CalendarCheck, Check, ClipboardCheck, FileSignature, FileText, ImageIcon, KeyRound, MapPin, Pencil, Users, Wallet } from "lucide-react";
import type { LongStayTermsDraft } from "./LongStayTermsCard";
import Image from "next/image";
import { AddPropertySection } from "./AddPropertySection";
import { StepFooter } from "./StepFooter";
import { PropertyVisualizationPreview } from "./PropertyVisualizationPreview";
import { floorName, type FloorUses } from "./floorUses";

type StepMeta = {
  index: number;
  title: string;
  completed: boolean;
};

interface ReviewData {
  title: string;
  type: string;
  location: {
    district?: string;
    regionName?: string;
    street?: string;
    city?: string;
  };
  rooms: Array<{
    roomType: string;
    bookingMode?: "ROOM" | "ENTIRE_UNIT";
    unitStyle?: "UNIT";
    bedrooms?: Array<{ name: string; beds: object }>;
    maxGuestsPerUnit?: number;
    includedGuests?: number;
    extraGuestFee?: number;
    roomsCount: number;
    pricePerNight: number;
    floorDistribution?: Record<number, number>;
  }>;
  buildingType: string;
  totalFloors: number | "";
  floorUses?: FloorUses;
  currency?: string | null;
  /** First property photo, shown as the listing cover */
  coverPhoto?: string;
  photoCount?: number;
  description?: string;
  bedrooms?: number | "";
  bathrooms?: number | "";
  maxGuests?: number | "";
  /** Long stay: the monthly terms replace the nightly rates in the review. */
  longStay?: {
    terms: LongStayTermsDraft;
    parking: string;
    rules: string[];
    onPreviewLease: () => void;
    onEditTerms: () => void;
  } | null;
}

type ReviewStepBaseProps = {
  isVisible: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  goToPreviousStep: () => void;
  submitForReview: () => void | Promise<void>;
  submitDisabled: boolean;
};

type ReviewStepFullProps = ReviewStepBaseProps & {
  stepsMeta: readonly StepMeta[];
  completeEnough: boolean;
  onStepClick?: (stepIndex: number) => void;
  reviewData: ReviewData;
  children?: never;
};

type ReviewStepChildrenProps = ReviewStepBaseProps & {
  children: ReactNode;
  stepsMeta?: never;
  completeEnough?: never;
  onStepClick?: never;
  reviewData?: never;
};

type ReviewStepProps = ReviewStepFullProps | ReviewStepChildrenProps;

const money = (n: number, currency = "TZS") => `${currency} ${Math.round(n).toLocaleString("en-US")}`;

export function ReviewStep(props: ReviewStepProps) {
  const { isVisible, sectionRef, goToPreviousStep, submitForReview, submitDisabled } = props;
  const isChildrenMode = "children" in props;

  return (
    <AddPropertySection as="section" sectionRef={sectionRef} isVisible={isVisible} className="add-property-step-surface">
      {isVisible && (
        <div className="w-full">
          <div className="ap-step-ground">
            {isChildrenMode ? props.children : <ReviewBody {...(props as ReviewStepFullProps)} />}
          </div>
        </div>
      )}

      {isVisible && (
        <StepFooter
          onPrev={goToPreviousStep}
          onNext={submitForReview}
          prevDisabled={false}
          nextDisabled={submitDisabled}
          nextLabel="Submit for review"
        />
      )}
    </AddPropertySection>
  );
}

function ReviewBody({ stepsMeta, completeEnough, onStepClick, reviewData }: ReviewStepFullProps) {
  const currency = reviewData.currency || "TZS";

  // The review step itself is not something to complete, so it is not counted
  const workSteps = stepsMeta.filter((s) => s.index < stepsMeta.length - 1);
  const doneCount = workSteps.filter((s) => s.completed).length;
  const goTo = (index: number) => {
    if (onStepClick && index >= 0 && index < stepsMeta.length) onStepClick(index);
  };

  const rooms = reviewData.rooms || [];
  // Separate units are whole places with a count; the entire place is exactly one.
  const separateUnits = rooms.some((room) => room.bookingMode === "ENTIRE_UNIT" && room.unitStyle === "UNIT");
  const entireUnit = !separateUnits && rooms.some((room) => room.bookingMode === "ENTIRE_UNIT");
  const totalRooms = rooms.reduce((sum, r) => sum + (Number(r.roomsCount) || 0), 0);
  const prices = rooms.map((r) => Number(r.pricePerNight) || 0).filter((n) => n > 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const fullNight = rooms.reduce((sum, r) => sum + (Number(r.pricePerNight) || 0) * (Number(r.roomsCount) || 0), 0);

  const place = [reviewData.location.street, reviewData.location.city, reviewData.location.district, reviewData.location.regionName]
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .filter((p, i, all) => all.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
    .join(", ");

  const isMulti = reviewData.buildingType === "multi_storey" && Number(reviewData.totalFloors) >= 2;
  const floorCount = isMulti ? Number(reviewData.totalFloors) : 0;

  const cover = reviewData.coverPhoto;
  const ls = reviewData.longStay ?? null;
  const stats = [
    { Icon: BedDouble, value: Number(reviewData.bedrooms) || totalRooms, label: "bedrooms" },
    { Icon: Bath, value: Number(reviewData.bathrooms) || 0, label: "bathrooms" },
    { Icon: Users, value: Number(reviewData.maxGuests) || 0, label: ls ? "people" : "guests" },
  ].filter((s) => s.value > 0);
  const lsRent = ls ? Number(ls.terms.monthlyRent) || 0 : 0;

  return (
    <>
      {/* ---------------------------------------------------------------
          1. How guests will see it, and what is left before submitting
         --------------------------------------------------------------- */}
      <section className="ap-card">
        <header className="ap-card-head">
          <span className="ap-card-head-no">1</span>
          <div className="ap-card-head-copy">
            <h3 className="ap-card-title">{ls ? "How tenants will see it" : "How guests will see it"}</h3>
            <p className="ap-card-sub">A preview of your listing card and page.</p>
          </div>
          {completeEnough ? (
            <span className="ap-card-tag">
              <Check className="h-3.5 w-3.5" aria-hidden />
              Ready to submit
            </span>
          ) : (
            <span className="ap-card-tag is-todo">
              {workSteps.length - doneCount} {workSteps.length - doneCount === 1 ? "step" : "steps"} left
            </span>
          )}
        </header>

        <div className="ap-split">
          <div className="ap-split-main">
            <article className="ap-listing">
              <div className="ap-listing-cover">
                {cover ? (
                  /^https?:\/\//i.test(cover) ? (
                    <Image src={cover} alt="Listing cover" fill sizes="(min-width: 1024px) 360px, 100vw" className="object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="Listing cover" className="absolute inset-0 h-full w-full object-cover" />
                  )
                ) : (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[12px] text-white/45">
                    <ImageIcon className="h-6 w-6" aria-hidden />
                    No cover photo yet
                  </span>
                )}
                {reviewData.photoCount ? (
                  <span className="ap-photo-tag">
                    <ImageIcon className="h-3 w-3" aria-hidden />
                    {reviewData.photoCount} photos
                  </span>
                ) : null}
              </div>

              <div className="ap-listing-body">
                {reviewData.type ? <span className="ap-listing-type">{reviewData.type}</span> : null}
                <h4 className="ap-listing-title">{reviewData.title || "Your property name"}</h4>
                <p className="ap-listing-place">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                  <span className="truncate">{place || "Location not set"}</span>
                </p>

                {stats.length ? (
                  <ul className="ap-listing-stats">
                    {stats.map(({ Icon, value, label }) => (
                      <li key={label}>
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        <strong>{value}</strong> {label}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {reviewData.description ? (
                  <p className="m-0 ap-clamp-2 text-[12.5px] leading-5 text-white/65">{reviewData.description}</p>
                ) : null}

                <div className="ap-listing-price">
                  {ls ? (
                    lsRent > 0 ? (
                      <>
                        <strong>{money(lsRent, ls.terms.currency)}</strong>
                        <span className="text-[11.5px] text-white/50">a month · {ls.terms.minTermMonths}+ months</span>
                      </>
                    ) : <span className="text-[12px] text-white/50">No monthly rent yet</span>
                  ) : minPrice > 0 ? (
                    <>
                      <span className="text-[11.5px] text-white/50">From</span>
                      <strong>{money(minPrice, currency)}</strong>
                      <span className="text-[11.5px] text-white/50">per night</span>
                    </>
                  ) : (
                    <span className="text-[12px] text-white/50">No rates yet</span>
                  )}
                </div>
              </div>
            </article>
          </div>

          <aside className="ap-split-side">
            <div>
              <span className="ap-stat-label">Ready</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-[30px] font-bold leading-none tabular-nums text-white">{doneCount}</span>
                <span className="text-[12.5px] text-white/50">of {workSteps.length} steps</span>
              </div>
              <span className="ap-photo-meter is-wide mt-2.5" aria-hidden>
                {workSteps.map((s) => (
                  <span key={s.index} className={s.completed ? "is-done" : ""} />
                ))}
              </span>
            </div>

            <ul className="ap-review-steps">
              {workSteps.map((s) => (
                <li key={s.index} className={s.completed ? "is-done" : ""}>
                  <span className="ap-checklist-dot">{s.completed ? <Check className="h-3 w-3" /> : null}</span>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {onStepClick ? (
                    <button type="button" onClick={() => goTo(s.index)} className="ap-sum-link" aria-label={`Go to ${s.title}`}>
                      {s.completed ? "Edit" : "Fix"}
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            <p className="m-0 mt-auto ap-note">
              {ls
                ? (completeEnough
                  ? "After you submit, NoLSAF reviews the listing and a Sales Partner inspects the home before it takes tenants."
                  : "Finish the steps marked Fix, then submit. A Sales Partner inspects every monthly home before it goes live.")
                : completeEnough
                  ? "Our team reviews every listing before it goes live. You will be notified when the review is complete."
                  : "Finish the steps marked Fix, then submit. Our team reviews every listing before it goes live."}
            </p>
          </aside>
        </div>
      </section>

      {ls ? <MonthlyReview ls={ls} /> : null}

      {/* ---------------------------------------------------------------
          2. Room groups, as a table with totals
         --------------------------------------------------------------- */}
      {ls ? null : <section className="ap-card">
        <header className="ap-card-head">
          <span className="ap-card-head-no">2</span>
          <div className="ap-card-head-copy">
            <h3 className="ap-card-title">{separateUnits ? "Unit types" : "Room groups"}</h3>
            <p className="ap-card-sub">What guests can book, and at what rate.</p>
          </div>
          {rooms.length ? (
            <span className="ap-card-tag">
              <Check className="h-3.5 w-3.5" aria-hidden />
              {totalRooms} {entireUnit ? "entire place" : separateUnits ? (totalRooms === 1 ? "unit" : "units") : totalRooms === 1 ? "room" : "rooms"}
            </span>
          ) : (
            <span className="ap-card-tag is-todo">None yet</span>
          )}
        </header>

        {rooms.length === 0 ? (
          <div className="ap-card-body">
            <p className="m-0 ap-note">No room groups saved. Add at least one in the Rooms step.</p>
          </div>
        ) : (
          <div className="ap-table-wrap">
            <table className="ap-table">
              <thead>
                <tr>
                  <th>{entireUnit || separateUnits ? "Unit type" : "Room type"}</th>
                  <th className="is-num">{entireUnit || separateUnits ? "Units" : "Rooms"}</th>
                  {isMulti ? <th>Floors</th> : null}
                  <th className="is-num">Per night</th>
                  <th className="is-num">{entireUnit ? "Whole unit, one night" : separateUnits ? "All units, one night" : "All rooms, one night"}</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r, i) => {
                  const floorsLabel = Object.entries(r.floorDistribution || {})
                    .filter(([, v]) => Number(v) > 0)
                    .map(([k, v]) => `${floorName(Number(k))} ${v}`)
                    .join(" · ");
                  return (
                    <tr key={i}>
                      <td>
                        <span className="ap-table-type">
                          <span className="ap-floor-no">{String(r.roomType || "R").charAt(0)}</span>
                          {r.bookingMode === "ENTIRE_UNIT" ? `${r.unitStyle === "UNIT" ? r.roomType : `Entire ${r.roomType}`} · ${r.bedrooms?.length ?? 0} bedrooms` : r.roomType}
                        </span>
                        {r.maxGuestsPerUnit && <small className="block pl-8 text-white/55">Sleeps {r.maxGuestsPerUnit}{r.bookingMode === "ROOM" ? " per room" : ""} · {Number(r.extraGuestFee) > 0 ? `Base rate includes ${r.includedGuests}; +${money(Number(r.extraGuestFee), currency)} per extra guest/night` : "Same rate for all guests"}</small>}
                      </td>
                      <td className="is-num">{r.roomsCount}</td>
                      {isMulti ? <td className="text-white/60">{floorsLabel || "Not placed"}</td> : null}
                      <td className="is-num">{money(Number(r.pricePerNight) || 0, currency)}</td>
                      <td className="is-num text-white/70">{money((Number(r.pricePerNight) || 0) * (Number(r.roomsCount) || 0), currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="is-num">{totalRooms}</td>
                  {isMulti ? <td /> : null}
                  <td className="is-num">
                    {prices.length ? (minPrice === maxPrice ? money(minPrice, currency) : `${money(minPrice, currency)} to ${maxPrice.toLocaleString("en-US")}`) : "Not set"}
                  </td>
                  <td className="is-num">{money(fullNight, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>}

      {/* ---------------------------------------------------------------
          3. The building, floor by floor
         --------------------------------------------------------------- */}
      <section className="ap-card">
        <header className="ap-card-head">
          <span className="ap-card-head-no">{ls ? 4 : 3}</span>
          <div className="ap-card-head-copy">
            <h3 className="ap-card-title">Building</h3>
            <p className="ap-card-sub">
              {isMulti ? "Rooms and uses on every floor, top floor first." : "How the rooms are laid out."}
            </p>
          </div>
          <span className="ap-card-tag is-todo">
            {isMulti ? `${floorCount} floors` : reviewData.buildingType === "separate_units" ? "Separate units" : "Single storey"}
          </span>
        </header>

        {rooms.length > 0 && !entireUnit && !separateUnits ? (
          <div className="ap-card-body">
            <PropertyVisualizationPreview
              tone="dark"
              showHeader={false}
              title={reviewData.title}
              buildingType={reviewData.buildingType}
              totalFloors={reviewData.totalFloors}
              floorUses={reviewData.floorUses}
              rooms={rooms.map((r) => ({
                roomType: r.roomType,
                roomsCount: r.roomsCount,
                floorDistribution: r.floorDistribution,
              }))}
            />
          </div>
        ) : entireUnit ? <div className="ap-card-body"><p className="m-0 ap-note">{ls ? "The whole home is rented to one tenant. The listing shows each bedroom and its beds." : "The entire place is one bookable unit. The guest listing will show each bedroom and its beds."}</p></div> : separateUnits ? <div className="ap-card-body"><p className="m-0 ap-note">Separate units at one address. Each booking takes one whole unit, and each unit type is sold up to its count.</p></div> : (
          <div className="ap-card-body">
            <p className="m-0 ap-note">The building appears here once a room group is saved.</p>
          </div>
        )}
      </section>
    </>
  );
}

/** Long stay: the monthly terms, the lease, and what happens after submitting. */
function MonthlyReview({ ls }: { ls: NonNullable<ReviewData["longStay"]> }) {
  const t = ls.terms;
  const c = t.currency;
  const rent = Number(t.monthlyRent) || 0;
  const fmt = (n: number) => `${c} ${n.toLocaleString("en-US", { minimumFractionDigits: c === "TZS" ? 0 : 2, maximumFractionDigits: c === "TZS" ? 0 : 2 })}`;
  const d6 = Number(t.discounts.m6) || 0;
  const d12 = Number(t.discounts.m12) || 0;
  const BILL: Record<string, string> = { water: "Water", electricity: "Electricity", internet: "Internet", security: "Security guard", serviceCharge: "Service charge" };
  const inRent = Object.entries(t.utilities).filter(([, v]) => v === "INCLUDED").map(([k]) => BILL[k]);
  const tenantPays = Object.entries(t.utilities).filter(([, v]) => v === "TENANT").map(([k]) => `${BILL[k]}${Number((t.billEstimates as any)[k]) ? ` ~${fmt(Number((t.billEstimates as any)[k]))}` : ""}`);
  const facts: Array<[string, React.ReactNode]> = [
    ["Rent", rent ? <>{fmt(rent)} a month{d6 || d12 ? <span className="block text-[12px] text-teal-300">{[d6 ? `${d6}% off 6+ months` : null, d12 ? `${d12}% off 12 months` : null].filter(Boolean).join(" · ")}</span> : null}</> : <span className="text-amber-300">Not set</span>],
    ["Lease", `${t.minTermMonths} ${t.maxTermMonths ? `to ${t.maxTermMonths}` : "or more"} months`],
    ["Paid before move-in", `${t.upfrontMonths} month${t.upfrontMonths === 1 ? "" : "s"} (1 through NoLSAF)`],
    ["Available from", t.availableFrom ? new Date(`${t.availableFrom}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : <span className="text-amber-300">Not set</span>],
    ["Deposit, to you", t.securityDepositMonths ? `${t.securityDepositMonths} month${t.securityDepositMonths === 1 ? "" : "s"}${rent ? `, ${fmt(rent * t.securityDepositMonths)}` : ""}` : "None"],
    ["Notice to leave", `${t.noticePeriodDays} days`],
    ["In the rent", inRent.length ? inRent.join(", ") : "No bills"],
    ["Tenant pays", tenantPays.length ? tenantPays.join(", ") : "Nothing extra"],
    ["Parking", ls.parking],
    ["People and pets", `Up to ${Number(t.maxOccupants) || "?"} people, pets ${t.petsAllowed ? "allowed" : "not allowed"}`],
  ];
  const steps: Array<{ Icon: typeof Check; title: string; text: string; lease?: boolean }> = [
    { Icon: ClipboardCheck, title: "NoLSAF reviews, a Sales Partner inspects", text: "A partner visits the home and checks it against the listing. It goes live once it passes." },
    { Icon: CalendarCheck, title: "A verified tenant reserves", text: "At these terms. You confirm or decline within 24 hours in Long stays." },
    { Icon: FileSignature, title: "You both read and sign the lease", text: "In Long stays, open the reservation: the full lease with the tenant's name and dates. Each of you accepts the exact text.", lease: true },
    { Icon: Wallet, title: "The tenant pays the first month", text: "By card through NoLSAF, within 48 hours. The home is reserved." },
    { Icon: KeyRound, title: "Move-in day", text: "Walk-through, the tenant pays you the balance, keys handed over. NoLSAF then pays you month 1 less commission." },
  ];

  return (
    <>
      <section className="ap-card">
        <header className="ap-card-head">
          <span className="ap-card-head-no">2</span>
          <div className="ap-card-head-copy">
            <h3 className="ap-card-title">Monthly terms</h3>
            <p className="ap-card-sub">What the tenant pays and agrees to. All of it goes into the lease.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={ls.onPreviewLease} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-teal-400/15 px-3 text-[12.5px] font-semibold text-teal-200 hover:bg-teal-400/25 [font-family:inherit]"><FileText className="h-3.5 w-3.5" />Read the lease</button>
            <button type="button" onClick={ls.onEditTerms} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-white/15 bg-white/[0.05] px-3 text-[12.5px] font-semibold text-white/80 hover:bg-white/[0.1] [font-family:inherit]"><Pencil className="h-3.5 w-3.5" />Edit</button>
          </div>
        </header>
        <div className="ap-card-body space-y-4">
          <dl className="m-0 grid gap-px overflow-hidden rounded-lg border border-solid border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0 bg-[#12191b] px-3.5 py-2.5">
                <dt className="text-[10.5px] font-bold uppercase tracking-wide text-white/40">{label}</dt>
                <dd className="m-0 mt-0.5 text-[13px] text-white/90">{value}</dd>
              </div>
            ))}
          </dl>
          {ls.rules.length ? (
            <div className="rounded-lg bg-white/[0.03] px-3.5 py-2.5">
              <p className="m-0 text-[10.5px] font-bold uppercase tracking-wide text-white/40">Your living rules, in the lease</p>
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[13px] text-white/80">
                {ls.rules.map((r) => <li key={r} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" />{r}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      <section className="ap-card">
        <header className="ap-card-head">
          <span className="ap-card-head-no">3</span>
          <div className="ap-card-head-copy">
            <h3 className="ap-card-title">After you submit</h3>
            <p className="ap-card-sub">From review to the tenant moving in, and where the lease is signed.</p>
          </div>
        </header>
        <div className="ap-card-body">
          <ol className="m-0 list-none p-0">
            {steps.map(({ Icon, title, text, lease }, i) => (
              <li key={title} className="relative flex gap-3.5 pb-4 last:pb-0">
                {i < steps.length - 1 ? <span className="absolute bottom-0 left-[17px] top-9 w-px bg-white/10" aria-hidden /> : null}
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${lease ? "bg-teal-400 text-[#0b2420]" : "bg-white/[0.06] text-white/60"}`}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-white">
                    {title}
                    {lease ? <span className="rounded bg-teal-400/15 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-teal-200">The lease</span> : null}
                  </p>
                  <p className="m-0 mt-0.5 text-[12.5px] leading-5 text-white/55">{text}</p>
                  {lease ? (
                    <button type="button" onClick={ls.onPreviewLease} className="mt-1.5 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] font-semibold text-teal-300 hover:underline [font-family:inherit]">
                      <BadgeCheck className="h-3.5 w-3.5" />Read it now, with sample names
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
