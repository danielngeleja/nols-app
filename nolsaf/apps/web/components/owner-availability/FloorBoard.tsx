"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Plus, X } from "lucide-react";
import { BoardSkeleton, BoardTilesSkeleton } from "./Skeleton";
import apiClient from "@/lib/apiClient";

/**
 * Floor-by-floor room board for the owner's availability page. It reuses the
 * property's floor plan (GET /owner/properties/:id/layout) and the per-room
 * availability for the chosen window (GET /owner/properties/:id/availability),
 * so the rooms here are exactly the rooms on the floor plan.
 */

type RoomNode = { id: string; name: string; code: string; pricePerNight?: number };
type Floor = { id: string; label: string; rooms: RoomNode[] };
type Layout = { floors: Floor[] };
type RoomAv = {
  code: string;
  occupancyPct: number;
  nightsBooked: number;
  nightsBlocked?: number;
  nightsOccupied?: number;
  nightsTotal: number;
  bookings: { id: number; checkIn: string; checkOut: string; status: string; guestName: string | null }[];
  blocks?: { id: number; startDate: string; endDate: string; source: string | null; nights: number }[];
};

const fmtDay = (v: string) => new Date(v).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short" });
const sourceLabel = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "External");

/** Room type from the floor-plan name ("Family 3" -> "Family"), and the room number. */
const typeName = (r: RoomNode) => String(r.name || r.code).replace(/\s+\d+$/, "").trim();
const roomNumber = (r: RoomNode) => /(\d+)$/.exec(String(r.name || r.code))?.[1] ?? r.code;
const FALLBACK_COLORS = ["#fbbf24", "#38bdf8", "#a78bfa", "#fb7185", "#fb923c", "#22d3ee"];

function stateOf(av?: RoomAv): { key: "free" | "partly" | "booked" | "blocked" | "full"; label: string } {
  if (!av || av.occupancyPct <= 0) return { key: "free", label: "Free" };
  const booked = av.nightsBooked > 0;
  const blocked = (av.nightsBlocked ?? 0) > 0;
  if (av.occupancyPct >= 100) return { key: "full", label: booked && !blocked ? "Fully booked" : blocked && !booked ? "Blocked" : "Full" };
  if (booked && !blocked) return { key: "booked", label: `${av.occupancyPct}% booked` };
  if (blocked && !booked) return { key: "blocked", label: `${av.occupancyPct}% blocked` };
  return { key: "partly", label: `${av.occupancyPct}% taken` };
}


