"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Building2, ChevronUp, ChevronDown, ChevronRight, BedDouble, Home, Layers, Grid3x3, MousePointerClick } from "lucide-react";

interface Room {
  roomType: string;
  roomsCount: number;
  floor?: number | string;
  floorDistribution?: Record<number, number>;
  floors?: number[];
}

interface PropertyVisualizationPreviewProps {
  title: string;
  buildingType: string;
  totalFloors: number | "";
  rooms: Room[];
  onFloorSelect?: (floor: number) => void;
  onRoomTypeClick?: (args: { roomType: string; floor: number; view: "structure" | "plan" }) => void;
  /** Visual style for the top header area */
  headerVariant?: "compact" | "hero";
  /** Whether to render the internal header (useful when embedded under another section header) */
  showHeader?: boolean;
  /** When embedded as a page section: one compact header row holding title, totals and a badge */
  sectionTitle?: string;
  sectionEyebrow?: string;
  sectionBadge?: React.ReactNode;
}

function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function getFloorName(floorNum: number): string {
  if (floorNum === 0) return "Ground";
  return `${floorNum}${getOrdinal(floorNum)}`;
}

/** Calm, distinct tones for room types; a type keeps its tone on every floor. */
const ROOM_TYPE_TONES = [
  { tile: "bg-teal-50 text-teal-700", bar: "bg-teal-500", view: "bg-teal-50 text-teal-700 group-hover:bg-teal-600", ring: "hover:border-teal-300" },
  { tile: "bg-indigo-50 text-indigo-600", bar: "bg-indigo-500", view: "bg-indigo-50 text-indigo-700 group-hover:bg-indigo-600", ring: "hover:border-indigo-300" },
  { tile: "bg-amber-50 text-amber-700", bar: "bg-amber-500", view: "bg-amber-50 text-amber-800 group-hover:bg-amber-600", ring: "hover:border-amber-300" },
  { tile: "bg-rose-50 text-rose-600", bar: "bg-rose-500", view: "bg-rose-50 text-rose-700 group-hover:bg-rose-600", ring: "hover:border-rose-300" },
  { tile: "bg-sky-50 text-sky-700", bar: "bg-sky-500", view: "bg-sky-50 text-sky-700 group-hover:bg-sky-600", ring: "hover:border-sky-300" },
  { tile: "bg-violet-50 text-violet-600", bar: "bg-violet-500", view: "bg-violet-50 text-violet-700 group-hover:bg-violet-600", ring: "hover:border-violet-300" },
  { tile: "bg-lime-50 text-lime-700", bar: "bg-lime-600", view: "bg-lime-50 text-lime-800 group-hover:bg-lime-700", ring: "hover:border-lime-300" },
  { tile: "bg-orange-50 text-orange-700", bar: "bg-orange-500", view: "bg-orange-50 text-orange-700 group-hover:bg-orange-600", ring: "hover:border-orange-300" },
] as const;

// Distribute rooms across floors based on building type and floor distribution
function distributeRoomsToFloors(
  rooms: Room[],
  totalFloors: number,
  buildingType: string
): Record<number, Room[]> {
  const floors: Record<number, Room[]> = {};
  
  // Initialize floors
  for (let i = 0; i <= totalFloors; i++) {
    floors[i] = [];
  }

  // If single story, put everything on ground floor
  // Support both spellings used across the app: single_story and single_storey
  if (buildingType === "single_story" || buildingType === "single_storey" || totalFloors === 0) {
    rooms.forEach((room) => {
      floors[0].push({ ...room, floor: 0 });
    });
    return floors;
  }

  // Distribute rooms based on floorDistribution or evenly
  rooms.forEach((room) => {
    if (room.floorDistribution && Object.keys(room.floorDistribution).length > 0) {
      // Use provided distribution
      Object.entries(room.floorDistribution).forEach(([floorStr, count]) => {
        const floor = parseInt(floorStr);
        if (!isNaN(floor) && floor >= 0 && floor <= totalFloors && count > 0) {
          if (!floors[floor]) floors[floor] = [];
          floors[floor].push({
            ...room,
            roomsCount: count,
            floor,
          });
        }
      });
    } else {
      // Evenly distribute across floors (excluding ground for multi-story)
      const floorsToUse = totalFloors > 0 ? totalFloors : 1;
      const roomsPerFloor = Math.ceil(room.roomsCount / floorsToUse);
      let remaining = room.roomsCount;
      
      for (let floor = buildingType === "multi_storey" ? 1 : 0; floor <= totalFloors && remaining > 0; floor++) {
        const count = Math.min(roomsPerFloor, remaining);
        if (!floors[floor]) floors[floor] = [];
        floors[floor].push({
          ...room,
          roomsCount: count,
          floor,
        });
        remaining -= count;
      }
    }
  });

  return floors;
}

