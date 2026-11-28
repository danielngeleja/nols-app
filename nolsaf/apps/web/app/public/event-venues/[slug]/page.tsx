import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import { tsh } from "@/components/events/eventHireTypes";
import { eventVenueBrowseContext, eventVenueDetailHref, type PublicEventVenue } from "@/lib/publicEventVenue";
import EventVenueGallery from "./EventVenueGallery";
import EventVenueOverview from "./EventVenueOverview";
import EventVenueHireOptions from "./EventVenueHireOptions";
import EventVenueCostCalculator from "./EventVenueCostCalculator";
import EventVenueFacilitiesRules from "./EventVenueFacilitiesRules";
import EventVenueBookingGuide from "./EventVenueBookingGuide";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
};

const loadVenue = cache(async (slug: string): Promise<PublicEventVenue | null> => {
  const apiOrigin = process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const url = new URL(`/api/public/properties/event-venues/${encodeURIComponent(slug)}`, apiOrigin);
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load the event venue");
  const { venue } = await response.json() as { venue: PublicEventVenue };
  return venue;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const venue = await loadVenue(slug).catch(() => null);
  if (!venue) return { title: "Event venue", robots: { index: false } };

  const title = `${venue.title} · Event venue`;
  const description = venue.offer.description || `Explore event hire at ${venue.title}${venue.location ? ` in ${venue.location}` : ""}.`;
  const site = process.env.NEXT_PUBLIC_APP_URL || "https://nolsaf.com";
  const canonical = new URL(eventVenueDetailHref(venue.slug), site).href;
  const image = venue.offer.photos.find(photo => /^https?:\/\//i.test(photo));
  return {
    title,
    description: description.slice(0, 160),
    alternates: { canonical },
    openGraph: { title, description: description.slice(0, 160), url: canonical, ...(image ? { images: [image] } : {}) },
  };
}

export default async function PublicEventVenuePage({ params, searchParams }: PageProps) {
  const [{ slug }, { returnTo }] = await Promise.all([params, searchParams]);
  const venue = await loadVenue(slug);
  if (!venue) notFound();

  const { title, location, offer } = venue;
  const browse = eventVenueBrowseContext(returnTo);
  const canRequest = offer.requestsOpen && process.env.NEXT_PUBLIC_EVENT_HIRE_REQUESTS_ENABLED === "true";
  const requestHref = `/account/event-requests?${new URLSearchParams({ tab: "requests", venue: venue.slug })}`;
  const photos = [...new Set(offer.photos)];

  return (
    <main className="header-offset min-h-screen bg-white text-slate-900">
      <div className="public-container pb-12 pt-5 sm:pb-16 sm:pt-8">
        <Link href={browse.href} aria-label="Back to event venues" title="Back to event venues"
          className="inline-grid h-11 w-11 box-border place-items-center rounded-md border border-solid border-[#dce8e5] bg-white text-[#02665e] no-underline transition-colors hover:border-[#b9d7cf] hover:bg-[#edf6f3] hover:text-[#014e47] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#02665e]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>

        <header className="mb-5 mt-3 sm:mb-6">
          <h1 className="m-0 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">{title}</h1>
          {location && <p className="m-0 mt-2 flex items-center gap-2 text-sm text-slate-600 sm:text-base"><MapPin className="h-4 w-4 shrink-0" aria-hidden />{location}</p>}
        </header>

        <EventVenueGallery photos={photos} title={title} />

        <div className="mt-6 grid gap-7 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
          <aside aria-labelledby="event-booking-heading" className="self-start rounded-lg border border-solid border-slate-200 bg-white p-5 shadow-sm lg:col-start-2 lg:row-start-1">
            <h2 id="event-booking-heading" className="m-0 text-base font-semibold text-slate-900">Hire this venue</h2>
            {offer.fromPrice != null && (
              <p className="m-0 mt-2 text-sm text-slate-600">From <strong className="ml-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{tsh(offer.fromPrice)}</strong></p>
            )}
            {canRequest ? (
              <>
                <Link href={requestHref} className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#02665e] px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-[#014e47] hover:no-underline">
                  <CalendarDays className="h-4 w-4" aria-hidden /> Request a date
                </Link>
                <p className="m-0 mt-3 text-sm leading-5 text-slate-600">Pay after the venue owner confirms your date.</p>
              </>
            ) : <p className="m-0 mt-3 text-sm leading-5 text-slate-600">Online date requests are currently unavailable.</p>}
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <EventVenueOverview offer={offer} search={browse.filters} resultsHref={browse.href} />
          </div>

          {offer.packages.length > 0 && (
            <div className="grid min-w-0 items-start gap-5 lg:col-span-2 lg:row-start-2 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
              <EventVenueHireOptions packages={offer.packages} cleaningFee={offer.cleaningFee} />
              <EventVenueCostCalculator
                venueSlug={venue.slug}
                offer={{ packages: offer.packages, cleaningFee: offer.cleaningFee, earliestStart: offer.earliestStart, latestEnd: offer.latestEnd }}
                multiDayEstimates={venue.multiDayEstimates}
              />
            </div>
          )}

          <EventVenueFacilitiesRules provided={offer.provided} allowed={offer.allowed} noiseCutoff={offer.noiseCutoff} capacitySeated={offer.capacitySeated} />
          <EventVenueBookingGuide hasMultiDayRates={Boolean(venue.multiDayEstimates?.length)} />
        </div>
      </div>
    </main>
  );
}
