import { useEffect, useMemo, useState } from "react";
import { NightlyPriceDialog } from "./NightlyPriceDialog";
import { InfoTip } from "./InfoTip";
import { BedDouble, BedSingle, Banknote, Check, KeyRound, Layers, Minus, Plus, Pencil, Trash2, Users } from "lucide-react";
import { RoomPhotoSlots } from "./RoomPhotoSlots";
import { declaredGuestCapacity, firstIncompleteBedroomIndex, hasCompleteBedrooms, type BedKey, type BedroomLayout } from "@/lib/listingInventory";

const BED_TYPES: Array<{ key: BedKey; label: string; size: string }> = [
  { key: "twin", label: "Twin", size: "99 × 191 cm" },
  { key: "full", label: "Full", size: "137 × 191 cm" },
  { key: "queen", label: "Queen", size: "152 × 203 cm" },
  { key: "king", label: "King", size: "193 × 203 cm" },
];
const KITCHEN_TYPES = ["Private kitchen", "Kitchenette", "Shared kitchen"];
const KITCHEN_EQUIPMENT = ["Cooking allowed", "Stove", "Oven", "Refrigerator", "Cookware", "Dishes and cutlery", "Dining table", "Microwave", "Electric kettle"];
const KITCHEN_CHOICES = [
  { value: "", label: "No kitchen", detail: "No kitchen access" },
  { value: "Private kitchen", label: "Private kitchen", detail: "Only for this unit" },
  { value: "Kitchenette", label: "Kitchenette", detail: "Compact kitchen area" },
  { value: "Shared kitchen", label: "Shared kitchen", detail: "Shared with others" },
];
const LIVING_AMENITIES = ["Washing machine", "Balcony", "Private entrance", "Barbecue area", "Garden or courtyard"];
export const UNIT_AMENITY_ITEMS = [...KITCHEN_TYPES, ...KITCHEN_EQUIPMENT, ...LIVING_AMENITIES];

