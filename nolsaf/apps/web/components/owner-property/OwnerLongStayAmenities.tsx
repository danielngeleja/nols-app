import { ArrowDown, Car, Dumbbell, House, MapPin, ShieldCheck, Wrench } from "lucide-react";
import { serviceIcon } from "@/lib/propertyServiceGroups";

const sections = [
  { key: "home", title: "Inside the home", Icon: House },
  { key: "compound", title: "Building & compound", Icon: Dumbbell },
  { key: "services", title: "Tenant services", Icon: Wrench },
  { key: "safety", title: "Safety & security", Icon: ShieldCheck },
  { key: "other", title: "Other listed features", Icon: House },
] as const;

type Group = typeof sections[number]["key"];
type Feature = { label: string; detail?: string };
type ServiceData = Record<string, unknown>;

const facilities: Array<{ field: string; label: string; group: Group; aliases?: string[] }> = [
  { field: "wifi", label: "Wi-Fi", group: "home", aliases: ["Free Wi-Fi"] },
  { field: "ac", label: "Air conditioning", group: "home" },
  { field: "pool", label: "Swimming pool", group: "compound", aliases: ["Pool"] },
  { field: "gym", label: "Gym", group: "compound" },
  { field: "playground", label: "Children’s play area", group: "compound" },
  { field: "sportsGames", label: "Sports & games", group: "compound", aliases: ["Sports court"] },
  { field: "sauna", label: "Sauna", group: "compound" },
  { field: "socialHall", label: "Social hall", group: "compound" },
  { field: "onSiteShop", label: "On-site shop", group: "compound" },
  { field: "laundry", label: "Laundry service", group: "services", aliases: ["Laundry"] },
  { field: "cleaningService", label: "Cleaning service", group: "services" },
  { field: "security24", label: "24-hour security", group: "safety", aliases: ["24h security", "Guard on duty, 24 hours"] },
  { field: "firstAid", label: "First aid kit", group: "safety", aliases: ["First aid"] },
  { field: "fireExtinguisher", label: "Fire extinguisher", group: "safety" },
];

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const enabled = (value: unknown) => value === true || value === 1 || /^(true|yes|1)$/i.test(String(value));
const isNearby = /^(near\b|nearby\b|close to\b|all-weather road$)/i;
const isSafety = /\b(security|guard|cctv|burglar bars|electric fence|alarm|gated compound|first aid|extinguisher|smoke detector)\b/i;
const nightlyOnly = /^(payment:|breakfast\b|restaurant$|bar$|room service$|private chef$|free cancellation$|group stay$|hospital distance\b)/i;

