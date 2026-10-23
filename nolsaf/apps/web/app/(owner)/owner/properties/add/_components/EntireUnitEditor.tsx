import { useMemo, useState } from "react";
import { BedDouble, BedSingle, Check, ChevronDown, Minus, Plus, Pencil, Trash2 } from "lucide-react";
import { RoomPhotoSlots } from "./RoomPhotoSlots";
import { declaredGuestCapacity, firstIncompleteBedroomIndex, hasCompleteBedrooms, type BedKey, type BedroomLayout } from "@/lib/listingInventory";
import { OwnerPriceBreakdown } from "@/components/owner-property/OwnerPriceBreakdown";

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
  const guestCapacity = useMemo(() => declaredGuestCapacity(bedrooms), [bedrooms]);
  const kitchenType = KITCHEN_TYPES.find((item) => otherAmenities.includes(item)) ?? "";
  const incompleteBedroom = firstIncompleteBedroomIndex(bedrooms);
  const completedBedrooms = bedrooms.filter((bedroom) => firstIncompleteBedroomIndex([bedroom]) === -1).length;
  const selectedBedroomIndex = Math.max(0, Math.min(openBedroom, bedrooms.length - 1));
  const selectedBedroom = bedrooms[selectedBedroomIndex];
  const pricingComplete = pricingMode === "FLAT" || (Number.isInteger(Number(includedGuests)) && Number(includedGuests) >= 1 && Number(includedGuests) < guestCapacity && Number(extraGuestFee) > 0);
  const canSave = roomType.trim().length > 0 && hasCompleteBedrooms(bedrooms) && roomImages.length >= 3 && Number(pricePerNight) >= 5000 && pricingComplete;
  const hasSavedUnit = definedRooms.length > 0 && editingRoomIndex === null;
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
    <section className="ap-card">
      <header className="ap-card-head"><span className="ap-card-head-no">1</span><div className="ap-card-head-copy">
        <h3 className="ap-card-title">Bedrooms and beds</h3>
        <p className="ap-card-sub">One booking includes every bedroom in this {roomType || "place"}.</p>
      </div><span className="ap-card-tag">{completedBedrooms === bedrooms.length ? `Sleeps ${guestCapacity} guests in total` : `${bedrooms.length - completedBedrooms} ${bedrooms.length - completedBedrooms === 1 ? "bedroom needs" : "bedrooms need"} details`}</span>
        <button type="button" className="ap-btn ap-unit-add-button" aria-describedby={incompleteBedroom >= 0 ? "unit-bedroom-requirement" : undefined} onClick={addBedroom}><Plus className="h-4 w-4" /> Add bedroom</button>
      </header>
      <div className="ap-card-body"><div className="ap-bedroom-workspace">
        <div className="ap-bedroom-list" aria-label="Bedrooms in this unit">
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
            return <div key={key} className={`ap-bed${bedCount > 0 ? " is-on" : ""}`}><span className="ap-bed-ico"><BedIcon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-white">{label} bed</span><span className="block truncate text-[11.5px] text-white/50">{size}</span></span><span className="ap-stepper is-small"><button type="button" className="ap-step-btn" aria-label={`Remove one ${label.toLowerCase()} bed from ${selectedBedroom.name || `bedroom ${selectedBedroomIndex + 1}`}`} disabled={bedCount === 0} onClick={() => updateBedroom(selectedBedroomIndex, { ...selectedBedroom, beds: { ...selectedBedroom.beds, [key]: Math.max(0, bedCount - 1) } })}><Minus className="h-3.5 w-3.5" /></button><span className="ap-step-val">{bedCount}</span><button type="button" className="ap-step-btn is-plus" aria-label={`Add one ${label.toLowerCase()} bed to ${selectedBedroom.name || `bedroom ${selectedBedroomIndex + 1}`}`} onClick={() => updateBedroom(selectedBedroomIndex, { ...selectedBedroom, beds: { ...selectedBedroom.beds, [key]: bedCount + 1 } })}><Plus className="h-3.5 w-3.5" /></button></span></div>;
          })}</div>
          <div className="ap-bedroom-capacity"><div className="ap-bedroom-capacity-copy"><span className="ap-label">How many guests can sleep here? <span className="text-red-300">*</span></span><p className="ap-note">Choose one number. We add the bedrooms together automatically.</p></div><div className="ap-bedroom-quick-count" role="group" aria-label={`Guest capacity for ${selectedBedroom.name || `Bedroom ${selectedBedroomIndex + 1}`}`}>{[1, 2, 3, 4].map((count) => <button key={count} type="button" className={Number(selectedBedroom.sleeps) === count ? "is-on" : ""} aria-pressed={Number(selectedBedroom.sleeps) === count} onClick={() => updateBedroom(selectedBedroomIndex, { ...selectedBedroom, sleeps: count })}>{count}</button>)}<label className="ap-bedroom-more-count"><span>Or type</span><input type="text" inputMode="numeric" aria-label="Type guest capacity" value={selectedBedroom.sleeps || ""} placeholder="5+" onChange={(event) => { const raw = event.target.value.replace(/[^0-9]/g, "").slice(0, 2); updateBedroom(selectedBedroomIndex, { ...selectedBedroom, sleeps: raw ? Number(raw) : 0 }); }} /></label></div></div>
        </div>}
      </div>
        <p id="unit-bedroom-requirement" className={`ap-note ap-bedroom-status mt-2${incompleteBedroom < 0 ? " text-teal-300" : ""}`} role="status">{incompleteBedroom >= 0 ? `Complete Bedroom ${incompleteBedroom + 1} with a name, at least one bed, and its guest capacity before adding another bedroom or continuing.` : "Bedrooms are complete. You can add another bedroom or continue."}</p>
        <div className="mt-4"><label className="ap-label" htmlFor="unit-description">Describe the whole place</label>
          <textarea id="unit-description" className="ap-input ap-textarea" rows={3} value={roomDescription} onChange={(event) => setRoomDescription(event.target.value)} placeholder="Layout, living areas, privacy and what guests can use" />
        </div>
      </div>
    </section>

    <section className="ap-card">
      <header className="ap-card-head"><span className="ap-card-head-no">2</span><div className="ap-card-head-copy"><h3 className="ap-card-title">What is inside this unit?</h3><p className="ap-card-sub">Select only amenities guests can actually use.</p></div></header>
      <div className="ap-card-body space-y-4">
        <div className="ap-kitchen-section"><span className="ap-label" id="unit-kitchen-label">Kitchen access</span>
          <div className="ap-kitchen-choices" role="radiogroup" aria-labelledby="unit-kitchen-label">{KITCHEN_CHOICES.map(({ value, label, detail }) => <label key={label} className={`ap-kitchen-choice${kitchenType === value ? " is-on" : ""}`}>
            <input type="radio" className="sr-only" name="unit-kitchen-type" value={value} checked={kitchenType === value} onChange={() => {
              const kept = otherAmenities.filter((item) => !KITCHEN_TYPES.includes(item) && (value || !KITCHEN_EQUIPMENT.includes(item)));
              setOtherAmenities(value ? [...kept, value] : kept);
            }} />
            <span className="ap-kitchen-choice-copy"><strong>{label}</strong><small>{detail}</small></span><span className="ap-kitchen-choice-mark" aria-hidden="true">{kitchenType === value && <Check className="h-3.5 w-3.5" />}</span>
          </label>)}</div>
          {kitchenType && <div className="ap-kitchen-details">
            <div className="ap-kitchen-cooking"><div><span className="ap-label" id="unit-cooking-label">Can guests cook here?</span><p className="ap-note">Choose yes only when guests are allowed to prepare meals.</p></div>
              <div className="ap-kitchen-permission" role="radiogroup" aria-labelledby="unit-cooking-label">{[{ value: false, label: "No" }, { value: true, label: "Yes, cooking allowed" }].map(({ value, label }) => <label key={label} className={`ap-kitchen-permission-choice${otherAmenities.includes("Cooking allowed") === value ? " is-on" : ""}`}><input type="radio" className="sr-only" name="unit-cooking-allowed" checked={otherAmenities.includes("Cooking allowed") === value} onChange={() => setOtherAmenities(value ? [...otherAmenities.filter((item) => item !== "Cooking allowed"), "Cooking allowed"] : otherAmenities.filter((item) => item !== "Cooking allowed"))} />{label}</label>)}</div>
            </div>
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
      <header className="ap-card-head"><span className="ap-card-head-no">3</span><div className="ap-card-head-copy"><h3 className="ap-card-title">Photos and price for the whole unit</h3><p className="ap-card-sub">Add at least three photos, then set your nightly rate.</p></div></header>
      <div className="ap-card-body ap-unit-finish">
        <RoomPhotoSlots images={roomImages} onUpload={(files) => { if (files) onPickRoomImages(files); }} onRemove={(index) => { setRoomImages((prev) => prev.filter((_, i) => i !== index)); setRoomImageSaved((prev) => prev.filter((_, i) => i !== index)); setRoomImageUploading((prev) => prev.filter((_, i) => i !== index)); }} saved={roomImageSaved} uploading={roomImageUploading} />
        <div className="ap-unit-pricing">
          <div className="ap-unit-pricing-head"><div><h4>Nightly price</h4><p>One booking reserves the entire place.</p></div><span className="ap-unit-capacity">Up to {guestCapacity || "—"} guests</span></div>
          <div className="ap-unit-base-rate"><label className="ap-label" htmlFor="unit-nightly-price">Price for the whole place, per night (TZS)</label><div className="ap-unit-money-input"><span aria-hidden="true">TZS</span><input id="unit-nightly-price" inputMode="numeric" value={pricePerNight === "" ? "" : Number(pricePerNight).toLocaleString("en-US")} onChange={(event) => { const raw = event.target.value.replace(/[^0-9]/g, ""); setPricePerNight(raw ? Number(raw) : ""); }} placeholder="150,000" /></div></div>
          <fieldset className="ap-unit-rate-rule"><legend>Does the price change with guest count?</legend><div className="ap-unit-rate-choices">
            <label className={`ap-unit-rate-option${pricingMode === "FLAT" ? " is-on" : ""}`}><input type="radio" name="unit-pricing-mode" checked={pricingMode === "FLAT"} onChange={() => setPricingMode("FLAT")} /><span><strong>One price for everyone</strong><small>Same nightly price for any group up to {guestCapacity || "the maximum"} guests.</small></span></label>
            <label className={`ap-unit-rate-option${pricingMode === "EXTRA_GUEST" ? " is-on" : ""}`}><input type="radio" name="unit-pricing-mode" checked={pricingMode === "EXTRA_GUEST"} disabled={guestCapacity < 2} onChange={() => setPricingMode("EXTRA_GUEST")} /><span><strong>Add a fee for extra guests</strong><small>Choose how many guests the nightly price includes.</small></span></label>
          </div></fieldset>
          {pricingMode === "EXTRA_GUEST" && <div className="ap-unit-rate-fields"><div><label className="ap-label" htmlFor="unit-included-guests">Nightly price includes</label><div className="ap-unit-guest-select"><select id="unit-included-guests" className="ap-input ap-select" value={includedGuests} onChange={(event) => setIncludedGuests(event.target.value ? Number(event.target.value) : "")}><option value="">Select guest count</option>{Array.from({ length: Math.max(0, guestCapacity - 1) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} guest{index === 0 ? "" : "s"}</option>)}</select><ChevronDown className="h-4 w-4" aria-hidden="true" /></div></div><div><label className="ap-label" htmlFor="unit-extra-guest-fee">Fee for each additional guest, per night (TZS)</label><div className="ap-unit-money-input"><span aria-hidden="true">TZS</span><input id="unit-extra-guest-fee" inputMode="numeric" value={extraGuestFee === "" ? "" : Number(extraGuestFee).toLocaleString("en-US")} onChange={(event) => { const raw = event.target.value.replace(/[^0-9]/g, ""); setExtraGuestFee(raw ? Number(raw) : ""); }} placeholder="20,000" /></div></div></div>}
          {pricingMode === "EXTRA_GUEST" && !pricingComplete && <p className="ap-field-error">Choose the included guest count and enter a fee for each additional guest.</p>}
          {Number(pricePerNight) >= 5000 && <OwnerPriceBreakdown rate={Number(pricePerNight)} commissionPercent={commissionPercent} dark />}
          {Number(pricePerNight) >= 5000 && guestCapacity > 0 && pricingMode === "EXTRA_GUEST" && pricingComplete && <div className="ap-unit-rate-preview"><strong>Your rate with extra guests</strong><div className="ap-unit-rate-examples"><span>{Number(includedGuests) + 1} guests <b>TZS {(Number(pricePerNight) + Number(extraGuestFee)).toLocaleString("en-US")}</b> before the NoLSAF fee</span></div></div>}
          <div className="ap-unit-pricing-actions"><button type="button" className="ap-btn is-primary" disabled={!canSave || (definedRooms.length > 0 && editingRoomIndex === null)} onClick={addRoomType}><Check className="h-4 w-4" /> {editingRoomIndex !== null ? "Update entire unit" : "Save entire unit"}</button>
          {editingRoomIndex !== null && <button type="button" className="ap-btn" onClick={onCancelRoomEdit}>Cancel editing</button>}</div>
        </div>
      </div>
    </section>

    </>}
    {definedRooms.length > 0 && <section className="ap-card"><header className="ap-card-head"><span className="ap-card-head-no">{hasSavedUnit ? 1 : 4}</span><div className="ap-card-head-copy"><h3 className="ap-card-title">Saved whole unit</h3><p className="ap-card-sub">A booking reserves every bedroom in this unit together.</p></div></header>
      <div className="ap-card-body">{definedRooms.map((unit, index) => <div key={index} className="flex items-center gap-3 rounded-lg border border-white/15 p-3 text-white/80"><div className="flex-1"><strong className="block text-white">Entire {unit.roomType}</strong><span>{unit.bedrooms?.length ?? 0} bedrooms · sleeps {unit.maxGuestsPerUnit || "—"} · TZS {Number(unit.pricePerNight).toLocaleString("en-US")} per night{Number(unit.extraGuestFee) > 0 ? ` for ${unit.includedGuests} guests + TZS ${Number(unit.extraGuestFee).toLocaleString("en-US")} per extra guest` : " for all guests"}</span></div><button type="button" className="ap-icon-btn" onClick={() => onEditRoom(index)} aria-label="Edit whole unit"><Pencil className="h-4 w-4" /></button><button type="button" className="ap-icon-btn is-danger" onClick={() => onRemoveRoom(index)} aria-label="Remove whole unit"><Trash2 className="h-4 w-4" /></button></div>)}</div>
    </section>}
  </div>;
}
