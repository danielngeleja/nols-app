"use client";

/**
 * Event calendar as an occupancy board: one row per venue, one column per
 * day of the month, so an admin sees at a glance which space is taken,
 * held or closed on which day. A mini month and a day panel sit beside it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { clock, errorText, label, span, useWorkspaceRefresh, when } from "./eventAdmin";
import { BookingDrawer } from "./AdminEventBookings";
import { Empty, ErrorNote } from "./ui";

type Kind = "BOOKING" | "BLOCK" | "HOLD";
type Entry = { reference: string; title: string; startsAt: string; endsAt: string; status: string; kind: Kind; expiresAt?: string };

const TZ = "Africa/Dar_es_Salaam";
const keyOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const utcKey = (d: Date) => d.toISOString().slice(0, 10);
const nice = (k: string, o: Intl.DateTimeFormatOptions) => new Date(`${k}T12:00:00+03:00`).toLocaleDateString("en-GB", { ...o, timeZone: TZ });
const RANK: Record<Kind, number> = { BOOKING: 3, HOLD: 2, BLOCK: 1 };
const KIND: Record<Kind, { name: string; long: string; cell: string; dot: string }> = {
  BOOKING: { name: "Paid", long: "Paid booking", cell: "bg-[#02665e] text-white", dot: "bg-[#02665e]" },
  HOLD: { name: "Holds", long: "Checkout hold", cell: "bg-amber-300 text-amber-950", dot: "bg-amber-400" },
  BLOCK: { name: "Closures", long: "Owner closure", cell: "bg-neutral-300 text-neutral-700", dot: "bg-neutral-400" },
};

/** Every EAT calendar day an entry touches. */
function daysOf(e: Entry) {
  const out: string[] = [];
  const end = keyOf(new Date(new Date(e.endsAt).getTime() - 1));
  const cursor = new Date(e.startsAt);
  for (let i = 0; i < 62 && keyOf(cursor) <= end; i++) { out.push(keyOf(cursor)); cursor.setTime(cursor.getTime() + 86400000); }
  return out.length ? out : [keyOf(new Date(e.startsAt))];
}

