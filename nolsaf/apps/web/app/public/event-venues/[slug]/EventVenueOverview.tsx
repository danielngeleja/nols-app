import Link from "next/link";
import { BriefcaseBusiness, Cake, Camera, Check, Church, CircleAlert, Clock3, CookingPot, GraduationCap, Heart, HeartHandshake, Music2, PartyPopper, Presentation, Users, type LucideIcon } from "lucide-react";
import { EVENT_TYPES, eventWindowMinutes } from "@/components/events/eventHireTypes";
import { formatClockTime } from "@/lib/propertyUtils";
import type { EventVenueFilters, PublicEventHire } from "@/lib/publicEventVenue";
import styles from "./event-venue-details.module.css";

const occasionIcons: Record<string, LucideIcon> = {
  WEDDING: Heart,
  SEND_OFF: HeartHandshake,
  KITCHEN_PARTY: CookingPot,
  BIRTHDAY: Cake,
  HOUSE_PARTY: Music2,
  GRADUATION: GraduationCap,
  MEETING: BriefcaseBusiness,
  WORKSHOP: Presentation,
  CHURCH: Church,
  PHOTO_SHOOT: Camera,
};

function EventHoursWindow({ start, end }: { start: string; end: string }) {
  const totalMinutes = eventWindowMinutes(start, end);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const duration = [hours > 0 ? `${hours} hr` : "", minutes > 0 ? `${minutes} min` : ""].filter(Boolean).join(" ");

  return (
    <>
      <time dateTime={`PT${totalMinutes}M`} className="block text-2xl font-semibold leading-7 tracking-tight tabular-nums text-slate-900">{duration}</time>
      <div className={styles.hourTrack} aria-hidden="true">
        {Array.from({ length: Math.ceil(totalMinutes / 60) }, (_, index) => (
          <span key={index} className={styles.hourSegment} style={{ flexGrow: Math.min(60, totalMinutes - index * 60) }} />
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm leading-5">
        <div>
          <span className="block text-xs text-slate-600">Earliest start</span>
          <time dateTime={start} className="whitespace-nowrap font-semibold text-slate-900">{formatClockTime(start)}</time>
        </div>
        <div className="ml-auto text-right">
          <span className="block text-xs text-slate-600">{end <= start ? "Latest end, next day" : "Latest end"}</span>
          <time dateTime={end} className="whitespace-nowrap font-semibold text-slate-900">{formatClockTime(end)}</time>
        </div>
      </div>
    </>
  );
}

function VenueSearchMatch({ offer, search, resultsHref }: {
  offer: PublicEventHire;
  search: EventVenueFilters;
  resultsHref: string;
}) {
  const occasion = EVENT_TYPES.find(type => type.key === search.kind);
  const hasGuests = search.guests > 0;
  if (!occasion && !hasGuests) return null;

  const standing = search.seating === "STANDING";
  const layout = standing ? "standing" : "seated";
  const capacity = standing ? offer.capacityStanding : offer.capacitySeated;
  const guestLabel = `${search.guests.toLocaleString("en-TZ")} ${layout} ${search.guests === 1 ? "guest" : "guests"}`;
  const overCapacity = hasGuests && capacity != null && search.guests > capacity;
  const unsupported = Boolean(occasion && !offer.eventTypes.includes(occasion.key));
  const needsConfirmation = hasGuests && capacity == null;
  const issues = [
    overCapacity ? `You searched for ${guestLabel}. The venue holds up to ${capacity} ${layout}.` : null,
    unsupported && occasion ? `${occasion.label} falls outside this venue’s listed occasions.` : null,
    needsConfirmation ? `Ask the venue to confirm its capacity for ${guestLabel}.` : null,
  ].filter(Boolean);
  const mismatch = overCapacity || unsupported;
  const matches = issues.length === 0;
  const headline = mismatch ? "Your event needs a different venue"
    : needsConfirmation ? "Confirm the capacity for your setup"
      : hasGuests && occasion ? "Fits your guest count and occasion"
        : hasGuests ? "Fits your guest count" : "Supports your occasion";
  const Icon = matches ? Check : CircleAlert;

  return (
    <div className={`mt-4 flex items-start gap-2.5 border-0 border-l-2 border-solid px-3.5 py-3 ${matches ? "border-[#02665e] bg-[#02665e]/[0.05]" : "border-amber-500 bg-amber-50"}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${matches ? "text-[#02665e]" : "text-amber-700"}`} aria-hidden />
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold text-slate-900">{headline}</p>
        <p className="m-0 mt-0.5 text-sm leading-5 text-slate-700">
          {matches ? [hasGuests ? guestLabel : null, occasion?.label].filter(Boolean).join(" · ") : issues.join(" ")}
        </p>
        {mismatch && <Link href={resultsHref} className="mt-1.5 inline-block text-sm font-semibold text-[#02665e] underline underline-offset-2">See other venues</Link>}
      </div>
    </div>
  );
}

export default function EventVenueOverview({ offer, search, resultsHref }: {
  offer: PublicEventHire;
  search: EventVenueFilters;
  resultsHref: string;
}) {
  const capacities = [
    { label: "Seated guests", value: offer.capacitySeated },
    { label: "Standing guests", value: offer.capacityStanding },
  ].filter(({ value }) => value != null && value > 0);
  const { earliestStart, latestEnd, noiseCutoff } = offer;
  const occasions = EVENT_TYPES.filter(type => offer.eventTypes.includes(type.key));
  const hasHours = Boolean((earliestStart && latestEnd) || noiseCutoff);
  const hasFacts = hasHours || occasions.length > 0;
  if (!offer.description && !capacities.length && !hasFacts && !search.guests && !search.kind) return null;

  return (
    <section aria-label="Venue overview" className={styles.overview}>
      {(capacities.length > 0 || hasFacts) && (
        <div className={`${styles.overviewGrid} ${capacities.length > 0 && hasFacts ? styles.overviewSplit : ""}`}>
          {capacities.length > 0 && (
            <section aria-labelledby="venue-capacity" className={styles.capacity}>
              <h2 id="venue-capacity" className={styles.capacityHeading}><Users className="h-4 w-4" aria-hidden /> Guest capacity</h2>
              <ul className={`${styles.capacityValues} list-none p-0`}>
                {capacities.map(({ label, value }) => (
                  <li key={label} className={styles.capacityValue}>
                    <strong className={styles.capacityNumber}>{value?.toLocaleString("en-TZ")}</strong>
                    <span className={styles.capacityUnit}>{label}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasFacts && (
            <dl className={styles.facts}>
              {hasHours && (
                <div className={styles.fact}>
                  <dt className="flex items-center gap-1.5 text-sm font-semibold text-[#07574f]"><Clock3 className="h-4 w-4" aria-hidden /> Event hours</dt>
                  <dd className="m-0 mt-1 text-sm leading-6 text-slate-700">
                    {earliestStart && latestEnd && <EventHoursWindow start={earliestStart} end={latestEnd} />}
                    {noiseCutoff && <p className="m-0 mt-2">Quiet hours start at <time dateTime={noiseCutoff} className="whitespace-nowrap">{formatClockTime(noiseCutoff)}</time>.</p>}
                  </dd>
                </div>
              )}
              {occasions.length > 0 && (
                <div className={styles.fact}>
                  <dt className="flex items-center gap-1.5 text-sm font-semibold text-[#07574f]"><PartyPopper className="h-4 w-4" aria-hidden /> Suitable for</dt>
                  <dd className="m-0 mt-2">
                    <ul className={styles.occasions}>
                      {occasions.map(({ key, label }) => {
                        const Icon = occasionIcons[key] ?? PartyPopper;
                        return (
                          <li key={key} className={styles.occasion}>
                            <span className={styles.occasionIcon}><Icon className="h-4 w-4" aria-hidden /></span>
                            <span className="min-w-0 text-sm font-medium leading-5 text-slate-800">{label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
      <VenueSearchMatch offer={offer} search={search} resultsHref={resultsHref} />
      {offer.description && <p className="m-0 mt-4 max-w-[65ch] whitespace-pre-line text-base leading-7 text-slate-700">{offer.description}</p>}
    </section>
  );
}