export function longStayHomeFeatures(services: ServiceData, tags: string[], unitAmenities: string[], securityCharge: unknown) {
  const groups = { home: [], compound: [], services: [], safety: [], other: [] } as Record<Group, Feature[]>;
  const seen = new Set<string>();
  const add = (group: Group, label: string, detail?: string) => {
    const key = normalize(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    groups[group].push({ label, detail });
  };
  const tagKeys = new Set(tags.map(normalize));

  for (const facility of facilities) {
    const aliases = [facility.label, ...(facility.aliases ?? [])].map(normalize);
    if (!enabled(services[facility.field]) && !aliases.some((key) => tagKeys.has(key))) continue;
    const detail = facility.field === "security24" && securityCharge === "TENANT" ? "Security charge paid by tenant"
      : facility.field === "security24" && securityCharge === "INCLUDED" ? "Security charge included in rent" : undefined;
    add(facility.group, facility.label, detail);
    aliases.forEach((key) => seen.add(key));
  }
  for (const raw of unitAmenities) {
    const label = String(raw || "").trim();
    if (!label || isNearby.test(label)) continue;
    add(isSafety.test(label) ? "safety" : /^shared\b/i.test(label) ? "compound" : /^rubbish collection$/i.test(label) ? "services" : "home", label);
  }
  for (const label of tags) {
    if (isNearby.test(label) || nightlyOnly.test(label) || /\bparking\b/i.test(label)) continue;
    add(isSafety.test(label) ? "safety" : "other", label);
  }

  const parkingTag = tags.find((tag) => /^(free|paid|no) parking\b/i.test(tag));
  const legacyParking = parkingTag?.split(" ")[0]?.toLowerCase();
  const mode = typeof services.parking === "string" ? services.parking.toLowerCase() : legacyParking;
  const spaces = Number(services.parkingSpaces);
  const price = services.parkingPeriod === "month" ? Number(services.parkingPrice) : NaN;
  const coverage = services.parkingCovered == null ? "Parking" : enabled(services.parkingCovered) ? "Covered parking" : "Open parking";
  const parkingLabel = Number.isInteger(spaces) && spaces > 0 ? `${coverage} · ${spaces} ${spaces === 1 ? "space" : "spaces"}` : coverage;
  const hasParking = mode === "free" || mode === "paid";
  const parking = mode === "no" ? { label: "No parking", detail: "Parking is unavailable at this home." }
    : hasParking ? { label: parkingLabel, detail: mode === "free" ? "Included in rent" : Number.isFinite(price) && price > 0 ? `TSh ${price.toLocaleString("en-US")} per month` : "Extra monthly charge · Amount not listed" }
    : tags.some((tag) => /^parking$/i.test(tag)) ? { label: parkingLabel, detail: "Monthly charge not specified" } : null;

  return { groups, parking, count: Object.values(groups).flat().length + Number(Boolean(parking && mode !== "no")) };
}

export function OwnerLongStayAmenities({ features, hasUtilityTerms }: { features: ReturnType<typeof longStayHomeFeatures>; hasUtilityTerms: boolean }) {
  const { groups, parking, count } = features;
  return (
    <section aria-labelledby="long-stay-amenities" className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-2 border-0 border-b border-solid border-slate-200 px-4 py-4 sm:px-6">
        <div>
          <h2 id="long-stay-amenities" className="m-0 text-lg font-bold text-slate-900">Home amenities</h2>
          <p className="m-0 mt-1 text-sm text-slate-600">What tenants can use in the home and around the property.</p>
        </div>
        <span className="text-xs text-slate-500">{count} listed</span>
      </header>
      <div className="divide-y divide-slate-100 px-4 sm:px-6">
        {parking && (
          <div className="flex items-start gap-3 py-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-emerald-50 text-[#02665e]"><Car className="h-4 w-4" aria-hidden /></span>
            <div className="min-w-0">
              <h3 className="m-0 text-sm font-semibold text-slate-900">{parking.label}</h3>
              <p className="m-0 mt-0.5 text-sm text-[#356658]">{parking.detail}</p>
            </div>
          </div>
        )}
        {sections.filter(({ key }) => groups[key].length > 0).map(({ key, title, Icon }) => (
          <div key={key} className="grid gap-2 py-3.5 sm:grid-cols-[170px_minmax(0,1fr)]">
            <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon className="h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />{title}</h3>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {groups[key].map(({ label, detail }) => {
                const ItemIcon = serviceIcon(label);
                return (
                  <li key={label} className="flex items-start gap-1.5 rounded border border-solid border-slate-200 bg-slate-50/60 px-2 py-1 text-xs leading-relaxed text-slate-800">
                    <ItemIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#35776b]" aria-hidden />
                    <span>{label}{detail && <span className="block text-slate-600">{detail}</span>}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {count === 0 && !parking && <p className="m-0 py-4 text-sm text-slate-600">No home amenities have been listed yet.</p>}
      </div>
      {hasUtilityTerms && (
        <a href="#owner-monthly-utilities" className="flex items-center gap-2 border-0 border-t border-solid border-[#dcebe4] bg-[#edf6f1] px-4 py-2.5 text-sm font-semibold text-[#235b49] no-underline hover:underline sm:px-6">
          <ArrowDown className="h-4 w-4 shrink-0" aria-hidden /> See utilities included in rent and bills paid by tenants
        </a>
      )}
    </section>
  );
}

export function OwnerLongStayNearby({ services, tags }: { services: ServiceData; tags: string[] }) {
  const places: Feature[] = [];
  const knownTypes = new Set<string>();
  const nearby = Array.isArray(services.nearbyFacilities) ? services.nearbyFacilities : [];
  for (const item of nearby) {
    const type = String(item?.type ?? "").trim();
    const label = String(item?.name ?? "").trim() || type;
    if (!label) continue;
    knownTypes.add(normalize(type));
    const distance = item.distanceKm === "" || item.distanceKm == null ? null : Number(item.distanceKm);
    const distanceLabel = distance != null && Number.isFinite(distance) && distance >= 0
      ? `${distance.toLocaleString("en-US", { maximumFractionDigits: 2 })} km${item.distanceKind === "straight_line" ? " straight line" : ""}` : null;
    places.push({ label, detail: distanceLabel ?? undefined });
  }
  for (const tag of tags.filter((label) => isNearby.test(label))) {
    const label = tag.replace(/^(near(?:by)?|close to)\s+/i, "");
    if (label && !knownTypes.has(normalize(label))) places.push({ label: label.charAt(0).toUpperCase() + label.slice(1) });
    knownTypes.add(normalize(label));
  }
  if (!places.length) return null;
  return (
    <div className="border-0 border-t border-solid border-slate-100 px-4 py-4 sm:px-5">
      <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><MapPin className="h-4 w-4 text-[#02665e]" aria-hidden /> In the neighbourhood</h3>
      <ul className="m-0 mt-2 grid list-none gap-x-4 gap-y-2 p-0 sm:grid-cols-2">
        {places.map(({ label, detail }, index) => (
          <li key={`${label}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-2 border-0 border-b border-solid border-slate-100 pb-1 text-sm text-slate-800">
            <span>{label}</span>{detail && <span className="text-xs text-slate-500">{detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
