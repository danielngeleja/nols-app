"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { PartyPopper } from "lucide-react";
import { SPACE_TYPES } from "@/components/events/eventHireTypes";
import { eventVenueDetailHref, type PublicEventHire } from "@/lib/publicEventVenue";

export default function EventHireOffer({ offer, slug }: { offer: PublicEventHire; slug: string }) {
  const section = useRef<HTMLElement>(null);
  const space = SPACE_TYPES.find(type => type.key === offer.spaceType)?.label;
  const guests = Math.max(offer.capacitySeated ?? 0, offer.capacityStanding ?? 0);

  useEffect(() => {
    if (window.location.hash === "#events") section.current?.scrollIntoView({ block: "start" });
  }, [slug]);

  return (
    <section ref={section} id="events" aria-labelledby="event-hire-title"
      className="mt-3 flex scroll-mt-24 flex-wrap items-center gap-3 rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-sm">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
        <PartyPopper className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="event-hire-title" className="m-0 text-base font-semibold text-slate-900">Host an event here</h2>
        <p className="m-0 mt-0.5 text-sm text-slate-600">{[space, guests > 0 && `Up to ${guests} guests`].filter(Boolean).join(" · ") || "Event hire"}</p>
      </div>
      <Link href={eventVenueDetailHref(slug)} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014e47] hover:no-underline">
        View event venue
      </Link>
    </section>
  );
}
