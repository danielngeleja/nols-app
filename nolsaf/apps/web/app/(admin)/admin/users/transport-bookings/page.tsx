"use client";

// Users > Transport Bookings: travellers who asked for a ride with their stay, and
// whether that ride is covered. Individual stays show the real trip behind the
// booking (driver or not); group stays are arranged in the Group Stay flow.
// Data: GET /api/admin/users/transport-bookings (paid stays only).

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarClock, Car, ChevronLeft, ChevronRight, History, Search, Truck, UserRound, Users, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";

type View = "upcoming" | "past" | "cancelled" | "all";
type RideState = "awaiting_payment" | "needs_driver" | "driver_assigned" | "in_progress" | "completed" | "cancelled" | "no_trip" | "group_flow";

type Item = {
  key: string;
  kind: "group" | "individual";
  href: string | null;
  customer: { ref: string | null; name: string | null; email: string | null; phone: string | null };
  to: { place: string | null; region: string | null };
  from: string | null;
  date: string | null;
  dateEnd: string | null;
  pickupAt: string | null;
  pickupNote: string | null;
  people: number | null;
  rooms: number | null;
  groupType: string | null;
  vehicle: string | null;
  bookingStatus: string;
  ride: { state: RideState; driver: string | null };
  when: "upcoming" | "past" | "cancelled";
};

type Payload = {
  summary: { upcoming: number; thisWeek: number; needsDriver: number; groups: number; past: number; cancelled: number; all: number };
  total: number;
  page: number;
  pageSize: number;
  items: Item[];
};

const VIEWS: Array<{ key: View; label: string; count: keyof Payload["summary"]; Icon: typeof Truck }> = [
  { key: "upcoming", label: "Upcoming", count: "upcoming", Icon: CalendarClock },
  { key: "past", label: "Past", count: "past", Icon: History },
  { key: "cancelled", label: "Cancelled", count: "cancelled", Icon: XCircle },
  { key: "all", label: "All", count: "all", Icon: Truck },
];

