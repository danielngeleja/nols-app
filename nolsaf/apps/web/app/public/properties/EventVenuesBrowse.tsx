"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Check, ChevronsUpDown, PartyPopper, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import PublicApprovedPropertyCard from "@/components/PublicApprovedPropertyCard";
import { EVENT_TYPES, SPACE_TYPES } from "@/components/events/eventHireTypes";
import { parseEventGuestCount, type EventVenueFilters, type EventVenueSort } from "@/lib/publicEventVenue";

type Venue = {
  slug: string;
  title: string;
  location: string;
  regionName: string | null;
  image: string | null;
  spaceType: string | null;
  eventTypes: string[];
  capacitySeated: number | null;
  capacityStanding: number | null;
  fromPrice: number | null;
};
const sortOptions = {
  match: "Best match",
  price: "Lowest price",
  guests: "Most guests",
} as const;

const defaultFilters: EventVenueFilters = { kind: "", guests: 0, seating: "SEATED", region: "" };
const eventLabel = (kind: string) => EVENT_TYPES.find(event => event.key === kind)?.label ?? kind;

export function writeEventVenueFilters(params: URLSearchParams, filters: EventVenueFilters) {
  const values = {
    eventOccasion: filters.kind,
    eventGuests: filters.guests ? String(filters.guests) : "",
    eventSeating: filters.seating === "STANDING" ? "standing" : "",
    eventRegion: filters.region,
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, value);
    else params.delete(key);
  });
}

export function useEventVenues(enabled: boolean) {
  const [data, setData] = useState<{ venues: Venue[]; failed: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/public/properties/event-venues", { cache: "no-store", signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error("Could not load event venues");
        return response.json();
      })
      .then(json => {
        if (!controller.signal.aborted) setData({ venues: json.items ?? [], failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setData({ venues: [], failed: true });
      });
    return () => controller.abort();
  }, [enabled]);

  return data;
}

const filterLabelClass = "grid min-w-0 content-start gap-1.5 text-sm font-semibold leading-5 text-slate-700";
const filterControlClass = "block box-border h-11 w-full min-w-0 m-0 rounded-lg border border-solid border-slate-200 bg-white px-3 py-0 text-[16px] font-normal leading-5 text-slate-900 focus:border-[#02665e] focus:outline-none focus:ring-2 focus:ring-[#02665e]/20";

function FilterSelect({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className={filterLabelClass}>
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className={`${filterControlClass} pr-9`}>
        {children}
      </select>
    </label>
  );
}