export function PropertyVisualizationPreview({
  title,
  buildingType,
  totalFloors,
  rooms,
  onFloorSelect,
  onRoomTypeClick,
  headerVariant = "compact",
  showHeader = true,
  sectionTitle,
  sectionEyebrow,
  sectionBadge,
}: PropertyVisualizationPreviewProps) {
  const numFloors = typeof totalFloors === "number" && totalFloors > 0 ? totalFloors : 0;
  const [currentFloor, setCurrentFloor] = useState(0);

  const roomsByFloor = useMemo(() => {
    if (numFloors === 0 || rooms.length === 0) {
      return { 0: rooms.map((r) => ({ ...r, floor: 0 })) } as Record<number, Room[]>;
    }
    return distributeRoomsToFloors(rooms, numFloors, buildingType);
  }, [rooms, numFloors, buildingType]);

  const availableFloors = useMemo(() => {
    return Object.keys(roomsByFloor)
      .map(Number)
      .filter((floor) => roomsByFloor[floor].length > 0)
      .sort((a, b) => a - b);
  }, [roomsByFloor]);

  // Land on the first floor that actually has rooms
  useEffect(() => {
    if (availableFloors.length && !availableFloors.includes(currentFloor)) setCurrentFloor(availableFloors[0]);
  }, [availableFloors, currentFloor]);

  const floorStats = useMemo(() => {
    const map = new Map<number, { rooms: number; types: { roomType: string; roomsCount: number }[] }>();
    for (const floor of availableFloors) {
      const byType = new Map<string, number>();
      for (const r of roomsByFloor[floor] || []) {
        const name = String(r.roomType || "Room").trim() || "Room";
        byType.set(name, (byType.get(name) || 0) + (Number(r.roomsCount) || 0));
      }
      const types = Array.from(byType, ([roomType, roomsCount]) => ({ roomType, roomsCount })).sort((a, b) => b.roomsCount - a.roomsCount);
      map.set(floor, { rooms: types.reduce((s, t) => s + t.roomsCount, 0), types });
    }
    return map;
  }, [availableFloors, roomsByFloor]);

  const totalRooms = useMemo(() => Array.from(floorStats.values()).reduce((s, f) => s + f.rooms, 0), [floorStats]);
  // Tone per room type, assigned alphabetically across the whole property so it is stable between floors
  const toneFor = useMemo(() => {
    const names = Array.from(new Set(rooms.map((r) => String(r.roomType || "Room").trim().toLowerCase()))).sort();
    const map = new Map(names.map((n, i) => [n, ROOM_TYPE_TONES[i % ROOM_TYPE_TONES.length]]));
    return (name: string) => map.get(String(name || "Room").trim().toLowerCase()) || ROOM_TYPE_TONES[0];
  }, [rooms]);
  const totalTypes = useMemo(() => new Set(rooms.map((r) => String(r.roomType || "Room").trim().toLowerCase())).size, [rooms]);
  const maxFloorRooms = useMemo(() => Math.max(1, ...Array.from(floorStats.values()).map((f) => f.rooms)), [floorStats]);

  const selectFloor = useCallback(
    (floor: number) => {
      if (floor === currentFloor) return;
      setCurrentFloor(floor);
      onFloorSelect?.(floor);
    },
    [currentFloor, onFloorSelect]
  );

  const stepFloor = useCallback(
    (dir: 1 | -1) => {
      const idx = availableFloors.indexOf(currentFloor);
      const next = availableFloors[idx + dir];
      if (next !== undefined) selectFloor(next);
    },
    [availableFloors, currentFloor, selectFloor]
  );

  // Large screens: the floor card rests at the middle of the column, and a drawn
  // connector runs from the selected floor to the card, so the link is explicit.
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const [panelPos, setPanelPos] = useState<{
    top: number;
    height: number;
    sx: number;
    sy: number;
    ex: number;
    ey: number;
  } | null>(null);

  const placePanel = useCallback(() => {
    const grid = gridRef.current;
    const panel = panelRef.current;
    const row = rowRefs.current.get(currentFloor);
    if (!grid || !panel || !row || !window.matchMedia("(min-width: 1024px)").matches) {
      setPanelPos(null);
      return;
    }
    const g = grid.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const h = panel.offsetHeight;
    const top = Math.max(0, (g.height - h) / 2);
    const sx = r.right - g.left;
    const sy = r.top - g.top + r.height / 2;
    const ex = panel.parentElement ? panel.parentElement.getBoundingClientRect().left - g.left : sx + 24;
    // Land on the card's edge at the floor's height when possible, else the nearest safe point.
    const ey = Math.min(Math.max(sy, top + 34), top + h - 34);
    setPanelPos((prev) =>
      prev && prev.top === top && prev.height === h && prev.sx === sx && prev.sy === sy && prev.ex === ex && prev.ey === ey
        ? prev
        : { top, height: h, sx, sy, ex, ey }
    );
  }, [currentFloor]);

  useEffect(() => {
    placePanel();
    const grid = gridRef.current;
    const panel = panelRef.current;
    if (!grid) return;
    const ro = new ResizeObserver(() => placePanel());
    ro.observe(grid);
    if (panel) ro.observe(panel);
    window.addEventListener("resize", placePanel);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", placePanel);
    };
  }, [placePanel, rooms]);

  if (rooms.length === 0) {
    return (
      <div className="box-border rounded-xl border border-solid border-slate-200 bg-white p-8 text-center">
        <BedDouble className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <p className="m-0 font-medium text-slate-600">No rooms configured yet</p>
        <p className="m-0 mt-1 text-sm text-slate-500">Add room types to see the building layout</p>
      </div>
    );
  }

  const current = floorStats.get(currentFloor) || { rooms: 0, types: [] };
  // Draw every declared storey so the building is true to its height; floors
  // without rooms show as quiet, non-clickable rows.
  const highestFloor = Math.max(numFloors, ...availableFloors);
  const allFloors = highestFloor <= 60 ? Array.from({ length: highestFloor + 1 }, (_, i) => i) : availableFloors;
  // Top floor first; a run of empty floors folds into one quiet row ("5–8") so it never dominates.
  const floorsTopDown = (() => {
    const out: Array<{ kind: "floor"; floor: number } | { kind: "empty"; from: number; to: number }> = [];
    for (const floor of [...allFloors].reverse()) {
      if (floorStats.has(floor)) {
        out.push({ kind: "floor", floor });
        continue;
      }
      const last = out[out.length - 1];
      if (last && last.kind === "empty" && last.from === floor + 1) last.from = floor;
      else out.push({ kind: "empty", from: floor, to: floor });
    }
    return out;
  })();
  const clickableTypes = Boolean(onRoomTypeClick);
  const idx = availableFloors.indexOf(currentFloor);
  const floorLabel = (f: number) => (f === 0 ? "Ground floor" : `${getFloorName(f)} floor`);

  return (
    <div className={showHeader ? "box-border overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white" : ""}>
      {showHeader ? (
        <div
          className={`flex items-center justify-between gap-4 px-5 py-4 ${headerVariant === "hero" ? "text-white" : "border-0 border-b border-solid border-slate-100"}`}
          style={headerVariant === "hero" ? { background: "linear-gradient(135deg, #013d38 0%, #02665e 60%, #037a70 100%)" } : undefined}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${headerVariant === "hero" ? "bg-white/15" : "bg-[#02665e]/10 text-[#02665e]"}`}>
              <Home className="h-5 w-5" />
            </span>
            <h3 className={`m-0 truncate text-lg font-bold ${headerVariant === "hero" ? "" : "text-slate-900"}`}>{title || "Property"}</h3>
          </div>
        </div>
      ) : null}

      <div className={showHeader ? "p-4 sm:p-5" : ""}>
        {/* Section header: title on the left, live totals and source badge on the right */}
        {(() => {
          const totals = (
            <div className="inline-flex max-w-full flex-wrap items-center overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
              {[
                { value: availableFloors.length, label: availableFloors.length === 1 ? "floor" : "floors", Icon: Layers },
                { value: totalRooms, label: totalRooms === 1 ? "room" : "rooms", Icon: BedDouble },
                { value: totalTypes, label: totalTypes === 1 ? "room type" : "room types", Icon: Grid3x3 },
              ].map(({ value, label, Icon }, i) => (
                <span
                  key={label}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] text-slate-600 ${i > 0 ? "border-0 border-l border-solid border-slate-200" : ""}`}
                >
                  <Icon className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                  <span className="font-bold tabular-nums text-slate-900">{value}</span>
                  {label}
                </span>
              ))}
            </div>
          );
          if (!sectionTitle) return <div className="mb-4">{totals}</div>;
          return (
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                  <Building2 className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  {sectionEyebrow && (
                    <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#02665e]">{sectionEyebrow}</p>
                  )}
                  <h2 className="m-0 truncate text-[17px] font-bold leading-tight text-slate-900">{sectionTitle}</h2>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {totals}
                {sectionBadge}
              </div>
            </div>
          );
        })()}

        <div ref={gridRef} className="relative grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-stretch lg:gap-10">
          {/* Connector: selected floor → floor card */}
          {panelPos && (
            <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 hidden h-full w-full overflow-visible lg:block">
              {(() => {
                const { sx, sy, ex, ey } = panelPos;
                const mid = sx + Math.max(16, (ex - sx) * 0.55);
                const d = `M ${sx + 6} ${sy} L ${mid - 8} ${sy} Q ${mid} ${sy} ${mid} ${sy + Math.sign(ey - sy) * Math.min(8, Math.abs(ey - sy))} L ${mid} ${ey - Math.sign(ey - sy) * Math.min(8, Math.abs(ey - sy))} Q ${mid} ${ey} ${mid + 8} ${ey} L ${ex - 2} ${ey}`;
                return (
                  <g className="motion-safe:transition-all motion-safe:duration-300">
                    <path d={d} fill="none" stroke="#02665e" strokeOpacity="0.18" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d={d} fill="none" stroke="#02665e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4" className="nols-connector-flow" />
                    <circle cx={sx + 6} cy={sy} r="5" fill="#ffffff" stroke="#02665e" strokeWidth="2" />
                    <circle cx={sx + 6} cy={sy} r="2" fill="#02665e" />
                    <circle cx={ex - 2} cy={ey} r="4" fill="#02665e" />
                  </g>
                );
              })()}
            </svg>
          )}
          {/* Elevation: the building drawn as stacked floors, top floor first */}
          <div
            role="listbox"
            aria-label="Floors"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                stepFloor(1);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                stepFloor(-1);
              }
            }}
            className="box-border rounded-xl border border-solid border-slate-200 bg-gradient-to-b from-sky-50/80 via-white to-slate-50 px-3 pt-3 outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 sm:px-5"
          >
            {/* How to use it, said once and plainly */}
            {availableFloors.length > 1 && (
              <p className="m-0 mb-3 flex items-center justify-center gap-1.5 text-[12px] font-medium text-[#02665e]">
                <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
                Select a floor to see its rooms
              </p>
            )}
            <div className="mx-auto max-w-[480px]">
              {/* Roof */}
              <div className="mx-6 h-2 rounded-t-md bg-slate-300" aria-hidden />
              <div
                className={`box-border rounded-t-sm border-2 border-b-0 border-solid border-slate-300 bg-white p-1.5 ${
                  floorsTopDown.length > 24 ? "max-h-[640px] overflow-y-auto" : ""
                }`}
              >
                {/* Column labels so the numbers read as room counts */}
                <div aria-hidden className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 border-0 border-b border-solid border-slate-100 px-1.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  <span className="text-center">Floor</span>
                  <span />
                  <span className="whitespace-nowrap pr-1 text-right">No. of rooms</span>
                </div>
                <ul className="m-0 mt-1 grid list-none gap-1 p-0">
                  {floorsTopDown.map((item) => {
                    if (item.kind === "empty") {
                      const name = (f: number) => (f === 0 ? "G" : String(f));
                      return (
                        <li key={`empty-${item.from}`} aria-hidden>
                          <div className="box-border grid h-7 grid-cols-[40px_minmax(0,1fr)_64px] items-center gap-2 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-1.5">
                            <span className="text-center font-mono text-[11px] text-slate-400">
                              {item.from === item.to ? name(item.from) : `${name(item.from)}–${name(item.to)}`}
                            </span>
                            <span className="block h-px bg-slate-200" />
                            <span className="pr-1 text-right text-[11px] tabular-nums text-slate-400">0 rooms</span>
                          </div>
                        </li>
                      );
                    }
                    const floor = item.floor;
                    const stats = floorStats.get(floor)!;
                    const on = floor === currentFloor;
                    const pct = Math.max(6, Math.round((stats.rooms / maxFloorRooms) * 100));
                    return (
                      <li
                        key={floor}
                        ref={(el) => {
                          if (el) rowRefs.current.set(floor, el);
                          else rowRefs.current.delete(floor);
                        }}
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={on}
                          onClick={() => selectFloor(floor)}
                          aria-label={`${floorLabel(floor)}, ${stats.rooms} rooms, ${stats.types.length} room types`}
                          className={`group relative box-border grid h-9 w-full cursor-pointer grid-cols-[40px_minmax(0,1fr)_64px] items-center gap-2 rounded-md border border-solid px-1.5 text-left transition-all ${
                            on
                              ? "border-[#02665e] bg-[#02665e] shadow-[0_6px_16px_-8px_rgba(2,102,94,0.7)]"
                              : "border-transparent bg-transparent hover:border-[#02665e]/25 hover:bg-[#02665e]/[0.04]"
                          }`}
                        >
                          <span className={`text-center font-mono text-[12px] font-bold ${on ? "text-white" : "text-slate-500 group-hover:text-[#02665e]"}`}>
                            {floor === 0 ? "G" : floor}
                          </span>
                          <span className={`relative block h-2.5 overflow-hidden rounded-full ${on ? "bg-white/20" : "bg-slate-100"}`}>
                            <span
                              className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${on ? "bg-emerald-300" : "bg-[#02665e]/55 group-hover:bg-[#02665e]"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className={`flex items-center justify-end gap-1 text-[12.5px] font-bold tabular-nums ${on ? "text-white" : "text-slate-700"}`}>
                            {stats.rooms}
                            <ChevronRight
                              className={`h-3.5 w-3.5 transition-all ${on ? "text-white" : "text-slate-300 group-hover:translate-x-0.5 group-hover:text-[#02665e]"}`}
                              aria-hidden
                            />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {/* Ground and street */}
              <div className="-mx-3 h-1.5 rounded-sm bg-slate-400 sm:-mx-5" aria-hidden />
              <div
                className="-mx-3 h-3 sm:-mx-5"
                aria-hidden
                style={{ backgroundImage: "repeating-linear-gradient(90deg, #cbd5e1 0 14px, transparent 14px 26px)", backgroundSize: "100% 2px", backgroundRepeat: "no-repeat", backgroundPosition: "0 60%" }}
              />
              {/* Key */}
              <div className="flex items-center justify-center gap-4 pb-3 pt-1 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-5 rounded-full bg-[#02665e]/55" aria-hidden /> Rooms on floor
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-5 rounded-full bg-[#02665e]" aria-hidden /> Selected
                </span>
              </div>
            </div>
          </div>

          {/* Selected floor: rests at the middle of the column, linked by the connector */}
          <div className="relative" style={panelPos ? { minHeight: panelPos.height } : undefined}>
          <div
            ref={panelRef}
            className="box-border flex w-full flex-col rounded-xl border-2 border-solid border-[#02665e] bg-white shadow-[0_18px_40px_-22px_rgba(2,40,36,0.45)] lg:absolute lg:inset-x-0"
            style={panelPos ? { top: panelPos.top } : undefined}
          >
            <div
              className="flex items-center justify-between gap-3 rounded-t-[10px] px-4 py-3.5 text-white"
              style={{ background: "linear-gradient(135deg, #013d38 0%, #02665e 70%, #037a70 100%)" }}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 flex-none flex-col items-center justify-center rounded-lg bg-white/15 leading-none ring-1 ring-inset ring-white/20">
                  <span className="font-mono text-[15px] font-bold">{currentFloor === 0 ? "G" : currentFloor}</span>
                </span>
                <div className="min-w-0">
                  <p className="m-0 truncate text-[16px] font-bold leading-tight">{floorLabel(currentFloor)}</p>
                  <p className="m-0 mt-0.5 flex items-center gap-2 text-[12px] text-white/75">
                    <span className="truncate">
                      {current.rooms} {current.rooms === 1 ? "room" : "rooms"} · {current.types.length} {current.types.length === 1 ? "type" : "types"}
                    </span>
                    {totalRooms > 0 && (
                      <span className="flex-none rounded bg-white/15 px-1.5 py-px text-[11px] font-semibold text-white">
                        {Math.round((current.rooms / totalRooms) * 100)}% of rooms
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {availableFloors.length > 1 && (
                <div className="flex flex-none items-center gap-1">
                  <button
                    type="button"
                    onClick={() => stepFloor(-1)}
                    disabled={idx <= 0}
                    aria-label="Floor below"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-white/15 text-white transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepFloor(1)}
                    disabled={idx >= availableFloors.length - 1}
                    aria-label="Floor above"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-white/15 text-white transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {current.types.length > 0 ? (
              <div className="p-3">
                <p className="m-0 mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Room types on this floor</p>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {current.types.map((t) => {
                    const share = current.rooms > 0 ? Math.round((t.roomsCount / current.rooms) * 100) : 0;
                    const tone = toneFor(t.roomType);
                    return (
                      <li key={t.roomType}>
                        <button
                          type="button"
                          disabled={!clickableTypes}
                          onClick={() => onRoomTypeClick?.({ roomType: t.roomType, floor: currentFloor, view: "structure" })}
                          className={`group box-border flex w-full items-center gap-3 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2.5 text-left transition-all enabled:cursor-pointer enabled:hover:shadow-[0_6px_16px_-10px_rgba(15,23,42,0.35)] disabled:cursor-default ${tone.ring}`}
                        >
                          <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${tone.tile}`}>
                            <BedDouble className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-slate-900">{t.roomType}</span>
                            <span className="mt-1 flex items-center gap-2">
                              <span className="block h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                                <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${share}%` }} />
                              </span>
                              <span className="flex-none text-[12px] tabular-nums text-slate-600">
                                <span className="font-bold text-slate-900">{t.roomsCount}</span> {t.roomsCount === 1 ? "room" : "rooms"}
                              </span>
                            </span>
                          </span>
                          {clickableTypes && (
                            <span className={`inline-flex h-7 flex-none items-center gap-0.5 rounded-md px-2 text-[12px] font-semibold transition-colors group-hover:text-white ${tone.view}`}>
                              View
                              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {clickableTypes && (
                  <p className="m-0 mt-2.5 px-1 text-[11.5px] text-slate-500">Open a room type to see its details.</p>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400">
                <BedDouble className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p className="m-0 text-sm">No rooms on this floor</p>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
