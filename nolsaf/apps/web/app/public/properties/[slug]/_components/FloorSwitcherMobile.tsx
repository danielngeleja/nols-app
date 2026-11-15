"use client";

// Phones only: rooms by floor without the building diagram. A row of floor
// buttons filters a plain list of room types; tapping a type opens the same
// room quick view as the desktop chart. Floors come from the same distribution
// logic as the chart, so both views always agree.
import { useMemo, useState } from "react";
import { BedDouble, ChevronRight, Layers } from "lucide-react";
import { distributeRoomsToFloors } from "@/app/(owner)/owner/properties/add/_components/PropertyVisualizationPreview";
import { floorUseLabel, type FloorUses } from "@/app/(owner)/owner/properties/add/_components/floorUses";

type Room = { roomType: string; roomsCount: number; floorDistribution?: Record<number, number> };

const floorShort = (f: number) => (f === 0 ? "G" : String(f));
const floorLong = (f: number) => {
  if (f === 0) return "Ground floor";
  const s = ["th", "st", "nd", "rd"];
  const v = f % 100;
  return `${f}${s[(v - 20) % 10] || s[v] || s[0]} floor`;
};

export default function FloorSwitcherMobile({ rooms, totalFloors, buildingType, floorUses, onRoomTypeClick }: {
  rooms: Room[];
  totalFloors: number;
  buildingType: string;
  floorUses?: FloorUses;
  onRoomTypeClick: (args: { roomType: string; floor: number }) => void;
}) {
  const byFloor = useMemo(() => distributeRoomsToFloors(rooms as any, totalFloors, buildingType), [rooms, totalFloors, buildingType]);
  const floors = useMemo(
    () => Object.keys(byFloor).map(Number).filter((f) => (byFloor[f] || []).some((r) => r.roomsCount > 0) || (floorUses?.[f] || []).length).sort((a, b) => a - b),
    [byFloor, floorUses],
  );
  const [floor, setFloor] = useState<number | "all">("all");

  // Room types on the chosen floor, or all floors combined.
  const list = useMemo(() => {
    const totals = new Map<string, { count: number; floors: number[] }>();
    for (const f of floors) {
      if (floor !== "all" && f !== floor) continue;
      for (const r of byFloor[f] || []) {
        if (!(r.roomsCount > 0)) continue;
        const cur = totals.get(r.roomType) ?? { count: 0, floors: [] };
        cur.count += r.roomsCount;
        if (!cur.floors.includes(f)) cur.floors.push(f);
        totals.set(r.roomType, cur);
      }
    }
    return [...totals.entries()].map(([roomType, v]) => ({ roomType, ...v })).sort((a, b) => b.count - a.count);
  }, [byFloor, floors, floor]);

  const totalRooms = list.reduce((s, r) => s + r.count, 0);
  const uses = floor === "all" ? [] : (floorUses?.[floor] || []).map(floorUseLabel);
  const multi = floors.length > 1;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><Layers className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0">
          <h2 className="m-0 text-[15px] font-semibold text-slate-900">Rooms by floor</h2>
          <p className="m-0 text-[12px] text-slate-500">{totalRooms} room{totalRooms === 1 ? "" : "s"}{floor === "all" ? ` across ${floors.length} floor${floors.length === 1 ? "" : "s"}` : ` on the ${floorLong(floor).toLowerCase()}`}</p>
        </div>
      </div>

      {multi ? (
        <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Choose a floor">
          {(["all", ...floors] as Array<number | "all">).map((f) => {
            const on = floor === f;
            return (
              <button key={String(f)} type="button" role="tab" aria-selected={on} onClick={() => setFloor(f)}
                aria-label={f === "all" ? "All floors" : floorLong(f)}
                className={`inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-solid px-3.5 text-[13px] font-semibold transition-colors ${on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-700 active:bg-slate-50"}`}>
                {f === "all" ? "All" : floorShort(f)}
              </button>
            );
          })}
        </div>
      ) : null}

      {uses.length ? (
        <p className="m-0 mt-2 text-[12px] text-slate-600">
          <span className="font-semibold text-slate-800">{floorLong(floor as number)}:</span> {uses.join(", ")}
        </p>
      ) : null}

      <ul className="m-0 mt-3 list-none divide-y divide-slate-100 overflow-hidden rounded-xl border border-solid border-slate-200 p-0">
        {list.length ? list.map((r) => (
          <li key={r.roomType}>
            <button type="button" onClick={() => onRoomTypeClick({ roomType: r.roomType, floor: floor === "all" ? r.floors[0] : floor })}
              className="flex w-full items-center gap-3 border-0 bg-white px-3.5 py-3 text-left active:bg-slate-50">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-600"><BedDouble className="h-4 w-4" aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-slate-900">{r.roomType}</span>
                <span className="block text-[12px] text-slate-500">
                  {r.count} room{r.count === 1 ? "" : "s"}
                  {floor === "all" && multi ? ` · ${r.floors.map(floorShort).join(", ")}` : ""}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            </button>
          </li>
        )) : (
          <li className="px-3.5 py-4 text-center text-[13px] text-slate-500">No guest rooms on this floor.</li>
        )}
      </ul>
    </div>
  );
}
