"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Armchair, ArrowRight, Building2, Check, CheckCircle2, MapPin, PartyPopper, RefreshCw, Search, UsersRound } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { EVENT_TYPES, SPACE_TYPES } from "@/components/events/eventHireTypes";
import styles from "./approved-event-venues.module.css";

type Venue = {
  ref: string; title: string; spaceType: string | null; capacitySeated: number | null; capacityStanding: number | null;
  photo?: string | null; location?: string[]; fromPrice?: number | null; priceLabel?: string | null; eventTypes?: string[];
};
function readable(value: string) {
  const text = value.trim();
  return text === text.toUpperCase() && /[A-Z]/.test(text)
    ? text.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : text;
}
function locationLabel(parts: string[] = []) {
  return Array.from(new Map(parts.filter(Boolean).map(p => [p.trim().toLowerCase(), readable(p)])).values()).join(", ");
}

export default function ApprovedEventVenues({embedded=false}:{embedded?:boolean}) {
  const [items, setItems] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const { data } = await apiClient.get("/api/owner/event-hire/approved", { signal });
      if (signal?.aborted) return;
      setItems(data.items); setHasMore(Boolean(data.hasMore));
    } catch (cause: any) {
      if (!signal?.aborted) setError(cause?.response?.data?.error || "Could not load your event spaces. Please try again.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter(item => `${item.title} ${locationLabel(item.location)} ${SPACE_TYPES.find(s => s.key === item.spaceType)?.label || ""}`.toLowerCase().includes(term));
  }, [items, search]);

  return <div className={styles.page}>
    {!embedded&&<header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.headingIcon}><PartyPopper size={21} aria-hidden /></span>
        <div><p className={styles.eyebrow}>Properties / Event hire</p><h1>Hired events</h1><p className={styles.subtitle}>Your event spaces, with capacity and hire rates at a glance.</p></div>
      </div>
      <div className={styles.headerActions}>
        <Link href="/owner/properties/approved" className={styles.propertyLink}><Building2 size={15} aria-hidden />My properties</Link>
        <button type="button" onClick={() => void load()} disabled={loading} className={styles.refresh} aria-label="Refresh event spaces" title="Refresh event spaces"><RefreshCw size={16} className={loading ? styles.spinning : undefined} aria-hidden /></button>
      </div>
    </header>}

    <div className={styles.toolbar}>
      <div className={styles.collectionTitle}><span>Your venues</span>{!loading || items.length > 0 ? <span className={styles.count}>{items.length}{hasMore ? "+" : ""}</span> : null}<span className={styles.collectionNote}><CheckCircle2 size={13} aria-hidden />Approved by NoLSAF</span></div>
      {items.length > 0 && <label className={styles.search}><Search size={16} aria-hidden /><span className={styles.srOnly}>Search event spaces</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search your event spaces" /></label>}
    </div>

    {error && <div role="alert" className={styles.error}>{error}<button type="button" onClick={() => void load()} disabled={loading}>Try again</button></div>}
    {loading && !items.length ? <div className={styles.skeleton} role="status" aria-label="Loading event spaces"><div /><div><span /><span /><span /></div></div> : !error && !items.length ? <div className={styles.empty}><span className={styles.emptyIcon}><PartyPopper size={26} aria-hidden /></span><h2>Your next gathering starts here</h2><p>Approved event spaces will appear here once both event hire and the accommodation are approved.</p><Link href="/owner/properties/approved">Go to my properties<ArrowRight size={15} aria-hidden /></Link></div> : <>
      <ul className={styles.venues} aria-label="Approved event venues" aria-busy={loading}>
        {visible.map(item => <VenueRow key={item.ref} venue={item} />)}
      </ul>
      {!visible.length && items.length > 0 && <div className={styles.noMatches}><Search size={22} aria-hidden /><h2>No matching event spaces</h2><p>Try another venue name or location.</p><button type="button" onClick={() => setSearch("")}>Clear search</button></div>}
    </>}
    {hasMore && !loading && <p className={styles.footnote}>Showing your 100 most recently added event spaces. Find other properties in My properties.</p>}
  </div>;
}

function VenueRow({ venue }: { venue: Venue }) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const href = `/owner/properties/events?venue=${encodeURIComponent(venue.ref)}&tab=overview`;
  const detailsHref = `/owner/properties/${encodeURIComponent(venue.ref)}/events`;
  const space = SPACE_TYPES.find(s => s.key === venue.spaceType)?.label || "Event space";
  const location = locationLabel(venue.location);
  const events = (venue.eventTypes || []).map(key => EVENT_TYPES.find(type => type.key === key)?.label).filter(Boolean);
  const hasPhoto = Boolean(venue.photo && venue.photo !== failedPhoto);
  return <li className={styles.venue}>
    <Link href={href} className={styles.photo} aria-label={`Open event hire for ${readable(venue.title)}`}>
      {hasPhoto ? <Image src={venue.photo!} alt={`${space} at ${readable(venue.title)}`} fill sizes="(max-width: 600px) 100vw, 200px" className={styles.venueImage} onError={() => setFailedPhoto(venue.photo!)} /> : <div className={styles.photoPlaceholder}><PartyPopper size={36} strokeWidth={1.25} aria-hidden /><span>{space}</span></div>}
      <span className={styles.spaceBadge}>{space}</span>
    </Link>
    <div className={styles.venueBody}>
      <div className={styles.venueTopline}><span>Event venue</span><span className={styles.approved}><Check size={12} aria-hidden />Approved</span></div>
      <h2><Link href={href}>{readable(venue.title) || "Event venue"}</Link></h2>
      {location && <p className={styles.location}><MapPin size={13} aria-hidden /><span>{location}</span></p>}
      <div className={styles.capacities} aria-label="Capacity by arrangement">
        {venue.capacitySeated != null && <span><Armchair size={17} aria-hidden /><strong>{venue.capacitySeated.toLocaleString()}</strong><span>seated</span></span>}
        {venue.capacityStanding != null && <span><UsersRound size={17} aria-hidden /><strong>{venue.capacityStanding.toLocaleString()}</strong><span>standing</span></span>}
      </div>
      {events.length > 0 && <p className={styles.eventTypes}>{events.slice(0, 3).join(" · ")}{events.length > 3 ? ` · +${events.length - 3} more` : ""}</p>}
    </div>
    <div className={styles.venueActions}>
      {venue.fromPrice ? <div className={styles.rate}><span>Hire from</span><p><span>TSh</span> {venue.fromPrice.toLocaleString("en-TZ")}</p><small>{venue.priceLabel} · venue rate</small></div> : <div className={styles.rate}><span>Venue details</span><p className={styles.detailsLabel}>Ready to manage</p></div>}
      <Link href={href} className={styles.manage}>Manage event hire<ArrowRight size={15} aria-hidden /></Link>
      <Link href={detailsHref} className={styles.requests}>Approved venue details</Link>
      {process.env.NEXT_PUBLIC_EVENT_HIRE_REQUESTS_ENABLED === "true" && <Link href="/owner/event-requests" className={styles.requests}>View event requests</Link>}
    </div>
  </li>;
}
