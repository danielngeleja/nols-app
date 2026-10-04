"use client";

import { useMemo, type ComponentType } from "react";
import {
  Ban,
  Bandage,
  Beer,
  Car,
  Check,
  Coffee,
  Dumbbell,
  FireExtinguisher,
  Gamepad,
  Package,
  PartyPopper,
  Shield,
  ShoppingBag,
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

/** Every on-site service, grouped the way guests scan for them. Keys are the saved service flags. */
const SERVICE_GROUPS: { label: string; items: { key: string; label: string; hint: string; Icon: Icon }[] }[] = [
  {
    label: "Dining",
    items: [
      { key: "breakfastIncluded", label: "Breakfast included", hint: "Breakfast is included in the room price", Icon: Coffee },
      { key: "breakfastAvailable", label: "Breakfast, extra charge", hint: "Breakfast is available for an additional charge", Icon: Coffee },
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
      { key: "laundry", label: "Laundry", hint: "Laundry service available for guests", Icon: WashingMachine },
      { key: "roomService", label: "Room service", hint: "Room service available for food and other requests", Icon: Package },
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
      { key: "nearbyMall", label: "Mall nearby", hint: "Shopping mall nearby the property", Icon: ShoppingBag },
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

/** Column layout for the groups above, balanced by item count (6 / 6 / 4) */
const SERVICE_COLUMNS: string[][] = [
  ["Dining", "Shopping"],
  ["Wellness and fitness", "Safety"],
  ["Housekeeping", "Events and sport"],
];

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
  numOrEmpty,
  nearbyFacilities,
  setNearbyFacilities,
  servicesCompleted,
}: {
  isVisible: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  currentStep: number;
  goToPreviousStep: () => void;
  goToNextStep: () => void;
  services: any;
  setServices: (updater: (prev: any) => any) => void;
  numOrEmpty: (v: any) => number | "";
  nearbyFacilities: any[];
  setNearbyFacilities: (updater: (prev: any[]) => any[]) => void;
  servicesCompleted: boolean;
}) {
  const onSiteCount = useMemo(() => {
    const s: any = services || {};
    return SERVICE_GROUPS.reduce((sum, g) => sum + g.items.filter((i) => !!s[i.key]).length, 0);
  }, [services]);

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

            {/* ---------------------------------------------------------------
                2. Everything on site, one row per kind
               --------------------------------------------------------------- */}
            <section className="ap-card">
              <header className="ap-card-head">
                <span className="ap-card-head-no">2</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">On-site services</h3>
                  <p className="ap-card-sub">Tick what guests can use at the property.</p>
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

              {/* Three balanced columns of two groups each: short, and no empty band */}
              <div className="ap-svc-cols">
                {SERVICE_COLUMNS.map((column, ci) => (
                  <div key={ci} className="ap-svc-col">
                    {column.map((groupLabel) => {
                      const group = SERVICE_GROUPS.find((g) => g.label === groupLabel)!;
                      const picked = group.items.filter((i) => !!services?.[i.key]).length;
                      return (
                        <div key={group.label} className="ap-svc-group">
                          <div className="ap-svc-head">
                            <span>{group.label}</span>
                            {picked > 0 ? <span className="ap-svc-count">{picked}</span> : null}
                          </div>
                          {group.items.map(({ key, label, hint, Icon }) => {
                            const on = !!services?.[key];
                            return (
                              <label key={key} className={`ap-svc-item${on ? " is-on" : ""}`} title={hint}>
                                <input
                                  type="checkbox"
                                  className="sr-only"
                                  checked={on}
                                  onChange={(e) => setServices((prev: any) => ({ ...prev, [key]: e.target.checked }))}
                                />
                                <span className="ap-svc-ico">
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 flex-1 truncate">{label}</span>
                                <span className="ap-checklist-dot">{on ? <Check className="h-3 w-3" /> : null}</span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>

            {/* ---------------------------------------------------------------
                3. Nearby places
               --------------------------------------------------------------- */}
            <NearbyPlacesCard cardNo={3} places={nearbyFacilities as any} setPlaces={setNearbyFacilities as any} />
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
