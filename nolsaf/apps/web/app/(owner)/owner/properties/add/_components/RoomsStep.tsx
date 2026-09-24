import Image from "next/image";
import type { Dispatch, SetStateAction } from "react";
import { AlertCircle, ArrowRight, Check, ChevronDown, Cigarette, CigaretteOff, Copy, Info, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { BATHROOM_ICONS, OTHER_AMENITIES_ICONS } from "@/lib/amenityIcons";
import { useEffect, useMemo, useState } from "react";
import { AddPropertySection } from "./AddPropertySection";
import { StepFooter } from "./StepFooter";
import { FloorPlanner } from "./FloorPlanner";
import { RoomPhotoSlots } from "./RoomPhotoSlots";
import type { FloorUses } from "./floorUses";

export const BATH_ITEMS = ["Free toiletries", "Toilet paper", "Shower", "Water Heater", "Toilet", "Hairdryer", "Trash Bin", "Toilet Brush", "Mirror", "Slippers", "Bathrobe", "Bath Mat", "Towel"];
export const ROOM_ITEMS = ["Free Wi-Fi", "Table", "Chair", "Iron", "TV", "Flat Screen TV", "PS Station", "Wardrobe", "Air Conditioning", "Mini Fridge", "Coffee Maker", "Phone", "Mirror", "Bedside Lamps", "Heating", "Desk", "Safe", "Clothes Rack", "Blackout Curtains", "Couches"];


export function RoomsStep({
  isVisible,
  sectionRef,
  currentStep,
  goToPreviousStep,
  goToNextStep,
  buildingType,
  totalFloors,
  roomType,
  setRoomType,
  beds,
  changeBed,
  roomsCount,
  setRoomsCount,
  roomFloors,
  setRoomFloors,
  roomFloorDistribution,
  setRoomFloorDistribution,
  floorUses,
  setFloorUses,
  smoking,
  setSmoking,
  bathPrivate,
  setBathPrivate,
  bathItems,
  setBathItems,
  towelColor,
  setTowelColor,
  otherAmenities,
  setOtherAmenities,
  otherAmenitiesText,
  setOtherAmenitiesText,
  roomDescription,
  setRoomDescription,
  roomImages,
  onPickRoomImages,
  setRoomImages,
  roomImageSaved,
  setRoomImageSaved,
  roomImageUploading,
  setRoomImageUploading,
  pricePerNight,
  setPricePerNight,
  addRoomType,
  editingRoomIndex,
  onEditRoom,
  onDuplicateRoom,
  onRemoveRoom,
  onCancelRoomEdit,
  definedRooms,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setDefinedRooms,
  numOrEmpty,
  toggleStr,
  BED_ICONS,
}: {
  isVisible: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  currentStep: number;
  goToPreviousStep: () => void;
  goToNextStep: () => void;
  buildingType: string;
  totalFloors: number | "";
  roomType: string;
  setRoomType: (v: string) => void;
  beds: Record<string, number>;
  changeBed: (k: string, delta: number) => void;
  roomsCount: number | "";
  setRoomsCount: (v: number | "") => void;
  roomFloors: number[];
  setRoomFloors: Dispatch<SetStateAction<number[]>>;
  roomFloorDistribution: Record<number, number>;
  setRoomFloorDistribution: Dispatch<SetStateAction<Record<number, number>>>;
  floorUses: FloorUses;
  setFloorUses: Dispatch<SetStateAction<FloorUses>>;
  smoking: "yes" | "no";
  setSmoking: (v: "yes" | "no") => void;
  bathPrivate: "yes" | "no";
  setBathPrivate: (v: "yes" | "no") => void;
  bathItems: string[];
  setBathItems: (v: string[]) => void;
  towelColor: string;
  setTowelColor: (v: string) => void;
  otherAmenities: string[];
  setOtherAmenities: (v: string[]) => void;
  otherAmenitiesText: string;
  setOtherAmenitiesText: (v: string) => void;
  roomDescription: string;
  setRoomDescription: (v: string) => void;
  roomImages: string[];
  onPickRoomImages: (files: FileList) => void;
  setRoomImages: (updater: (prev: string[]) => string[]) => void;
  roomImageSaved: boolean[];
  setRoomImageSaved: (updater: (prev: boolean[]) => boolean[]) => void;
  roomImageUploading: boolean[];
  setRoomImageUploading: (updater: (prev: boolean[]) => boolean[]) => void;
  pricePerNight: number | "";
  setPricePerNight: (v: number | "") => void;
  addRoomType: () => void;
  /** Index of the saved group being edited in the form, or null for a new group */
  editingRoomIndex: number | null;
  onEditRoom: (index: number) => void;
  onDuplicateRoom: (index: number) => void;
  onRemoveRoom: (index: number) => void;
  onCancelRoomEdit: () => void;
  definedRooms: any[];
  setDefinedRooms: (updater: (prev: any[]) => any[]) => void;
  numOrEmpty: (v: any) => number | "";
  toggleStr: (arr: string[], setArr: (v: string[]) => void, item: string) => void;
  BED_ICONS: Record<string, any>;
}) {
  const bedsPerRoom = useMemo(() => {
    return Object.values(beds || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  }, [beds]);
  const roomCountNum = typeof roomsCount === "number" ? roomsCount : 0;
  const selectedBedsSummary = ["twin", "full", "queen", "king"]
    .filter((key) => Number(beds?.[key]) > 0)
    .map((key) => `${beds[key]} ${key.charAt(0).toUpperCase() + key.slice(1)}`)
    .join(" + ");
  const selectedBedTypeCount = ["twin", "full", "queen", "king"].filter((key) => Number(beds?.[key]) > 0).length;
  const shouldConfirmMixedBeds = roomCountNum > 1 && selectedBedTypeCount > 1;

  const roomTypeOk = String(roomType || "").trim().length > 0;
  const roomsCountOk = roomCountNum > 0;
  const bedsOk = bedsPerRoom > 0;
  const roomImagesOk = (roomImages?.length ?? 0) >= 3;
  const MIN_PRICE = 5000; // Minimum price in TZS
  const priceOk = Number(pricePerNight) >= MIN_PRICE;

  const isMultiStorey = buildingType === "multi_storey";
  const floorsCountNum = Number(totalFloors);
  const floorOptions = useMemo(() => {
    if (!isMultiStorey) return [];
    const n = Number.isFinite(floorsCountNum) ? floorsCountNum : 0;
    if (n < 2) return [];
    return Array.from({ length: n }, (_, i) => i); // 0 = Ground
  }, [isMultiStorey, floorsCountNum]);

  const floorLabel = (f: number) => {
    if (f === 0) return "Ground";
    const mod100 = f % 100;
    const mod10 = f % 10;
    const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
    return `${f}${suffix}`;
  };

  const floorDistSum = useMemo(() => {
    return (roomFloors || []).reduce((sum, f) => sum + (Number(roomFloorDistribution?.[f]) || 0), 0);
  }, [roomFloors, roomFloorDistribution]);

  const floorsOk = !isMultiStorey || (roomFloors.length > 0 && roomsCountOk && floorDistSum === roomCountNum);
  const canAddRoomType = roomTypeOk && roomsCountOk && bedsOk && roomImagesOk && priceOk && floorsOk;
  const roomSetupOk = roomTypeOk && roomsCountOk && bedsOk && floorsOk;
  const requiredChecks = [
    { label: "Room type", done: roomTypeOk },
    { label: "Rooms & beds", done: roomsCountOk && bedsOk && floorsOk },
    { label: "3 photos", done: roomImagesOk },
    { label: "Nightly price", done: priceOk },
  ];
  const completedChecks = requiredChecks.filter((item) => item.done).length;
  const savedRoomsTotal = (definedRooms || []).reduce((sum, r) => sum + (Number(r?.roomsCount) || 0), 0);
  const savedRoomTypeNames = Array.from(new Set((definedRooms || []).map((room) => String(room?.roomType || "").trim()).filter(Boolean)));

  // Initialize + keep distribution consistent
  useEffect(() => {
    if (!isMultiStorey) return;
    if (floorOptions.length === 0) return;

    // Default to Ground floor selected on first entry
    if ((roomFloors?.length ?? 0) === 0) {
      setRoomFloors([0]);
      setRoomFloorDistribution({ 0: roomCountNum || 0 });
      return;
    }

    // Prune floors that are no longer valid
    setRoomFloors((prev) => prev.filter((f) => floorOptions.includes(f)));
  }, [isMultiStorey, floorOptions, roomCountNum, roomFloors?.length, setRoomFloors, setRoomFloorDistribution]);

  useEffect(() => {
    if (!isMultiStorey) return;
    // Ensure distribution keys exist only for selected floors
    setRoomFloorDistribution((prev) => {
      const next: Record<number, number> = {};
      for (const f of roomFloors || []) next[f] = Number(prev?.[f]) || 0;
      return next;
    });
  }, [isMultiStorey, roomFloors, setRoomFloorDistribution]);

  useEffect(() => {
    if (!isMultiStorey) return;
    if (!roomCountNum || roomCountNum <= 0) return;
    if (!roomFloors || roomFloors.length === 0) return;

    // Adjust distribution to match roomCountNum (keep existing allocations as much as possible)
    setRoomFloorDistribution((prev) => {
      const next: Record<number, number> = {};
      for (const f of roomFloors) next[f] = Number(prev?.[f]) || 0;

      const current = roomFloors.reduce((sum, f) => sum + (next[f] || 0), 0);
      if (current === roomCountNum) return next;

      if (current === 0) {
        next[roomFloors[0]] = roomCountNum;
        return next;
      }

      if (current < roomCountNum) {
        next[roomFloors[0]] = (next[roomFloors[0]] || 0) + (roomCountNum - current);
        return next;
      }

      // current > roomCountNum: reduce from the last floor backwards
      let over = current - roomCountNum;
      for (let i = roomFloors.length - 1; i >= 0 && over > 0; i--) {
        const f = roomFloors[i];
        const take = Math.min(next[f] || 0, over);
        next[f] = (next[f] || 0) - take;
        over -= take;
      }
      return next;
    });
  }, [isMultiStorey, roomCountNum, roomFloors, setRoomFloorDistribution]);

  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    // Collapse newly-added room types by default (keeps user-expanded ones expanded).
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < (definedRooms?.length ?? 0); i++) next.add(i);
      return next;
    });
  }, [definedRooms?.length]);

  const [openDescriptions, setOpenDescriptions] = useState<Set<number>>(() => new Set());
  const toggleDescription = (idx: number) =>
    setOpenDescriptions((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const [openAmenities, setOpenAmenities] = useState<Set<string>>(() => new Set());
  const toggleAmenities = (key: string) =>
    setOpenAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleCollapsed = (idx: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Floor planner rows. The floors are the truth: each floor holds exactly the
  // number typed or stepped into it, nothing moves between floors on its own,
  // and the group's room count follows the sum. A floor joins the group with
  // its first room and leaves it at zero.
  const floorDist = (f: number) => Number(roomFloorDistribution?.[f] || 0);
  const setFloorCount = (f: number, n: number) => {
    const value = Math.max(0, Math.min(999, Math.floor(Number(n) || 0)));
    const next: Record<number, number> = {};
    for (const floor of roomFloors) next[floor] = floorDist(floor);
    if (value > 0) next[f] = value;
    else delete next[f];
    const used = Object.keys(next)
      .map(Number)
      .filter((floor) => next[floor] > 0)
      .sort((x, y) => x - y);
    const clean: Record<number, number> = {};
    for (const floor of used) clean[floor] = next[floor];
    const total = used.reduce((sum, floor) => sum + clean[floor], 0);
    setRoomFloors(used);
    setRoomFloorDistribution(clean);
    setRoomsCount(total > 0 ? total : "");
  };
  const canPlusFloor = (f: number) => floorDist(f) < 999;
  const plusFloor = (f: number) => setFloorCount(f, floorDist(f) + 1);
  const canMinusFloor = (f: number) => floorDist(f) > 0;
  const minusFloor = (f: number) => setFloorCount(f, floorDist(f) - 1);
  const spreadEvenly = () => {
    const used = [...roomFloors].sort((x, y) => x - y);
    if (used.length < 2 || roomCountNum < 2) return;
    const base = Math.floor(roomCountNum / used.length);
    let extra = roomCountNum - base * used.length;
    const next: Record<number, number> = {};
    for (const f of used) {
      next[f] = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
    }
    setRoomFloorDistribution(next);
    setRoomFloors(used.filter((f) => next[f] > 0));
  };

  // Card numbers follow the cards actually shown: the floor card only exists
  // for a multi-storey building.
  const floorsNo = isMultiStorey ? 3 : null;
  const bathNo = isMultiStorey ? 4 : 3;
  const finishNo = bathNo + 1;
  const savedNo = finishNo + 1;


  return (
    <AddPropertySection
      as="section"
      sectionRef={sectionRef}
      isVisible={isVisible}
      className="add-property-step-surface"
    >
      {isVisible && (
        <div className="w-full">
          <div id="rooms-step-start" className="ap-step-ground">
            {editingRoomIndex !== null && definedRooms[editingRoomIndex] ? (
              <div className="ap-block ap-editing">
                <span className="ap-floor-no">
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </span>
                <p className="m-0 min-w-0 flex-1 text-[13px] text-white/75">
                  Editing{" "}
                  <strong className="text-white">
                    {definedRooms[editingRoomIndex].roomsCount} × {definedRooms[editingRoomIndex].roomType}
                  </strong>
                  . Change anything below, then press Update.
                </p>
                <button type="button" onClick={onCancelRoomEdit} className="ap-btn">
                  Cancel
                </button>
              </div>
            ) : null}

            {/* ---------------------------------------------------------------
                1. The room group: what it is, how many, the house rule.
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">1</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">The room group</h3>
                  <p className="ap-card-sub">One group means identical rooms: same beds, photos and price.</p>
                </div>
                {roomTypeOk && roomsCountOk ? (
                  <span className="ap-card-tag">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {roomCountNum} {roomType}
                  </span>
                ) : (
                  <span className="ap-card-tag is-todo">Required</span>
                )}
              </header>

              <div className="ap-card-body">
                <div className="ap-fields-3">
                  {/* Room type */}
                  <div>
                    <div className="ap-label-row">
                      <label htmlFor="room-type" className="ap-label">
                        Room type <span className="text-red-300">*</span>
                      </label>
                      <details className="group relative shrink-0">
                        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11.5px] font-semibold text-white/60 hover:text-white [&::-webkit-details-marker]:hidden">
                          <Info className="h-3.5 w-3.5" />
                          Guide
                        </summary>
                        <div className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-3rem)] rounded-lg border border-solid border-white/20 bg-[#1d2427] p-3.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]">
                          <dl className="m-0 space-y-2 text-[12px]">
                            {[
                              ["Single", "A room mainly intended for one guest."],
                              ["Double", "A room intended for two guests, usually with one larger bed."],
                              ["Studio", "An open-plan unit where sleeping and living areas share one space."],
                              ["Suite", "A larger premium unit with a separate or defined living area."],
                              ["Family", "A room designed for a family or group, often with multiple beds."],
                              ["Other", "Use when none of the listed room types accurately describe it."],
                            ].map(([name, meaning]) => (
                              <div key={name} className="flex gap-2">
                                <dt className="w-14 shrink-0 font-bold text-white">{name}</dt>
                                <dd className="m-0 leading-relaxed text-white/65">{meaning}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </details>
                    </div>
                    <div className="relative">
                      <select
                        id="room-type"
                        value={roomType}
                        onChange={(e) => setRoomType(e.target.value)}
                        className={`ap-select${roomTypeOk ? " is-set" : ""}`}
                      >
                        <option value="">Select a room type</option>
                        <option value="Single">Single</option>
                        <option value="Double">Double</option>
                        <option value="Studio">Studio</option>
                        <option value="Suite">Suite</option>
                        <option value="Family">Family</option>
                        <option value="Other">Other</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                    </div>
                  </div>

                  {/* How many. With floors, the floors are the truth and this is their sum. */}
                  {isMultiStorey && floorOptions.length > 0 ? (
                    <div>
                      <span className="ap-label">
                        Number of {roomTypeOk ? roomType : "identical"} rooms <span className="text-red-300">*</span>
                      </span>
                      <div className={`ap-sum${roomsCountOk ? " is-set" : ""}`} aria-live="polite">
                        <span className="ap-sum-value">{roomCountNum}</span>
                        <span className="ap-sum-note">{roomsCountOk ? "sum of the floors" : "add rooms per floor"}</span>
                        <button
                          type="button"
                          className="ap-sum-link"
                          onClick={() => document.getElementById("rooms-floors")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        >
                          Set per floor
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                  ) : (
                  <div>
                    <label htmlFor="rooms-count" className="ap-label">
                      Number of {roomTypeOk ? roomType : "identical"} rooms <span className="text-red-300">*</span>
                    </label>
                    <div className="ap-stepper">
                      <button
                        type="button"
                        aria-label="Remove one room"
                        onClick={() => setRoomsCount(roomCountNum <= 1 ? "" : roomCountNum - 1)}
                        disabled={roomCountNum === 0}
                        className="ap-step-btn"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        id="rooms-count"
                        value={roomsCount as any}
                        onChange={(e) => setRoomsCount(numOrEmpty(e.target.value))}
                        type="number"
                        min={1}
                        placeholder="0"
                        className={roomsCountOk ? "is-set" : ""}
                      />
                      <button
                        type="button"
                        aria-label="Add one room"
                        onClick={() => setRoomsCount(roomCountNum + 1)}
                        className="ap-step-btn is-plus"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Smoking */}
                  <div>
                    <span className="ap-label">Smoking inside</span>
                    <div className="ap-toggles" role="radiogroup" aria-label="Smoking allowed">
                      {[
                        { value: "no" as const, label: "Not allowed", icon: CigaretteOff },
                        { value: "yes" as const, label: "Allowed", icon: Cigarette },
                      ].map(({ value, label, icon: SmokingIcon }) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={smoking === value}
                          onClick={() => setSmoking(value)}
                          className={`ap-toggle${smoking === value ? " is-on" : ""}`}
                        >
                          <SmokingIcon className="h-4 w-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {!isMultiStorey ? (
                  <p className="m-0 ap-note mt-3">
                    <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {buildingType === "separate_units"
                      ? "Separate units: rooms are spread across different units, with no floor levels."
                      : "All rooms are on the ground floor."}
                  </p>
                ) : null}
              </div>

              <div className="ap-card-body">
                <label htmlFor="room-description" className="ap-label">
                  {roomTypeOk ? `Describe this ${roomType} room` : "Describe this room"}{" "}
                  <span className="font-normal text-white/40">optional</span>
                </label>
                <textarea
                  id="room-description"
                  value={roomDescription}
                  onChange={(e) => setRoomDescription(e.target.value)}
                  rows={3}
                  className="ap-input ap-textarea"
                  placeholder="e.g. Spacious rooms with natural light, a work desk, and garden views"
                />
              </div>
            </section>

            {/* ---------------------------------------------------------------
                2. Beds inside ONE room of this group.
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">2</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">Beds in one {roomTypeOk ? roomType : "room"}</h3>
                  <p className="ap-card-sub">Only the beds physically inside a single room.</p>
                </div>
                {bedsPerRoom > 0 ? (
                  <span className="ap-card-tag">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {selectedBedsSummary}
                  </span>
                ) : (
                  <span className="ap-card-tag is-todo">Required</span>
                )}
              </header>

              <div className="ap-card-body space-y-3">
                <div className="ap-beds">
                  {[
                    { key: "twin", label: "Twin", size: "99 × 191 cm", sleeps: "Sleeps 1" },
                    { key: "full", label: "Full", size: "137 × 191 cm", sleeps: "Sleeps 2" },
                    { key: "queen", label: "Queen", size: "152 × 203 cm", sleeps: "Sleeps 2" },
                    { key: "king", label: "King", size: "193 × 203 cm", sleeps: "Sleeps 2" },
                  ].map(({ key: k, label, size, sleeps }) => {
                    const BedIcon = BED_ICONS[k];
                    const bedCount = beds[k] ?? 0;
                    return (
                      <div key={k} className={`ap-bed${bedCount > 0 ? " is-on" : ""}`}>
                        <span className="ap-bed-ico">{BedIcon ? <BedIcon className="h-4 w-4" /> : null}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-white">{label} bed</span>
                          <span className="block truncate text-[11.5px] text-white/50">{size} · {sleeps}</span>
                        </span>
                        <span className="ap-stepper is-small">
                          <button
                            type="button"
                            aria-label={`Remove one ${k} bed`}
                            onClick={() => changeBed(k, -1)}
                            disabled={bedCount === 0}
                            className="ap-step-btn"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="ap-step-val">{bedCount}</span>
                          <button
                            type="button"
                            aria-label={`Add one ${k} bed`}
                            onClick={() => changeBed(k, 1)}
                            className="ap-step-btn is-plus"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>

                {shouldConfirmMixedBeds ? (
                  <p className="m-0 ap-note is-strong">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      <strong>Are these beds together in every room?</strong> This setup means all {roomCountNum} {roomType || "rooms"} contain{" "}
                      <strong>{selectedBedsSummary}</strong> each. If the beds belong to different rooms, save them as separate groups, for example 3 rooms with 1 Queen, then 2 rooms with 1 King.
                    </span>
                  </p>
                ) : null}
                {roomCountNum > 0 && bedsPerRoom === 0 ? (
                  <p className="m-0 ap-note is-strong">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Room count is set but no beds yet. Add at least one bed.
                  </p>
                ) : null}
              </div>
            </section>

            {/* The building, floor by floor: this group's rooms and what else is there */}
            {isMultiStorey ? (
              <FloorPlanner
                id="rooms-floors"
                cardNo={floorsNo}
                totalFloors={floorOptions.length}
                roomType={roomTypeOk ? roomType : ""}
                roomCount={roomCountNum}
                roomFloors={roomFloors}
                distribution={roomFloorDistribution}
                definedRooms={definedRooms}
                floorUses={floorUses}
                setFloorUses={setFloorUses}
                onPlus={plusFloor}
                onMinus={minusFloor}
                canPlus={canPlusFloor}
                canMinus={canMinusFloor}
                onSetCount={setFloorCount}
                onSpreadEvenly={spreadEvenly}
              />
            ) : null}

            {/* ---------------------------------------------------------------
                Bathroom and what is inside the room.
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">{bathNo}</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">Bathroom and amenities</h3>
                  <p className="ap-card-sub">Only what guests find inside this room.</p>
                </div>
                <span className={`ap-card-tag${bathItems.length + otherAmenities.length > 0 ? "" : " is-todo"}`}>
                  {bathItems.length + otherAmenities.length > 0 ? `${bathItems.length + otherAmenities.length} selected` : "Optional"}
                </span>
              </header>

              <div className="ap-card-body">
                <div className="ap-fields-3">
                  <div className="sm:col-span-2">
                    <span className="ap-label">Bathroom</span>
                    <div className="ap-toggles" role="radiogroup" aria-label="Bathroom type">
                      {[
                        { value: "yes" as const, label: "Private", help: "Only this room" },
                        { value: "no" as const, label: "Shared", help: "Used by others" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={bathPrivate === option.value}
                          onClick={() => setBathPrivate(option.value)}
                          className={`ap-toggle${bathPrivate === option.value ? " is-on" : ""}`}
                        >
                          {option.label}
                          <span className="font-normal text-white/55">{option.help}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="towel-color" className="ap-label">Towel colour</label>
                    <input
                      id="towel-color"
                      value={towelColor}
                      onChange={(e) => setTowelColor(e.target.value)}
                      className={`ap-input${towelColor.trim() ? " is-set" : ""}`}
                      placeholder="e.g. white"
                    />
                  </div>
                </div>
              </div>

              <div className="ap-card-body">
                <span className="ap-label">In the bathroom</span>
                <div className="ap-checks">
                  {BATH_ITEMS.map((i) => {
                    const Icon = (BATHROOM_ICONS as any)[i];
                    const isChecked = bathItems.includes(i);
                    return (
                      <label key={i} className={`ap-check${isChecked ? " is-on" : ""}`}>
                        <input type="checkbox" className="sr-only" checked={isChecked} onChange={() => toggleStr(bathItems, setBathItems, i)} />
                        <span className="ap-check-ico">{Icon ? <Icon className="h-3.5 w-3.5" /> : null}</span>
                        <span className="min-w-0 truncate">{i}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="ap-card-body">
                <span className="ap-label">In the room</span>
                <div className="ap-checks">
                  {ROOM_ITEMS.map((i) => {
                    const Icon = (OTHER_AMENITIES_ICONS as any)[i];
                    const isChecked = otherAmenities.includes(i);
                    return (
                      <label key={i} className={`ap-check${isChecked ? " is-on" : ""}`}>
                        <input type="checkbox" className="sr-only" checked={isChecked} onChange={() => toggleStr(otherAmenities, setOtherAmenities, i)} />
                        <span className="ap-check-ico">{Icon ? <Icon className="h-3.5 w-3.5" /> : null}</span>
                        <span className="min-w-0 truncate">{i}</span>
                      </label>
                    );
                  })}
                </div>
                <label htmlFor="room-extra-amenities" className="ap-label mt-3">
                  Something missing? <span className="font-normal text-white/40">separate with commas</span>
                </label>
                <input
                  id="room-extra-amenities"
                  value={otherAmenitiesText}
                  onChange={(e) => setOtherAmenitiesText(e.target.value)}
                  className="ap-input"
                  placeholder="e.g. minibar, balcony, mosquito net"
                />
              </div>
            </section>

            {/* ---------------------------------------------------------------
                Photos on the left, the rate and the save on the right: the
                last things to do before the group is saved.
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">{finishNo}</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">Photos and price</h3>
                  <p className="ap-card-sub">Three photos, one nightly rate, then save the group.</p>
                </div>
                <span className={`ap-card-tag${canAddRoomType ? "" : " is-todo"}`}>
                  {canAddRoomType ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Ready to save
                    </>
                  ) : (
                    `${requiredChecks.length - completedChecks} left`
                  )}
                </span>
              </header>

              <div className="ap-split">
                <div className="ap-split-main">
                  <RoomPhotoSlots
                    images={roomImages}
                    onUpload={(files) => {
                      if (files) onPickRoomImages(files);
                    }}
                    onRemove={(index) => {
                      setRoomImages((prev) => prev.filter((_, i) => i !== index));
                      setRoomImageSaved((prev) => prev.filter((_, i) => i !== index));
                      setRoomImageUploading((prev) => prev.filter((_, i) => i !== index));
                    }}
                    saved={roomImageSaved}
                    uploading={roomImageUploading}
                  />
                </div>

                <aside className="ap-split-side">
                  <label htmlFor="room-nightly-price" className="ap-label">
                    Nightly rate, one {roomTypeOk ? roomType : "room"} <span className="text-red-300">*</span>
                  </label>
                  <div className={`ap-price is-lg${priceOk ? " is-set" : ""}`}>
                    <span className="ap-price-unit">TZS</span>
                    <input
                      id="room-nightly-price"
                      value={pricePerNight === "" ? "" : Number(pricePerNight).toLocaleString("en-US")}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/,/g, "");
                        const val = numOrEmpty(raw);
                        setPricePerNight(val);
                      }}
                      type="text"
                      inputMode="numeric"
                      placeholder="50,000"
                    />
                  </div>
                  {!priceOk && pricePerNight !== "" ? (
                    <p className="ap-field-error">Minimum nightly price is TZS 5,000.</p>
                  ) : null}

                  <dl className="ap-rate">
                    <div>
                      <dt>{roomCountNum > 1 ? `All ${roomCountNum} rooms, one night` : "One room, one night"}</dt>
                      <dd>
                        {priceOk
                          ? `TZS ${(Number(pricePerNight) * Math.max(1, roomCountNum)).toLocaleString("en-US")}`
                          : "Not set"}
                      </dd>
                    </div>
                    <div>
                      <dt>Minimum rate</dt>
                      <dd>TZS 5,000</dd>
                    </div>
                  </dl>
                  <p className="m-0 ap-note">Your base rate. NoLSAF commission is added later.</p>

                  <ul className="ap-checklist is-stacked">
                    {requiredChecks.map((item) => (
                      <li key={item.label} className={item.done ? "is-done" : ""}>
                        <span className="ap-checklist-dot">{item.done ? <Check className="h-3 w-3" /> : null}</span>
                        {item.label}
                      </li>
                    ))}
                  </ul>
                  {isMultiStorey && roomsCountOk && !floorsOk ? (
                    <p className="m-0 ap-note is-strong">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      Rooms placed on floors must equal the number of rooms.
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={addRoomType}
                    disabled={!canAddRoomType}
                    className="ap-btn is-primary is-block"
                  >
                    {editingRoomIndex !== null ? "Update" : "Save"} {roomTypeOk ? `${roomType} ` : ""}group
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </aside>
              </div>
            </section>

            {/* ---------------------------------------------------------------
                Saved room groups: review, edit, duplicate or remove.
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">{savedNo}</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">Saved room groups</h3>
                  <p className="ap-card-sub">
                    {definedRooms.length > 0
                      ? `${savedRoomsTotal} ${savedRoomsTotal === 1 ? "room" : "rooms"} in ${definedRooms.length} ${definedRooms.length === 1 ? "group" : "groups"}`
                      : "Each group you save lands here."}
                  </p>
                </div>
                {definedRooms.length > 0 ? (
                  <span className="ap-card-tag">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {definedRooms.length} saved
                  </span>
                ) : (
                  <span className="ap-card-tag is-todo">None yet</span>
                )}
              </header>

              {definedRooms.length === 0 ? (
                <div className="ap-card-body">
                  <p className="m-0 ap-note">Nothing saved yet. Fill in the cards above and press Save group.</p>
                </div>
              ) : (
                <ul className="ap-floor-list">
                  {definedRooms.map((r, idx) => {
                    const isCollapsed = collapsed.has(idx);
                    const isEditing = editingRoomIndex === idx;
                    const dist = r?.floorDistribution && typeof r.floorDistribution === "object" ? (r.floorDistribution as Record<number, number>) : null;
                    const distLabel = dist
                      ? Object.keys(dist)
                          .map((k) => Number(k))
                          .filter((n) => Number.isFinite(n) && Number(dist[n]) > 0)
                          .sort((x, y) => x - y)
                          .map((f) => `${floorLabel(f)} ${dist[f] ?? 0}`)
                          .join(" · ")
                      : "";
                    const bedLabel = [
                      { key: "twin", label: "Twin" },
                      { key: "full", label: "Full" },
                      { key: "queen", label: "Queen" },
                      { key: "king", label: "King" },
                    ]
                      .filter(({ key }) => Number(r.beds?.[key]) > 0)
                      .map(({ key, label }) => `${r.beds[key]} ${label}`)
                      .join(" + ") || "No beds";
                    const meta = [
                      bedLabel,
                      r.bathPrivate === "yes" ? "Private bath" : "Shared bath",
                      r.smoking === "yes" ? "Smoking" : "No smoking",
                      distLabel ? `Floors ${distLabel}` : "",
                    ].filter(Boolean).join(" · ");
                    const photos: string[] = Array.isArray(r.roomImages) ? r.roomImages : [];
                    const thumb = photos[0];
                    return (
                      <li key={idx} className={isEditing ? "ap-saved-item is-editing" : "ap-saved-item"}>
                        <div className="ap-saved">
                          <button
                            type="button"
                            onClick={() => toggleCollapsed(idx)}
                            className="ap-saved-main"
                            aria-expanded={!isCollapsed}
                          >
                            {thumb ? (
                              <span className="ap-saved-thumb">
                                {/^https?:\/\//i.test(thumb) ? (
                                  <Image src={thumb} alt="" width={64} height={48} className="h-full w-full object-cover" />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                                )}
                              </span>
                            ) : (
                              <span className="ap-floor-no">{String(r.roomType || "R").charAt(0)}</span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[13.5px] font-semibold text-white">
                                  {r.roomsCount} × {r.roomType}
                                </span>
                                {isEditing ? <span className="ap-card-tag is-todo">Editing</span> : null}
                              </span>
                              <span className="block truncate text-[11.5px] text-white/55">{meta}</span>
                            </span>
                            {Number(r.pricePerNight) > 0 ? (
                              <span className="ap-saved-price">
                                <strong>TZS {Number(r.pricePerNight).toLocaleString("en-US")}</strong>
                                <span>per night</span>
                              </span>
                            ) : null}
                            <ChevronDown className={`h-4 w-4 shrink-0 text-white/45 transition-transform ${isCollapsed ? "" : "rotate-180"}`} />
                          </button>

                          <div className="ap-saved-actions">
                            <button
                              type="button"
                              onClick={() => onEditRoom(idx)}
                              disabled={isEditing}
                              className="ap-icon-btn"
                              title="Edit this group"
                              aria-label={`Edit ${r.roomsCount} × ${r.roomType}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDuplicateRoom(idx)}
                              className="ap-icon-btn"
                              title="Start a new group from this one"
                              aria-label={`Duplicate ${r.roomsCount} × ${r.roomType}`}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveRoom(idx)}
                              className="ap-icon-btn is-danger"
                              title="Remove this group"
                              aria-label={`Remove ${r.roomsCount} × ${r.roomType}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {!isCollapsed ? (
                          <div className="ap-sheet">
                            {/* Photos: the cover large, the rest as a strip */}
                            <div className="ap-mosaic">
                              {photos.length === 0 ? (
                                <p className="m-0 ap-note">No photos for this group.</p>
                              ) : (
                                photos.slice(0, 5).map((u: string, i: number) => {
                                  const more = i === 4 && photos.length > 5 ? photos.length - 5 : 0;
                                  return (
                                    <div key={i} className={i === 0 ? "ap-mosaic-cover" : "ap-mosaic-thumb"}>
                                      {/^https?:\/\//i.test(u) ? (
                                        <Image src={u} alt={`${r.roomType} photo ${i + 1}`} fill sizes={i === 0 ? "420px" : "110px"} className="object-cover" />
                                      ) : (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={u} alt={`${r.roomType} photo ${i + 1}`} className="absolute inset-0 h-full w-full object-cover" />
                                      )}
                                      {i === 0 ? <span className="ap-photo-tag">{photos.length} {photos.length === 1 ? "photo" : "photos"}</span> : null}
                                      {more > 0 ? <span className="ap-mosaic-more">+{more}</span> : null}
                                    </div>
                                  );
                                })
                              )}
                            </div>

                            <div className="ap-sheet-info">
                              {r.roomDescription ? (
                                <div>
                                  <p className={`m-0 text-[13px] leading-5 text-white/75 ${openDescriptions.has(idx) ? "" : "ap-clamp-2"}`}>
                                    {r.roomDescription}
                                  </p>
                                  {String(r.roomDescription).length > 160 ? (
                                    <button type="button" onClick={() => toggleDescription(idx)} className="ap-sum-link mt-1">
                                      {openDescriptions.has(idx) ? "Show less" : "Read more"}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}

                              <dl className="ap-spec">
                                <div><dt>Rooms</dt><dd>{r.roomsCount}</dd></div>
                                <div><dt>Beds per room</dt><dd>{bedLabel}</dd></div>
                                <div><dt>Bathroom</dt><dd>{r.bathPrivate === "yes" ? "Private" : "Shared"}</dd></div>
                                <div><dt>Smoking</dt><dd>{r.smoking === "yes" ? "Allowed" : "Not allowed"}</dd></div>
                                {r.towelColor ? <div><dt>Towel colour</dt><dd>{r.towelColor}</dd></div> : null}
                                {distLabel ? <div><dt>Floors</dt><dd>{distLabel}</dd></div> : null}
                                <div><dt>Nightly rate</dt><dd className="font-mono tabular-nums">TZS {Number(r.pricePerNight || 0).toLocaleString("en-US")}</dd></div>
                                <div>
                                  <dt>All rooms, one night</dt>
                                  <dd className="font-mono tabular-nums">
                                    TZS {(Number(r.pricePerNight || 0) * (Number(r.roomsCount) || 0)).toLocaleString("en-US")}
                                  </dd>
                                </div>
                              </dl>

                              {[
                                { label: "In the bathroom", items: Array.isArray(r.bathItems) ? r.bathItems : [], icons: BATHROOM_ICONS },
                                { label: "In the room", items: Array.isArray(r.otherAmenities) ? r.otherAmenities : [], icons: OTHER_AMENITIES_ICONS },
                              ].map(({ label, items, icons }) =>
                                items.length ? (
                                  <div key={label}>
                                    <span className="ap-label">
                                      {label} <span className="font-normal text-white/40">{items.length}</span>
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {(openAmenities.has(`${idx}-${label}`) ? items : items.slice(0, 6)).map((item: string) => {
                                        const Icon = (icons as any)[item];
                                        return (
                                          <span key={item} className="ap-chip-static">
                                            {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
                                            {item}
                                          </span>
                                        );
                                      })}
                                      {items.length > 6 ? (
                                        <button type="button" onClick={() => toggleAmenities(`${idx}-${label}`)} className="ap-chip-static is-more">
                                          {openAmenities.has(`${idx}-${label}`) ? "Show less" : `+${items.length - 6} more`}
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null
                              )}

                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

          </div>
        </div>
      )}

      {isVisible && (
        <StepFooter
          onPrev={goToPreviousStep}
          onNext={goToNextStep}
          prevDisabled={currentStep <= 0}
          nextDisabled={currentStep >= 5}
        />
      )}
    </AddPropertySection>
  );
}
