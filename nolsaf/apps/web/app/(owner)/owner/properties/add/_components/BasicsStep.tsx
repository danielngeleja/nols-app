"use client";

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Building2, Check, ChevronDown, HelpCircle, Home, LayoutGrid, MapPin, AlertCircle, Pencil, X } from "lucide-react";
import { PropertyLocationMap, type PropertyLocationDetectionMeta } from "./PropertyLocationMap";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddPropertySection } from "./AddPropertySection";
import { StepFooter } from "./StepFooter";

type TouchedBasics = {
  title?: boolean;
  type?: boolean;
  buildingType?: boolean;
  totalFloors?: boolean;
  district?: boolean;
  ward?: boolean;
  street?: boolean;
  zip?: boolean;
};

export type BasicsStepProps = {
  isVisible: boolean;
  currentStep: number;
  goToPreviousStep: () => void;
  goToNextStep: () => void;

  title: string;
  setTitle: (v: string) => void;
  type: string;
  setType: (v: string) => void;
  otherType: string;
  setOtherType: (v: string) => void;
  hotelStar: string;
  setHotelStar: (v: string) => void;

  buildingType: string;
  setBuildingType: (v: string) => void;
  totalFloors: number | "";
  setTotalFloors: Dispatch<SetStateAction<number | "">>;

  touchedBasics: TouchedBasics;
  setTouchedBasics: (updater: (prev: TouchedBasics) => TouchedBasics) => void;

  PROPERTY_TYPES: readonly string[];
  PROPERTY_TYPE_ICONS: Record<string, any>;
  PROPERTY_TYPE_STYLES: Record<string, any>;
  HOTEL_STAR_OPTIONS: Array<{ value: string; label: string }>;

  regionId: string;
  setRegionId: (v: string) => void;
  district: string;
  setDistrict: (v: string) => void;
  ward: string;
  setWard: (v: string) => void;
  street: string;
  setStreet: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  zip: string;
  setZip: (v: string) => void;
  selectedWardPostcode: string | null;

  latitude: number | "";
  setLatitude: Dispatch<SetStateAction<number | "">>;
  longitude: number | "";
  setLongitude: Dispatch<SetStateAction<number | "">>;

  districts: string[];
  wards: string[];
  streets: string[];
  REGIONS: Array<{ id: string; name: string }>;

  tourismSiteId?: number | "";
  setTourismSiteId?: Dispatch<SetStateAction<number | "">>;
  parkPlacement?: "" | "INSIDE" | "NEARBY";
  setParkPlacement?: Dispatch<SetStateAction<"" | "INSIDE" | "NEARBY">>;
};

type TourismSiteOption = {
  // Be tolerant in case an API/DB layer serializes ids as strings.
  id: number | string;
  slug: string;
  name: string;
  country: string;
};

