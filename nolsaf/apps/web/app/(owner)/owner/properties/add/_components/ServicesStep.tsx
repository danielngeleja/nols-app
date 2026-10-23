"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Ban,
  Bandage,
  Beer,
  Car,
  Check,
  ChevronDown,
  ChevronUp,
  Coffee,
  Dumbbell,
  FireExtinguisher,
  Gamepad,
  Package,
  PartyPopper,
  Shield,
  Store,
  Thermometer,
  UtensilsCrossed,
  Wallet,
  WashingMachine,
  Waves,
} from "lucide-react";
import { AddPropertySection } from "./AddPropertySection";
import { NearbyPlacesCard } from "./NearbyPlacesCard";
import { StepFooter } from "./StepFooter";

type Icon = ComponentType<{ className?: string }>;

/** On-site services only. Amenities inside a booked unit are set in the Rooms step. */
const SERVICE_GROUPS: { label: string; items: { key: string; label: string; hint: string; Icon: Icon }[] }[] = [
  {
    label: "Dining",
    items: [
      { key: "restaurant", label: "Restaurant", hint: "On-site restaurant available for guests", Icon: UtensilsCrossed },
      { key: "bar", label: "Bar", hint: "Bar or lounge area available for guests", Icon: Beer },
    ],
  },
  {
    label: "Wellness and fitness",
    items: [
      { key: "pool", label: "Swimming pool", hint: "Swimming pool available on the property", Icon: Waves },
      { key: "sauna", label: "Sauna or spa", hint: "Sauna or steam room available", Icon: Thermometer },
      { key: "gym", label: "Gym", hint: "Gym or fitness center available on-site", Icon: Dumbbell },
    ],
  },
  {
    label: "Housekeeping",
    items: [
      { key: "laundry", label: "Laundry service", hint: "Staff or a laundry provider washes guests' clothes", Icon: WashingMachine },
      { key: "roomService", label: "Room service", hint: "Room service available for food and other requests", Icon: Package },
      { key: "privateChef", label: "Private chef", hint: "A chef can prepare meals for guests; disclose any extra charge", Icon: UtensilsCrossed },
    ],
  },
  {
    label: "Safety",
    items: [
      { key: "security24", label: "24h security", hint: "24/7 security personnel on-site", Icon: Shield },
      { key: "firstAid", label: "First aid", hint: "First aid kit or medical assistance available", Icon: Bandage },
      { key: "fireExtinguisher", label: "Fire extinguisher", hint: "Fire extinguishers and fire safety equipment available", Icon: FireExtinguisher },
    ],
  },
  {
    label: "Shopping",
    items: [
      { key: "onSiteShop", label: "On-site shop", hint: "Shop or convenience store on the property", Icon: Store },
    ],
  },
  {
    label: "Events and sport",
    items: [
      { key: "socialHall", label: "Event hall", hint: "Social hall or event space available", Icon: PartyPopper },
      { key: "sportsGames", label: "Sports and games", hint: "Sports facilities or game room available", Icon: Gamepad },
    ],
  },
];

const HOTEL_PRIORITY = new Set(["restaurant", "bar", "roomService", "laundry", "pool", "gym", "security24", "firstAid", "fireExtinguisher"]);
const HOME_PRIORITY = new Set(["pool", "laundry", "sportsGames", "security24", "firstAid", "fireExtinguisher"]);
const HOTEL_TYPES = new Set(["Hotel", "Lodge", "Guest House"]);

const PARKING: { v: "no" | "free" | "paid"; label: string; Icon: Icon }[] = [
  { v: "no", label: "No parking", Icon: Ban },
  { v: "free", label: "Free parking", Icon: Car },
  { v: "paid", label: "Paid parking", Icon: Wallet },
];

