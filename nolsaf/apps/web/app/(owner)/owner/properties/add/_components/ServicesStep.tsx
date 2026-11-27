"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Ban,
  Bandage,
  Beer,
  Car,
  Check,
  ChevronDown,
  Plus,
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
  Sun,
  Warehouse,
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
/** Long stay: a tenant parks every day, so parking is part of the rent or a monthly extra. */
const PARKING_MONTHLY: { v: "no" | "free" | "paid"; label: string; Icon: Icon }[] = [
  { v: "no", label: "No parking", Icon: Ban },
  { v: "free", label: "Included in the rent", Icon: Car },
  { v: "paid", label: "Extra each month", Icon: Wallet },
];

/** Long stay: what a tenant can use in the compound or building, not hotel services. */
const HOME_FACILITY_GROUPS: typeof SERVICE_GROUPS = [
  {
    label: "In the compound",
    items: [
      { key: "pool", label: "Swimming pool", hint: "A pool the tenant can use", Icon: Waves },
      { key: "gym", label: "Gym", hint: "A gym in the building or compound", Icon: Dumbbell },
      { key: "playground", label: "Children's play area", hint: "A safe place for children to play", Icon: PartyPopper },
      { key: "sportsGames", label: "Sports court", hint: "Basketball, tennis or a games room", Icon: Gamepad },
    ],
  },
  {
    label: "Services for the tenant",
    items: [
      { key: "security24", label: "Guard on duty, 24 hours", hint: "A guard at the gate day and night", Icon: Shield },
      { key: "cleaningService", label: "Cleaning service", hint: "Cleaning the tenant can book; say in the description if it costs extra", Icon: Package },
      { key: "laundry", label: "Laundry service", hint: "Someone can wash clothes for the tenant", Icon: WashingMachine },
    ],
  },
  {
    label: "Safety",
    items: [
      { key: "fireExtinguisher", label: "Fire extinguisher", hint: "Fire extinguishers in the home or building", Icon: FireExtinguisher },
      { key: "firstAid", label: "First aid kit", hint: "A first aid kit in the home", Icon: Bandage },
    ],
  },
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
  monthly = false,
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
  /** Long stay: parking by the month and facilities a tenant lives with. */
  monthly?: boolean;
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
  // What is behind "More services", so the owner knows whether to open it.
  const moreItems = moreGroups.flatMap((group) => group.items);
  const moreTotal = moreItems.length + (!hotelStyle ? 1 : 0);
  const morePreview = moreItems.slice(0, 3).map((item) => item.label).join(", ");
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
  const parkingSpaces = Number(services?.parkingSpaces) || 1;
  const parkingOptions = monthly ? PARKING_MONTHLY : PARKING;
  // Monthly listings price parking per month; the period is saved so it is shown right everywhere.
  const setParking = (patch: Record<string, unknown>) => setServices((s: any) => ({ ...s, ...patch, ...(monthly ? { parkingPeriod: "month" } : { parkingPeriod: undefined }) }));
  const homeFacilityCount = HOME_FACILITY_GROUPS.reduce((sum, g) => sum + g.items.filter((i) => !!services?.[i.key]).length, 0);

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
                  <h3 className="ap-card-title">{monthly ? "Parking for the tenant" : "Parking"}</h3>
                  <p className="ap-card-sub">{monthly ? "Can the tenant park a car at the home every day?" : "Can guests park at the property?"}</p>
                </div>
                <span className={`ap-card-tag${parking === "no" ? " is-todo" : ""}`}>
                  {parking === "no" ? (
                    "None"
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {parking === "free"
                        ? (monthly ? `In the rent${parkingSpaces > 1 ? `, ${parkingSpaces} cars` : ""}` : "Free")
                        : Number(parkingPrice) > 0
                          ? `TZS ${Number(parkingPrice).toLocaleString("en-US")} a ${monthly ? "month" : "day"}`
                          : "Paid"}
                    </>
                  )}
                </span>
              </header>
              {monthly ? (
                <div className="ap-card-body space-y-5">
                  {/* 1. Is there parking, and who pays */}
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Parking for the tenant">
                    {([
                      { v: "no", title: "No parking", detail: "The tenant parks on the street or nearby", Icon: Ban },
                      { v: "free", title: "Included in the rent", detail: "No extra cost to the tenant", Icon: Car },
                      { v: "paid", title: "Extra each month", detail: "You set a monthly price", Icon: Wallet },
                    ] as const).map(({ v, title, detail, Icon: TileIcon }) => {
                      const on = parking === v;
                      return (
                        <button key={v} type="button" role="radio" aria-checked={on} onClick={() => setParking({ parking: v })}
                          className={`relative flex cursor-pointer items-start gap-3 rounded-xl border border-solid p-3.5 text-left [font-family:inherit] transition-colors ${on ? "border-teal-400/70 bg-teal-400/[0.08]" : "border-white/10 bg-white/[0.02] hover:border-white/25"}`}>
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? "bg-teal-400/20 text-teal-200" : "bg-white/[0.06] text-white/50"}`}><TileIcon className="h-[18px] w-[18px]" /></span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-[14px] font-semibold ${on ? "text-white" : "text-white/80"}`}>{title}</span>
                            <span className="mt-0.5 block text-[12px] leading-4 text-white/45">{detail}</span>
                          </span>
                          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-solid ${on ? "border-teal-300 bg-teal-400 text-[#0b2420]" : "border-white/25"}`}>{on ? <Check className="h-3 w-3" /> : null}</span>
                        </button>
                      );
                    })}
                  </div>

                  {parking !== "no" ? (
                    <div className="grid gap-4 rounded-xl border border-solid border-white/10 bg-white/[0.02] p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                      {/* 2. How many cars: tap a space */}
                      <div>
                        <p className="m-0 text-[13px] font-semibold text-white">Parking spaces for the tenant</p>
                        <p className="m-0 mt-0.5 text-[12px] text-white/45">Tap how many cars fit.</p>
                        <div className="mt-2.5 grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Parking spaces">
                          {[1, 2, 3, 4, 5, 6].map((count) => {
                            const filled = count <= parkingSpaces;
                            return (
                              <button key={count} type="button" role="radio" aria-checked={parkingSpaces === count} aria-label={`${count} car${count === 1 ? "" : "s"}`} onClick={() => setParking({ parkingSpaces: count })}
                                className={`flex h-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed [font-family:inherit] transition-colors ${filled ? "border-teal-300/70 bg-teal-400/15 text-teal-200" : "border-white/15 bg-transparent text-white/25 hover:border-white/35 hover:text-white/50"}`}>
                                <Car className="h-5 w-5" />
                                <span className="text-[11px] font-semibold">{count}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 3. Open or covered */}
                      <div>
                        <p className="m-0 text-[13px] font-semibold text-white">Kind of parking</p>
                        <p className="m-0 mt-0.5 text-[12px] text-white/45">Covered protects the car from sun and rain.</p>
                        <div className="mt-2.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Kind of parking">
                          {([[false, "Open", "In the compound", Sun], [true, "Covered", "Shade or garage", Warehouse]] as const).map(([v, l, d, KindIcon]) => {
                            const on = Boolean(services?.parkingCovered) === v;
                            return (
                              <button key={l} type="button" role="radio" aria-checked={on} onClick={() => setParking({ parkingCovered: v })}
                                className={`flex h-14 cursor-pointer items-center gap-2.5 rounded-lg border border-solid px-3 text-left [font-family:inherit] transition-colors ${on ? "border-teal-400/70 bg-teal-400/[0.08]" : "border-white/10 bg-transparent hover:border-white/25"}`}>
                                <KindIcon className={`h-5 w-5 shrink-0 ${on ? "text-teal-200" : "text-white/40"}`} />
                                <span className="min-w-0">
                                  <span className={`block text-[13px] font-semibold ${on ? "text-white" : "text-white/75"}`}>{l}</span>
                                  <span className="block truncate text-[11.5px] text-white/40">{d}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 4. Monthly price, only when it is extra */}
                      {parking === "paid" ? (
                        <div className="lg:col-span-2">
                          <label htmlFor="parking-price" className="m-0 block text-[13px] font-semibold text-white">Price each month{parkingSpaces > 1 ? ", for all spaces" : ""}</label>
                          <div className={`ap-price mt-2 max-w-[320px]${Number(parkingPrice) > 0 ? " is-set" : ""}`}>
                            <span className="ap-price-unit">TZS</span>
                            <input id="parking-price" type="text" inputMode="numeric" autoFocus placeholder="30,000"
                              value={parkingPrice === "" || parkingPrice == null ? "" : Number(parkingPrice).toLocaleString("en-US")}
                              onChange={(e) => setParking({ parkingPrice: numOrEmpty(e.target.value.replace(/[^0-9]/g, "")) })} />
                            <span className="ap-price-unit">/ month</span>
                          </div>
                          <p className="m-0 mt-1.5 text-[12px] text-white/45">Paid by the tenant to you with the rent. It is not part of what NoLSAF collects.</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* What tenants will read */}
                  <p className="m-0 flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2.5 text-[12.5px] text-white/60">
                    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white/50">Tenants see</span>
                    <span className="min-w-0 text-white/85">
                      {parking === "no"
                        ? "No parking at the home."
                        : `${services?.parkingCovered ? "Covered parking" : "Open parking"} for ${parkingSpaces} car${parkingSpaces === 1 ? "" : "s"}, ${parking === "free" ? "included in the rent" : Number(parkingPrice) > 0 ? `TZS ${Number(parkingPrice).toLocaleString("en-US")} a month` : "extra each month"}.`}
                    </span>
                  </p>
                </div>
              ) : (
              <div className="ap-card-body">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <div className="ap-toggles lg:max-w-[560px] lg:flex-1" role="radiogroup" aria-label="Parking">
                    {parkingOptions.map(({ v, label, Icon }) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={parking === v}
                        onClick={() => setParking({ parking: v })}
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
                        {monthly ? "Price each month" : "Daily price"}
                      </label>
                      <div className={`ap-price${Number(parkingPrice) > 0 ? " is-set" : ""}`}>
                        <span className="ap-price-unit">TZS</span>
                        <input
                          id="parking-price"
                          type="text"
                          inputMode="numeric"
                          value={parkingPrice === "" || parkingPrice == null ? "" : Number(parkingPrice).toLocaleString("en-US")}
                          onChange={(e) => setParking({ parkingPrice: numOrEmpty(e.target.value.replace(/[^0-9]/g, "")) })}
                          placeholder={monthly ? "30,000" : "5,000"}
                          autoFocus
                        />
                        <span className="ap-price-unit">/ {monthly ? "month" : "day"}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              )}
            </section>

            {/* On-site services suggested for this property type; every other service remains available. */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">2</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">{monthly ? "Shared facilities" : "On-site services"}</h3>
                  <p className="ap-card-sub">{monthly ? "What the tenant can use in the compound or building, beyond the home itself." : `Select services guests can use at this ${propertyType ? propertyType.toLowerCase() : "property"}.`}</p>
                </div>
                {(monthly ? homeFacilityCount : onSiteCount) > 0 ? (
                  <span className="ap-card-tag">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {monthly ? homeFacilityCount : onSiteCount} selected
                  </span>
                ) : (
                  <span className="ap-card-tag is-todo">Optional</span>
                )}
              </header>

              {monthly ? (
                <>
                  <div className="ap-service-context">The kitchen, furniture, water, power and security of the home itself are set in Rooms. Meals and room service are for nightly stays, so they are not offered here.</div>
                  {renderGroups(HOME_FACILITY_GROUPS)}
                </>
              ) : <>
              <div className="ap-service-context">{hotelStyle ? "Common hotel services appear first. Add any other service guests can actually use." : "Kitchen, cooking and amenities inside the booked space are set in Rooms and beds. Add property services here."}</div>
              {hotelStyle ? <div className="ap-service-breakfast-wrap">{breakfastPicker}</div> : null}
              {renderGroups(priorityGroups)}
              <div className="ap-service-more">
                <button type="button" className={`ap-service-more-toggle${showMoreServices ? " is-open" : ""}`} aria-expanded={showMoreServices} onClick={() => setShowMoreServices((value) => !value)}>
                  <span className="ap-service-more-ico" aria-hidden><Plus className="h-4 w-4" /></span>
                  <span className="ap-service-more-copy">
                    <strong>{showMoreServices ? "Fewer services" : "More services"}</strong>
                    <small>{showMoreServices ? "Hide the extra list" : `${moreTotal} more to choose from${morePreview ? `, like ${morePreview}` : ""}`}</small>
                  </span>
                  {moreCount > 0 ? <span className="ap-service-more-badge"><Check className="h-3.5 w-3.5" aria-hidden />{moreCount} selected</span> : null}
                  <ChevronDown className="ap-service-more-chev h-4 w-4" aria-hidden />
                </button>
                {showMoreServices ? <div className="ap-service-more-content">{!hotelStyle ? breakfastPicker : null}{renderGroups(moreGroups)}</div> : null}
              </div>
              </>}
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
          nextDisabled={currentStep >= 6}
        />
      )}
    </AddPropertySection>
  );
}
