"use client";

// Users > Bookings: the traveller side of accommodation bookings. One row per
// customer account with their stays, what they have spent, and the stay that is
// happening now or next. Owners > Bookings remains the booking-by-booking ledger.
// Data: GET /api/admin/users/travellers (paid stays only; unpaid and cancelled excluded).

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowRight, BedDouble, CalendarClock, ChevronLeft, ChevronRight, MapPin, Repeat, Search, Sparkles, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Segment = "all" | "staying" | "arriving" | "repeat" | "new";

type Traveller = {
  ref: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  stays: number;
  spent: number;
  firstBookedAt: string | null;
  lastBookedAt: string | null;
  current: null | { bookingRef: string | null; status: string; checkIn: string; checkOut: string; amount: number; property: string | null; region: string | null };
  lastStay: null | { checkOut: string; property: string | null; region: string | null };
};

type Payload = {
  summary: { travellers: number; staying: number; arriving: number; repeat: number; new: number; walkInStays: number };
  total: number;
  page: number;
  pageSize: number;
  items: Traveller[];
};

const SEGMENTS: Array<{ key: Segment; label: string; count: keyof Payload["summary"]; Icon: typeof Users }> = [
  { key: "all", label: "All travellers", count: "travellers", Icon: Users },
  { key: "staying", label: "Staying now", count: "staying", Icon: BedDouble },
  { key: "arriving", label: "Arriving this week", count: "arriving", Icon: CalendarClock },
  { key: "repeat", label: "Repeat", count: "repeat", Icon: Repeat },
  { key: "new", label: "New this month", count: "new", Icon: Sparkles },
];