export const BasicsStep = forwardRef<HTMLElement, BasicsStepProps>(function BasicsStep(
  props,
  forwardedRef
) {
  const {
    isVisible,
    currentStep,
    goToPreviousStep,
    goToNextStep,

  title,
  setTitle,
  type,
  setType,
  otherType,
  setOtherType,
  hotelStar,
  setHotelStar,

  buildingType,
  setBuildingType,
  totalFloors,
  setTotalFloors,

  touchedBasics,
  setTouchedBasics,

  PROPERTY_TYPES,
  PROPERTY_TYPE_ICONS,
  PROPERTY_TYPE_STYLES,
  HOTEL_STAR_OPTIONS,

  regionId,
  setRegionId,
  district,
  setDistrict,
  ward,
  setWard,
  street,
  setStreet,
  city,
  setCity,
  zip,
  setZip,
  selectedWardPostcode,

  latitude,
  setLatitude,
  longitude,
  setLongitude,

  districts,
  wards,
  streets,
  REGIONS,

  tourismSiteId,
  setTourismSiteId,
  parkPlacement,
  setParkPlacement,
} = props;

const tourismSiteIdValue = tourismSiteId ?? "";
const setTourismSiteIdValue = useMemo(
  () => setTourismSiteId ?? ((() => {}) as Dispatch<SetStateAction<number | "">>),
  [setTourismSiteId]
);
const parkPlacementValue = parkPlacement ?? "";
const setParkPlacementValue = useMemo(
  () => setParkPlacement ?? ((() => {}) as Dispatch<SetStateAction<"" | "INSIDE" | "NEARBY">>),
  [setParkPlacement]
);

const [tourismSites, setTourismSites] = useState<TourismSiteOption[]>([]);
const [tourismSitesLoading, setTourismSitesLoading] = useState(false);
const [tourismSitesError, setTourismSitesError] = useState<string | null>(null);

const [parkPickerOpen, setParkPickerOpen] = useState(false);
const [parkQuery, setParkQuery] = useState("");
const parkPickerRef = useRef<HTMLDivElement | null>(null);
const parkInputRef = useRef<HTMLInputElement | null>(null);

const [isEditingPark, setIsEditingPark] = useState(false);
const [isEditingPlacement, setIsEditingPlacement] = useState(false);

// Local fallback for display/enablement in case parent state updates are delayed.
const [localTourismSiteId, setLocalTourismSiteId] = useState<number | "">("");
const [localParkPlacement, setLocalParkPlacement] = useState<"" | "INSIDE" | "NEARBY">("");

const effectiveTourismSiteIdValue = useMemo(() => {
  return tourismSiteIdValue === "" ? localTourismSiteId : tourismSiteIdValue;
}, [localTourismSiteId, tourismSiteIdValue]);

const effectiveParkPlacementValue = useMemo(() => {
  return parkPlacementValue === "" ? localParkPlacement : parkPlacementValue;
}, [localParkPlacement, parkPlacementValue]);

useEffect(() => {
  // Sync local from parent when parent has a concrete value (e.g., editing an existing property).
  if (tourismSiteIdValue === "") return;
  setLocalTourismSiteId(tourismSiteIdValue);
}, [tourismSiteIdValue]);

useEffect(() => {
  // Sync local from parent when parent has a concrete value (e.g., editing an existing property).
  if (parkPlacementValue === "") return;
  setLocalParkPlacement(parkPlacementValue);
}, [parkPlacementValue]);

useEffect(() => {
  // Push local selection up if parent is still empty.
  if (localTourismSiteId === "") return;
  if (tourismSiteIdValue !== "") return;
  setTourismSiteIdValue(localTourismSiteId);
}, [localTourismSiteId, setTourismSiteIdValue, tourismSiteIdValue]);

useEffect(() => {
  // Push local selection up if parent is still empty.
  if (localParkPlacement === "") return;
  if (parkPlacementValue !== "") return;
  setParkPlacementValue(localParkPlacement);
}, [localParkPlacement, parkPlacementValue, setParkPlacementValue]);

const tourismCountry = useMemo(() => {
  // Current add-property location UX is Tanzania-based (REGIONS list).
  // Only allow park selection after a region is chosen to prevent mismatches.
  if (!regionId) return null;
  return "Tanzania";
}, [regionId]);

const MAJOR_TOURISM_SLUGS = useMemo(
  () =>
    new Set<string>([
      // Tanzania (seeded)
      "serengeti-national-park",
      "ngorongoro-crater",
      "tarangire-national-park",
      // Kenya (seeded)
      "maasai-mara",
      // Uganda (seeded)
      "bwindi-impenetrable",
    ]),
  []
);

const selectedTourismSite = useMemo(() => {
  if (effectiveTourismSiteIdValue === "") return null;
  const id = Number(effectiveTourismSiteIdValue);
  if (!Number.isFinite(id) || id <= 0) return null;
  return tourismSites.find((s) => Number(s.id) === id) ?? null;
}, [tourismSites, effectiveTourismSiteIdValue]);

const parkIsLocked = !!selectedTourismSite && !isEditingPark;
const placementIsLocked = effectiveTourismSiteIdValue !== "" && !!effectiveParkPlacementValue && !isEditingPlacement;

const orderedTourismSites = useMemo(() => {
  const sites = Array.isArray(tourismSites) ? tourismSites : [];
  return [...sites].sort((a, b) => {
    const aMajor = MAJOR_TOURISM_SLUGS.has(a.slug) ? 1 : 0;
    const bMajor = MAJOR_TOURISM_SLUGS.has(b.slug) ? 1 : 0;
    if (aMajor !== bMajor) return bMajor - aMajor;
    return a.name.localeCompare(b.name);
  });
}, [tourismSites, MAJOR_TOURISM_SLUGS]);

const filteredTourismSites = useMemo(() => {
  const q = parkQuery.trim().toLowerCase();
  if (!q) return orderedTourismSites;
  return orderedTourismSites.filter((s) => {
    const name = String(s.name || "").toLowerCase();
    const country = String(s.country || "").toLowerCase();
    return name.includes(q) || country.includes(q);
  });
}, [orderedTourismSites, parkQuery]);

useEffect(() => {
  function onDocMouseDown(e: MouseEvent) {
    if (!parkPickerOpen) return;
    const el = parkPickerRef.current;
    if (!el) return;
    if (e.target instanceof Node && !el.contains(e.target)) {
      setParkPickerOpen(false);
      setParkQuery("");
    }
  }
  document.addEventListener("mousedown", onDocMouseDown);
  return () => document.removeEventListener("mousedown", onDocMouseDown);
}, [parkPickerOpen]);

useEffect(() => {
  // When leaving edit mode, ensure the picker closes.
  if (isEditingPark) return;
  setParkPickerOpen(false);
  setParkQuery("");
}, [isEditingPark]);

useEffect(() => {
  let cancelled = false;
  const controller = new AbortController();

  async function loadTourismSites() {
    if (!tourismCountry) {
      setTourismSites([]);
      setTourismSitesError(null);
      setTourismSitesLoading(false);
      return;
    }

    try {
      setTourismSitesLoading(true);
      setTourismSitesError(null);

      const resp = await fetch(`/api/public/tourism-sites?country=${encodeURIComponent(tourismCountry)}`, {
        method: "GET",
        credentials: "include",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) {
        throw new Error(`Failed to load tourism sites (${resp.status})`);
      }
      const data = (await resp.json()) as { items?: TourismSiteOption[] };
      const items = Array.isArray(data?.items) ? data.items : [];
      const normalized = items
        .map((s) => ({ ...s, id: Number((s as any)?.id) }))
        .filter((s) => Number.isFinite(s.id) && s.id > 0);

      if (!cancelled) setTourismSites(normalized);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      console.error("Failed to load tourism sites", e);
      if (!cancelled) setTourismSitesError(String(e?.message || "Failed to load tourism sites"));
    } finally {
      if (!cancelled) setTourismSitesLoading(false);
    }
  }

  loadTourismSites();
  return () => {
    cancelled = true;
    controller.abort();
  };
}, [tourismCountry]);

useEffect(() => {
  // If location is cleared OR selected park doesn't match the current country context, clear it.
  if (effectiveTourismSiteIdValue === "") return;

  if (!tourismCountry) {
    setTourismSiteIdValue("");
    setLocalTourismSiteId("");
    setParkPlacementValue("");
    setLocalParkPlacement("");
    setParkPickerOpen(false);
    setParkQuery("");
    setIsEditingPark(false);
    setIsEditingPlacement(false);
    return;
  }

  if (selectedTourismSite && selectedTourismSite.country !== tourismCountry) {
    setTourismSiteIdValue("");
    setLocalTourismSiteId("");
    setParkPlacementValue("");
    setLocalParkPlacement("");
    setParkPickerOpen(false);
    setParkQuery("");
    setIsEditingPark(false);
    setIsEditingPlacement(false);
  }
}, [tourismCountry, effectiveTourismSiteIdValue, selectedTourismSite, setParkPlacementValue, setTourismSiteIdValue]);

const [typePickerOpen, setTypePickerOpen] = useState(false);

const handleSectionRef = useCallback(
  (node: HTMLElement | null) => {
    if (!forwardedRef) return;

    if (typeof forwardedRef === "function") {
      forwardedRef(node);
    } else {
      (forwardedRef as MutableRefObject<HTMLElement | null>).current = node;
    }
  },
  [forwardedRef]
);

  const typeOk = !!type;
  const showTypeExtras = type === "Other" || type === "Hotel";
  const collapseTypes = typeOk && !typePickerOpen;
  const visibleTypes = useMemo(() => {
    if (collapseTypes) return [type];
    return [...PROPERTY_TYPES];
  }, [PROPERTY_TYPES, collapseTypes, type]);

  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);

  const handleLocationDetected = useCallback((lat: number, lng: number, meta?: PropertyLocationDetectionMeta) => {
    setLatitude(lat);
    setLongitude(lng);
    setLocationAccuracy(meta?.accuracy ?? null);
  }, [setLatitude, setLongitude]);

  // Address text used to seed an approximate starting pin when no coordinate
  // exists yet (the owner then drags it to the exact spot).
  const locationAddressQuery = useMemo(() => {
    const regionName = REGIONS.find((r) => r.id === regionId)?.name ?? "";
    const parts = [ward, district, regionName].map((p) => (p || "").trim()).filter(Boolean);
    if (parts.length === 0) return "";
    return [...parts, "Tanzania"].join(", ");
  }, [REGIONS, regionId, district, ward]);

  return (
    <AddPropertySection
      as="section"
      sectionRef={handleSectionRef}
      isVisible={isVisible}
      className="add-property-step-surface"
    >
      {isVisible && (
        <div id="propertyBasicsInner" className="w-full">
          <div className="ap-step-ground">

          <div className="w-full">
            {/* ---------------------------------------------------------------
                What this place is. The category, the name and the type specific
                field live in one card, because they answer one question.
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">1</span>
                <div className="ap-card-copy ap-card-head-copy">
                  <h3 className="ap-card-title" id="propertyTypeLabel">What this place is</h3>
                  <p className="ap-card-sub">Category, name and star rating.</p>
                </div>
                {typeOk ? (
                  <span className="ap-card-tag">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {type === "Other" && otherType.trim() ? otherType.trim() : type}
                  </span>
                ) : (
                  <span className="ap-card-tag is-todo">Required</span>
                )}
              </header>

              <div className="ap-card-body">
                {/* Twelve categories as one dense palette, not twelve cards */}
                <div role="radiogroup" aria-labelledby="propertyTypeLabel" className="ap-type-grid">
                  {PROPERTY_TYPES.map((pt) => {
                    const selected = type === pt;
                    const IconComponent = PROPERTY_TYPE_ICONS[pt] || HelpCircle;
                    return (
                      <label key={pt} className={`ap-type${selected ? " is-selected" : ""}`} title={pt}>
                        <input
                          type="radio"
                          name="propertyType"
                          value={pt}
                          checked={selected}
                          onChange={() => {
                            if (PROPERTY_TYPES.includes(pt)) {
                              setType(pt);
                              setTypePickerOpen(false);
                              setTouchedBasics((t) => ({ ...t, type: true }));
                            }
                          }}
                          className="sr-only"
                        />
                        <span className="ap-type-ico">
                          <IconComponent className="h-4 w-4" />
                        </span>
                        <span className="ap-type-name">{pt}</span>
                        {selected ? <Check className="h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden /> : null}
                      </label>
                    );
                  })}
                </div>

                {touchedBasics.type && !type ? (
                  <p id="typeError" className="ap-field-error">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Please select a property type.
                  </p>
                ) : null}

                {/* The name, and only the extra field this category needs */}
                {typeOk ? (
                  <div className="ap-field-grid mt-3 border-0 border-t border-solid border-white/10 pt-3">
                    <div className={showTypeExtras ? "min-w-0" : "min-w-0 ap-field-wide"}>
                      <label htmlFor="propertyName" className="ap-label">
                        Property name <span className="text-red-300">*</span>
                      </label>
                      <input
                        id="propertyName"
                        aria-describedby={touchedBasics.title && title.trim().length < 3 ? "nameError" : undefined}
                        value={title}
                        onChange={(e) => {
                          // Security: Sanitize input - limit length and prevent XSS
                          const sanitized = e.target.value.slice(0, 200).replace(/[<>]/g, "");
                          setTitle(sanitized);
                        }}
                        onBlur={() => setTouchedBasics((t) => ({ ...t, title: true }))}
                        type="text"
                        placeholder='e.g. "Serena Hotel"'
                        maxLength={200}
                        className={`ap-input${touchedBasics.title && title.trim().length < 3 ? " is-invalid" : ""}`}
                        aria-required={true}
                      />
                      {touchedBasics.title && title.trim().length < 3 ? (
                        <p id="nameError" className="ap-field-error">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Please enter at least 3 characters
                        </p>
                      ) : null}
                    </div>

                    {type === "Other" ? (
                      <div className="min-w-0">
                        <label htmlFor="otherPropertyType" className="ap-label">
                          Specify the type <span className="text-red-300">*</span>
                        </label>
                        <input
                          id="otherPropertyType"
                          value={otherType}
                          onChange={(e) => {
                            // Security: Sanitize input
                            const sanitized = e.target.value.slice(0, 100).replace(/[<>]/g, "");
                            setOtherType(sanitized);
                          }}
                          maxLength={100}
                          className="ap-input"
                          placeholder="Please specify"
                        />
                      </div>
                    ) : null}

                    {type === "Hotel" ? (
                      <div className="min-w-0">
                        <label htmlFor="hotelStarRating" className="ap-label">
                          Hotel star rating <span className="text-red-300">*</span>
                        </label>
                        <div className="relative">
                          <select
                            id="hotelStarRating"
                            title="Hotel Star Rating"
                            aria-required={true}
                            value={hotelStar}
                            onChange={(e) => {
                              // Security: Validate value is from allowed options
                              const validValue = HOTEL_STAR_OPTIONS.find((o) => o.value === e.target.value)?.value || "";
                              if (validValue) setHotelStar(validValue);
                            }}
                            className="ap-select"
                          >
                            {HOTEL_STAR_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>

            {/* ---------------------------------------------------------------
                How the building is arranged.
               --------------------------------------------------------------- */}
            {typeOk ? (
              <section className="ap-card">
                <header className="ap-card-head">
                  <span className="ap-card-head-no">2</span>
                  <div className="ap-card-copy ap-card-head-copy">
                    <h3 className="ap-card-title" id="buildingLayoutLabel">How the building is arranged</h3>
                    <p className="ap-card-sub">Tells us where the rooms sit.</p>
                  </div>
                  {buildingType ? (
                    <span className="ap-card-tag">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {buildingType === "single_storey"
                        ? "Single storey"
                        : buildingType === "multi_storey"
                        ? `${Number(totalFloors) >= 2 ? `${totalFloors} floors` : "Multi storey"}`
                        : "Separate units"}
                    </span>
                  ) : (
                    <span className="ap-card-tag is-todo">Required</span>
                  )}
                </header>

                <div className="ap-card-body">
                  <div role="radiogroup" aria-labelledby="buildingLayoutLabel" className="ap-opt-grid">
                    {[
                      { value: "single_storey", title: "Single storey", desc: "All rooms on the ground floor.", Icon: Home },
                      { value: "multi_storey", title: "Multi storey", desc: "Rooms across several floors.", Icon: Building2 },
                      { value: "separate_units", title: "Separate units", desc: "Scattered blocks or bungalows.", Icon: LayoutGrid },
                    ].map(({ value, title: t, desc: d, Icon }) => {
                      const selected = buildingType === value;
                      return (
                        <label key={value} className={`ap-opt${selected ? " is-selected" : ""}`}>
                          <input
                            type="radio"
                            name="buildingType"
                            value={value}
                            checked={selected}
                            onChange={() => {
                              const allowedValues = ["single_storey", "multi_storey", "separate_units"];
                              if (allowedValues.includes(value)) {
                                setBuildingType(value);
                                setTouchedBasics((tb) => ({ ...tb, buildingType: true }));
                                if (value === "single_storey") setTotalFloors(1);
                                if (value === "separate_units") setTotalFloors("");
                                if (value === "multi_storey") setTotalFloors((prev) => (Number(prev) >= 2 ? prev : ""));
                              }
                            }}
                            className="sr-only"
                          />
                          <span className="ap-opt-ico">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="ap-opt-name block">{t}</span>
                            <span className="ap-opt-desc block">{d}</span>
                          </span>
                          {selected ? (
                            <span className="ap-opt-check">
                              <Check className="h-3 w-3" aria-hidden />
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>

                  {touchedBasics.buildingType && !buildingType ? (
                    <p className="ap-field-error">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Please select a building layout.
                    </p>
                  ) : null}

                  {buildingType === "multi_storey" ? (
                    <div className="ap-inline">
                      <label htmlFor="totalFloors" className="ap-inline-label">
                        Floors in the building
                      </label>
                      <input
                        id="totalFloors"
                        type="number"
                        min={2}
                        max={100}
                        value={totalFloors as any}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "") {
                            setTotalFloors("");
                            return;
                          }
                          const num = parseInt(val, 10);
                          if (!isNaN(num) && num >= 2 && num <= 100) setTotalFloors(num);
                        }}
                        onBlur={() => setTouchedBasics((tb) => ({ ...tb, totalFloors: true }))}
                        placeholder="2"
                        className={touchedBasics.totalFloors && (!Number(totalFloors) || Number(totalFloors) < 2) ? "border-red-400/70" : ""}
                      />
                      {touchedBasics.totalFloors && (!Number(totalFloors) || Number(totalFloors) < 2) ? (
                        <span className="text-[12px] font-medium text-red-300">Enter 2 or more</span>
                      ) : (
                        <span className="text-[12px] text-white/55">
                          Count every floor, ground included, even ones with only a reception, restaurant, offices or parking.
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* ---------------------------------------------------------------
                Where it is. Same card, same black header, so the step reads as
                three questions instead of a stack of loose panels.
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">3</span>
                <div className="ap-card-copy ap-card-head-copy">
                  <h3 className="ap-card-title">Where it is</h3>
                  <p className="ap-card-sub">The official address, down to the street.</p>
                </div>
                {regionId && district && ward && street ? (
                  <span className="ap-card-tag">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Set
                  </span>
                ) : (
                  <span className="ap-card-tag is-todo">Required</span>
                )}
              </header>

              <div className="ap-card-body">
                <div className="space-y-3">
                {/* Region / District / Ward / Street */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="space-y-1.5">
                    <label className="ap-label">Region <span className="text-red-300">*</span></label>
                    <div className="relative">
                      <select
                        title="Region"
                        value={regionId}
                        onChange={(e) => { setRegionId(e.target.value); setDistrict(""); setWard(""); }}
                        className="ap-select"
                        aria-required={true}
                      >
                        <option value="">Select</option>
                        {REGIONS.map((r: { id: string; name: string }) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-white/40" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="ap-label">District <span className="text-red-300">*</span></label>
                    <div className="relative">
                      <select
                        title="District"
                        value={district}
                        onChange={(e) => { setDistrict(e.target.value); setWard(""); setStreet(""); setZip(""); }}
                        onBlur={() => setTouchedBasics((t) => ({ ...t, district: true }))}
                        disabled={!regionId}
                        className={`ap-select${district ? " is-set" : ""}`}
                        aria-required={true}
                        aria-describedby={touchedBasics.district && !district ? "districtError" : undefined}
                      >
                        <option value="">{regionId ? "Select" : "Region first"}</option>
                        {districts.map((d: string) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-white/40" />
                    </div>
                    {touchedBasics.district && !district ? <p id="districtError" className="text-[10px] text-red-300 mt-1">Required</p> : null}
                  </div>

                  <div className="space-y-1.5">
                    <label className="ap-label">Ward <span className="text-red-300">*</span></label>
                    <div className="relative">
                      <select
                        title="Ward"
                        value={ward}
                        onChange={(e) => { setWard(e.target.value); setStreet(""); setZip(""); }}
                        onBlur={() => setTouchedBasics((t) => ({ ...t, ward: true }))}
                        disabled={!district}
                        className={`ap-select${ward ? " is-set" : ""}`}
                        aria-required={true}
                        aria-describedby={touchedBasics.ward && !ward ? "wardError" : undefined}
                      >
                        <option value="">{district ? "Select" : "District first"}</option>
                        {wards.map((w: string) => (
                          <option key={w} value={w}>{w}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-white/40" />
                    </div>
                    {touchedBasics.ward && !ward ? <p id="wardError" className="text-[10px] text-red-300 mt-1">Required</p> : null}
                  </div>

                  <div className="space-y-1.5">
                    <label className="ap-label">Street <span className="text-red-300">*</span></label>
                    <div className="relative">
                      <select
                        title="Street"
                        value={street}
                        onChange={(e) => setStreet(e.target.value)}
                        onBlur={() => setTouchedBasics((t) => ({ ...t, street: true }))}
                        disabled={!ward}
                        className={`ap-select${street ? " is-set" : ""}`}
                        aria-required={true}
                      >
                        <option value="">{ward ? "Select" : "Ward first"}</option>
                        {streets.map((s: string) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-white/40" />
                    </div>
                    {touchedBasics.street && !street ? <p id="streetErrorAdmin" className="text-[10px] text-red-300 mt-1">Required</p> : null}
                  </div>
                </div>

                {/* City + Zip */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="ap-label">City <span className="text-white/40 normal-case tracking-normal text-[10px]">optional</span></label>
                    <input
                      id="city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="ap-input"
                      placeholder="Enter city"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="ap-label">Zip {selectedWardPostcode ? <span className="text-red-300">*</span> : <span className="text-white/40 normal-case tracking-normal text-[10px]">optional</span>}</label>
                    <input
                      id="zip"
                      type="text"
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      onBlur={() => setTouchedBasics((t) => ({ ...t, zip: true }))}
                      readOnly={!!selectedWardPostcode}
                      className="ap-input"
                      placeholder={selectedWardPostcode ? "Auto-filled" : "Enter postcode"}
                      aria-required={!!selectedWardPostcode}
                    />
                    {touchedBasics.zip && selectedWardPostcode && (!zip || zip.trim().length === 0) ? <p id="zipError" className="text-[10px] text-red-300 mt-1">Required</p> : null}
                    {selectedWardPostcode && zip ? <p className="text-[10px] text-[#02665e] mt-1">Auto-filled from ward</p> : null}
                  </div>
                </div>
                </div>
              </div>
            </section>

            {/* Park and pin sit side by side on a wide screen. Opening the map
                makes the pair a single column so the map gets the full width. */}
            <div className="ap-pair">
              <section className="ap-card ap-card-fill">
                <header className="ap-card-head">
                  <span className="ap-card-head-no">4</span>
                  <div className="ap-card-copy ap-card-head-copy">
                    <h3 className="ap-card-title">Park or reserve</h3>
                    <p className="ap-card-sub">Only if it sits inside or near one.</p>
                  </div>
                  {selectedTourismSite ? (
                    <span className="ap-card-tag">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Linked
                    </span>
                  ) : (
                    <span className="ap-card-tag is-todo">Optional</span>
                  )}
                </header>

                <div className="ap-card-body">
                  <div className="ap-field-grid">
                  {/* Tourism site / Park */}
                  <div className="space-y-1.5">
                    <label className="ap-label">Tourism site / Park</label>
                    <div ref={parkPickerRef} className="relative">
                      <input
                        ref={parkInputRef}
                        value={parkPickerOpen ? parkQuery : selectedTourismSite?.name ?? ""}
                        onFocus={() => {
                          if (tourismSitesLoading || !tourismCountry) return;
                          setParkPickerOpen(true);
                          setParkQuery(selectedTourismSite?.name ?? "");
                        }}
                        onChange={(e) => {
                          setParkQuery(e.target.value);
                          if (!tourismSitesLoading && tourismCountry) setParkPickerOpen(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setParkPickerOpen(false);
                            setParkQuery("");
                          }
                        }}
                        placeholder={
                          !tourismCountry
                            ? "Set location first"
                            : tourismSitesLoading
                              ? "Loading\u2026"
                              : "Search or skip"
                        }
                        className={`ap-input${selectedTourismSite ? " is-set" : ""}`}
                        style={{ paddingRight: "4rem" }}
                        role="combobox"
                        aria-haspopup="listbox"
                        aria-expanded={parkPickerOpen}
                        aria-controls="parkListbox"
                        disabled={tourismSitesLoading || !tourismCountry}
                        title="Tourism site"
                      />

                      {selectedTourismSite ? (
                        <button
                          type="button"
                          onClick={() => {
                            setTourismSiteIdValue("");
                            setLocalTourismSiteId("");
                            setParkPlacementValue("");
                            setLocalParkPlacement("");
                            setParkPickerOpen(false);
                            setParkQuery("");
                            setIsEditingPark(false);
                            setIsEditingPlacement(false);
                            window.setTimeout(() => parkInputRef.current?.focus(), 0);
                          }}
                          className="absolute right-8 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-solid border-white/20 bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#02665e]/40"
                          title="Clear park"
                          aria-label="Clear park"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}

                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-white/40 z-10">
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${parkPickerOpen ? "rotate-180" : ""}`} />
                      </div>

                      {parkPickerOpen ? (
                        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-solid border-white/20 bg-[#1d2427] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]">
                          <div id="parkListbox" role="listbox" className="max-h-60 overflow-auto py-1">
                            <button
                              type="button"
                              onClick={() => {
                                setTourismSiteIdValue("");
                                setLocalTourismSiteId("");
                                setParkPlacementValue("");
                                setLocalParkPlacement("");
                                setParkPickerOpen(false);
                                setParkQuery("");
                                setIsEditingPark(false);
                                setIsEditingPlacement(false);
                              }}
                              className="w-full text-left px-3 py-2 text-[13px] text-white/80 hover:bg-white/10"
                              role="option"
                              aria-selected={effectiveTourismSiteIdValue === ""}
                            >
                              Not linked to a park
                            </button>

                            {tourismSitesLoading ? (
                              <div className="px-3 py-2 text-[13px] text-white/60">Loading parks{"\u2026"}</div>
                            ) : null}

                            {!tourismSitesLoading && filteredTourismSites.length === 0 ? (
                              <div className="px-3 py-2 text-[13px] text-white/60">No parks found.</div>
                            ) : null}

                            {!tourismSitesLoading
                              ? filteredTourismSites.map((s) => {
                                  const selected =
                                    effectiveTourismSiteIdValue !== "" &&
                                    Number(effectiveTourismSiteIdValue) === Number(s.id);
                                  const isMajor = MAJOR_TOURISM_SLUGS.has(s.slug);
                                  return (
                                    <button
                                      key={s.id}
                                      type="button"
                                      onClick={() => {
                                        const nextId = Number(s.id);
                                        setLocalTourismSiteId(nextId);
                                        setTourismSiteIdValue(nextId);
                                        setParkPickerOpen(false);
                                        setParkQuery("");
                                        setIsEditingPark(false);
                                        setIsEditingPlacement(false);
                                      }}
                                      className={`w-full text-left px-3 py-2 text-[13px] transition-colors hover:bg-white/10 ${selected ? "bg-[#02665e]/35" : ""}`}
                                      role="option"
                                      aria-selected={selected}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="truncate text-white">
                                            {s.name}{" "}
                                            {isMajor ? (
                                              <span className="ml-1 text-[10px] font-semibold text-[#02665e]">Major</span>
                                            ) : null}
                                          </div>
                                          <div className="truncate text-[10px] text-white/60">{s.country}</div>
                                        </div>
                                        {selected ? (
                                          <span className="text-[10px] font-semibold text-[#02665e]">Selected</span>
                                        ) : null}
                                      </div>
                                    </button>
                                  );
                                })
                              : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {tourismSitesError ? <p className="text-[10px] text-red-300 mt-1">{tourismSitesError}</p> : null}
                  </div>

                  {/* Placement */}
                  <div className="space-y-1.5">
                    <label className="ap-label">Placement</label>
                    <div className="relative">
                      <select
                        value={effectiveParkPlacementValue}
                        onChange={(e) => {
                          const next = String(e.target.value || "") as "" | "INSIDE" | "NEARBY";
                          setLocalParkPlacement(next);
                          setParkPlacementValue(next);
                          if (effectiveTourismSiteIdValue !== "" && next) setIsEditingPlacement(false);
                        }}
                        disabled={effectiveTourismSiteIdValue === ""}
                        className={`ap-select${effectiveParkPlacementValue ? " is-set" : ""}`}
                        aria-label="Park placement"
                      >
                        <option value="" disabled>Select placement</option>
                        <option value="INSIDE">Inside the park</option>
                        <option value="NEARBY">Nearby the park</option>
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-white/40" />
                    </div>
                  </div>
                  </div>
                </div>
              </section>

              {(() => {
                const locationDetected = typeof latitude === "number" && Number.isFinite(latitude) && typeof longitude === "number" && Number.isFinite(longitude) && locationAccuracy !== null && locationAccuracy <= 100;
                return (
                  <PropertyLocationMap
                    stepNo={5}
                    latitude={typeof latitude === "number" && Number.isFinite(latitude) ? latitude : NaN}
                    longitude={typeof longitude === "number" && Number.isFinite(longitude) ? longitude : NaN}
                    onLocationDetected={handleLocationDetected}
                    addressQuery={locationAddressQuery}
                    onClear={() => {
                      setLatitude("");
                      setLongitude("");
                      setLocationAccuracy(null);
                    }}
                    footer={
                      locationDetected ? null : (
                        <details className="group">
                          <summary className="flex cursor-pointer select-none list-none items-center gap-1 text-[12px] font-semibold text-white/70 hover:text-white">
                            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                            Type the coordinates instead
                          </summary>
                          <div className="ap-field-grid mt-2.5">
                            <div>
                              <label htmlFor="latitude" className="ap-label">Latitude</label>
                              <input
                                id="latitude"
                                type="number"
                                step="any"
                                value={latitude as any}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === "") return setLatitude("");
                                  const n = e.target.valueAsNumber;
                                  setLatitude(Number.isFinite(n) ? n : "");
                                }}
                                className="ap-input"
                                placeholder="e.g. -6.827000"
                              />
                            </div>
                            <div>
                              <label htmlFor="longitude" className="ap-label">Longitude</label>
                              <input
                                id="longitude"
                                type="number"
                                step="any"
                                value={longitude as any}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === "") return setLongitude("");
                                  const n = e.target.valueAsNumber;
                                  setLongitude(Number.isFinite(n) ? n : "");
                                }}
                                className="ap-input"
                                placeholder="e.g. 39.267500"
                              />
                            </div>
                          </div>
                        </details>
                      )
                    }
                  />
                );
              })()}
            </div>
          </div>
          </div>

          <StepFooter
            onPrev={goToPreviousStep}
            onNext={goToNextStep}
            prevDisabled={currentStep <= 0}
            nextDisabled={currentStep >= 5}
          />
        </div>
      )}
    </AddPropertySection>
  );
});

BasicsStep.displayName = "BasicsStep";