const RIDE: Record<RideState, { label: string; tone: string }> = {
  needs_driver: { label: "Needs a driver", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  no_trip: { label: "No trip created", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
  awaiting_payment: { label: "Awaiting payment", tone: "bg-neutral-100 text-neutral-600 ring-neutral-200" },
  driver_assigned: { label: "Driver assigned", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  in_progress: { label: "On the road", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
  completed: { label: "Completed", tone: "bg-neutral-100 text-neutral-600 ring-neutral-200" },
  cancelled: { label: "Cancelled", tone: "bg-neutral-100 text-neutral-500 ring-neutral-200" },
  group_flow: { label: "Arranged in Group Stay", tone: "bg-violet-50 text-violet-800 ring-violet-200" },
};

const EAT = "Africa/Dar_es_Salaam";
const eatDay = (iso: string | number | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: EAT });
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-GB", { ...o, timeZone: EAT });
/** Shared row grid. The list scrolls sideways on narrow screens instead of squeezing columns. */
const ROW_GRID = "grid grid-cols-[56px_minmax(190px,1fr)_96px_minmax(260px,1.4fr)_minmax(200px,0.9fr)_auto] items-center gap-x-6";
/** "MEMBE" or "dodoma" -> "Membe", "Dodoma"; keeps mixed-case names as they are. */
const smartCase = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);
const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Day buckets for the upcoming view, counted in EAT. */
function bucket(iso: string | null) {
  if (!iso) return "Flexible dates";
  const d = eatDay(iso);
  const today = eatDay(Date.now());
  const tomorrow = eatDay(Date.now() + 86_400_000);
  if (d === today) return "Today";
  if (d === tomorrow) return "Tomorrow";
  if (new Date(iso).getTime() - Date.now() < 7 * 86_400_000) return "This week";
  return "Later";
}

export default function TransportBookingsPage() {
  const [view, setView] = useState<View>("upcoming");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await apiClient.get<Payload>("/api/admin/users/transport-bookings", { params: { view, q: applied || undefined, page, pageSize } });
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.error === "failed" ? "Unable to load transport requests" : e?.response?.data?.error || "Unable to load transport requests");
    } finally {
      setLoading(false);
    }
  }, [view, applied, page]);

  useEffect(() => { void load(); }, [load]);

  const s = data?.summary;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // Upcoming reads as a schedule: Today, Tomorrow, This week, Later, Flexible dates.
  const groups = useMemo(() => {
    const items = data?.items ?? [];
    if (view !== "upcoming") return [{ label: null as string | null, items }];
    const out: Array<{ label: string | null; items: Item[] }> = [];
    for (const it of items) {
      const label = bucket(it.date);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(it);
      else out.push({ label, items: [it] });
    }
    return out;
  }, [data, view]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setApplied(query.trim());
  };

  return (
    <div id="transport-requests" className="w-full min-w-0 space-y-4">
      <style>{`#transport-requests, #transport-requests * { box-sizing: border-box; }`}</style>

      {/* Header band */}
      <section className="relative overflow-hidden rounded-2xl border border-solid border-emerald-950/60 bg-[#0b2420] px-5 py-5 text-white sm:px-6">
        <div className="pointer-events-none absolute inset-0" aria-hidden style={{ background: "radial-gradient(640px circle at 6% -30%, rgba(52,211,153,0.16), transparent 60%)" }} />
        <div className="relative">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200/70">Users · Transport</p>
          <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight">Rides with stays</h1>
          <p className="m-0 mt-1.5 max-w-2xl text-sm leading-6 text-emerald-50/75">
            {!s
              ? "Reading transport requests…"
              : s.upcoming === 0
                ? "No upcoming stay has a ride requested."
                : `${s.upcoming} upcoming ${s.upcoming === 1 ? "stay has" : "stays have"} a ride requested, ${s.thisWeek} within the next week.`}
            {s && s.needsDriver > 0 ? <span className="font-semibold text-amber-200"> {s.needsDriver} still {s.needsDriver === 1 ? "has" : "have"} no driver.</span> : null}
          </p>
          {s ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { label: "Next 7 days", value: s.thisWeek, hot: false },
                { label: "Need a driver", value: s.needsDriver, hot: s.needsDriver > 0 },
                { label: "Group stays", value: s.groups, hot: false },
              ].map((t) => (
                <span key={t.label} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] ${t.hot ? "bg-amber-300/15 text-amber-100" : "bg-white/[0.05] text-emerald-50/70"}`}>
                  <span className="text-base font-bold tabular-nums text-white">{t.value}</span>
                  {t.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
        {/* Views + search */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-0 border-b border-solid border-neutral-200 px-4 sm:px-5">
          <div className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label="Transport views">
            {VIEWS.map((v) => {
              const on = view === v.key;
              const n = s ? s[v.count] : null;
              return (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => { setView(v.key); setPage(1); }}
                  className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-solid bg-transparent px-3 py-3 text-[13px] font-semibold transition ${on ? "border-[#02665e] text-[#02665e]" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
                >
                  <v.Icon className="h-4 w-4" aria-hidden />
                  {v.label}
                  {n != null ? <span className={`rounded-full px-1.5 py-px text-[11px] tabular-nums ${on ? "bg-[#02665e]/10" : "bg-neutral-100"}`}>{n}</span> : null}
                </button>
              );
            })}
          </div>
          <form onSubmit={onSearch} className="relative mb-2 w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => { if (query.trim() !== applied) { setPage(1); setApplied(query.trim()); } }}
              placeholder="Traveller, property, region or pickup"
              aria-label="Search transport requests"
              className="h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#02665e]/50"
            />
          </form>
        </div>

        {error ? (
          <div className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-rose-700">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="cursor-pointer rounded-lg border border-solid border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700">Retry</button>
          </div>
        ) : loading && !data ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-100" />)}</div>
        ) : data && data.items.length ? (
          <div className={`overflow-x-auto overscroll-x-contain [scrollbar-width:thin] transition-opacity ${loading ? "opacity-60" : ""}`}>
           <div className="min-w-[1120px]">
            <div className={`${ROW_GRID} border-0 border-b border-solid border-neutral-100 px-5 py-2 text-[11px] font-semibold text-neutral-500`}>
              <span>Date</span>
              <span>Traveller</span>
              <span>Pickup</span>
              <span>Route</span>
              <span>Ride</span>
              <span className="text-right">Open</span>
            </div>
            {groups.map((g, gi) => (
              <div key={g.label ?? gi}>
                {g.label ? (
                  <p className="m-0 border-0 border-b border-solid border-neutral-100 bg-neutral-50/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
                    {g.label} <span className="font-medium normal-case tracking-normal text-neutral-400">· {g.items.length}</span>
                  </p>
                ) : null}
                <ol className="m-0 list-none divide-y divide-neutral-100 p-0">
                  {g.items.map((it) => {
                    const ride = RIDE[it.ride.state];
                    const who = it.customer.name || it.customer.email || it.customer.phone || "Traveller";
                    const pickupTime = it.pickupAt
                      ? it.kind === "individual" ? fmt(it.pickupAt, { hour: "2-digit", minute: "2-digit" }) : it.pickupAt
                      : null;
                    const nights = it.date && it.dateEnd ? Math.max(1, Math.round((new Date(it.dateEnd).getTime() - new Date(it.date).getTime()) / 86_400_000)) : null;
                    const destination = [it.to.place ? smartCase(it.to.place) : null, it.to.region ? smartCase(it.to.region) : null].filter(Boolean).join(", ");
                    return (
                      <li key={it.key} className={`${ROW_GRID} px-4 py-4 transition-colors hover:bg-neutral-50/70 sm:px-5`}>
                        {/* When */}
                        <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl text-center ${it.date ? "bg-[#02665e]/[0.07] text-[#02665e]" : "border border-dashed border-neutral-200 text-neutral-400"}`}>
                          {it.date ? (
                            <span>
                              <span className="block text-lg font-bold leading-none tabular-nums">{fmt(it.date, { day: "numeric" })}</span>
                              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide">{fmt(it.date, { month: "short" }).slice(0, 3)}</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold leading-tight">Any<br />date</span>
                          )}
                        </div>

                        {/* Who */}
                        <div className="min-w-0">
                          <p className="m-0 truncate text-sm font-semibold text-neutral-950">{who}</p>
                          <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{it.customer.phone || it.customer.email || "No contact on file"}</p>
                          <span className={`mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${it.kind === "group" ? "bg-violet-50 text-violet-700" : "bg-neutral-100 text-neutral-600"}`}>
                            {it.kind === "group" ? <Users className="h-3 w-3" aria-hidden /> : <Car className="h-3 w-3" aria-hidden />}
                            {it.kind === "group"
                              ? `${titleCase(it.groupType || "Group")}${it.people ? ` · ${it.people} people` : ""}`
                              : `Single stay${it.rooms && it.rooms > 1 ? ` · ${it.rooms} rooms` : ""}${it.vehicle ? ` · ${titleCase(it.vehicle.toLowerCase())}` : ""}`}
                          </span>
                        </div>

                        {/* Pickup time */}
                        <div className="min-w-0">
                          {pickupTime ? (
                            <>
                              <p className="m-0 text-sm font-semibold tabular-nums text-neutral-900">{pickupTime}</p>
                              <p className="m-0 mt-0.5 text-[11px] text-neutral-400">{it.kind === "individual" ? "EAT" : "Requested"}</p>
                            </>
                          ) : (
                            <p className="m-0 text-xs text-neutral-400">Time not set</p>
                          )}
                        </div>

                        {/* The trip: pickup to destination */}
                        <div className="min-w-0">
                          <div className="relative pl-5">
                            <span className="absolute left-[5px] top-[9px] h-[calc(100%-18px)] w-px border-0 border-l border-dashed border-neutral-300" aria-hidden />
                            <p className="relative m-0 flex min-w-0 items-baseline gap-2 text-[13px]">
                              <span className="absolute -left-5 top-[5px] h-2.5 w-2.5 rounded-full border-2 border-solid border-[#02665e] bg-white" aria-hidden />
                              <span className="truncate text-neutral-600">{it.pickupNote || it.from || "Pickup point not set"}</span>
                            </p>
                            <p className="relative m-0 mt-2 flex min-w-0 items-center gap-1.5 text-[13px]">
                              <span className="absolute -left-5 top-[4px] h-2.5 w-2.5 rounded-full bg-[#02665e]" aria-hidden />
                              <span className="truncate font-medium text-neutral-900">{destination || "Destination not set"}</span>
                            </p>
                          </div>
                        </div>

                        {/* Ride and stay */}
                        <div className="min-w-0">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${ride.tone}`}>{ride.label}</span>
                          <p className="m-0 mt-1.5 truncate text-[11px] text-neutral-500">
                            {it.ride.driver
                              ? `Driver: ${it.ride.driver}`
                              : it.date && it.dateEnd
                                ? `Stay ${fmt(it.date, { day: "numeric", month: "short" })} to ${fmt(it.dateEnd, { day: "numeric", month: "short" })}${nights ? ` · ${nights} ${nights === 1 ? "night" : "nights"}` : ""}`
                                : "Dates flexible"}
                          </p>
                        </div>

                        {/* Go */}
                        <div className="flex items-center justify-end gap-1.5">
                          {it.customer.ref ? (
                            <Link href={`/admin/users/${it.customer.ref}`} title="Open traveller" aria-label="Open traveller" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-600 no-underline hover:bg-neutral-50 hover:text-neutral-900">
                              <UserRound className="h-4 w-4" aria-hidden />
                            </Link>
                          ) : null}
                          {it.href ? (
                            <Link href={it.href} className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg bg-[#02665e] px-3 text-xs font-semibold text-white no-underline hover:bg-[#01544d] hover:no-underline">
                              {it.kind === "group" ? "Group stay" : "Booking"} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
           </div>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <p className="m-0 text-sm font-semibold text-neutral-800">{applied ? "Nothing matches that search" : view === "upcoming" ? "No upcoming rides requested" : "Nothing here"}</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">Requests appear once a stay with transport is paid.</p>
          </div>
        )}

        {data && data.total > data.pageSize ? (
          <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:px-5">
            <p className="m-0 text-xs text-neutral-500">{(data.page - 1) * data.pageSize + 1} to {Math.min(data.page * data.pageSize, data.total)} of {data.total}</p>
            <div className="flex gap-1.5">
              <button type="button" aria-disabled={page <= 1} onClick={() => page > 1 && setPage(page - 1)} className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-700 ${page <= 1 ? "opacity-40" : "hover:bg-neutral-50"}`}>
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous
              </button>
              <button type="button" aria-disabled={page >= totalPages} onClick={() => page < totalPages && setPage(page + 1)} className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-700 ${page >= totalPages ? "opacity-40" : "hover:bg-neutral-50"}`}>
                Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
