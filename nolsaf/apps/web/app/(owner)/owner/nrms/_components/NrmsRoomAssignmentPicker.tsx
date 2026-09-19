"use client";

import { useEffect, useMemo, useState } from "react";
import { BedDouble, Building2, Check, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

export type NrmsRoomChoice = {
  id: number;
  code: string;
  floor?: number | null;
  housekeepingStatus?: string | null;
};

type FloorFilter = "ALL" | "UNASSIGNED" | number;

function floorLabel(floor: number | null): string {
  if (floor == null) return "Floor not set";
  return floor === 0 ? "Ground floor" : `Floor ${floor}`;
}

export default function NrmsRoomAssignmentPicker({
  roomTypeName,
  units,
  selectedUnitId,
  onSelect,
  totalFloors,
  loading = false,
  disabled = false,
}: {
  roomTypeName: string;
  units: NrmsRoomChoice[];
  selectedUnitId: number | "";
  onSelect: (id: number) => void;
  totalFloors?: number | null;
  loading?: boolean;
  disabled?: boolean;
}) {
  const [floorFilter, setFloorFilter] = useState<FloorFilter>("ALL");
  const floorOptions = useMemo(() => {
    const floors = [...new Set(units.flatMap((unit) => unit.floor == null ? [] : [unit.floor]))].sort((a, b) => a - b);
    return {
      floors,
      hasUnassigned: units.some((unit) => unit.floor == null),
    };
  }, [units]);
  const explicitlySingleStorey = Number(totalFloors) === 1;
  const multiStorey = !explicitlySingleStorey && (
    Number(totalFloors ?? 0) > 1
    || floorOptions.floors.length > 1
    || floorOptions.floors.some((floor) => floor !== 0)
  );
  const visibleUnits = floorFilter === "ALL"
    ? units
    : floorFilter === "UNASSIGNED"
      ? units.filter((unit) => unit.floor == null)
      : units.filter((unit) => unit.floor === floorFilter);
  const groupedUnits = useMemo(() => {
    if (!multiStorey) return [{ floor: null, units: visibleUnits }];
    const groups = new Map<number | null, NrmsRoomChoice[]>();
    for (const unit of visibleUnits) {
      const floor = unit.floor ?? null;
      groups.set(floor, [...(groups.get(floor) ?? []), unit]);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left == null ? 1 : right == null ? -1 : left - right)
      .map(([floor, grouped]) => ({ floor, units: grouped }));
  }, [multiStorey, visibleUnits]);

  useEffect(() => {
    if (!multiStorey) setFloorFilter("ALL");
    else if (floorFilter === "UNASSIGNED" && !floorOptions.hasUnassigned) setFloorFilter("ALL");
    else if (typeof floorFilter === "number" && !floorOptions.floors.includes(floorFilter)) setFloorFilter("ALL");
  }, [floorFilter, floorOptions, multiStorey]);

  return (
    <section className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white" aria-label="Room assignment">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50/70 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><LockKeyhole className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Paid room category</p>
            <p className="mb-0 mt-0.5 truncate text-sm font-bold text-neutral-950">{roomTypeName}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100"><ShieldCheck className="h-3 w-3" />Category locked</span>
      </div>

      <div className="px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h4 className="m-0 text-xs font-bold text-neutral-900">Choose an available room number</h4>
            <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Only free, active rooms from this category are shown.</p>
          </div>
          {!loading && <span className="shrink-0 text-[11px] font-semibold tabular-nums text-neutral-400">{units.length} available</span>}
        </div>

        {multiStorey && !loading && units.length > 0 && (
          <div className="mb-4 flex gap-1.5 overflow-x-auto border-y border-neutral-100 bg-neutral-50/60 px-2 py-2" aria-label="Filter available rooms by floor">
            <button type="button" onClick={() => setFloorFilter("ALL")} className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[10px] font-bold transition ${floorFilter === "ALL" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-white"}`}>All floors · {units.length}</button>
            {floorOptions.floors.map((floor) => <button key={floor} type="button" onClick={() => setFloorFilter(floor)} className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[10px] font-bold transition ${floorFilter === floor ? "bg-emerald-700 text-white" : "text-neutral-600 hover:bg-white"}`}>{floorLabel(floor)} · {units.filter((unit) => unit.floor === floor).length}</button>)}
            {floorOptions.hasUnassigned && <button type="button" onClick={() => setFloorFilter("UNASSIGNED")} className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[10px] font-bold transition ${floorFilter === "UNASSIGNED" ? "bg-amber-600 text-white" : "text-amber-700 hover:bg-white"}`}>Floor not set · {units.filter((unit) => unit.floor == null).length}</button>}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-28 items-center justify-center gap-2 text-xs font-semibold text-neutral-500"><Loader2 className="h-4 w-4 animate-spin text-emerald-700" />Checking live availability</div>
        ) : units.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center border-y border-neutral-100 text-center">
            <BedDouble className="h-5 w-5 text-neutral-300" />
            <p className="mb-0 mt-2 text-xs font-bold text-neutral-700">No room number is free</p>
            <p className="mb-0 mt-1 text-[11px] text-neutral-400">Availability may change when another stay releases a room.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedUnits.map((group) => <div key={group.floor ?? "unassigned"}>
              {multiStorey && <div className="mb-2 flex items-center justify-between gap-3"><span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] ${group.floor == null ? "text-amber-700" : "text-neutral-500"}`}><Building2 className="h-3.5 w-3.5" />{floorLabel(group.floor)}</span><span className="text-[10px] font-semibold tabular-nums text-neutral-400">{group.units.length} free</span></div>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {group.units.map((unit) => {
              const selected = selectedUnitId === unit.id;
              const housekeeping = String(unit.housekeepingStatus || "").replace(/_/g, " ").toLowerCase();
              return (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => onSelect(unit.id)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={`flex min-h-14 items-center gap-2.5 rounded-lg border border-solid px-3 text-left transition ${selected ? "border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-100" : "border-neutral-200 bg-white text-neutral-800 hover:border-emerald-300 hover:bg-emerald-50/40"} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${selected ? "bg-emerald-700 text-white" : "bg-neutral-100 text-neutral-500"}`}>{selected ? <Check className="h-4 w-4" strokeWidth={3} /> : <BedDouble className="h-4 w-4" />}</span>
                  <span className="min-w-0"><strong className="block truncate text-xs">Room {unit.code}</strong>{housekeeping && <span className="mt-0.5 block truncate text-[9px] capitalize text-neutral-400">{housekeeping}</span>}</span>
                </button>
              );
            })}
              </div>
            </div>)}
          </div>
        )}
      </div>
    </section>
  );
}