export function ServicesStep({
  isVisible,
  sectionRef,
  currentStep,
  goToPreviousStep,
  goToNextStep,
  services,
  setServices,
  propertyType,
  propertyLatitude,
  propertyLongitude,
  numOrEmpty,
  nearbyFacilities,
  setNearbyFacilities,
}: {
  isVisible: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  currentStep: number;
  goToPreviousStep: () => void;
  goToNextStep: () => void;
  services: any;
  setServices: (updater: (prev: any) => any) => void;
  propertyType: string;
  propertyLatitude: number | "";
  propertyLongitude: number | "";
  numOrEmpty: (v: any) => number | "";
  nearbyFacilities: any[];
  setNearbyFacilities: (updater: (prev: any[]) => any[]) => void;
}) {
  const [showMoreServices, setShowMoreServices] = useState(false);
  const hotelStyle = HOTEL_TYPES.has(propertyType);
  const priorityKeys = hotelStyle ? HOTEL_PRIORITY : HOME_PRIORITY;
  const priorityGroups = SERVICE_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => priorityKeys.has(item.key)) })).filter((group) => group.items.length > 0);
  const moreGroups = SERVICE_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !priorityKeys.has(item.key)) })).filter((group) => group.items.length > 0);
  const onSiteCount = useMemo(() => {
    const s: any = services || {};
    return SERVICE_GROUPS.reduce((sum, g) => sum + g.items.filter((i) => !!s[i.key]).length, 0) + (s.breakfastIncluded || s.breakfastAvailable ? 1 : 0);
  }, [services]);
  const moreCount = moreGroups.reduce((sum, group) => sum + group.items.filter((item) => !!services?.[item.key]).length, 0) + (!hotelStyle && (services?.breakfastIncluded || services?.breakfastAvailable) ? 1 : 0);
  const breakfastChoice = services?.breakfastIncluded ? "included" : services?.breakfastAvailable ? "extra" : "none";

  useEffect(() => {
    if (services?.breakfastIncluded && services?.breakfastAvailable) {
      setServices((previous: any) => ({ ...previous, breakfastAvailable: false }));
    }
  }, [services?.breakfastIncluded, services?.breakfastAvailable, setServices]);

  const breakfastPicker = (
    <fieldset className="ap-breakfast-choice">
      <legend>Breakfast</legend>
      <div className="ap-breakfast-options">
        {([{"value": "none", "label": "Not offered"}, {"value": "included", "label": "Included in the nightly price"}, {"value": "extra", "label": "Available for an extra charge"}] as const).map(({ value, label }) => (
          <label key={value} className={`ap-breakfast-option${breakfastChoice === value ? " is-on" : ""}`}>
            <input type="radio" name="breakfast-service" checked={breakfastChoice === value} onChange={() => setServices((previous: any) => ({ ...previous, breakfastIncluded: value === "included", breakfastAvailable: value === "extra" }))} />
            <Coffee className="h-4 w-4" aria-hidden="true" />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  const renderGroups = (groups: typeof SERVICE_GROUPS) => {
    const columnCount = Math.min(3, groups.length);
    return <div className="ap-svc-cols">{Array.from({ length: columnCount }, (_, column) => (
      <div key={column} className="ap-svc-col">
        {groups.filter((_, index) => index % columnCount === column).map((group) => {
          const picked = group.items.filter((item) => !!services?.[item.key]).length;
          return <div key={group.label} className="ap-svc-group">
            <div className="ap-svc-head"><span>{group.label}</span>{picked > 0 ? <span className="ap-svc-count">{picked}</span> : null}</div>
            {group.items.map(({ key, label, hint, Icon }) => {
              const on = !!services?.[key];
              return <label key={key} className={`ap-svc-item${on ? " is-on" : ""}`} title={hint}>
                <input type="checkbox" className="sr-only" checked={on} onChange={(event) => setServices((previous: any) => ({ ...previous, [key]: event.target.checked }))} />
                <span className="ap-svc-ico"><Icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="ap-checklist-dot">{on ? <Check className="h-3 w-3" /> : null}</span>
              </label>;
            })}
          </div>;
        })}
      </div>
    ))}</div>;
  };

  const parking = services?.parking || "no";
  const parkingPrice = services?.parkingPrice;

  return (
    <AddPropertySection as="section" sectionRef={sectionRef} isVisible={isVisible} className="add-property-step-surface">
      {isVisible && (
        <div className="w-full">
          <div className="ap-step-ground">
            {/* ---------------------------------------------------------------
                1. Parking
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">1</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">Parking</h3>
                  <p className="ap-card-sub">Can guests park at the property?</p>
                </div>
                <span className={`ap-card-tag${parking === "no" ? " is-todo" : ""}`}>
                  {parking === "no" ? (
                    "None"
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {parking === "free"
                        ? "Free"
                        : Number(parkingPrice) > 0
                          ? `TZS ${Number(parkingPrice).toLocaleString("en-US")} a day`
                          : "Paid"}
                    </>
                  )}
                </span>
              </header>
              <div className="ap-card-body">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <div className="ap-toggles lg:max-w-[560px] lg:flex-1" role="radiogroup" aria-label="Parking">
                    {PARKING.map(({ v, label, Icon }) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={parking === v}
                        onClick={() => setServices((s: any) => ({ ...s, parking: v }))}
                        className={`ap-toggle${parking === v ? " is-on" : ""}`}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                  {parking === "paid" ? (
                    <div className="lg:w-[280px]">
                      <label htmlFor="parking-price" className="ap-label">
                        Daily price
                      </label>
                      <div className={`ap-price${Number(parkingPrice) > 0 ? " is-set" : ""}`}>
                        <span className="ap-price-unit">TZS</span>
                        <input
                          id="parking-price"
                          type="text"
                          inputMode="numeric"
                          value={parkingPrice === "" || parkingPrice == null ? "" : Number(parkingPrice).toLocaleString("en-US")}
                          onChange={(e) => setServices((s: any) => ({ ...s, parkingPrice: numOrEmpty(e.target.value.replace(/[^0-9]/g, "")) }))}
                          placeholder="5,000"
                          autoFocus
                        />
                        <span className="ap-price-unit">/ day</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {/* On-site services suggested for this property type; every other service remains available. */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">2</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">On-site services</h3>
                  <p className="ap-card-sub">Select services guests can use at this {propertyType ? propertyType.toLowerCase() : "property"}.</p>
                </div>
                {onSiteCount > 0 ? (
                  <span className="ap-card-tag">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {onSiteCount} selected
                  </span>
                ) : (
                  <span className="ap-card-tag is-todo">Optional</span>
                )}
              </header>

              <div className="ap-service-context">{hotelStyle ? "Common hotel services appear first. Add any other service guests can actually use." : "Kitchen, cooking and amenities inside the booked space are set in Rooms and beds. Add property services here."}</div>
              {hotelStyle ? <div className="ap-service-breakfast-wrap">{breakfastPicker}</div> : null}
              {renderGroups(priorityGroups)}
              <div className="ap-service-more">
                <button type="button" className="ap-service-more-toggle" aria-expanded={showMoreServices} onClick={() => setShowMoreServices((value) => !value)}><span>{showMoreServices ? "Hide" : "Show"} more services{moreCount > 0 ? ` · ${moreCount} selected` : ""}</span>{showMoreServices ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
                {showMoreServices ? <div className="ap-service-more-content">{!hotelStyle ? breakfastPicker : null}{renderGroups(moreGroups)}</div> : null}
              </div>
              {services?.nearbyMall ? <div className="ap-service-legacy-mall"><span>“Mall nearby” was saved in the old service list. Add the named mall under Nearby places, then clear this old flag.</span><button type="button" onClick={() => setServices((previous: any) => ({ ...previous, nearbyMall: false }))}>Clear old flag</button></div> : null}
            </section>

            {/* ---------------------------------------------------------------
                3. Nearby places
               --------------------------------------------------------------- */}
            <NearbyPlacesCard cardNo={3} places={nearbyFacilities as any} setPlaces={setNearbyFacilities as any} propertyLatitude={propertyLatitude} propertyLongitude={propertyLongitude} />
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
