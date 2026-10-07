"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowRight, BedDouble, Building2, ChevronLeft, Layers, Loader2, Pencil, Plus, Sparkles } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { FloorPlanSkeleton } from "@/components/owner-availability/Skeleton";

/**
 * Floor plan setup. The plan is generated on the server (lib/autoLayout.ts)
 * from the property's room types: each type's floor distribution decides which
 * floor its rooms sit on, and the property's total floors decides how many
 * floors exist. This page shows that building, floor by floor, with tonight's
 * status on every room. Checking other dates and blocking rooms happen on
 * Room availability, so this page only explains and rebuilds the plan.
 */

const api = apiClient;

type RoomNode = {
  id: string;
  name: string;
  code: string;
  pricePerNight: number;
  photos: string[];
  amenities: string[];
  accessible: boolean;
};
type Floor = { id: string; label: string; rooms: RoomNode[] };
type Layout = { floors: Floor[] };
type RoomAv = {
  code: string;
  occupancyPct: number;
  nightsBooked: number;
  nightsBlocked?: number;
  bookings: { id: number; checkIn: string; checkOut: string; guestName: string | null }[];
  blocks?: { id: number; startDate: string; endDate: string; source: string | null }[];
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (v: string) => new Date(v).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short" });
const fmtTzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
const typeOf = (room: RoomNode) => String(room.name || room.code).replace(/\s+\d+$/, "").trim();
const numberOf = (room: RoomNode) => (/(\d+)$/.exec(String(room.name || room.code))?.[1] ?? room.code);
const sourceLabel = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "Outside booking");

function tonight(av?: RoomAv): "free" | "booked" | "blocked" {
  if (!av || av.occupancyPct <= 0) return "free";
  return av.nightsBooked > 0 ? "booked" : "blocked";
}

const TILE = {
  free: "border-[#5eead4]/30 bg-[#5eead4]/[0.07] text-white hover:border-[#5eead4]/60",
  booked: "border-amber-400/50 bg-amber-400/15 text-white hover:border-amber-400/80",
  blocked: "border-white/20 bg-white/[0.07] text-white/80 hover:border-white/40",
} as const;
const STATUS_TEXT = { free: "Free tonight", booked: "Booked tonight", blocked: "Blocked tonight" } as const;

export default function OwnerPropertyLayoutPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const propertyId = Number(idParam);

  const [layout, setLayout] = useState<Layout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Record<string, RoomAv>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  // Close the rebuild dialog with Escape.
  useEffect(() => {
    if (!confirmRebuild) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirmRebuild(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmRebuild]);

  const loadTonight = useCallback(async () => {
    if (!Number.isFinite(propertyId) || propertyId <= 0) return;
    const from = ymd(new Date());
    const to = ymd(new Date(Date.now() + 86_400_000));
    try {
      const r = await api.get<{ rooms: RoomAv[] }>(`/api/owner/properties/${propertyId}/availability`, { params: { from, to } });
      const map: Record<string, RoomAv> = {};
      for (const it of r.data?.rooms ?? []) map[it.code] = it;
      setRooms(map);
    } catch {
      // The plan still works without tonight's colours.
    }
  }, [propertyId]);

  useEffect(() => {
    if (!Number.isFinite(propertyId) || propertyId <= 0) return;
    let alive = true;
    (async () => {
      try {
        setError(null);
        const r = await api.get<Layout | null>(`/api/owner/properties/${propertyId}/layout`);
        let l = r.data && Array.isArray(r.data.floors) ? r.data : null;
        if (!l) {
          // First visit: build the plan from the room types.
          const g = await api.post<Layout>(`/api/owner/properties/${propertyId}/layout/generate`);
          l = g.data;
        }
        if (!alive) return;
        setLayout(l);
        await loadTonight();
      } catch (e: any) {
        if (alive) setError(String(e?.response?.data?.error || e?.message || "The floor plan could not be loaded."));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [propertyId, loadTonight]);

  const rebuild = async () => {
    setConfirmRebuild(false);
    setRebuilding(true);
    try {
      const r = await api.post<Layout>(`/api/owner/properties/${propertyId}/layout/generate`);
      setLayout(r.data);
      setSelected(null);
      await loadTonight();
    } catch (e: any) {
      setError(String(e?.response?.data?.error || e?.message || "The floor plan could not be rebuilt."));
    } finally {
      setRebuilding(false);
    }
  };

  const floors = useMemo(() => layout?.floors ?? [], [layout]);
  // Top floor first, like looking at the building.
  const stack = useMemo(() => [...floors].reverse(), [floors]);
  const allRooms = useMemo(() => floors.flatMap((f) => f.rooms.map((r) => ({ room: r, floor: f }))), [floors]);
  const emptyFloors = floors.filter((f) => f.rooms.length === 0);
  const freeTonight = allRooms.filter(({ room }) => tonight(rooms[room.code]) === "free").length;
  const types = useMemo(() => {
    const m = new Map<string, { count: number; floors: Set<string> }>();
    for (const { room, floor } of allRooms) {
      const t = typeOf(room);
      const e = m.get(t) ?? { count: 0, floors: new Set<string>() };
      e.count += 1;
      e.floors.add(floor.label);
      m.set(t, e);
    }
    return [...m.entries()];
  }, [allRooms]);

  const pick = selected ? allRooms.find(({ room }) => room.code === selected) ?? null : null;
  const pickAv = pick ? rooms[pick.room.code] : undefined;
  const pickState = tonight(pickAv);

  const shell = "w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6";
  const style = (
    <style>{`:where(#owner-floorplan, #owner-floorplan *, #owner-floorplan *::before, #owner-floorplan *::after) { box-sizing: border-box; border-width: 0; border-style: solid; border-color: #e2e8f0; }`}</style>
  );

  if (loading) {
    return (
      <div id="owner-floorplan" className={shell} aria-busy="true">
        {style}
        <FloorPlanSkeleton />
      </div>
    );
  }

  if (!layout) {
    return (
      <div id="owner-floorplan" className={shell}>
        {style}
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          {error ?? "The floor plan could not be loaded."}
          <Link href={`/owner/properties/${propertyId}/availability`} className="ml-2 font-semibold text-rose-900 underline">Back to Room availability</Link>
        </div>
      </div>
    );
  }

  return (
    <div id="owner-floorplan" className={shell}>
      {style}

      {/* ── Rebuild confirmation ── */}
      {confirmRebuild ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="rebuild-title">
          <button type="button" aria-label="Close" onClick={() => setConfirmRebuild(false)} className="absolute inset-0 border-0 bg-[#012a26]/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10">
            <div className="bg-[#012a26] px-6 pb-5 pt-5 text-white">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#5eead4]/15 text-[#5eead4]">
                <Sparkles className="h-5 w-5" aria-hidden />
              </span>
              <p id="rebuild-title" className="m-0 mt-3 text-lg font-bold">Rebuild the floor plan?</p>
              <p className="m-0 mt-1 text-sm text-white/65">NoLSAF lays out every room again from your current room types and floor settings.</p>
            </div>
            <div className="space-y-3 p-6">
              <ul className="m-0 list-none space-y-2 p-0 text-sm text-slate-700">
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#02665e]" aria-hidden />
                  Rooms are placed on the floors you set for each room type.
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#02665e]" aria-hidden />
                  Bookings and blocks are kept. Only room positions change.
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#02665e]" aria-hidden />
                  Use it after adding or removing rooms, or changing floors.
                </li>
              </ul>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                <span>Now</span>
                <span className="font-semibold text-slate-900">{floors.length} {floors.length === 1 ? "floor" : "floors"} · {allRooms.length} {allRooms.length === 1 ? "room" : "rooms"}</span>
              </div>
              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmRebuild(false)}
                  className="h-11 flex-1 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Keep current plan
                </button>
                <button
                  type="button"
                  onClick={rebuild}
                  autoFocus
                  className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#012a26] text-sm font-bold text-white transition hover:bg-[#02665e]"
                >
                  <Sparkles className="h-4 w-4 text-[#5eead4]" aria-hidden /> Rebuild plan
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Header band ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)", WebkitMaskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative px-5 pb-6 pt-5 sm:px-8 sm:pt-6">
          <Link href={`/owner/properties/${propertyId}/availability`} className="inline-flex items-center gap-1 text-sm font-semibold text-white/60 no-underline transition hover:text-white">
            <ChevronLeft className="h-4 w-4" aria-hidden /> Room availability
          </Link>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Setup</p>
              <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">Floor plan</h1>
              <p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">
                Your building, floor by floor. NoLSAF places each room from the floors you set for its room type.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/owner/properties/add?id=${propertyId}`}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white no-underline transition hover:bg-white/10"
              >
                <Pencil className="h-4 w-4" aria-hidden /> Edit rooms and floors
              </Link>
              <button
                type="button"
                onClick={() => setConfirmRebuild(true)}
                disabled={rebuilding}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5eead4] px-3.5 text-sm font-bold text-[#012a26] transition hover:bg-[#8ff3e1] disabled:opacity-60"
              >
                {rebuilding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                Rebuild plan
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2.5 sm:gap-3">
            {[
              { label: "Floors", value: floors.length, Icon: Layers },
              { label: "Rooms", value: allRooms.length, Icon: BedDouble },
              { label: "Free tonight", value: freeTonight, Icon: Building2 },
            ].map((s) => (
              <div key={s.label} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
                  <s.Icon className="h-3.5 w-3.5 text-[#5eead4]" aria-hidden /> {s.label}
                </span>
                <span className="mt-1 block text-2xl font-bold tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      {emptyFloors.length > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">{emptyFloors.length} {emptyFloors.length === 1 ? "floor has" : "floors have"} no rooms</strong>{" "}
            ({emptyFloors.map((f) => f.label).join(", ")}). Assign rooms to {emptyFloors.length === 1 ? "it" : "them"} in your room setup, or lower the number of floors, then rebuild the plan.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        {/* ── The building ── */}
        <section className="overflow-hidden rounded-3xl bg-[#012a26] text-white shadow-[0_18px_40px_-28px_rgba(1,42,38,0.8)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-white/10 px-5 py-4">
            <p className="m-0 text-sm font-bold">Building</p>
            <div className="flex items-center gap-3 text-[11px] font-semibold text-white/70">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#5eead4]" aria-hidden />Free</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" aria-hidden />Booked</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-white/40" aria-hidden />Blocked</span>
              <span className="text-white/45">tonight</span>
            </div>
          </div>

          <ol className="m-0 list-none p-0">
            {stack.map((floor, i) => {
              const free = floor.rooms.filter((r) => tonight(rooms[r.code]) === "free").length;
              const isGround = i === stack.length - 1;
              return (
                <li key={floor.id} className="grid grid-cols-[92px_minmax(0,1fr)] border-0 border-b border-white/10 last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <div className="flex flex-col justify-center border-0 border-r border-white/10 bg-white/[0.03] px-3 py-3 sm:px-4">
                    <span className="text-sm font-bold">{floor.label}</span>
                    <span className="text-[11px] text-white/50">
                      {floor.rooms.length === 0 ? "No rooms" : `${free}/${floor.rooms.length} free`}
                    </span>
                  </div>
                  <div className="min-w-0 px-3 py-3 sm:px-4">
                    {floor.rooms.length === 0 ? (
                      <div className="flex h-12 items-center rounded-xl border border-dashed border-white/15 px-3 text-xs text-white/40">
                        Empty floor
                      </div>
                    ) : (
                      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                        {floor.rooms.map((room) => {
                          const st = tonight(rooms[room.code]);
                          const on = selected === room.code;
                          return (
                            <li key={room.id}>
                              <button
                                type="button"
                                onClick={() => setSelected(on ? null : room.code)}
                                aria-pressed={on}
                                title={`${room.name} · ${STATUS_TEXT[st]}`}
                                className={`flex h-14 w-[76px] flex-col items-start justify-between rounded-xl border px-2.5 py-1.5 text-left transition ${TILE[st]} ${on ? "ring-2 ring-[#5eead4] ring-offset-2 ring-offset-[#012a26]" : ""}`}
                              >
                                <span className="text-base font-bold leading-none tabular-nums">{numberOf(room)}</span>
                                <span className="w-full truncate text-[10px] font-semibold text-white/60">{typeOf(room)}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {isGround ? <p className="m-0 mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">Entrance and reception</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* ── Side panel: the selected room, or the room types ── */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          {pick ? (
            <section className="overflow-hidden rounded-3xl border border-slate-300/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-26px_rgba(15,23,42,0.4)]">
              {pick.room.photos?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pick.room.photos[0]} alt="" className="h-36 w-full object-cover" />
              ) : null}
              <div className="p-5">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{pick.floor.label} floor</p>
                <p className="m-0 mt-1 text-xl font-bold text-slate-900">{pick.room.name}</p>
                <p className="m-0 mt-0.5 text-sm text-slate-500">
                  {pick.room.pricePerNight > 0 ? `${fmtTzs(pick.room.pricePerNight)} / night` : "No rate set"}
                </p>
                <span
                  className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    pickState === "free" ? "bg-emerald-50 text-emerald-800" : pickState === "booked" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${pickState === "free" ? "bg-emerald-500" : pickState === "booked" ? "bg-amber-500" : "bg-slate-500"}`} aria-hidden />
                  {STATUS_TEXT[pickState]}
                </span>
                {pickAv?.bookings?.length || pickAv?.blocks?.length ? (
                  <ul className="m-0 mt-3 list-none space-y-1.5 p-0 text-xs">
                    {pickAv.bookings.map((b) => (
                      <li key={`b-${b.id}`} className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                        <span className="truncate font-semibold text-slate-800">{b.guestName || "Guest"}</span>
                        <span className="shrink-0 text-slate-500">{fmtDay(b.checkIn)} to {fmtDay(b.checkOut)}</span>
                      </li>
                    ))}
                    {(pickAv.blocks ?? []).map((bl) => (
                      <li key={`x-${bl.id}`} className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                        <span className="truncate font-semibold text-slate-800">{sourceLabel(bl.source)}</span>
                        <span className="shrink-0 text-slate-500">{fmtDay(bl.startDate)} to {fmtDay(bl.endDate)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {pick.room.amenities?.length ? (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {pick.room.amenities.slice(0, 8).map((a) => (
                      <span key={a} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-700">{a}</span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-5 space-y-2">
                  <Link
                    href={`/owner/properties/${propertyId}/availability?externalBlock=1&roomName=${encodeURIComponent(pick.room.name)}`}
                    className="group flex h-11 items-center justify-between rounded-xl bg-[#012a26] pl-4 pr-1.5 text-sm font-bold text-white no-underline transition hover:bg-[#02665e]"
                  >
                    Block this room
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5eead4] text-[#012a26]"><Plus className="h-4 w-4" aria-hidden /></span>
                  </Link>
                  <Link
                    href={`/owner/properties/${propertyId}/availability`}
                    className="flex h-11 items-center justify-between rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 no-underline transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                  >
                    Check other dates <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-3xl border border-slate-300/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <p className="m-0 text-sm font-bold text-slate-900">Room types</p>
              <p className="m-0 mt-0.5 text-xs text-slate-500">Tap a room in the building to see it here.</p>
              <ul className="m-0 mt-4 list-none space-y-2 p-0">
                {types.map(([name, t]) => (
                  <li key={name} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-inset ring-slate-200">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{name}</span>
                      <span className="block truncate text-[11px] text-slate-500">{[...t.floors].join(", ")}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold tabular-nums text-slate-900">{t.count}</span>
                      <span className="block text-[11px] text-slate-500">{t.count === 1 ? "room" : "rooms"}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-4 text-[11px] leading-relaxed text-slate-500">
                To move rooms between floors, change the floor counts for the room type in your room setup, then rebuild the plan.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