export default function FloorBoard({
  propertyId,
  from,
  to,
  refreshKey = 0,
  onBlockRoom,
  typeColors,
}: {
  propertyId: number;
  from: string;
  to: string;
  refreshKey?: number;
  /** Opens the external booking form for this physical room. */
  onBlockRoom?: (room: { code: string; name: string }) => void;
  /** Room type (lower-case) to colour, so the board matches the page's room-type filters. */
  typeColors?: Record<string, string>;
}) {
  const [layout, setLayout] = useState<Layout | null | undefined>(undefined);
  const [rooms, setRooms] = useState<Record<string, RoomAv>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(propertyId) || propertyId <= 0) return;
    let alive = true;
    apiClient
      .get<Layout | null>(`/api/owner/properties/${propertyId}/layout`)
      .then((r) => {
        if (!alive) return;
        const l = r.data && Array.isArray(r.data.floors) ? r.data : null;
        setLayout(l);
        if (l?.floors?.length) setFloorId((cur) => cur ?? (l.floors.find((fl) => fl.rooms?.length > 0) ?? l.floors[0]).id);
      })
      .catch(() => alive && setLayout(null));
    return () => { alive = false; };
  }, [propertyId]);

  useEffect(() => {
    if (!layout || !from || !to || to <= from) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiClient
      .get<{ rooms: RoomAv[] }>(`/api/owner/properties/${propertyId}/availability`, { params: { from, to } })
      .then((r) => {
        if (!alive) return;
        const map: Record<string, RoomAv> = {};
        for (const it of r.data?.rooms ?? []) map[it.code] = it;
        setRooms(map);
      })
      .catch((e: any) => alive && setError(e?.response?.data?.error || "Room availability could not be loaded."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [layout, propertyId, from, to, refreshKey]);

  const floors = useMemo(() => layout?.floors ?? [], [layout]);
  const floor = floors.find((f) => f.id === floorId) ?? floors[0];

  // One colour per room type: the page's own palette when given, otherwise by order of appearance.
  const typeOrder: string[] = [];
  for (const f of floors) for (const r of f.rooms) {
    const t = typeName(r);
    if (!typeOrder.includes(t)) typeOrder.push(t);
  }
  const colorOf = (t: string) =>
    typeColors?.[t.toLowerCase()] ?? FALLBACK_COLORS[Math.max(0, typeOrder.indexOf(t)) % FALLBACK_COLORS.length];

  const visibleRooms = (floor?.rooms ?? []).filter((r) => !typeFilter || typeName(r) === typeFilter);
  const typeCounts = new Map<string, { total: number; free: number }>();
  for (const r of floor?.rooms ?? []) {
    const t = typeName(r);
    const e = typeCounts.get(t) ?? { total: 0, free: 0 };
    e.total += 1;
    if (!rooms[r.code] || rooms[r.code].occupancyPct <= 0) e.free += 1;
    typeCounts.set(t, e);
  }
  const floorTypes = [...typeCounts.entries()];

  const openRoom = floor?.rooms.find((r) => r.code === openCode) ?? null;
  const openAv = openCode ? rooms[openCode] : undefined;
  const floorFree = (f: Floor) => f.rooms.filter((r) => !rooms[r.code] || rooms[r.code].occupancyPct <= 0).length;

  if (layout === undefined) {
    return <BoardSkeleton />;
  }

  if (!layout || floors.length === 0) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-white/15 bg-[#012a26] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-[#5eead4]">
            <Building2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="m-0 text-sm font-bold text-white">No floor plan yet</p>
            <p className="m-0 mt-0.5 text-xs text-white/55">Set up the floor plan once and every room appears here, floor by floor.</p>
          </div>
        </div>
        <Link href={`/owner/properties/${propertyId}/layout`} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5eead4] px-4 text-sm font-bold text-[#012a26] no-underline hover:bg-[#8ff3e1]">
          Open floor plan <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#012a26] shadow-[0_18px_40px_-28px_rgba(1,42,38,0.8)]">
      {/* Head */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <p className="m-0 text-sm font-bold text-white">Rooms by floor</p>
          <p className="m-0 mt-0.5 text-xs text-white/55">From your floor plan. Tap a room to see who is in it, or block it.</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-semibold text-white/60">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#5eead4]" aria-hidden />Free</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />Booked</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-white/45" aria-hidden />Blocked</span>
        </div>
      </div>

      {/* Floors: runs of empty floors collapse into one quiet chip */}
      {floors.length > 1 ? (() => {
        const items: Array<{ kind: "floor"; f: Floor } | { kind: "empty"; from: string; to: string; count: number }> = [];
        for (const f of floors) {
          const last = items[items.length - 1];
          if (f.rooms.length === 0) {
            if (last && last.kind === "empty") { last.to = f.label; last.count += 1; }
            else items.push({ kind: "empty", from: f.label, to: f.label, count: 1 });
          } else items.push({ kind: "floor", f });
        }
        return (
          <nav className="flex flex-wrap gap-1.5 px-4 pb-3" aria-label="Floors">
            {items.map((it) => {
              if (it.kind === "empty") {
                return (
                  <span
                    key={`empty-${it.from}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-white/10 px-3 py-1.5 text-xs font-semibold text-white/35"
                    title="These floors have no rooms on the floor plan"
                  >
                    {it.count === 1 ? it.from : `${it.from} to ${it.to}`}
                    <span className="font-normal">· empty</span>
                  </span>
                );
              }
              const f = it.f;
              const on = f.id === floor?.id;
              const free = floorFree(f);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { setFloorId(f.id); setOpenCode(null); setTypeFilter(null); }}
                  aria-current={on ? "true" : undefined}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                    on ? "border-[#5eead4] bg-[#5eead4] text-[#012a26]" : "border-white/10 bg-white/[0.04] text-white/85 hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  {f.label}
                  <span
                    className={`rounded-md px-1.5 py-px text-[11px] font-bold tabular-nums ${
                      on ? "bg-[#012a26]/10 text-[#012a26]" : free === 0 ? "bg-amber-400/15 text-amber-300" : "bg-white/10 text-white/60"
                    }`}
                    title={`${free} of ${f.rooms.length} rooms free`}
                  >
                    {free}/{f.rooms.length}
                  </span>
                </button>
              );
            })}
          </nav>
        );
      })() : null}

      {/* Room types on this floor, also a filter */}
      {floorTypes.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-0 border-t border-white/10 px-4 py-3">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Room types</span>
          {floorTypes.map(([t, c]) => {
            const on = typeFilter === t;
            const color = colorOf(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(on ? null : t)}
                aria-pressed={on}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  on ? "text-white" : "border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/[0.08] hover:text-white"
                }`}
                style={on ? { borderColor: color, backgroundColor: `${color}2e` } : undefined}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 0 3px ${color}26` }} aria-hidden />
                {t}
                <span className="rounded-md bg-white/10 px-1.5 py-px text-[11px] font-bold tabular-nums text-white/70">{c.free}/{c.total}</span>
              </button>
            );
          })}
          {typeFilter ? (
            <button type="button" onClick={() => setTypeFilter(null)} className="rounded-full border-0 bg-transparent px-2 py-1 text-xs font-semibold text-[#5eead4] hover:underline">
              Show all
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="border-0 border-t border-white/10 p-4 sm:p-5">
        {error ? <p className="m-0 mb-3 rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</p> : null}
        {loading && Object.keys(rooms).length === 0 ? (
          <BoardTilesSkeleton count={Math.max(6, Math.min(18, visibleRooms.length || 12))} />
        ) : visibleRooms.length === 0 ? (
          <p className="m-0 py-8 text-center text-sm text-white/55">No rooms on this floor.</p>
        ) : (
          <ul className={`m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
            {visibleRooms.map((room) => {
              const av = rooms[room.code];
              const st = stateOf(av);
              const t = typeName(room);
              const color = colorOf(t);
              const total = av?.nightsTotal || 1;
              const bookedPct = av ? Math.min(100, Math.round((av.nightsBooked / total) * 100)) : 0;
              const blockedPct = av ? Math.min(100 - bookedPct, Math.round(((av.nightsBlocked ?? 0) / total) * 100)) : 0;
              const on = openCode === room.code;
              const pill =
                st.key === "free" ? "bg-[#5eead4]/15 text-[#5eead4]"
                  : st.key === "blocked" ? "bg-white/10 text-white/70"
                    : "bg-amber-400/15 text-amber-300";
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    onClick={() => setOpenCode(on ? null : room.code)}
                    aria-pressed={on}
                    className={`group relative flex h-full w-full flex-col overflow-hidden rounded-xl border p-3 text-left transition ${
                      st.key === "full" ? "bg-amber-400/[0.08]" : "bg-white/[0.04] hover:bg-white/[0.07]"
                    }`}
                    style={{ borderColor: on ? color : `${color}40`, boxShadow: on ? `0 0 0 1px ${color}` : undefined }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                        <span className="truncate text-[11px] font-semibold" style={{ color }}>{t}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold ${pill}`}>
                        {st.key === "free" ? "Free" : st.key === "blocked" ? "Blocked" : st.key === "full" ? "Full" : `${av?.occupancyPct ?? 0}%`}
                      </span>
                    </span>
                    <span className="mt-2 text-2xl font-bold leading-none tabular-nums text-white">{roomNumber(room)}</span>
                    <span className="mt-2.5 flex h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                      <span className="h-full bg-amber-400" style={{ width: `${bookedPct}%` }} />
                      <span className="h-full bg-white/45" style={{ width: `${blockedPct}%` }} />
                    </span>
                    <span className="mt-1.5 truncate text-[11px] text-white/55">
                      {av?.bookings?.[0]?.guestName ?? (st.key === "free" ? "Free all window" : st.label)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Selected room */}
        {openRoom ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-bold tabular-nums"
                  style={{ backgroundColor: `${colorOf(typeName(openRoom))}26`, color: colorOf(typeName(openRoom)) }}
                >
                  {roomNumber(openRoom)}
                </span>
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-bold text-white">{openRoom.name}</p>
                  <p className="m-0 mt-0.5 text-xs text-white/55">
                    {openAv && (openAv.nightsOccupied ?? openAv.nightsBooked) > 0
                      ? `${openAv.nightsOccupied ?? openAv.nightsBooked} of ${openAv.nightsTotal} nights taken in this window`
                      : "Free for the whole window"}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setOpenCode(null)} className="grid h-7 w-7 place-items-center rounded-lg border-0 bg-transparent text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {openAv && (openAv.bookings.length > 0 || (openAv.blocks?.length ?? 0) > 0) ? (
              <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
                {openAv.bookings.map((b) => (
                  <li key={`b-${b.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />
                      <span className="truncate font-semibold text-white">{b.guestName || "Guest"}</span>
                    </span>
                    <span className="shrink-0 text-white/55">{fmtDay(b.checkIn)} to {fmtDay(b.checkOut)}</span>
                  </li>
                ))}
                {(openAv.blocks ?? []).map((bl) => (
                  <li key={`x-${bl.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-white/45" aria-hidden />
                      <span className="truncate font-semibold text-white">Blocked · {sourceLabel(bl.source)}</span>
                    </span>
                    <span className="shrink-0 text-white/55">{fmtDay(bl.startDate)} to {fmtDay(bl.endDate)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {onBlockRoom ? (
                <button
                  type="button"
                  onClick={() => onBlockRoom({ code: openRoom.code, name: openRoom.name })}
                  className="group inline-flex h-10 items-center gap-3 rounded-xl bg-[#5eead4] pl-4 pr-1.5 text-sm font-bold text-[#012a26] transition hover:bg-[#8ff3e1]"
                >
                  Block this room
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#012a26] text-[#5eead4] transition group-hover:translate-x-0.5">
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </button>
              ) : null}
              <span className="text-[11px] text-white/50">For a walk-in, Airbnb, Booking.com or any booking made outside NoLSAF.</span>
            </div>
          </div>
        ) : null}

      </div>
    </section>
  );
}