const EAT = "Africa/Dar_es_Salaam";
const tsh = (v: number) => `TSh ${Math.round(v || 0).toLocaleString("en-GB")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: EAT });
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: EAT });
const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

function stayLine(t: Traveller) {
  const c = t.current;
  if (!c) return null;
  if (c.status === "CHECKED_IN") return { tone: "bg-emerald-50 text-emerald-800", label: `Staying now, leaves ${day(c.checkOut)}` };
  const d = daysUntil(c.checkIn);
  const when = d <= 0 ? "arrives today" : d === 1 ? "arrives tomorrow" : d <= 7 ? `arrives in ${d} days` : `booked for ${day(c.checkIn)}`;
  return { tone: d <= 7 ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800", label: when.charAt(0).toUpperCase() + when.slice(1) };
}

export default function TravellersPage() {
  const [segment, setSegment] = useState<Segment>("all");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await apiClient.get<Payload>("/api/admin/users/travellers", { params: { segment, q: applied || undefined, page, pageSize } });
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Unable to load travellers");
    } finally {
      setLoading(false);
    }
  }, [segment, applied, page]);

  useEffect(() => { void load(); }, [load]);

  const s = data?.summary;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setApplied(query.trim());
  };

  return (
    <div id="travellers-page" className="w-full min-w-0 space-y-4">
      <style>{`#travellers-page, #travellers-page * { box-sizing: border-box; }`}</style>

      {/* Header band */}
      <section className="relative overflow-hidden rounded-2xl border border-solid border-emerald-950/60 bg-[#0b2420] px-5 py-5 text-white sm:px-6">
        <div className="pointer-events-none absolute inset-0" aria-hidden style={{ background: "radial-gradient(640px circle at 6% -30%, rgba(52,211,153,0.16), transparent 60%)" }} />
        <div className="relative">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200/70">Users · Bookings</p>
          <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight">Travellers</h1>
          <p className="m-0 mt-1.5 max-w-2xl text-sm leading-6 text-emerald-50/75">
            {!s
              ? "Reading who books with NoLSAF…"
              : s.travellers === 0
                ? "No traveller has a paid stay yet."
                : `${s.travellers} ${s.travellers === 1 ? "traveller has" : "travellers have"} stayed through NoLSAF. ${s.staying} ${s.staying === 1 ? "is" : "are"} staying now and ${s.arriving} ${s.arriving === 1 ? "arrives" : "arrive"} within a week.`}
          </p>
          {s && s.walkInStays > 0 ? (
            <p className="m-0 mt-1 text-xs text-emerald-100/50">{s.walkInStays} more {s.walkInStays === 1 ? "stay was" : "stays were"} booked without a traveller account and appear only in Owners, Bookings.</p>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
        {/* Segments + search */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-0 border-b border-solid border-neutral-200 px-4 sm:px-5">
          <div className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label="Traveller segments">
            {SEGMENTS.map((seg) => {
              const on = segment === seg.key;
              const n = s ? s[seg.count] : null;
              return (
                <button
                  key={seg.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => { setSegment(seg.key); setPage(1); }}
                  className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-solid bg-transparent px-3 py-3 text-[13px] font-semibold transition ${on ? "border-[#02665e] text-[#02665e]" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
                >
                  <seg.Icon className="h-4 w-4" aria-hidden />
                  {seg.label}
                  {n != null ? <span className={`rounded-full px-1.5 py-px text-[11px] tabular-nums ${on ? "bg-[#02665e]/10" : "bg-neutral-100"}`}>{n}</span> : null}
                </button>
              );
            })}
          </div>
          <form onSubmit={onSearch} className="relative mb-2 w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => { if (query.trim() !== applied) { setPage(1); setApplied(query.trim()); } }}
              placeholder="Name, email or phone"
              aria-label="Search travellers"
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
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100" />)}</div>
        ) : data && data.items.length ? (
          <ol className={`m-0 list-none divide-y divide-neutral-100 p-0 transition-opacity ${loading ? "opacity-60" : ""}`}>
            {data.items.map((t, i) => {
              const line = stayLine(t);
              const name = t.name || t.email || t.phone || "Traveller";
              return (
                <li key={t.ref ?? i} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4 sm:px-5">
                  {/* Who */}
                  <div className="flex min-w-[220px] flex-1 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#02665e]/10 text-sm font-bold text-[#02665e]">
                      {t.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        name.trim().charAt(0).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-neutral-950">{name}</span>
                        {t.stays >= 2 ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-px text-[10px] font-bold text-violet-700"><Repeat className="h-3 w-3" aria-hidden /> Repeat</span> : null}
                      </span>
                      <span className="block truncate text-xs text-neutral-500">{[t.email, t.phone].filter(Boolean).join(" · ") || "No contact on file"}</span>
                    </span>
                  </div>

                  {/* Now or next */}
                  <div className="min-w-[220px] flex-1">
                    {t.current && line ? (
                      <>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${line.tone}`}>{line.label}</span>
                        <span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-neutral-600">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
                          <span className="truncate">{[t.current.property, t.current.region].filter(Boolean).join(", ") || "Property"}</span>
                          <span className="shrink-0 text-neutral-400">· {day(t.current.checkIn)} to {day(t.current.checkOut)}</span>
                        </span>
                      </>
                    ) : t.lastStay ? (
                      <span className="block text-xs text-neutral-500">
                        Last stayed at <span className="font-medium text-neutral-700">{t.lastStay.property || "a property"}</span>
                        {t.lastStay.region ? `, ${t.lastStay.region}` : ""} · {monthYear(t.lastStay.checkOut)}
                      </span>
                    ) : (
                      <span className="block text-xs text-neutral-400">No stay in progress or finished yet</span>
                    )}
                  </div>

                  {/* History */}
                  <div className="w-[150px] shrink-0">
                    <span className="block text-sm font-semibold tabular-nums text-neutral-900">{tsh(t.spent)}</span>
                    <span className="block text-[11px] text-neutral-500">
                      {t.stays} {t.stays === 1 ? "stay" : "stays"}{t.firstBookedAt ? ` since ${monthYear(t.firstBookedAt)}` : ""}
                    </span>
                  </div>

                  {/* Go */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {t.current?.bookingRef ? (
                      <Link href={`/admin/bookings/${t.current.bookingRef}`} className="inline-flex h-8 items-center rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50 hover:no-underline">Booking</Link>
                    ) : null}
                    {t.ref ? (
                      <Link href={`/admin/users/${t.ref}`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#02665e] px-3 text-xs font-semibold text-white no-underline hover:bg-[#01544d] hover:no-underline">
                        Traveller <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="px-6 py-12 text-center">
            <p className="m-0 text-sm font-semibold text-neutral-800">{applied ? "No traveller matches that search" : "Nobody in this group right now"}</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">{applied ? "Try a name, email or phone number." : "Travellers appear here once they have a paid stay."}</p>
          </div>
        )}

        {data && data.total > data.pageSize ? (
          <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:px-5">
            <p className="m-0 text-xs text-neutral-500">
              {(data.page - 1) * data.pageSize + 1} to {Math.min(data.page * data.pageSize, data.total)} of {data.total}
            </p>
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
