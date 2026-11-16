/**
 * Property-level services (what the place offers), grouped the way a guest
 * reads them and given a fitting icon. Used by the owner property view; the
 * groups match the public property page: included in the price, facilities,
 * safety, and what is nearby.
 */
import {
  Bandage, Beer, Car, Coffee, ConciergeBell, Dumbbell, FireExtinguisher, Gamepad2, Hospital, PartyPopper,
  Plane, Shield, ShoppingBag, Store, Tag, Thermometer, UsersRound, UtensilsCrossed, WashingMachine, Waves, Wifi,
  type LucideIcon,
} from "lucide-react";

const ICONS: Array<[RegExp, LucideIcon]> = [
  [/parking/i, Car],
  [/breakfast|coffee/i, Coffee],
  [/restaurant|dining|meal/i, UtensilsCrossed],
  [/\bbar\b|lounge/i, Beer],
  [/pool|swim/i, Waves],
  [/sauna|steam|spa/i, Thermometer],
  [/laundry|wash/i, WashingMachine],
  [/room service|concierge/i, ConciergeBell],
  [/security|guard|cctv/i, Shield],
  [/first aid/i, Bandage],
  [/fire|extinguisher|smoke|alarm/i, FireExtinguisher],
  [/shop|store/i, ShoppingBag],
  [/mall|market/i, Store],
  [/hall|event|conference/i, PartyPopper],
  [/sport|game/i, Gamepad2],
  [/gym|fitness/i, Dumbbell],
  [/wi-?fi|internet/i, Wifi],
  [/air ?con|cooling/i, Thermometer],
  [/hospital|clinic|pharmacy/i, Hospital],
  [/airport/i, Plane],
  [/group/i, UsersRound],
];

export function serviceIcon(label: string): LucideIcon {
  for (const [re, Icon] of ICONS) if (re.test(label)) return Icon;
  return Tag;
}

const INCLUDED = /\b(free|included|inclusive|complimentary)\b/i;
const SAFETY = /security|guard|first aid|fire|extinguisher|smoke|alarm|cctv|emergency/i;
const NEARBY = /^near\b|nearby|close to/i;

export type ServiceGroup = { key: "included" | "facilities" | "safety" | "nearby"; title: string; items: Array<{ label: string; full: string }> };

/** "Free parking" reads as "Parking" under "Included in the price". */
function shortIncluded(label: string) {
  const s = label.replace(INCLUDED, "").replace(/\s{2,}/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : label;
}
function shortNearby(label: string) {
  const s = label.replace(/^near(by)?\s+/i, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : label;
}

export function groupServices(labels: string[]): ServiceGroup[] {
  const groups: ServiceGroup[] = [
    { key: "included", title: "Included in the price", items: [] },
    { key: "facilities", title: "Facilities", items: [] },
    { key: "safety", title: "Safety", items: [] },
    { key: "nearby", title: "Nearby", items: [] },
  ];
  const by = Object.fromEntries(groups.map((g) => [g.key, g])) as Record<ServiceGroup["key"], ServiceGroup>;
  for (const raw of labels) {
    const label = String(raw || "").trim();
    if (!label) continue;
    if (INCLUDED.test(label)) by.included.items.push({ label: shortIncluded(label), full: label });
    else if (SAFETY.test(label)) by.safety.items.push({ label, full: label });
    else if (NEARBY.test(label)) by.nearby.items.push({ label: shortNearby(label), full: label });
    else by.facilities.items.push({ label, full: label });
  }
  return groups.filter((g) => g.items.length > 0);
}