export function EntireUnitEditor({
  unitsMode = false, propertyType = "", setRoomType, roomsCount, setRoomsCount,
  roomType, bedrooms, setBedrooms,
  roomDescription, setRoomDescription, bathItems, setBathItems,
  otherAmenities, setOtherAmenities, otherAmenitiesText, setOtherAmenitiesText,
  roomImages, onPickRoomImages, setRoomImages, roomImageSaved, setRoomImageSaved,
  roomImageUploading, setRoomImageUploading, pricePerNight, setPricePerNight,
  commissionPercent,
  pricingMode, setPricingMode, includedGuests, setIncludedGuests, extraGuestFee, setExtraGuestFee,
  addRoomType, editingRoomIndex, onEditRoom, onRemoveRoom, onCancelRoomEdit,
  definedRooms, bathOptions, sharedOptions,
}: {
  /** Separate units: several unit types, each with its own count of identical units. */
  unitsMode?: boolean;
  /** Property type, used to suggest a name such as "2-bedroom apartment". */
  propertyType?: string;
  setRoomType?: (value: string) => void;
  roomsCount?: number | "";
  setRoomsCount?: (value: number | "") => void;
  roomType: string;
  bedrooms: BedroomLayout[]; setBedrooms: (value: BedroomLayout[]) => void;
  roomDescription: string; setRoomDescription: (value: string) => void;
  bathItems: string[]; setBathItems: (value: string[]) => void;
  otherAmenities: string[]; setOtherAmenities: (value: string[]) => void;
  otherAmenitiesText: string; setOtherAmenitiesText: (value: string) => void;
  roomImages: string[]; onPickRoomImages: (files: FileList) => void;
  setRoomImages: (updater: (prev: string[]) => string[]) => void;
  roomImageSaved: boolean[]; setRoomImageSaved: (updater: (prev: boolean[]) => boolean[]) => void;
  roomImageUploading: boolean[]; setRoomImageUploading: (updater: (prev: boolean[]) => boolean[]) => void;
  pricePerNight: number | ""; setPricePerNight: (value: number | "") => void;
  commissionPercent: number | null;
  pricingMode: "FLAT" | "EXTRA_GUEST"; setPricingMode: (value: "FLAT" | "EXTRA_GUEST") => void;
  includedGuests: number | ""; setIncludedGuests: (value: number | "") => void;
  extraGuestFee: number | ""; setExtraGuestFee: (value: number | "") => void;
  addRoomType: () => void; editingRoomIndex: number | null;
  onEditRoom: (index: number) => void; onRemoveRoom: (index: number) => void;
  onCancelRoomEdit: () => void; definedRooms: any[];
  bathOptions: string[]; sharedOptions: string[];
}) {
  const [openBedroom, setOpenBedroom] = useState(0);
  // The nightly price is edited in a popup card; the section only shows the result.
  const [priceOpen, setPriceOpen] = useState(false);
  const guestCapacity = useMemo(() => declaredGuestCapacity(bedrooms), [bedrooms]);
  const kitchenType = KITCHEN_TYPES.find((item) => otherAmenities.includes(item)) ?? "";
  useEffect(() => {
    if (kitchenType && !otherAmenities.includes("Cooking allowed")) setOtherAmenities([...otherAmenities, "Cooking allowed"]);
  }, [kitchenType, otherAmenities, setOtherAmenities]);
  const incompleteBedroom = firstIncompleteBedroomIndex(bedrooms);
  const completedBedrooms = bedrooms.filter((bedroom) => firstIncompleteBedroomIndex([bedroom]) === -1).length;
  const selectedBedroomIndex = Math.max(0, Math.min(openBedroom, bedrooms.length - 1));
  const selectedBedroom = bedrooms[selectedBedroomIndex];
  const pricingComplete = pricingMode === "FLAT" || (Number.isInteger(Number(includedGuests)) && Number(includedGuests) >= 1 && Number(includedGuests) < guestCapacity && Number(extraGuestFee) > 0);
  const unitCount = Number(roomsCount) || 0;
  const canSave = roomType.trim().length > 0 && hasCompleteBedrooms(bedrooms) && roomImages.length >= 3 && Number(pricePerNight) >= 5000 && pricingComplete && (!unitsMode || unitCount >= 1);
  // Entire place: one unit, so the form closes once it is saved. Separate units:
  // the form stays open for the next unit type.
  const hasSavedUnit = !unitsMode && definedRooms.length > 0 && editingRoomIndex === null;
  const unitName = roomType.trim() || "unit";
  // Separate units add a "Unit type" card first, so the other cards shift by one.
  const n = (base: number) => (unitsMode ? base + 1 : base);

  // A unit always exists once you describe one: start the count at 1.
  useEffect(() => {
    if (unitsMode && (roomsCount === "" || roomsCount === undefined || Number(roomsCount) < 1)) setRoomsCount?.(1);
  }, [unitsMode, roomsCount, setRoomsCount]);

  // Names guests understand, built from what the owner lists. The first one
  // follows the bedrooms set below, so the name and the layout agree.
  const placeWord = (propertyType && propertyType !== "Other" ? propertyType : "Apartment").toLowerCase();
  const nameSuggestions = Array.from(new Set([
    bedrooms.length > 0 ? `${bedrooms.length}-bedroom ${placeWord}` : "",
    `Studio ${placeWord}`,
    `1-bedroom ${placeWord}`,
    `2-bedroom ${placeWord}`,
    `3-bedroom ${placeWord}`,
    "Penthouse",
  ].filter(Boolean))).slice(0, 5);

  // The name and the bedrooms describe the same unit, so they must agree.
  const namedBedrooms = (() => {
    const match = roomType.match(/(\d+)\s*-?\s*bed(room)?/i);
    return match ? Number(match[1]) : /\bstudio\b/i.test(roomType) ? 0 : null;
  })();
  const nameMismatch = unitsMode && namedBedrooms !== null && namedBedrooms > 0 && namedBedrooms !== bedrooms.length;
  const matchingName = `${bedrooms.length}-bedroom ${placeWord}`;
  const updateBedroom = (index: number, next: BedroomLayout) => {
    setOpenBedroom(index);
    setBedrooms(bedrooms.map((room, i) => i === index ? next : room));
  };
  const addBedroom = () => {
    if (incompleteBedroom >= 0) {
      setOpenBedroom(incompleteBedroom);
      window.setTimeout(() => document.getElementById(`bedroom-panel-${incompleteBedroom}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    const newIndex = bedrooms.length;
    setOpenBedroom(newIndex);
    setBedrooms([...bedrooms, { name: `Bedroom ${newIndex + 1}`, beds: { twin: 0, full: 0, queen: 0, king: 0 }, sleeps: 0 }]);
    window.setTimeout(() => document.getElementById(`bedroom-${newIndex}`)?.focus(), 0);
  };
  const toggle = (list: string[], setList: (value: string[]) => void, item: string) =>
    setList(list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);

  return <div className="ap-step-ground space-y-4">
    {!hasSavedUnit && <>
    {unitsMode && <section className="ap-card">
      <header className="ap-card-head"><span className="ap-card-head-no">1</span><div className="ap-card-head-copy">
        <h3 className="ap-card-title">{editingRoomIndex !== null ? "Edit this layout" : definedRooms.length > 0 ? "Add another layout" : "Which units are these?"}</h3>
        <InfoTip label="What is a layout?" title="What is a layout?">
          <div className="it-rows">
            <div className="it-row"><span className="it-ico"><Layers className="h-4 w-4" /></span><div><strong>Same rooms, one layout</strong><span>4 identical flats? Add once, set 4 units.</span></div></div>
            <div className="it-row"><span className="it-ico"><Plus className="h-4 w-4" /></span><div><strong>Different rooms, new layout</strong><span>A penthouse gets its own.</span></div></div>
            <div className="it-row"><span className="it-ico"><KeyRound className="h-4 w-4" /></span><div><strong>Guests book one unit</strong><span>The rest stay free that night.</span></div></div>
          </div>
          <div className="it-example" aria-label="Example: 4 two-bedroom flats and 1 penthouse make 2 layouts and 5 units">
            <span className="it-chip">2-bedroom flat <b>×4</b></span>
            <span className="it-chip">Penthouse <b>×1</b></span>
            <span className="it-sum">= 2 layouts, 5 units</span>
          </div>
        </InfoTip>
        <p className="ap-card-sub">Add one layout at a time. Units that look the same go together.</p>
      </div>{roomType.trim() ? <span className="ap-card-tag"><Check className="h-3.5 w-3.5" aria-hidden />{unitCount} × {roomType.trim()}</span> : <span className="ap-card-tag is-todo">Required</span>}</header>
      <div className="ap-card-body">
        <div className="ap-unit-type-grid">
          <div className="min-w-0">
            <label className="ap-label" htmlFor="unit-type-name">Name guests will see <span className="text-red-300">*</span></label>
            <input id="unit-type-name" className={`ap-input${roomType.trim() ? " is-set" : ""}`} maxLength={100} value={roomType} onChange={(event) => setRoomType?.(event.target.value)} placeholder={nameSuggestions[0] || "e.g. 2-bedroom apartment"} />
            <div className="ap-unit-name-chips" role="group" aria-label="Suggested names">
              {nameSuggestions.map((name) => <button key={name} type="button" className={`ap-unit-name-chip${roomType.trim() === name ? " is-on" : ""}`} onClick={() => setRoomType?.(name)}>{name}</button>)}
            </div>
            {nameMismatch ? (
              <p className="ap-unit-mismatch" role="status">
                The name says {namedBedrooms} bedroom{namedBedrooms === 1 ? "" : "s"}, but {bedrooms.length} {bedrooms.length === 1 ? "is" : "are"} set below.
                <button type="button" onClick={() => setRoomType?.(matchingName)}>Use &quot;{matchingName}&quot;</button>
              </p>
            ) : null}
          </div>
          <div className="min-w-0">
            <label className="ap-label" htmlFor="unit-type-count">Units with this layout</label>
            <div className={`ap-stepper${unitCount >= 1 ? " is-set" : ""}`}>
              <button type="button" className="ap-step-btn" aria-label="One fewer unit" disabled={unitCount <= 1} onClick={() => setRoomsCount?.(Math.max(1, unitCount - 1))}><Minus className="h-4 w-4" /></button>
              <input id="unit-type-count" type="text" inputMode="numeric" value={roomsCount ?? ""} placeholder="1" onChange={(event) => { const raw = event.target.value.replace(/[^0-9]/g, "").slice(0, 3); setRoomsCount?.(raw ? Math.max(1, Number(raw)) : ""); }} />
              <button type="button" className="ap-step-btn is-plus" aria-label="One more unit" disabled={unitCount >= 999} onClick={() => setRoomsCount?.(unitCount + 1)}><Plus className="h-4 w-4" /></button>
            </div>
            <p className="ap-unit-count-hint">
              {unitCount <= 1
                ? "Just this one. If other units look exactly the same, add them here."
                : `${unitCount} units look the same. Guests book one at a time, so ${unitCount} separate bookings fit on the same night.`}
            </p>
          </div>
        </div>
      </div>
    </section>}
    <section className="ap-card">
      <header className="ap-card-head"><span className="ap-card-head-no">{n(1)}</span><div className="ap-card-head-copy">
        <h3 className="ap-card-title">{unitsMode ? `Bedrooms in each ${unitName}` : "Bedrooms and beds"}</h3>
        <p className="ap-card-sub">{unitsMode
          ? (unitCount > 1 ? `Set them once. All ${unitCount} units of this layout get the same bedrooms.` : "Set the bedrooms of this unit. One booking includes all of them.")
          : `One booking includes every bedroom in this ${roomType || "place"}.`}</p>
      </div><span className="ap-card-tag">{completedBedrooms === bedrooms.length
        ? (unitsMode ? `Sleeps ${guestCapacity} per unit${unitCount > 1 ? ` · ${guestCapacity * unitCount} across ${unitCount}` : ""}` : `Sleeps ${guestCapacity} guests in total`)
        : `${bedrooms.length - completedBedrooms} ${bedrooms.length - completedBedrooms === 1 ? "bedroom needs" : "bedrooms need"} details`}</span>
        <button type="button" className="ap-btn ap-unit-add-button" aria-describedby={incompleteBedroom >= 0 ? "unit-bedroom-requirement" : undefined} onClick={addBedroom}><Plus className="h-4 w-4" /> Add bedroom</button>
      </header>
      <div className="ap-card-body"><div className="ap-bedroom-workspace">
        <div className="ap-bedroom-list" aria-label={unitsMode ? `Bedrooms in each ${unitName}` : "Bedrooms in this unit"}>
          <div className="ap-bedroom-list-heading"><strong>Bedrooms</strong><span>{completedBedrooms} of {bedrooms.length} complete</span></div>
          {bedrooms.map((bedroom, index) => {
            const bedsCount = BED_TYPES.reduce((sum, bed) => sum + (Number(bedroom.beds[bed.key]) || 0), 0);
            const declared = Number.isInteger(Number(bedroom.sleeps)) && Number(bedroom.sleeps) > 0 ? Number(bedroom.sleeps) : 0;
            const ready = bedroom.name.trim() && bedsCount > 0 && declared > 0;
            const status = !bedroom.name.trim() ? "Name needed" : !bedsCount ? "Add a bed" : !declared ? "Set guest capacity" : `${bedsCount} ${bedsCount === 1 ? "bed" : "beds"} · sleeps ${declared}`;
            return <div key={index} className={`ap-bedroom-list-row${selectedBedroomIndex === index ? " is-selected" : ""}`}>
              <button type="button" className="ap-bedroom-list-select" aria-current={selectedBedroomIndex === index ? "true" : undefined} onClick={() => setOpenBedroom(index)}><span className={`ap-bedroom-list-no${ready ? " is-ready" : ""}`}>{ready ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}</span><span className="ap-bedroom-list-copy"><strong>{bedroom.name.trim() || `Bedroom ${index + 1}`}</strong><small className={ready ? "" : "is-needed"}>{status}</small></span></button>
              {bedrooms.length > 1 && <button type="button" className="ap-bedroom-list-remove" aria-label={`Remove bedroom ${index + 1}`} onClick={() => { setBedrooms(bedrooms.filter((_, i) => i !== index)); setOpenBedroom(selectedBedroomIndex === index ? Math.max(0, index - 1) : index < selectedBedroomIndex ? selectedBedroomIndex - 1 : selectedBedroomIndex); }}><Trash2 className="h-4 w-4" /></button>}
            </div>;
          })}
        </div>
        {selectedBedroom && <div id={`bedroom-panel-${selectedBedroomIndex}`} className="ap-bedroom-editor">
          <div className="ap-bedroom-editor-head"><div><strong>Bedroom {selectedBedroomIndex + 1}</strong><span>Set the beds and the number of guests. The total is calculated for you.</span></div></div>
          <label className="ap-label" htmlFor={`bedroom-${selectedBedroomIndex}`}>Bedroom name</label>
          <input id={`bedroom-${selectedBedroomIndex}`} className="ap-unit-bedroom-name-input" value={selectedBedroom.name} onChange={(event) => updateBedroom(selectedBedroomIndex, { ...selectedBedroom, name: event.target.value })} placeholder={`Bedroom ${selectedBedroomIndex + 1}`} />
          <span className="ap-label ap-bedroom-beds-label">Beds in this bedroom</span>
          <div className="ap-beds">{BED_TYPES.map(({ key, label, size }) => {
            const BedIcon = key === "twin" ? BedSingle : BedDouble;
            const bedCount = Number(selectedBedroom.beds[key]) || 0;
            const bedroomLabel = selectedBedroom.name || `bedroom ${selectedBedroomIndex + 1}`;
            const setCount = (next: number) => updateBedroom(selectedBedroomIndex, { ...selectedBedroom, beds: { ...selectedBedroom.beds, [key]: Math.max(0, next) } });
            return <div key={key} className={`ap-bed${bedCount > 0 ? " is-on" : ""}`}>
              <div className="ap-bed-top">
                <span className="ap-bed-ico"><BedIcon className="h-4 w-4" /></span>
                <span className="ap-bed-copy"><span className="ap-bed-name">{label} bed</span><span className="ap-bed-size">{size}</span></span>
              </div>
              <div className="ap-bed-step">
                <button type="button" className="ap-bed-step-btn" aria-label={`Remove one ${label.toLowerCase()} bed from ${bedroomLabel}`} disabled={bedCount === 0} onClick={() => setCount(bedCount - 1)}><Minus className="h-3.5 w-3.5" /></button>
                <span className="ap-bed-step-val" aria-live="polite">{bedCount}</span>
                <button type="button" className="ap-bed-step-btn is-plus" aria-label={`Add one ${label.toLowerCase()} bed to ${bedroomLabel}`} onClick={() => setCount(bedCount + 1)}><Plus className="h-3.5 w-3.5" /></button>
              </div>
            </div>;
          })}</div>
          <div className="ap-bedroom-capacity"><div className="ap-bedroom-capacity-copy"><span className="ap-label">How many guests can sleep here? <span className="text-red-300">*</span></span><p className="ap-note">Choose one number. We add the bedrooms together automatically.</p></div><div className="ap-bedroom-quick-count" role="group" aria-label={`Guest capacity for ${selectedBedroom.name || `Bedroom ${selectedBedroomIndex + 1}`}`}>{[1, 2, 3, 4].map((count) => <button key={count} type="button" className={Number(selectedBedroom.sleeps) === count ? "is-on" : ""} aria-pressed={Number(selectedBedroom.sleeps) === count} onClick={() => updateBedroom(selectedBedroomIndex, { ...selectedBedroom, sleeps: count })}>{count}</button>)}<label className="ap-bedroom-more-count"><span>Or type</span><input type="text" inputMode="numeric" aria-label="Type guest capacity" value={selectedBedroom.sleeps || ""} placeholder="5+" onChange={(event) => { const raw = event.target.value.replace(/[^0-9]/g, "").slice(0, 2); updateBedroom(selectedBedroomIndex, { ...selectedBedroom, sleeps: raw ? Number(raw) : 0 }); }} /></label></div></div>
        </div>}
      </div>
        <p id="unit-bedroom-requirement" className={`ap-note ap-bedroom-status mt-2${incompleteBedroom < 0 ? " text-teal-300" : ""}`} role="status">{incompleteBedroom >= 0 ? `Complete Bedroom ${incompleteBedroom + 1} with a name, at least one bed, and its guest capacity before adding another bedroom or continuing.` : "Bedrooms are complete. You can add another bedroom or continue."}</p>
        <div className="mt-4"><label className="ap-label" htmlFor="unit-description">{unitsMode ? `Describe one ${unitName}` : "Describe the whole place"}</label>
          <textarea id="unit-description" className="ap-input ap-textarea" rows={3} value={roomDescription} onChange={(event) => setRoomDescription(event.target.value)} placeholder="Layout, living areas, privacy and what guests can use" />
        </div>
      </div>
    </section>

    <section className="ap-card">
      <header className="ap-card-head"><span className="ap-card-head-no">{n(2)}</span><div className="ap-card-head-copy"><h3 className="ap-card-title">{unitsMode ? `What is inside each ${unitName}?` : "What is inside this unit?"}</h3><p className="ap-card-sub">Select only amenities guests can actually use.</p></div></header>
      <div className="ap-card-body space-y-4">
        <div className="ap-kitchen-section"><span className="ap-label" id="unit-kitchen-label">Kitchen access</span>
          <div className="ap-kitchen-choices" role="radiogroup" aria-labelledby="unit-kitchen-label">{KITCHEN_CHOICES.map(({ value, label, detail }) => <label key={label} className={`ap-kitchen-choice${kitchenType === value ? " is-on" : ""}`}>
            <input type="radio" className="sr-only" name="unit-kitchen-type" value={value} checked={kitchenType === value} onChange={() => {
              const kept = otherAmenities.filter((item) => !KITCHEN_TYPES.includes(item) && item !== "Cooking allowed" && (value || !KITCHEN_EQUIPMENT.includes(item)));
              // A kitchen is there to cook in: choosing one allows cooking.
              setOtherAmenities(value ? [...kept, value, "Cooking allowed"] : kept);
            }} />
            <span className="ap-kitchen-choice-copy"><strong>{label}</strong><small>{detail}</small></span><span className="ap-kitchen-choice-mark" aria-hidden="true">{kitchenType === value && <Check className="h-3.5 w-3.5" />}</span>
          </label>)}</div>
          {kitchenType && <div className="ap-kitchen-details">
            <p className="m-0 ap-note"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden />Guests can cook in this kitchen.</p>
            <div><span className="ap-label">Available kitchen equipment</span><div className="ap-checks">{KITCHEN_EQUIPMENT.filter((item) => item !== "Cooking allowed").map((item) => <label key={item} className={`ap-check${otherAmenities.includes(item) ? " is-on" : ""}`}><input type="checkbox" className="sr-only" checked={otherAmenities.includes(item)} onChange={() => toggle(otherAmenities, setOtherAmenities, item)} /><span>{item}</span></label>)}</div></div>
          </div>}
        </div>
        <div><span className="ap-label">Living spaces</span><div className="ap-checks">{LIVING_AMENITIES.map((item) => <label key={item} className={`ap-check${otherAmenities.includes(item) ? " is-on" : ""}`}><input type="checkbox" className="sr-only" checked={otherAmenities.includes(item)} onChange={() => toggle(otherAmenities, setOtherAmenities, item)} /><span>{item}</span></label>)}</div></div>
        <div><span className="ap-label">Other amenities in the unit</span><div className="ap-checks">{sharedOptions.map((item) => <label key={item} className={`ap-check${otherAmenities.includes(item) ? " is-on" : ""}`}><input type="checkbox" className="sr-only" checked={otherAmenities.includes(item)} onChange={() => toggle(otherAmenities, setOtherAmenities, item)} /><span>{item}</span></label>)}</div></div>
        <div><span className="ap-label">Bathrooms</span><div className="ap-checks">{bathOptions.map((item) => <label key={item} className={`ap-check${bathItems.includes(item) ? " is-on" : ""}`}><input type="checkbox" className="sr-only" checked={bathItems.includes(item)} onChange={() => toggle(bathItems, setBathItems, item)} /><span>{item}</span></label>)}</div></div>
        <div><label className="ap-label" htmlFor="unit-other-amenities">Something missing? Separate with commas</label><input id="unit-other-amenities" className="ap-input" value={otherAmenitiesText} onChange={(event) => setOtherAmenitiesText(event.target.value)} placeholder="e.g. barbecue, mosquito net" /></div>
      </div>
    </section>

    <section className="ap-card">
      <header className="ap-card-head"><span className="ap-card-head-no">{n(3)}</span><div className="ap-card-head-copy"><h3 className="ap-card-title">{unitsMode ? `Photos and price for one ${unitName}` : "Photos and price for the whole unit"}</h3><p className="ap-card-sub">{unitsMode ? "Photos of this unit type, and the nightly rate for one unit." : "Add at least three photos, then set your nightly rate."}</p></div></header>
      <div className="ap-card-body ap-unit-finish">
        <RoomPhotoSlots images={roomImages} onUpload={(files) => { if (files) onPickRoomImages(files); }} onRemove={(index) => { setRoomImages((prev) => prev.filter((_, i) => i !== index)); setRoomImageSaved((prev) => prev.filter((_, i) => i !== index)); setRoomImageUploading((prev) => prev.filter((_, i) => i !== index)); }} saved={roomImageSaved} uploading={roomImageUploading} />
        {(() => {
          const priceSet = Number(pricePerNight) >= 5000;
          const priceReady = priceSet && pricingComplete;
          const ruleText = !priceSet
            ? (unitsMode ? `Set the nightly rate for one ${unitName}.` : "Set the price guests pay per night for the whole place.")
            : pricingMode === "EXTRA_GUEST"
              ? (pricingComplete
                ? `Covers ${includedGuests} guest${Number(includedGuests) === 1 ? "" : "s"}, then TZS ${Number(extraGuestFee).toLocaleString("en-US")} per extra guest`
                : "Extra guest fee not finished")
              : guestCapacity > 0 ? `Same price for up to ${guestCapacity} guests` : "Same price for every booking";
          return <div className="ap-unit-pricing">
            <div className={`ap-np-summary${priceReady ? " is-set" : ""}`}>
              <span className="ap-np-summary-ico" aria-hidden><Banknote className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <span className="ap-np-summary-label">{unitsMode ? "Nightly price per unit" : "Nightly price"}</span>
                <strong className="ap-np-summary-value">{priceSet ? `TZS ${Number(pricePerNight).toLocaleString("en-US")}` : "Not set"}{priceSet ? <small> per night</small> : null}</strong>
                <span className={`ap-np-summary-rule${priceSet && !pricingComplete ? " is-warn" : ""}`}>{ruleText}</span>
              </div>
              <button type="button" className={`ap-btn${priceSet ? "" : " is-primary"}`} onClick={() => setPriceOpen(true)}>
                {priceSet ? <><Pencil className="h-4 w-4" />Edit price</> : <><Banknote className="h-4 w-4" />Set price</>}
              </button>
            </div>

            <div className="ap-np-actions">
              {editingRoomIndex !== null && <button type="button" className="ap-btn" onClick={onCancelRoomEdit}>Cancel editing</button>}
              <button type="button" className="ap-btn is-primary" disabled={!canSave || (!unitsMode && definedRooms.length > 0 && editingRoomIndex === null)} onClick={addRoomType}><Check className="h-4 w-4" /> {unitsMode ? (editingRoomIndex !== null ? "Update unit type" : "Save unit type") : (editingRoomIndex !== null ? "Update entire unit" : "Save entire unit")}</button>
            </div>

            <NightlyPriceDialog
              open={priceOpen}
              onClose={() => setPriceOpen(false)}
              value={{ pricePerNight, pricingMode, includedGuests, extraGuestFee }}
              guestCapacity={guestCapacity}
              commissionPercent={commissionPercent}
              subject={unitsMode ? `One ${unitName}` : "Entire place"}
              priceLabel={unitsMode ? `Your rate for one ${unitName} per night` : "Your price per night"}
              note={unitsMode && unitCount > 1 && Number(pricePerNight) >= 5000 ? `All ${unitCount} units for one night: TZS ${(Number(pricePerNight) * unitCount).toLocaleString("en-US")} before the NoLSAF fee.` : null}
              onSave={(next) => {
                setPricePerNight(next.pricePerNight);
                setPricingMode(next.pricingMode);
                setIncludedGuests(next.includedGuests);
                setExtraGuestFee(next.extraGuestFee);
              }}
            />
          </div>;
        })()}
      </div>
    </section>

    </>}
    {definedRooms.length > 0 && <section className="ap-card"><header className="ap-card-head"><span className="ap-card-head-no">{hasSavedUnit ? 1 : n(4)}</span><div className="ap-card-head-copy"><h3 className="ap-card-title">{unitsMode ? "Saved unit types" : "Saved whole unit"}</h3><p className="ap-card-sub">{unitsMode ? "Each booking takes one whole unit. The others stay available." : "A booking reserves every bedroom in this unit together."}</p></div>{unitsMode ? <span className="ap-card-tag"><Check className="h-3.5 w-3.5" aria-hidden />{definedRooms.reduce((sum, unit) => sum + (Number(unit.roomsCount) || 0), 0)} units in total</span> : null}</header>
      <div className="ap-card-body space-y-2">{definedRooms.map((unit, index) => {
        const count = Number(unit.roomsCount) || 1;
        const nightly = Number(unit.pricePerNight) || 0;
        const photo = Array.isArray(unit.roomImages) ? unit.roomImages.find((src: unknown) => typeof src === "string" && /^https?:/.test(src)) : null;
        const bedroomCount = unit.bedrooms?.length ?? 0;
        const extraFee = Number(unit.extraGuestFee) > 0;
        const title = unitsMode ? unit.roomType : `Entire ${unit.roomType}`;
        return <div key={index} className={`ap-saved-unit${editingRoomIndex === index ? " is-editing" : ""}`}>
          <span className="ap-saved-unit-thumb" aria-hidden>
            {photo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={photo} alt="" loading="lazy" />
              : <BedDouble className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="ap-saved-unit-title">
              <strong>{title}</strong>
              {unitsMode ? <span className="ap-saved-unit-badge">{count} {count === 1 ? "unit" : "units"}</span> : null}
              {editingRoomIndex === index ? <span className="ap-saved-unit-badge is-editing">Editing</span> : null}
            </div>
            <div className="ap-saved-unit-facts">
              <span><BedDouble className="h-3.5 w-3.5" aria-hidden />{bedroomCount} bedroom{bedroomCount === 1 ? "" : "s"}</span>
              <span><Users className="h-3.5 w-3.5" aria-hidden />Sleeps {unit.maxGuestsPerUnit || "?"}</span>
              <span className="is-price"><Banknote className="h-3.5 w-3.5" aria-hidden />TZS {nightly.toLocaleString("en-US")}<small>/night{unitsMode ? " each" : ""}</small></span>
              {extraFee ? <span>Covers {unit.includedGuests}, +TZS {Number(unit.extraGuestFee).toLocaleString("en-US")} per extra guest</span> : null}
            </div>
          </div>
          {unitsMode && count > 1 ? (
            <div className="ap-saved-unit-total">
              <span>All {count}, one night</span>
              <strong>TZS {(nightly * count).toLocaleString("en-US")}</strong>
            </div>
          ) : null}
          <div className="ap-saved-unit-actions">
            <button type="button" className="ap-saved-unit-btn" onClick={() => onEditRoom(index)} aria-label={unitsMode ? `Edit ${unit.roomType}` : "Edit whole unit"} title="Edit"><Pencil className="h-4 w-4" /></button>
            <button type="button" className="ap-saved-unit-btn is-danger" onClick={() => onRemoveRoom(index)} aria-label={unitsMode ? `Remove ${unit.roomType}` : "Remove whole unit"} title="Remove"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>;
      })}</div>
    </section>}
  </div>;
}
