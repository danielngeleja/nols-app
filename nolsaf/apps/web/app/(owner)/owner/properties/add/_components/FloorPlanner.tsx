"use client";

import { AlertCircle, Check, Minus, Plus, Shuffle, X } from "lucide-react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { FLOOR_USES, floorName, floorUseLabel, type FloorUseKey, type FloorUses } from "./floorUses";

/**
 * The building, top floor first. Each floor says, in one row, how many rooms
 * of the group being edited sit there, what saved groups already use it, and
 * what else the floor holds (reception, restaurant, offices...).
 */
export function FloorPlanner({
  id,
  cardNo,
  totalFloors,
  roomType,
  roomCount,
  roomFloors,
  distribution,
  definedRooms,
  floorUses,
  setFloorUses,
  onPlus,
  onMinus,
  canPlus,
  canMinus,
  onSetCount,
  onSpreadEvenly,
}: {
  id?: string;
  cardNo: number | null;
  totalFloors: number;
  roomType: string;
  roomCount: number;
  roomFloors: number[];
  distribution: Record<number, number>;
  definedRooms: any[];
  floorUses: FloorUses;
  setFloorUses: Dispatch<SetStateAction<FloorUses>>;
  onPlus: (floor: number) => void;
  onMinus: (floor: number) => void;
  canPlus: (floor: number) => boolean;
  canMinus: (floor: number) => boolean;
  /** Sets a floor's room count exactly; the group total follows */
  onSetCount: (floor: number, count: number) => void;
  onSpreadEvenly: () => void;
}) {
  const [openFloor, setOpenFloor] = useState<number | null>(null);

  // Rooms already saved in other groups, per floor
  const savedOnFloor = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of definedRooms || []) {
      const dist = r?.floorDistribution && typeof r.floorDistribution === "object" ? r.floorDistribution : null;
      if (!dist) continue;
      for (const [k, v] of Object.entries(dist)) {
        const f = Number(k);
        if (Number.isFinite(f)) map.set(f, (map.get(f) || 0) + (Number(v) || 0));
      }
    }
    return map;
  }, [definedRooms]);

  const hasFloors = Number.isFinite(totalFloors) && totalFloors >= 2;
  const floors = hasFloors ? Array.from({ length: totalFloors }, (_, i) => totalFloors - 1 - i) : [];
  const placed = roomFloors.reduce((sum, f) => sum + (Number(distribution?.[f]) || 0), 0);
  const allPlaced = roomCount > 0 && roomFloors.length > 0 && placed === roomCount;
  const described = floors.filter((f) => (floorUses[f]?.length ?? 0) > 0).length;
  const groupName = roomType ? `${roomType} rooms` : "This group";

  const toggleUse = (floor: number, key: FloorUseKey) =>
    setFloorUses((prev) => {
      const cur = prev[floor] || [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      const out = { ...prev };
      if (next.length) out[floor] = next;
      else delete out[floor];
      return out;
    });

  return (
    <section id={id} className="ap-card scroll-mt-4">
      <header className="ap-card-head">
        <span className="ap-card-head-no">{cardNo}</span>
        <div className="ap-card-head-copy">
          <h3 className="ap-card-title">Floors</h3>
          <p className="ap-card-sub">Type the rooms on each floor. The group total follows.</p>
        </div>
        {allPlaced ? (
          <span className="ap-card-tag">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {placed} {placed === 1 ? "room" : "rooms"} placed
          </span>
        ) : (
          <span className="ap-card-tag is-todo">
            {placed} of {roomCount || 0} placed
          </span>
        )}
      </header>

      {!hasFloors ? (
        <div className="ap-card-body">
          <p className="m-0 ap-note is-strong">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Set the number of floors in step 1 (Basics) to place rooms here.
          </p>
        </div>
      ) : (
        <>
          {/* One line that sums the building up, with the only bulk action */}
          <div className="ap-fl-summary">
            <span>
              <strong>{totalFloors}</strong> floors
            </span>
            <span>
              <strong>{roomFloors.length}</strong> with {groupName.toLowerCase()}
            </span>
            <span>
              <strong>{described}</strong> described
            </span>
            <button
              type="button"
              onClick={onSpreadEvenly}
              disabled={roomFloors.length < 2 || roomCount < 2}
              className="ap-btn-text ml-auto inline-flex items-center gap-1.5"
              title="Share the rooms equally across the floors in use"
            >
              <Shuffle className="h-3.5 w-3.5" aria-hidden />
              Spread evenly
            </button>
          </div>

          <div className="ap-fl-cols" aria-hidden>
            <span>Floor</span>
            <span>{groupName}</span>
            <span>Also on this floor</span>
          </div>

          <ul className="ap-floor-list">
            {floors.map((f) => {
              const mine = Number(distribution?.[f]) || 0;
              const saved = savedOnFloor.get(f) || 0;
              const uses = floorUses[f] || [];
              const isOpen = openFloor === f;
              const empty = mine === 0 && saved === 0 && uses.length === 0;
              return (
                <li key={f} className={`ap-fl-row${mine > 0 ? " is-mine" : ""}`}>
                  <div className="ap-fl-name">
                    <span className="ap-floor-no">{f === 0 ? "G" : f}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-white">{floorName(f)} floor</span>
                      {saved > 0 ? (
                        <span className="block truncate text-[11.5px] text-white/50">
                          +{saved} from saved groups
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <div className="ap-fl-count">
                    <span className="ap-stepper is-small">
                      <button
                        type="button"
                        aria-label={`One less room on the ${floorName(f)} floor`}
                        onClick={() => onMinus(f)}
                        disabled={!canMinus(f)}
                        className="ap-step-btn"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={mine > 0 ? String(mine) : ""}
                        placeholder="0"
                        onChange={(e) => onSetCount(f, Number(e.target.value.replace(/[^0-9]/g, "").slice(0, 3)) || 0)}
                        onFocus={(e) => e.target.select()}
                        aria-label={`Rooms on the ${floorName(f)} floor`}
                      />
                      <button
                        type="button"
                        aria-label={`One more room on the ${floorName(f)} floor`}
                        onClick={() => onPlus(f)}
                        disabled={!canPlus(f)}
                        className="ap-step-btn is-plus"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>

                  <div className="ap-fl-uses">
                    {uses.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleUse(f, k)}
                        className="ap-use is-on"
                        aria-label={`Remove ${floorUseLabel(k)} from the ${floorName(f)} floor`}
                      >
                        {floorUseLabel(k)}
                        <X className="ml-1 h-3 w-3" aria-hidden />
                      </button>
                    ))}

                    {isOpen ? (
                      <>
                        {FLOOR_USES.filter((u) => !uses.includes(u.key)).map((u) => (
                          <button key={u.key} type="button" onClick={() => toggleUse(f, u.key)} className="ap-use">
                            {u.label}
                          </button>
                        ))}
                        <button type="button" onClick={() => setOpenFloor(null)} className="ap-use is-done">
                          Done
                        </button>
                      </>
                    ) : (
                      <>
                        {empty ? <span className="text-[12px] text-white/45">What is here?</span> : null}
                        <button type="button" onClick={() => setOpenFloor(f)} className="ap-use is-add">
                          <Plus className="h-3 w-3" aria-hidden />
                          {uses.length ? "Add" : "Add use"}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {roomCount > 0 && roomFloors.length > 0 && placed !== roomCount ? (
            <div className="ap-card-body">
              <p className="m-0 ap-note is-strong">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {placed} placed but the group has {roomCount} rooms.
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
