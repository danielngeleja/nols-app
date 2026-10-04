"use client";

import type { ReactNode } from "react";
import { ArrowRight, Bath, BedDouble, Check, ImageIcon, MapPin, Users } from "lucide-react";
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
  const stats = [
    { Icon: BedDouble, value: Number(reviewData.bedrooms) || totalRooms, label: "bedrooms" },
    { Icon: Bath, value: Number(reviewData.bathrooms) || 0, label: "bathrooms" },
    { Icon: Users, value: Number(reviewData.maxGuests) || 0, label: "guests" },
  ].filter((s) => s.value > 0);

  return (
    <>
      {/* ---------------------------------------------------------------
          1. How guests will see it, and what is left before submitting
         --------------------------------------------------------------- */}
      <section className="ap-card">
        <header className="ap-card-head">
          <span className="ap-card-head-no">1</span>
          <div className="ap-card-head-copy">
            <h3 className="ap-card-title">How guests will see it</h3>
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
                  {minPrice > 0 ? (
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
              {completeEnough
                ? "Our team reviews every listing before it goes live. You will be notified when the review is complete."
                : "Finish the steps marked Fix, then submit. Our team reviews every listing before it goes live."}
            </p>
          </aside>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          2. Room groups, as a table with totals
         --------------------------------------------------------------- */}
      <section className="ap-card">
        <header className="ap-card-head">
          <span className="ap-card-head-no">2</span>
          <div className="ap-card-head-copy">
            <h3 className="ap-card-title">Room groups</h3>
            <p className="ap-card-sub">What guests can book, and at what rate.</p>
          </div>
          {rooms.length ? (
            <span className="ap-card-tag">
              <Check className="h-3.5 w-3.5" aria-hidden />
              {totalRooms} {totalRooms === 1 ? "room" : "rooms"}
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
                  <th>Room type</th>
                  <th className="is-num">Rooms</th>
                  {isMulti ? <th>Floors</th> : null}
                  <th className="is-num">Per night</th>
                  <th className="is-num">All rooms, one night</th>
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
                          {r.roomType}
                        </span>
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
      </section>

      {/* ---------------------------------------------------------------
          3. The building, floor by floor
         --------------------------------------------------------------- */}
      <section className="ap-card">
        <header className="ap-card-head">
          <span className="ap-card-head-no">3</span>
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

        {rooms.length > 0 ? (
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
        ) : (
          <div className="ap-card-body">
            <p className="m-0 ap-note">The building appears here once a room group is saved.</p>
          </div>
        )}
      </section>
    </>
  );
}
