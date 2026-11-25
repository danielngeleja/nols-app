"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Armchair, Bath, Building2, Car, ChevronDown, ChevronLeft, ChevronRight, DoorOpen, Grid2X2, House, Plus, ShieldCheck, Sparkles, Trees, UtensilsCrossed, WashingMachine, Zap, type LucideIcon } from "lucide-react";
import PropertyDiagramConnector, { type DiagramConnection } from "@/components/PropertyDiagramConnector";
import { BATHROOM_ICONS, HOME_AMENITIES_ICONS, OTHER_AMENITIES_ICONS } from "@/lib/amenityIcons";

type Unit = {
  roomType: string;
  roomCode?: string;
  amenities: string[];
  bathItems: string[];
};
type Group = { title: string; Icon: LucideIcon; items: string[] };

export const isParkingAmenity = (label: string) =>
  /^(?:(?:open|covered|free|paid|no) )?parking(?: for \d+ cars?)?(?:, (?:in the rent|extra each month|tzs [\d,.]+ a month)| \([^()]* tzs\))?$/i.test(label.trim());
const longStayFacilities = [
  { title: "Shared facilities", Icon: Building2, labels: [
    ["Swimming pool", "Pool"],
    ["Gym"],
    ["Children’s play area"],
    ["Sports court", "Sports & games", "Sports and games"],
  ] },
  { title: "Tenant services", Icon: Sparkles, labels: [
    ["24-hour guard", "24h security", "Guard on duty, 24 hours", "Security guard"],
    ["Cleaning service"],
    ["Laundry service", "Laundry"],
  ] },
  { title: "Safety", Icon: ShieldCheck, labels: [
    ["First aid kit", "First aid"],
    ["Fire extinguisher"],
  ] },
];
const mapLabels: Record<string, string> = {
  "Kitchen and dining": "Kitchen",
  "Living and sleeping": "Living",
  "Water, power and internet": "Utilities",
  "Access and security": "Security",
  "Outdoor space and parking": "Outdoors",
  "More features": "More",
};
const unitCategories = [
  { title: "Kitchen and dining", Icon: UtensilsCrossed, matches: /kitchen|cooking|cookware|stove|oven|refrigerator|fridge|freezer|microwave|dishes|cutlery|dining|kettle|coffee maker|sink|worktop/i },
  { title: "Living and sleeping", Icon: Armchair, matches: /sitting|living|bed|mattress|sofa|couch|wardrobe|clothes rack|curtain|mosquito|lamp|chair|desk|table|air condition|heating|fan|\btv\b|entertainment|phone|servant quarter/i },
  { title: "Water, power and internet", Icon: Zap, matches: /water|borehole|power|luku|generator|solar|wi[ -]?fi|internet|electric meter|fiber|fibre/i },
  { title: "Access and security", Icon: ShieldCheck, matches: /entrance|gated|burglar|fence|lock|security|guard|cctv|alarm|first aid|fire|emergency|safe\b/i },
  { title: "Outdoor space and parking", Icon: Trees, matches: /parking|garden|courtyard|balcony|terrace|patio|outdoor|pool|public transport/i },
  { title: "Laundry", Icon: WashingMachine, matches: /laundry|washer|washing machine|dryer|iron/i },
];