export function EventVenueSearchControls({ data, filters, sort, onFilters, onSort }: {
  data: ReturnType<typeof useEventVenues>;
  filters: EventVenueFilters;
  sort: EventVenueSort;
  onFilters: (filters: EventVenueFilters) => void;
  onSort: (sort: EventVenueSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const venues = data?.venues ?? [];
  const kinds = EVENT_TYPES.filter(event => event.key === draft.kind || venues.some(venue => venue.eventTypes.includes(event.key)));
  const regions = [...new Set([draft.region, ...venues.map(venue => venue.regionName ?? "")].filter(Boolean))].sort();
  const count = Number(Boolean(filters.kind)) + Number(Boolean(filters.guests || filters.seating === "STANDING")) + Number(Boolean(filters.region));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onFilters(draft);
    setOpen(false);
  };

  return (
    <>
      <Menu>
        <MenuButton type="button" aria-label={`Sort event venues, ${sortOptions[sort]}`} title="Sort event venues"
          className={`flex h-10 flex-none items-center justify-center gap-1.5 rounded-md border-0 px-2.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 sm:px-3 ${sort === "match" ? "bg-transparent text-slate-600 hover:bg-slate-100" : "bg-[#02665e]/[0.08] text-[#02665e]"}`}>
          <ChevronsUpDown className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Sort</span>
        </MenuButton>
        <MenuItems anchor={{ to: "bottom end", gap: 8 }} className="z-[2147483000] min-w-44 rounded-xl border border-solid border-slate-200 bg-white p-1.5 shadow-lg focus:outline-none">
          {(Object.keys(sortOptions) as EventVenueSort[]).map(option => (
            <MenuItem key={option} as="button" type="button" onClick={() => onSort(option)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm data-[focus]:bg-slate-100 ${sort === option ? "font-semibold text-[#02665e]" : "text-slate-700"}`}>
              {sortOptions[option]}
              {sort === option && <><Check className="h-4 w-4" aria-hidden /><span className="sr-only">Selected</span></>}
            </MenuItem>
          ))}
        </MenuItems>
      </Menu>

      <span className="h-6 w-px flex-none bg-slate-200" aria-hidden />
      <button type="button" aria-label={count ? `Event filters, ${count} applied` : "Event filters"} title="Event filters"
        aria-haspopup="dialog" aria-expanded={open} onClick={() => { setDraft(filters); setOpen(true); }}
        className="flex h-10 flex-none items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#014e47] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/40 sm:px-4">
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Filters</span>
        {count > 0 && <span aria-hidden className="grid h-[18px] min-w-[18px] place-items-center rounded bg-emerald-300 px-1 text-[11px] font-bold text-[#012e29]">{count}</span>}
      </button>

      <Dialog open={open} onClose={setOpen} className="relative z-[2147483000]">
        <DialogBackdrop className="fixed inset-0 bg-slate-900/45 backdrop-blur-[2px]" />
        <div className="fixed inset-x-2 bottom-2 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4">
          <DialogPanel className="max-h-[calc(100dvh-1rem)] overflow-auto rounded-xl bg-white shadow-[0_24px_60px_-18px_rgba(0,0,0,0.45)] sm:max-h-[calc(100dvh-2rem)] sm:w-[420px]">
            <form onSubmit={submit}>
              <header className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-200 px-4 py-3">
                <DialogTitle className="m-0 text-base font-semibold text-slate-900">Event filters</DialogTitle>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close filters"
                  className="grid h-8 w-8 place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </header>
              <div className="grid items-start gap-x-3 gap-y-4 p-4 min-[360px]:grid-cols-2">
                <FilterSelect label="Occasion" value={draft.kind} onChange={kind => setDraft({ ...draft, kind })}>
                  <option value="">Any event</option>
                  {kinds.map(kind => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
                </FilterSelect>
                <FilterSelect label="Region" value={draft.region} onChange={region => setDraft({ ...draft, region })}>
                  <option value="">Anywhere</option>
                  {regions.map(region => <option key={region} value={region}>{region}</option>)}
                </FilterSelect>
                <label className={filterLabelClass}>
                  <span>Guests</span>
                  <input type="number" min={1} max={3000} inputMode="numeric" placeholder="Any number" value={draft.guests || ""}
                    onChange={event => setDraft({ ...draft, guests: parseEventGuestCount(event.target.value) })}
                    className={`${filterControlClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`} />
                </label>
                <FilterSelect label="Seating" value={draft.seating} onChange={value => setDraft({ ...draft, seating: value === "STANDING" ? "STANDING" : "SEATED" })}>
                  <option value="SEATED">Seated</option>
                  <option value="STANDING">Standing</option>
                </FilterSelect>
              </div>
              <footer className="grid grid-cols-2 gap-2 border-0 border-t border-solid border-slate-200 p-4">
                <button type="button" onClick={() => { onFilters(defaultFilters); setOpen(false); }}
                  className="h-11 rounded-lg border border-solid border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">Clear filters</button>
                <button type="submit" className="h-11 rounded-lg border-0 bg-[#02665e] text-sm font-semibold text-white hover:bg-[#014e47]">Apply filters</button>
              </footer>
            </form>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}

export default function EventVenuesBrowse({ query, resultsHref, data, filters, sort }: {
  query: string;
  resultsHref: string;
  data: ReturnType<typeof useEventVenues>;
  filters: EventVenueFilters;
  sort: EventVenueSort;
}) {
  const { kind, guests, seating, region } = filters;
  const venues = data?.venues ?? null;
  const all = venues ?? [];
  const failed = data?.failed ?? false;
  const capacity = (v: Venue) => (seating === "SEATED" ? v.capacitySeated : v.capacityStanding) ?? 0;
  const q = query.trim().toLowerCase();

  const base = all.filter(v => (!kind || v.eventTypes.includes(kind)) && (!region || v.regionName === region) && (!q || `${v.title} ${v.location} ${v.regionName ?? ""}`.toLowerCase().includes(q)));
  const fits = base.filter(v => !guests || capacity(v) >= guests);
  const tooSmall = base.length - fits.length;
  const shown = [...fits].sort((a, b) => {
    if (sort === "price") return (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity);
    if (sort === "guests") return capacity(b) - capacity(a);
    // Best match: the tightest room that still fits, so 60 guests are not sent to a 600-guest hall first.
    if (guests) return capacity(a) - capacity(b);
    return (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity);
  });

  return (
    <section id="event-venue-results" aria-labelledby="event-venue-heading">
      <div className="flex items-end justify-between gap-3 border-0 border-b border-solid border-slate-100 pb-2.5">
        <div className="min-w-0">
          <h2 id="event-venue-heading" className="m-0 text-[15px] font-semibold tracking-tight text-slate-900">
            {kind ? `${eventLabel(kind)} venues` : "All event venues"}{region ? ` in ${region}` : ""}
          </h2>
          <p role="status" className="m-0 mt-0.5 text-xs text-slate-500">
            {venues === null ? "Loading event venues" : `${shown.length} ${shown.length === 1 ? "venue" : "venues"}${guests ? ` for ${guests} ${seating === "SEATED" ? "seated" : "standing"} guests` : ""}`}
          </p>
        </div>
        {sort !== "match" && <p className="m-0 text-xs text-slate-500">{sortOptions[sort]}</p>}
      </div>

      <div className="mt-4">
        {venues === null ? (
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:gap-5 lg:grid-cols-5">
            {Array.from({ length: 3 }).map((_, i) => <li key={i} className="h-80 animate-pulse rounded-2xl bg-slate-100" />)}
          </ul>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#02665e]/[0.07] text-[#02665e]"><PartyPopper className="h-6 w-6" aria-hidden /></span>
            <p className="m-0 mt-3 text-[15px] font-semibold text-slate-900">{failed ? "Event venues could not be loaded" : all.length === 0 ? "Event venues are coming" : "No venue fits these choices"}</p>
            <p className="m-0 mt-1 max-w-md text-[13px] text-slate-500">
              {failed ? "Please try again in a moment." : all.length === 0 ? "Spaces appear here as soon as NoLSAF approves them for events." : tooSmall ? `Nothing holds ${guests} ${seating === "SEATED" ? "seated" : "standing"} guests${kind ? " for this occasion" : ""}. Try standing, or fewer guests.` : "Try another occasion or area."}
            </p>
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:gap-5 lg:grid-cols-5">
            {shown.map((venue, index) => (
              <li key={venue.slug} className="min-w-0">
                <PublicApprovedPropertyCard
                  p={{ slug: venue.slug, title: venue.title, location: venue.location, primaryImage: venue.image, basePrice: null, currency: "TZS" }}
                  priorityImage={index === 0}
                  resultsHref={resultsHref}
                  eventVenue={{
                    fromPrice: venue.fromPrice,
                    space: SPACE_TYPES.find(space => space.key === venue.spaceType)?.label,
                    capacity: guests ? capacity(venue) : Math.max(venue.capacitySeated ?? 0, venue.capacityStanding ?? 0),
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="m-0 mt-5 flex items-start gap-2 text-sm text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
        Prices include the NoLSAF service fee. Pay after the owner confirms your date.
      </p>
    </section>
  );
}