export default function AdminEventCalendar() {
  const today = keyOf(new Date());
  const [ym, setYm] = useState(() => today.slice(0, 7));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [venues, setVenues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<string>(today);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ BOOKING: true, HOLD: true, BLOCK: true });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [y, m] = ym.split("-").map(Number);
      const r = await apiClient.get("/api/admin/event-hire/operations/calendar", { params: { from: `${ym}-01T00:00:00+03:00`, to: new Date(Date.UTC(y, m, 1) - 3 * 3600000).toISOString() } });
      setEntries(r.data.events); setTruncated(r.data.truncated);
    } catch (e) { setError(errorText(e, "Could not load the calendar.")); setEntries([]); }
    finally { setLoading(false); }
  }, [ym]);
  useEffect(() => { void load(); }, [load]);
  useWorkspaceRefresh(useCallback(() => { void load(); }, [load]));
  // Live venues give the board its rows even in a quiet month.
  useEffect(() => {
    void apiClient.get("/api/admin/event-hire", { params: { status: "APPROVED" } })
      .then(r => setVenues((r.data?.items ?? []).map((v: { propertyTitle?: string }) => v.propertyTitle || "Event venue")))
      .catch(() => setVenues([]));
  }, []);

  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const go = (nextYm: string, day?: string) => { setYm(nextYm); setSelected(day ?? (today.startsWith(nextYm) ? today : `${nextYm}-01`)); };
  const shift = (delta: number) => go(utcKey(new Date(Date.UTC(y, m - 1 + delta, 1))).slice(0, 7));

  const shown = useMemo(() => entries.filter(e => kinds[e.kind]), [entries, kinds]);
  const { board, byDay } = useMemo(() => {
    const board = new Map<string, Map<string, Entry[]>>();
    const byDay = new Map<string, Entry[]>();
    for (const e of shown) {
      const row = board.get(e.title) ?? new Map<string, Entry[]>();
      for (const k of daysOf(e)) { row.set(k, [...(row.get(k) ?? []), e]); byDay.set(k, [...(byDay.get(k) ?? []), e]); }
      board.set(e.title, row);
    }
    return { board, byDay };
  }, [shown]);
  const rows = useMemo(() => {
    const names = [...new Set([...board.keys(), ...venues])];
    const booked = (n: string) => days.filter(d => (board.get(n)?.get(d) ?? []).some(e => e.kind === "BOOKING")).length;
    return names.map(n => ({ name: n, booked: booked(n), cells: board.get(n) })).sort((a, b) => b.booked - a.booked || a.name.localeCompare(b.name));
  }, [board, venues, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = { BOOKING: entries.filter(e => e.kind === "BOOKING").length, HOLD: entries.filter(e => e.kind === "HOLD").length, BLOCK: entries.filter(e => e.kind === "BLOCK").length };
  const bookedDays = days.filter(d => (byDay.get(d) ?? []).some(e => e.kind === "BOOKING")).length;
  const capacity = rows.length * daysInMonth;
  const occupancy = capacity ? Math.round((rows.reduce((n, r) => n + r.booked, 0) / capacity) * 100) : 0;
  const dayList = (byDay.get(selected) ?? []).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const freeVenues = rows.filter(r => !(r.cells?.get(selected)?.length)).length;

  // Monday-first mini month.
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const mini = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) => (i >= lead && i < lead + daysInMonth ? days[i - lead] : null));

  return (
    <div className="space-y-3">
      {/* Toolbar with the month's figures */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2">
        <div className="flex items-center overflow-hidden rounded-md border border-solid border-neutral-200">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="grid h-8 w-8 place-items-center border-0 bg-white text-neutral-600 hover:bg-neutral-50"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[8.5rem] border-0 border-x border-solid border-neutral-200 px-2 text-center text-[13px] font-semibold leading-8 text-neutral-900">{monthName}</span>
          <button type="button" onClick={() => shift(1)} aria-label="Next month" className="grid h-8 w-8 place-items-center border-0 bg-white text-neutral-600 hover:bg-neutral-50"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <button type="button" onClick={() => go(today.slice(0, 7), today)} className="h-8 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">Today</button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" aria-label="Loading" />}
        <div className="mx-1 hidden h-6 w-px bg-neutral-200 md:block" aria-hidden />
        <dl className="m-0 hidden items-center gap-4 md:flex">
          {[{ t: "Venue occupancy", v: `${occupancy}%` }, { t: "Days with events", v: `${bookedDays}/${daysInMonth}` }, { t: "Live venues", v: String(rows.length) }].map(s => (
            <div key={s.t} className="flex items-baseline gap-1.5"><dd className="m-0 text-[14px] font-bold tabular-nums text-neutral-900">{s.v}</dd><dt className="text-[11px] text-neutral-500">{s.t}</dt></div>
          ))}
        </dl>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Show on calendar">
          {(Object.keys(KIND) as Kind[]).map(k => (
            <button key={k} type="button" aria-pressed={kinds[k]} title={KIND[k].long} onClick={() => setKinds(v => ({ ...v, [k]: !v[k] }))}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border border-solid px-2.5 text-[11px] font-semibold ${kinds[k] ? "border-neutral-200 bg-white text-neutral-700" : "border-transparent bg-neutral-100 text-neutral-400 line-through"}`}>
              <span className={`h-2 w-2 rounded-full ${KIND[k].dot}`} aria-hidden />{KIND[k].name}<span className="tabular-nums text-neutral-400">{totals[k]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[16.5rem_minmax(0,1fr)]">
        {/* Mini month + the chosen day */}
        <div className="min-w-0 space-y-3">
          <section className="rounded-lg border border-solid border-neutral-200 bg-white p-2.5">
            <div className="grid grid-cols-7 gap-0.5">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="py-1 text-center text-[10px] font-semibold text-neutral-400">{d}</span>)}
              {mini.map((k, i) => {
                if (!k) return <span key={`x${i}`} />;
                const list = byDay.get(k) ?? [];
                const top = list.reduce<Kind | null>((t, e) => (!t || RANK[e.kind] > RANK[t] ? e.kind : t), null);
                const sel = k === selected;
                return (
                  <button key={k} type="button" onClick={() => setSelected(k)} aria-pressed={sel} aria-label={`${nice(k, { day: "numeric", month: "long" })}, ${list.length} entries`}
                    className={`relative grid h-8 place-items-center rounded-md border-0 text-[12px] font-semibold tabular-nums ${sel ? "bg-[#0b2420] text-white" : k === today ? "bg-[#02665e]/10 text-[#02665e]" : k < today ? "bg-transparent text-neutral-400 hover:bg-neutral-100" : "bg-transparent text-neutral-700 hover:bg-neutral-100"}`}>
                    {Number(k.slice(8))}
                    {top && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${sel ? "bg-emerald-300" : KIND[top].dot}`} aria-hidden />}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
            <div className="border-0 border-b border-solid border-neutral-100 px-3 py-2">
              <p className="m-0 text-[13px] font-semibold text-neutral-900">{nice(selected, { weekday: "long", day: "numeric", month: "long" })}</p>
              <p className="m-0 text-[11px] text-neutral-500">{dayList.length ? `${dayList.length} ${dayList.length === 1 ? "entry" : "entries"} · ` : ""}{rows.length ? `${freeVenues} of ${rows.length} venues free` : "No live venues yet"}</p>
            </div>
            {dayList.length === 0 ? (
              <p className="m-0 px-3 py-3 text-[12px] text-neutral-500">Nothing reserved. Every venue can take a request for this day.</p>
            ) : (
              <ul className="m-0 max-h-[22rem] list-none overflow-y-auto p-0">
                {dayList.map(e => (
                  <li key={`${e.kind}${e.reference}`} className="border-0 border-t border-solid border-neutral-100 first:border-t-0">
                    <button type="button" disabled={e.kind !== "BOOKING"} onClick={() => setOpenRef(e.reference)} className="flex w-full items-start gap-2 border-0 bg-white px-3 py-2 text-left enabled:hover:bg-neutral-50 disabled:cursor-default">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND[e.kind].dot}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[12.5px] font-semibold text-neutral-900">{e.title}</strong>
                        <span className="block text-[11px] text-neutral-500">{span(e.startsAt, e.endsAt)}</span>
                        <span className="block text-[11px] text-neutral-400">{KIND[e.kind].long} · {label(e.status)}{e.expiresAt ? ` · held until ${when(e.expiresAt)}` : ""}</span>
                      </span>
                      {e.kind === "BOOKING" && <span className="shrink-0 text-[11px] font-semibold text-[#02665e]">Open</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Occupancy board: venues down, days across */}
        <section className="min-w-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white" aria-busy={loading}>
          <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
            <p className="m-0 text-[13px] font-semibold text-neutral-900">Venue occupancy</p>
            <p className="m-0 text-[11px] text-neutral-500">Click a day to see it. Click a paid day to open the booking.</p>
          </div>
          {rows.length === 0 ? (
            <Empty icon={<Building2 className="h-5 w-5" />} title="No live venues yet">Approved event venues appear here as rows, with each day of the month showing whether the space is booked, held or closed.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-max" style={{ gridTemplateColumns: `minmax(11rem,13rem) repeat(${daysInMonth}, minmax(1.75rem,1fr)) 3.25rem` }}>
                {/* Header row */}
                <div className="sticky left-0 z-10 border-0 border-b border-r border-solid border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[10.5px] font-semibold text-neutral-500">Venue</div>
                {days.map(d => {
                  const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
                  return (
                    <button key={d} type="button" onClick={() => setSelected(d)} className={`flex flex-col items-center border-0 border-b border-solid border-neutral-200 py-1 ${d === selected ? "bg-[#0b2420] text-white" : d === today ? "bg-[#02665e]/10 text-[#02665e]" : wd === 0 || wd === 6 ? "bg-neutral-100 text-neutral-500" : "bg-neutral-50 text-neutral-600"}`}>
                      <span className="text-[9px] font-semibold opacity-70">{"SMTWTFS"[wd]}</span>
                      <span className="text-[11px] font-bold tabular-nums leading-tight">{Number(d.slice(8))}</span>
                    </button>
                  );
                })}
                <div className="border-0 border-b border-l border-solid border-neutral-200 bg-neutral-50 py-1.5 text-center text-[10.5px] font-semibold text-neutral-500" title="Days booked this month">Days</div>

                {/* Venue rows */}
                {rows.map(r => (
                  <div key={r.name} className="contents">
                    <div className="sticky left-0 z-10 flex min-w-0 items-center border-0 border-b border-r border-solid border-neutral-100 bg-white px-3 py-1.5">
                      <span className="truncate text-[12px] font-medium text-neutral-800" title={r.name}>{r.name}</span>
                    </div>
                    {days.map(d => {
                      const list = r.cells?.get(d) ?? [];
                      const top = list.reduce<Entry | null>((t, e) => (!t || RANK[e.kind] > RANK[t.kind] ? e : t), null);
                      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
                      return (
                        <button key={d} type="button"
                          title={top ? `${nice(d, { day: "numeric", month: "short" })}: ${list.map(e => `${KIND[e.kind].long} ${clock(e.startsAt)}`).join(", ")}` : `${nice(d, { day: "numeric", month: "short" })}: free`}
                          onClick={() => { setSelected(d); if (top?.kind === "BOOKING") setOpenRef(top.reference); }}
                          className={`h-9 border-0 border-b border-solid border-neutral-100 p-[3px] ${d === selected ? "bg-[#02665e]/[0.07]" : wd === 0 || wd === 6 ? "bg-neutral-50" : "bg-white"} hover:bg-neutral-100`}>
                          {top ? <span className={`grid h-full w-full place-items-center rounded-[4px] text-[9px] font-bold ${KIND[top.kind].cell}`}>{list.length > 1 ? list.length : ""}</span> : <span className={`block h-full w-full rounded-[4px] ${d < today ? "" : "border border-dashed border-neutral-200"}`} />}
                        </button>
                      );
                    })}
                    <div className="flex items-center justify-center border-0 border-b border-l border-solid border-neutral-100 text-[12px] font-bold tabular-nums text-neutral-800">{r.booked}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-0 border-t border-solid border-neutral-100 px-3 py-2 text-[11px] text-neutral-500">
            {(Object.keys(KIND) as Kind[]).map(k => <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded-[3px] ${KIND[k].cell}`} aria-hidden />{KIND[k].long}</span>)}
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] border border-dashed border-neutral-300" aria-hidden />Open for requests</span>
            {truncated && <span className="text-amber-700">More entries exist than the board can show.</span>}
            <span className="ml-auto inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />East Africa Time</span>
          </div>
        </section>
      </div>

      {openRef && <BookingDrawer key={openRef} reference={openRef} onClose={() => setOpenRef(null)} />}
    </div>
  );
}