function amenityKey(value: string) {
  if (isParkingAmenity(value)) return "parking";
  return value.trim().toLowerCase().replace(/,\s+in the rent$/, "").replace(/\b(free|included|inclusive|complimentary)\b/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}

const amenityIconsByKey = new Map(
  Object.entries({ ...HOME_AMENITIES_ICONS, ...OTHER_AMENITIES_ICONS, ...BATHROOM_ICONS })
    .map(([label, Icon]) => [amenityKey(label), Icon] as const),
);

function uniqueItems(items: string[], seen = new Set<string>()) {
  return items.filter((item) => {
    const key = amenityKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupLongStayFacilities(included: string[], available: string[], propertyKeys: Set<string>): Group[] {
  const includedParking = included.find(isParkingAmenity);
  const parking = includedParking ?? available.find(isParkingAmenity);
  const groups: Group[] = [];
  if (parking) {
    const paid = /^paid parking(?: \(([\d,.]+) TZS\))?$/i.exec(parking);
    const label = includedParking
      ? `${parking.replace(/^free /i, "").replace(/, in the rent$/i, "").replace(/^./, (first) => first.toUpperCase())}, included in rent`
      : paid ? `Parking, ${paid[1] ? `TZS ${paid[1]} a month` : "extra each month"}` : parking;
    groups.push({ title: "Parking", Icon: Car, items: [label] });
    propertyKeys.add("parking");
  }

  const declaredKeys = new Set([...included, ...available].map(amenityKey));
  for (const { title, Icon, labels } of longStayFacilities) {
    const items = labels.flatMap(([label, ...aliases]) => {
      const keys = [label, ...aliases].map(amenityKey);
      if (!keys.some((key) => declaredKeys.has(key))) return [];
      keys.forEach((key) => propertyKeys.add(key));
      return [label];
    });
    if (items.length) groups.push({ title, Icon, items });
  }
  return groups;
}

function groupUnit(unit: Unit, propertyKeys: Set<string>): Group[] {
  const seen = new Set(propertyKeys);
  const bath = uniqueItems(unit.bathItems, seen);
  const items = uniqueItems(unit.amenities, seen);
  const categories: Group[] = unitCategories.map(({ title, Icon }) => ({ title, Icon, items: [] }));
  const other = { title: "More features", Icon: Plus, items: [] as string[] };
  for (const item of items) {
    const index = unitCategories.findIndex(({ matches }) => matches.test(item));
    (categories[index] ?? other).items.push(item);
  }
  return [...categories, { title: "Bathroom", Icon: Bath, items: bath }, other].filter(({ items }) => items.length);
}

function PropertyOverview({ groups }: { groups: Group[] }) {
  return (
    <div className="grid gap-x-6 gap-y-3 border-0 border-y border-solid border-neutral-200 py-3 sm:grid-cols-[repeat(auto-fit,minmax(145px,1fr))] sm:py-4">
      {groups.map(({ title, Icon, items }) => (
        <div key={title} className="min-w-0">
          <h4 className="m-0 flex items-center gap-1.5 text-xs font-semibold text-neutral-950">
            <Icon className="size-3.5 shrink-0 text-[#39796d]" aria-hidden />{title}
          </h4>
          <ul className="m-0 mt-1 list-none space-y-0.5 p-0 pl-5 text-[13px] leading-5 text-neutral-700">
            {items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function AmenityMap({ groups }: { groups: Group[] }) {
  const [selected, setSelected] = useState(groups[0]?.title);
  const [showAll, setShowAll] = useState(false);
  const [connection, setConnection] = useState<DiagramConnection | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const panelId = useId();
  const active = groups.find(({ title }) => title === selected) ?? groups[0];
  const activeTitle = active?.title;
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const maxCount = Math.max(1, ...groups.map(({ items }) => items.length));

  useEffect(() => {
    const container = frame.current;
    const detail = panel.current;
    const node = activeTitle ? nodes.current.get(activeTitle) : undefined;
    if (showAll || !container || !detail || !node) {
      setConnection(null);
      return;
    }
    const measure = () => {
      const root = container.getBoundingClientRect();
      const from = node.getBoundingClientRect();
      const to = detail.getBoundingClientRect();
      if (to.left - from.right < 24 || !from.width || !to.height) {
        setConnection(null);
        return;
      }
      const center = from.top + from.height / 2;
      const end = Math.min(Math.max(center, to.top + 24), to.bottom - 24);
      const next = { sx: from.right - root.left, sy: center - root.top, ex: to.left - root.left, ey: end - root.top };
      setConnection((current) => current && current.sx === next.sx && current.sy === next.sy && current.ex === next.ex && current.ey === next.ey ? current : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(detail);
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeTitle, groups.length, showAll]);

  if (!active) return null;
  const activeIndex = groups.indexOf(active);
  const detailCount = showAll ? total : active.items.length;
  const DetailIcon = showAll ? Grid2X2 : active.Icon;

  function selectGroup(index: number, focus = false) {
    const group = groups[index];
    if (!group) return;
    setSelected(group.title);
    setShowAll(false);
    if (focus) nodes.current.get(group.title)?.focus();
  }

  return (
    <div className="@container">
      {groups.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="m-0 text-neutral-600">Select a group to explore its amenities.</p>
          <button type="button" aria-pressed={showAll} aria-controls={panelId} onClick={() => setShowAll((value) => !value)}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-[#d7e5e1] bg-white px-2.5 font-semibold text-[#28645a] transition-colors hover:bg-[#edf6f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#39796d]">
            <Grid2X2 className="size-3.5" aria-hidden />{showAll ? "Return to selected group" : "View all amenities"}
          </button>
        </div>
      ) : null}
      <div ref={frame} className={`relative grid items-start gap-3 ${groups.length > 1 ? "@min-[640px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] @min-[640px]:gap-9" : ""}`}>
        {connection && !showAll ? <PropertyDiagramConnector connection={connection} stroke="#548f83" /> : null}
        {groups.length > 1 ? (
          <div className="rounded-md border border-solid border-[#e2ebe8] bg-[#f7faf9] p-3 [background-image:radial-gradient(#d7e4e0_0.75px,transparent_0.75px)] [background-size:15px_15px]">
            <ul aria-label="Amenities map" className="relative m-0 grid list-none grid-cols-2 gap-2 p-0 @min-[640px]:grid-cols-1">
              <li className="pointer-events-none absolute inset-y-4 left-1/2 hidden w-px border-0 border-l border-dashed border-[#d0dfda] @min-[640px]:block" aria-hidden />
              {groups.map(({ title, Icon, items }, index) => {
                const current = !showAll && active.title === title;
                return (
                  <li key={title} className="relative @min-[640px]:grid @min-[640px]:grid-cols-2">
                    <button type="button" ref={(element) => { if (element) nodes.current.set(title, element); else nodes.current.delete(title); }}
                      aria-label={`${title}, ${items.length} ${items.length === 1 ? "amenity" : "amenities"}`}
                      aria-pressed={current} aria-controls={panelId}
                      onClick={() => selectGroup(index)}
                      onKeyDown={(event) => {
                        const destinations: Partial<Record<string, number>> = {
                          ArrowUp: index - 1, ArrowLeft: index - 1,
                          ArrowDown: index + 1, ArrowRight: index + 1,
                          Home: 0, End: groups.length - 1,
                        };
                        const destination = destinations[event.key];
                        if (typeof destination !== "number") return;
                        event.preventDefault();
                        selectGroup(destination, true);
                      }}
                      className={`relative z-[1] grid min-h-[49px] w-full min-w-0 cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-1.5 rounded-md border border-solid px-2 py-1.5 text-left outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#39796d] [font-family:inherit] ${index % 2 ? "@min-[640px]:col-start-2" : ""} ${current ? "border-[#7eb2a6] bg-[#e5f2ee] text-[#214f46]" : "border-[#e0e8e5] bg-white text-neutral-900 hover:border-[#a7c8bf] hover:bg-[#f8fbfa]"}`}>
                      <span className={`row-span-2 grid size-7 place-items-center rounded-sm ${current ? "bg-[#cfe6df] text-[#28645a]" : "bg-[#f0f5f3] text-[#58736b]"}`}><Icon className="size-4" aria-hidden /></span>
                      <span className="truncate text-xs font-semibold">{mapLabels[title] ?? title}</span>
                      <span className={`text-right text-xs font-semibold tabular-nums ${current ? "text-[#28645a]" : "text-neutral-600"}`}>{items.length}</span>
                      <span className={`col-span-2 h-1 overflow-hidden rounded-full ${current ? "bg-[#cfe6df]" : "bg-[#edf2f0]"}`} aria-hidden>
                        <span className={`block h-full rounded-full ${current ? "bg-[#548f83]" : "bg-[#a8bfb8]"}`} style={{ width: `${items.length / maxCount * 100}%` }} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <section ref={panel} id={panelId} aria-label="Selected amenities" className="min-w-0 self-center overflow-hidden rounded-md border border-solid border-[#dce7e3] bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-0 border-b border-solid border-[#e3ece8] bg-[#f7faf9] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md border border-solid border-[#d7e8e2] bg-[#eaf4f0] text-[#28645a]"><DetailIcon className="size-5" aria-hidden /></span>
              <div aria-live="polite" aria-atomic="true" className="min-w-0">
                <h5 className="m-0 text-[15px] font-semibold text-neutral-950">{showAll ? "All amenities" : active.title}</h5>
                <p className="m-0 mt-0.5 text-xs text-neutral-600">{detailCount} {detailCount === 1 ? "amenity" : "amenities"}</p>
              </div>
            </div>
            {!showAll && groups.length > 1 ? (
              <div role="group" aria-label="Browse amenity groups" className="ml-auto flex shrink-0 items-center gap-1">
                {[
                  { offset: -1, label: "Previous amenity group", Arrow: ChevronLeft },
                  { offset: 1, label: "Next amenity group", Arrow: ChevronRight },
                ].map(({ offset, label, Arrow }) => (
                  <button key={offset} type="button" aria-label={label} aria-controls={panelId}
                    aria-disabled={!groups[activeIndex + offset]}
                    onClick={() => selectGroup(activeIndex + offset)}
                    className="inline-grid size-9 cursor-pointer place-items-center rounded-md border border-solid border-[#d7e5e1] bg-white p-0 text-[#28645a] transition-colors hover:bg-[#edf6f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#39796d] aria-disabled:cursor-default aria-disabled:text-neutral-400 aria-disabled:hover:bg-white">
                    <Arrow className="size-4" aria-hidden />
                  </button>
                ))}
              </div>
            ) : null}
          </header>
          <div className="space-y-3 px-4 py-3">
            {(showAll ? groups : [active]).map(({ title, Icon: GroupIcon, items }) => (
              <div key={title}>
                {showAll ? <h6 className="m-0 mb-1 text-[13px] font-semibold text-neutral-900">{title}</h6> : null}
                <ul className="m-0 grid list-none gap-x-4 gap-y-1.5 p-0 min-[400px]:grid-cols-2">
                  {items.map((item) => {
                    const ItemIcon = amenityIconsByKey.get(amenityKey(item)) ?? GroupIcon;
                    return (
                      <li key={item} className="flex min-w-0 items-start gap-2 text-[13px] leading-5 text-neutral-700">
                        <ItemIcon className="mt-0.5 size-4 shrink-0 text-[#39796d]" aria-hidden />
                        <span className="min-w-0 break-words">{item}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function PropertyOfferings({ included, available, units }: {
  included: string[];
  available: string[];
  units: Unit[];
}) {
  const propertyKeys = new Set<string>();
  const propertyGroups = groupLongStayFacilities(included, available, propertyKeys);
  const unitGroups = units.map((unit, index) => ({
    index,
    title: units.length === 1 ? "Inside the home" : unit.roomType,
    groups: groupUnit(unit, propertyKeys),
    code: unit.roomCode,
  }));
  if (!propertyGroups.length && !unitGroups.some(({ groups }) => groups.length)) return null;

  const unitsWithFeatures = unitGroups.filter(({ groups }) => groups.length);

  return (
    <section id="property-offers" aria-labelledby="property-offers-title" className="scroll-mt-24 rounded-lg border border-solid border-neutral-200 bg-white p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-neutral-100 text-neutral-700"><House className="h-5 w-5" aria-hidden /></span>
        <h3 id="property-offers-title" className="m-0 text-xl font-semibold tracking-tight text-neutral-950">What this place offers</h3>
      </header>

      {propertyGroups.length ? <div className="mt-4"><PropertyOverview groups={propertyGroups} /></div> : null}
      {unitsWithFeatures.length ? (
        <div className="mt-5">
          {unitGroups.length === 1 ? (
            <div id="offers-unit-0" className="scroll-mt-24">
              <h4 className="m-0 mb-2.5 text-[15px] font-semibold text-neutral-950">{unitGroups[0].title}</h4>
              <AmenityMap groups={unitGroups[0].groups} />
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {unitsWithFeatures.map(({ index, title, groups, code }) => (
                <details key={index} id={`offers-unit-${index}`} className="group scroll-mt-24 py-2">
                  <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm font-semibold text-neutral-900 [&::-webkit-details-marker]:hidden">
                    <DoorOpen className="h-4 w-4 shrink-0 text-neutral-700" aria-hidden />
                    <span className="min-w-0 flex-1">{title}{code && unitGroups.filter((entry) => entry.title === title).length > 1 ? <small className="ml-2 font-normal text-neutral-600">{code}</small> : null}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-neutral-600 group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="pb-2 pt-3"><AmenityMap groups={groups} /></div>
                </details>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
