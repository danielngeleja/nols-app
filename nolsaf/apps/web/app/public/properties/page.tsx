"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  X,
  LocateFixed,
  ChevronsUpDown,
  CreditCard,
  Smartphone,
  BadgeCheck,
  UsersRound,
  Hospital,
  BadgeAlert,
  Plane,
  Bus,
  Fuel,
  Route,
  Car,
  Coffee,
  UtensilsCrossed,
  Beer,
  Waves,
  Thermometer,
  WashingMachine,
  ConciergeBell,
  Shield,
  Bandage,
  FireExtinguisher,
  ShoppingBag,
  Store,
  PartyPopper,
  Gamepad2,
  Dumbbell,
  Tag,
  Trash2,
  Check,
  Building2,
  Hotel,
  Globe,
  MapPin,
  Headphones,
  Wallet,
  UserCircle,
  SearchX,
  ArrowRight,
  Clock,
  ArrowUpDown,
} from "lucide-react";
import SectionSeparator from "../../../components/SectionSeparator";
import { REGIONS } from "@/lib/tzRegions";
import { REGIONS_FULL_DATA } from "@/lib/tzRegionsFull";
import PublicApprovedPropertyCard from "../../../components/PublicApprovedPropertyCard";

type PublicPropertyCard = {
  id: number;
  slug: string;
  title: string;
  type: string;
  location: string;
  ward?: string | null;
  services?: any; // Can be array of strings OR object with commissionPercent and discountRules
  primaryImage: string | null;
  basePrice: number | null;
  currency: string | null;
  maxGuests: number | null;
  totalBedrooms: number | null;
  totalBathrooms: number | null;
};

type ListResponse = {
  items: PublicPropertyCard[];
  total: number;
  page: number;
  pageSize: number;
};

const PROPERTY_TYPES = [
  { key: "HOTEL", label: "Hotel" },
  { key: "LODGE", label: "Lodge" },
  { key: "APARTMENT", label: "Apartment" },
  { key: "VILLA", label: "Villa" },
  { key: "GUEST_HOUSE", label: "Guest house" },
  { key: "BUNGALOW", label: "Bungalow" },
  { key: "CONDO", label: "Condo" },
  { key: "CABIN", label: "Cabin" },
  { key: "HOMESTAY", label: "Homestay" },
  { key: "TOWNHOUSE", label: "Townhouse" },
  { key: "HOUSE", label: "House" },
  { key: "OTHER", label: "Other" },
] as const;

const AMENITIES = [
  "Free parking",
  "Breakfast included",
  "Breakfast available",
  "Restaurant",
  "Bar",
  "Pool",
  "Sauna",
  "Laundry",
  "Room service",
  "24h security",
  "First aid",
  "Fire extinguisher",
  "On-site shop",
  "Nearby mall",
  "Social hall",
  "Sports & games",
  "Gym",
] as const;

type Amenity = (typeof AMENITIES)[number];

/** Amenities grouped for the filters sheet; every entry in AMENITIES appears exactly once. */
const AMENITY_GROUPS: Array<{ title: string; items: Amenity[] }> = [
  { title: "Food and drink", items: ["Breakfast included", "Breakfast available", "Restaurant", "Bar"] },
  { title: "Services", items: ["Free parking", "Laundry", "Room service", "On-site shop"] },
  { title: "Wellness and leisure", items: ["Pool", "Sauna", "Gym", "Sports & games", "Social hall", "Nearby mall"] },
  { title: "Safety", items: ["24h security", "First aid", "Fire extinguisher"] },
];

const PRICE_BUCKETS: Array<{ label: string; min: number | null; max: number | null }> = [
  { label: "Any", min: null, max: null },
  { label: "5k–20k", min: 5_000, max: 20_000 },
  { label: "20k–40k", min: 20_000, max: 40_000 },
  { label: "40k–80k", min: 40_000, max: 80_000 },
  { label: "80k–100k", min: 80_000, max: 100_000 },
  { label: "100k–400k", min: 100_000, max: 400_000 },
  { label: "400k+", min: 400_000, max: null }, // "any million"
] as const;

const PAYMENT_MODES = [
  { key: "Card", Icon: CreditCard },
  { key: "Mobile money", Icon: Smartphone },
] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number]["key"];

function priceBucketIndex(minPrice: string, maxPrice: string) {
  const min = minPrice ? Number(minPrice) : NaN;
  const max = maxPrice ? Number(maxPrice) : NaN;
  if (!Number.isFinite(min) && !Number.isFinite(max)) return 0;
  for (let i = 1; i < PRICE_BUCKETS.length; i++) {
    const b = PRICE_BUCKETS[i];
    const minOk = (b.min == null && !Number.isFinite(min)) || (b.min != null && Number.isFinite(min) && min === b.min);
    const maxOk =
      (b.max == null && !Number.isFinite(max)) ||
      (b.max != null && Number.isFinite(max) && max === b.max);
    if (minOk && maxOk) return i;
  }
  // If user typed a custom range earlier, pick the closest bucket by min
  if (Number.isFinite(min)) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 1; i < PRICE_BUCKETS.length; i++) {
      const b = PRICE_BUCKETS[i];
      if (b.min == null) continue;
      const dist = Math.abs(b.min - min);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
  return 0;
}

const AMENITY_ICON_META: Record<Amenity, { Icon: LucideIcon; colorClass: string }> = {
  "Free parking": { Icon: Car, colorClass: "text-blue-600" },
  "Breakfast included": { Icon: Coffee, colorClass: "text-amber-600" },
  "Breakfast available": { Icon: Coffee, colorClass: "text-orange-600" },
  Restaurant: { Icon: UtensilsCrossed, colorClass: "text-rose-600" },
  Bar: { Icon: Beer, colorClass: "text-purple-600" },
  Pool: { Icon: Waves, colorClass: "text-cyan-600" },
  Sauna: { Icon: Thermometer, colorClass: "text-orange-600" },
  Laundry: { Icon: WashingMachine, colorClass: "text-indigo-600" },
  "Room service": { Icon: ConciergeBell, colorClass: "text-emerald-700" },
  "24h security": { Icon: Shield, colorClass: "text-red-600" },
  "First aid": { Icon: Bandage, colorClass: "text-green-700" },
  "Fire extinguisher": { Icon: FireExtinguisher, colorClass: "text-red-600" },
  "On-site shop": { Icon: ShoppingBag, colorClass: "text-pink-600" },
  "Nearby mall": { Icon: Store, colorClass: "text-pink-600" },
  "Social hall": { Icon: PartyPopper, colorClass: "text-yellow-600" },
  "Sports & games": { Icon: Gamepad2, colorClass: "text-yellow-700" },
  Gym: { Icon: Dumbbell, colorClass: "text-slate-700" },
};

const NEARBY_SERVICE_TAGS: Array<{ tag: string; label: string; Icon: LucideIcon; colorClass: string }> = [
  { tag: "Near hospital", label: "Hospital", Icon: Hospital, colorClass: "text-rose-600" },
  { tag: "Near police station", label: "Police", Icon: BadgeAlert, colorClass: "text-indigo-600" },
  { tag: "Near airport", label: "Airport", Icon: Plane, colorClass: "text-sky-600" },
  { tag: "Near bus station", label: "Bus station", Icon: Bus, colorClass: "text-amber-700" },
  { tag: "Near petrol station", label: "Petrol station", Icon: Fuel, colorClass: "text-orange-600" },
  { tag: "Near main road", label: "Main road", Icon: Route, colorClass: "text-slate-700" },
] as const;

function buildQuery(searchParams: { toString(): string } | null | undefined) {
  const qp = new URLSearchParams(searchParams?.toString() ?? "");
  if (!qp.get("pageSize")) qp.set("pageSize", "24");
  if (!qp.get("page")) qp.set("page", "1");
  // Guests are chosen later during booking (dates/adults/children),
  // so we intentionally ignore guests filtering at browse level.
  qp.delete("guests");
  return qp;
}

function getParam(qp: URLSearchParams, key: string) {
  const v = qp.get(key);
  return v && v.trim() ? v.trim() : "";
}

function setOrDelete(qp: URLSearchParams, key: string, value: string) {
  const v = value.trim();
  if (!v) qp.delete(key);
  else qp.set(key, v);
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Filters sheet building blocks; module level so inputs inside keep their identity between renders. */
function FilterSwitch({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`relative inline-flex h-6 w-10 flex-none items-center rounded-full transition-colors ${on ? "bg-[#02665e]" : "bg-slate-300"}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </span>
  );
}

type FilterOption = { key: string; label: string; Icon?: LucideIcon; hint?: string };

/**
 * The filters sheet's shared option list: a white card split into a two-column grid,
 * monochrome icons, and a checkbox (multi) or radio dot (single) on the right.
 */
function OptionGrid({
  title,
  options,
  isOn,
  onPick,
  single = false,
  columns = 2,
}: {
  title?: string;
  options: FilterOption[];
  isOn: (key: string) => boolean;
  onPick: (key: string) => void;
  single?: boolean;
  columns?: 1 | 2;
}) {
  const picked = options.filter((o) => isOn(o.key)).length;
  return (
    <div>
      {title && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{title}</span>
          {!single && picked > 0 && <span className="text-[11px] font-semibold text-[#02665e]">{picked} selected</span>}
        </div>
      )}
      <div
        role={single ? "radiogroup" : "group"}
        aria-label={title}
        className={`grid overflow-hidden rounded-lg border border-solid border-slate-200 bg-white ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}
      >
        {options.map((o, i) => {
          const on = isOn(o.key);
          const Icon = o.Icon;
          return (
            <button
              key={o.key}
              type="button"
              role={single ? "radio" : "checkbox"}
              aria-checked={on}
              onClick={() => onPick(o.key)}
              className={[
                "box-border flex min-w-0 items-center gap-2.5 border-0 border-solid border-slate-100 px-3 py-2.5 text-left transition-colors",
                columns === 2 && i % 2 === 1 ? "border-l" : "",
                i >= columns ? "border-t" : "",
                on ? "bg-[#02665e]/[0.06]" : "bg-white hover:bg-slate-50",
              ].join(" ")}
            >
              {Icon && <Icon className={`h-4 w-4 flex-none ${on ? "text-[#02665e]" : "text-slate-400"}`} aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[13px] ${on ? "font-semibold text-[#02665e]" : "text-slate-700"}`}>{o.label}</span>
                {o.hint && <span className="block truncate text-[11.5px] text-slate-500">{o.hint}</span>}
              </span>
              {single ? (
                <span
                  aria-hidden
                  className={`box-border flex h-4 w-4 flex-none items-center justify-center rounded-full border border-solid transition-colors ${on ? "border-[#02665e]" : "border-slate-300"}`}
                >
                  {on && <span className="h-2 w-2 rounded-full bg-[#02665e]" />}
                </span>
              ) : (
                <span
                  aria-hidden
                  className={`box-border flex h-4 w-4 flex-none items-center justify-center rounded-[4px] border border-solid transition-colors ${
                    on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white"
                  }`}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One accordion row: icon, title and the current choice on the right.
 * Only one row is expanded at a time, so the sheet stays short and scannable.
 */
function FilterSection({
  id,
  title,
  Icon,
  summary,
  open,
  onToggle,
  onClear,
  children,
}: {
  id: string;
  title: string;
  Icon: LucideIcon;
  summary: string;
  open: boolean;
  onToggle: () => void;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const isSet = Boolean(onClear);
  return (
    <section className="border-0 border-t border-solid border-slate-100 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`filter-panel-${id}`}
        className={`box-border flex h-[52px] w-full items-center gap-3 border-0 px-4 text-left transition-colors ${open ? "bg-slate-50" : "bg-white hover:bg-slate-50"}`}
      >
        <span
          className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ring-1 ring-inset ${
            isSet ? "bg-[#02665e] text-white ring-[#02665e]" : "bg-[#02665e]/[0.07] text-[#02665e] ring-[#02665e]/10"
          }`}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-900">{title}</span>
        {/* Current choice: quiet grey when open-ended, brand when set */}
        <span className={`max-w-[42%] flex-none truncate text-[13px] ${isSet ? "font-semibold text-[#02665e]" : "text-slate-500"}`}>
          {summary}
        </span>
        <ChevronRight className={`h-4 w-4 flex-none text-slate-400 transition-transform duration-200 ${open ? "rotate-90" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id={`filter-panel-${id}`} className="min-w-0 border-0 border-t border-solid border-slate-100 bg-slate-50 px-4 pb-3.5 pt-3">
          {children}
          {onClear && (
            <button type="button" onClick={onClear} className="mt-3 border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline">
              Clear {title.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function nextSort(cur: string): "" | "price_asc" | "price_desc" {
  if (cur === "price_asc") return "price_desc";
  if (cur === "price_desc") return "";
  return "price_asc";
}

function parseTypesParam(qp: URLSearchParams) {
  const raw = qp.get("types") || qp.get("type") || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseAmenitiesParam(qp: URLSearchParams) {
  const raw = qp.get("amenities") || qp.get("services") || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseCsvParam(qp: URLSearchParams, key: string) {
  const raw = qp.get(key) || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBoolParam(qp: URLSearchParams, key: string) {
  const v = (qp.get(key) || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export default function PropertiesPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const qp = useMemo(() => buildQuery(sp), [sp]);
  const q = qp.get("q")?.trim() || "";
  const page = Math.max(1, Number(qp.get("page") || "1"));

  // Local search state — decoupled from URL so typing is free
  const [searchInput, setSearchInput] = useState(q);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recently viewed properties — persisted in localStorage (max 4)
  type RecentProperty = { title: string; slug: string; location: string; primaryImage: string | null; basePrice: number | null; currency: string | null; services?: any };
  const RECENT_KEY = "nolsaf_recent_properties";
  const [recentProperties, setRecentProperties] = useState<RecentProperty[]>([]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_KEY);
      if (stored) setRecentProperties(JSON.parse(stored));
    } catch {}
  }, []);
  const addRecentProperty = useCallback((prop: RecentProperty) => {
    setRecentProperties((prev) => {
      const next = [prop, ...prev.filter((p) => p.slug !== prop.slug)].slice(0, 4);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const removeRecentProperty = useCallback((slug: string) => {
    setRecentProperties((prev) => {
      const next = prev.filter((p) => p.slug !== slug);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const clearRecentProperties = useCallback(() => {
    setRecentProperties([]);
    try { localStorage.removeItem(RECENT_KEY); } catch {}
  }, []);

  // Sync local input when URL q changes externally (e.g. chip removal, clear filters)
  useEffect(() => { setSearchInput(q); }, [q]);

  const pushSearch = useCallback((value: string) => {
    const next = new URLSearchParams(qp.toString());
    next.set("page", "1");
    setOrDelete(next, "q", value);
    router.push(`/public/properties?${next.toString()}`);
  }, [qp, router]);

  const onSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => pushSearch(value), 500);
  }, [pushSearch]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); }, []);

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [systemCommission, setSystemCommission] = useState<number>(0);

  useEffect(() => {
    const originalAlert = window.alert;

    // Prevent native browser popups on this page and keep a consistent in-app UI.
    window.alert = (message?: any) => {
      const text = String(message ?? "").trim();
      if (!text) return;
      setPageNotice(text);
    };

    return () => {
      window.alert = originalAlert;
    };
  }, []);

  // Load system commission settings
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/public/support/system-settings`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (mounted && json?.commissionPercent !== undefined) {
            const commission = Number(json.commissionPercent);
            setSystemCommission(isNaN(commission) ? 0 : commission);
          }
        }
      } catch (e) {
        // Silently fail - will use 0 as default
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // Filters UI state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersShown, setFiltersShown] = useState(false);
  /** Which filter row is expanded in the sheet (one at a time) */
  const [filterPanel, setFilterPanel] = useState<string | null>(null);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [amenityHint, setAmenityHint] = useState<Amenity | null>(null);
  const [draft, setDraft] = useState<{
    q: string;
    sort: string;
    region: string;
    district: string;
    ward: string;
    street: string;
    minPrice: string;
    maxPrice: string;
    types: string[];
    amenities: string[];
    nearbyServices: string[];
    paymentModes: string[];
    freeCancellation: boolean;
    groupStay: boolean;
    nearbyOn: boolean;
    radiusKm: string;
    nearLat: string;
    nearLng: string;
  }>({
    q: "",
    sort: "",
    region: "",
    district: "",
    ward: "",
    street: "",
    minPrice: "",
    maxPrice: "",
    types: [],
    amenities: [],
    nearbyServices: [],
    paymentModes: [],
    freeCancellation: false,
    groupStay: false,
    nearbyOn: false,
    radiusKm: "15",
    nearLat: "",
    nearLng: "",
  });

  const locationOptions = useMemo(() => {
    const regionData = draft.region
      ? (REGIONS_FULL_DATA as any[]).find((r) => slugify(String(r?.name || "")) === draft.region) || null
      : null;
    const districts: string[] = regionData?.districts?.map((d: any) => String(d?.name || "")).filter(Boolean) || [];
    const districtData = regionData && draft.district ? regionData.districts?.find((d: any) => String(d?.name || "") === draft.district) || null : null;
    const wards: string[] = districtData?.wards?.map((w: any) => String(w?.name || "")).filter(Boolean) || [];
    const wardData = districtData && draft.ward ? districtData.wards?.find((w: any) => String(w?.name || "") === draft.ward) || null : null;
    const streets: string[] = wardData?.streets?.map((s: any) => String(s || "")).filter(Boolean) || [];
    return { districts, wards, streets };
  }, [draft.region, draft.district, draft.ward]);

  useEffect(() => {
    if (!amenityHint) return;
    const t = setTimeout(() => setAmenityHint(null), 1200);
    return () => clearTimeout(t);
  }, [amenityHint]);

  const hasNearby = Boolean(getParam(qp, "nearLat") && getParam(qp, "nearLng"));

  const appliedChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    const remove = (keys: string[]) => {
      const next = new URLSearchParams(qp.toString());
      keys.forEach((k) => next.delete(k));
      next.set("page", "1");
      router.push(`/public/properties?${next.toString()}`);
    };
    const qv = getParam(qp, "q");
    if (qv) chips.push({ key: "q", label: `Search: ${qv}`, onRemove: () => remove(["q"]) });
    const sort = getParam(qp, "sort");
    if (sort) {
      const label = sort === "price_asc" ? "Price: low → high" : sort === "price_desc" ? "Price: high → low" : sort.replace("_", " ");
      chips.push({ key: "sort", label: `Sort: ${label}`, onRemove: () => remove(["sort"]) });
    }
    const region = getParam(qp, "region");
    if (region) {
      const label = REGIONS.find((r: any) => String(r.id) === String(region))?.name || region;
      chips.push({ key: "region", label: `Region: ${label}`, onRemove: () => remove(["region"]) });
    }
    const district = getParam(qp, "district");
    if (district) chips.push({ key: "district", label: `District: ${district}`, onRemove: () => remove(["district"]) });
    const ward = getParam(qp, "ward");
    if (ward) chips.push({ key: "ward", label: `Ward: ${ward}`, onRemove: () => remove(["ward"]) });
    const street = getParam(qp, "street");
    if (street) chips.push({ key: "street", label: `Street: ${street}`, onRemove: () => remove(["street"]) });
    const city = getParam(qp, "city");
    if (city) chips.push({ key: "city", label: `City: ${city}`, onRemove: () => remove(["city"]) });
    const minPrice = getParam(qp, "minPrice");
    const maxPrice = getParam(qp, "maxPrice");
    if (minPrice || maxPrice) chips.push({ key: "price", label: `Price: ${minPrice || "0"}–${maxPrice || "∞"}`, onRemove: () => remove(["minPrice", "maxPrice"]) });
    const types = parseTypesParam(qp);
    if (types.length) chips.push({ key: "types", label: `Type: ${types.join(", ")}`, onRemove: () => remove(["types", "type"]) });
    const amenities = parseAmenitiesParam(qp);
    if (amenities.length) chips.push({ key: "amenities", label: `Amenities: ${amenities.join(", ")}`, onRemove: () => remove(["amenities", "services"]) });
    const nearbyServices = parseCsvParam(qp, "nearbyServices");
    if (nearbyServices.length) chips.push({ key: "nearbyServices", label: `Nearby: ${nearbyServices.map((t) => t.replace(/^Near\\s+/i, "")).join(", ")}`, onRemove: () => remove(["nearbyServices"]) });
    const paymentModes = parseCsvParam(qp, "paymentModes").filter((m) => PAYMENT_MODES.some((x) => x.key === (m as PaymentMode)));
    if (paymentModes.length) chips.push({ key: "paymentModes", label: `Payments: ${paymentModes.join(", ")}`, onRemove: () => remove(["paymentModes"]) });
    const freeCancellation = parseBoolParam(qp, "freeCancellation");
    if (freeCancellation) chips.push({ key: "freeCancellation", label: "Free cancellation", onRemove: () => remove(["freeCancellation"]) });
    const groupStay = parseBoolParam(qp, "groupStay");
    if (groupStay) chips.push({ key: "groupStay", label: "Group stay", onRemove: () => remove(["groupStay"]) });
    if (hasNearby) {
      const r = getParam(qp, "radiusKm") || "15";
      chips.push({ key: "nearby", label: `Nearby: ${r}km`, onRemove: () => remove(["nearLat", "nearLng", "radiusKm"]) });
    }
    return chips;
  }, [qp, router, hasNearby]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/properties?${qp.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load properties (${res.status})`);
        const json = (await res.json()) as ListResponse;
        if (!mounted) return;
        setData(json);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Failed to load properties");
        setData(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [qp]);

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? Number(qp.get("pageSize") || "24");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(qp.toString());
    next.set("page", String(Math.max(1, Math.min(nextPage, totalPages))));
    router.push(`/public/properties?${next.toString()}`);
  };

  const openFilters = () => {
    setFiltersError(null);
    setDraft({
      q: getParam(qp, "q"),
      sort: getParam(qp, "sort"),
      region: getParam(qp, "region"),
      district: getParam(qp, "district"),
      ward: getParam(qp, "ward"),
      street: getParam(qp, "street"),
      minPrice: getParam(qp, "minPrice"),
      maxPrice: getParam(qp, "maxPrice"),
      types: parseTypesParam(qp),
      amenities: parseAmenitiesParam(qp),
      nearbyServices: parseCsvParam(qp, "nearbyServices"),
      paymentModes: parseCsvParam(qp, "paymentModes").filter((m) => PAYMENT_MODES.some((x) => x.key === (m as PaymentMode))),
      freeCancellation: parseBoolParam(qp, "freeCancellation"),
      groupStay: parseBoolParam(qp, "groupStay"),
      nearbyOn: Boolean(getParam(qp, "nearLat") && getParam(qp, "nearLng")),
      radiusKm: getParam(qp, "radiusKm") || "15",
      nearLat: getParam(qp, "nearLat"),
      nearLng: getParam(qp, "nearLng"),
    });
    setFiltersOpen(true);
    // allow mount before transition in
    requestAnimationFrame(() => setFiltersShown(true));
  };

  const closeFilters = () => {
    setFiltersShown(false);
    // let exit animation play before unmount
    window.setTimeout(() => setFiltersOpen(false), 180);
  };

  // While the filters sheet is open: Esc closes it and the page behind stops scrolling
  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFiltersShown(false);
        window.setTimeout(() => setFiltersOpen(false), 180);
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  const applyFilters = () => {
    const next = new URLSearchParams(qp.toString());
    // reset paging when filters change
    next.set("page", "1");

    setOrDelete(next, "q", draft.q);
    setOrDelete(next, "sort", draft.sort);
    setOrDelete(next, "region", draft.region);
    setOrDelete(next, "district", draft.district);
    setOrDelete(next, "ward", draft.ward);
    setOrDelete(next, "street", draft.street);
    setOrDelete(next, "minPrice", draft.minPrice);
    setOrDelete(next, "maxPrice", draft.maxPrice);

    // types
    next.delete("type");
    if (draft.types.length) next.set("types", draft.types.join(","));
    else next.delete("types");

    // amenities
    next.delete("services");
    if (draft.amenities.length) next.set("amenities", draft.amenities.join(","));
    else next.delete("amenities");

    // nearby services tags
    if (draft.nearbyServices.length) next.set("nearbyServices", draft.nearbyServices.join(","));
    else next.delete("nearbyServices");

    // more filters
    const allowedModes = draft.paymentModes.filter((m) => PAYMENT_MODES.some((x) => x.key === (m as PaymentMode)));
    if (allowedModes.length) next.set("paymentModes", allowedModes.join(","));
    else next.delete("paymentModes");
    if (draft.freeCancellation) next.set("freeCancellation", "1");
    else next.delete("freeCancellation");
    if (draft.groupStay) next.set("groupStay", "1");
    else next.delete("groupStay");

    // nearby
    if (draft.nearbyOn && draft.nearLat && draft.nearLng) {
      setOrDelete(next, "nearLat", draft.nearLat);
      setOrDelete(next, "nearLng", draft.nearLng);
      setOrDelete(next, "radiusKm", draft.radiusKm || "15");
    } else {
      next.delete("nearLat");
      next.delete("nearLng");
      next.delete("radiusKm");
    }

    router.push(`/public/properties?${next.toString()}`);
    closeFilters();
  };

  const clearFilters = () => {
    const next = new URLSearchParams(qp.toString());
    ["q","sort","region","district","ward","street","minPrice","maxPrice","types","type","amenities","services","nearbyServices","paymentModes","freeCancellation","groupStay","nearLat","nearLng","radiusKm","city"].forEach((k) => next.delete(k));
    next.set("page", "1");
    router.push(`/public/properties?${next.toString()}`);
    closeFilters();
  };

  const requestNearby = async () => {
    setFiltersError(null);
    setFiltersError(null);
    if (!navigator.geolocation) {
      setFiltersError("Geolocation is not supported on this device/browser.");
      return;
    }
    setFiltersError("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setDraft((d) => ({
          ...d,
          nearbyOn: true,
          nearLat: lat.toFixed(6),
          nearLng: lng.toFixed(6),
        }));
        setFiltersError(null);
      },
      (err) => {
        setFiltersError(err?.message || "Failed to get location permission.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    );
  };

  return (
    <main className="relative min-h-screen bg-white text-slate-900 header-offset">
      <section className="py-8">
        <div className="public-container">
          <div className="flex flex-col gap-3">
            <div className="w-full min-w-0">
              {/* Premium header card */}
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 0.8, 0.32, 1] }}
                className="relative overflow-hidden rounded-3xl px-4 pb-4 pt-5 shadow-[0_18px_44px_-20px_rgba(1,40,36,0.75)] sm:rounded-[32px] sm:px-10 sm:pb-8 sm:pt-9"
                style={{ background: 'linear-gradient(135deg, #011a18 0%, #023a35 50%, #02665e 100%)' }}
              >
                  {/* Texture: same soft emerald light and dot grid as the account and header surfaces */}
                  <div className="pointer-events-none absolute inset-0" aria-hidden>
                    <div className="absolute inset-0" style={{ background: 'radial-gradient(520px circle at 100% 0%, rgba(52,211,153,0.22), transparent 60%), radial-gradient(380px circle at 0% 100%, rgba(2,102,94,0.45), transparent 60%)' }} />
                    <div
                      className="absolute inset-0 opacity-[0.16]"
                      style={{
                        backgroundImage: 'radial-gradient(rgba(255,255,255,0.55) 1px, transparent 1px)',
                        backgroundSize: '18px 18px',
                        WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 60%)',
                        maskImage: 'linear-gradient(90deg, transparent 0%, #000 60%)',
                      }}
                    />
                  </div>

                  <div className="relative z-10 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                      <h1 className="m-0 text-[26px] font-bold leading-[1.15] tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
                        {q
                          ? <>{`Results for `}<span className="text-emerald-300">&ldquo;{q}&rdquo;</span></>
                          : 'Find your stay'}
                      </h1>
                      <p className="m-0 mt-1.5 text-[13.5px] text-white/60 sm:text-base">
                        Verified properties across Tanzania, booked securely.
                      </p>
                    </div>

                    {/* Count as a quiet chip, not a separate card */}
                    <span className="mt-2.5 inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-emerald-300/10 px-2.5 py-1 text-[12px] font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-300/25 sm:mt-0">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                      {loading ? 'Loading' : `${total.toLocaleString()} verified ${total === 1 ? 'property' : 'properties'}`}
                    </span>
                  </div>

                  {/* Search: solid white so it is the obvious next step */}
                  <div className="relative z-10 mt-4 flex items-center gap-1.5 rounded-2xl bg-white p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] sm:mt-6">
                    <label className="relative flex min-w-0 flex-1 items-center">
                      <span className="sr-only">Search properties</span>
                      <Search className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" aria-hidden />
                      <input
                        type="search"
                        value={searchInput}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Region, city or property name"
                        enterKeyHint="search"
                        className="box-border h-11 w-full min-w-0 rounded-xl border-0 bg-transparent pl-10 pr-2 text-[14.5px] text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    </label>

                    {(() => {
                      const cur = getParam(qp, "sort");
                      const setSort = (v: "" | "price_asc" | "price_desc") => {
                        const next = new URLSearchParams(qp.toString());
                        next.set("page", "1");
                        setOrDelete(next, "sort", v);
                        router.push(`/public/properties?${next.toString()}`);
                      };
                      const label =
                        cur === "price_asc"
                          ? "Price: low to high"
                          : cur === "price_desc"
                            ? "Price: high to low"
                            : "Sort by price";
                      return (
                        <button
                          type="button"
                          onClick={() => setSort(nextSort(cur))}
                          className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl border-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 ${
                            cur ? "bg-[#02665e]/[0.08] text-[#02665e]" : "bg-slate-100 text-slate-600 active:bg-slate-200"
                          }`}
                          aria-label={label}
                          title={label}
                        >
                          <ChevronsUpDown className={`h-[18px] w-[18px] ${cur === "price_desc" ? "rotate-180" : ""}`} />
                        </button>
                      );
                    })()}

                    <button
                      type="button"
                      onClick={openFilters}
                      aria-label={appliedChips.length > 0 ? `Filters, ${appliedChips.length} applied` : "Filters"}
                      title="Filters"
                      className="relative flex h-11 flex-none items-center justify-center gap-1.5 rounded-xl border-0 px-3 text-[13.5px] font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/40 active:scale-[0.97] sm:px-4"
                      style={{ background: 'linear-gradient(135deg, #014e47 0%, #02665e 100%)' }}
                    >
                      <SlidersHorizontal className="h-[18px] w-[18px]" />
                      <span className="hidden sm:inline">Filters</span>
                      {appliedChips.length > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400 px-1 text-[11px] font-bold text-[#012e29] ring-2 ring-white">
                          {appliedChips.length}
                        </span>
                      )}
                    </button>
                  </div>
              </motion.div>

            </div>
          </div>

          <SectionSeparator pillLabel="Browse" className="my-5" />

          {/* Filters row */}
          <div className="flex flex-col gap-3">


            {/* Applied filter chips */}
            {appliedChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-white to-slate-50/90 p-2 shadow-sm">
                {appliedChips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={c.onRemove}
                    className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                      c.key === "q"
                        ? "border-cyan-200 bg-cyan-50 text-cyan-900 hover:border-cyan-300 hover:bg-cyan-100"
                        : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                    title="Remove filter"
                  >
                    {c.key === "q" && <Search className="w-3.5 h-3.5 text-cyan-600" />}
                    <span className="truncate max-w-[14rem]">{c.label}</span>
                    <X className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-700" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => clearFilters()}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100"
                >
                  <SearchX className="w-3.5 h-3.5" />
                  Reset filters
                </button>
              </div>
            )}
          </div>

          {/* ── Recently Viewed Properties ── */}
          {recentProperties.length > 0 && !loading && appliedChips.length === 0 && !q && (
            <div className="rounded-2xl border border-amber-100/80 bg-amber-50/40 p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-white border border-amber-200/70 shadow-sm">
                    <Clock className="w-3 h-3 text-amber-500" />
                  </span>
                  <span className="text-[11px] font-bold text-amber-700/80 uppercase tracking-wider">Recently viewed</span>
                </div>
                <button
                  type="button"
                  onClick={clearRecentProperties}
                  className="text-[11px] font-medium text-slate-400 hover:text-rose-500 transition-colors"
                >
                  Clear all
                </button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {recentProperties.map((rp) => (
                  <div key={rp.slug} className="relative">
                    <PublicApprovedPropertyCard p={rp} systemCommission={systemCommission} />
                    <button
                      type="button"
                      onClick={() => removeRecentProperty(rp.slug)}
                      className="absolute top-2 right-2 z-10 p-1 rounded-full bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm hover:bg-red-50 hover:border-red-200 transition-all"
                      aria-label={`Remove ${rp.title}`}
                    >
                      <X className="w-3 h-3 text-slate-500 hover:text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
              {error}
            </div>
          )}

          {loading && (
            <div className="relative">
            <div className="flex sm:grid overflow-x-auto sm:overflow-visible snap-x snap-mandatory sm:snap-none scroll-smooth gap-3 sm:gap-5 pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid-cols-2 lg:grid-cols-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="snap-start shrink-0 w-[calc(50vw-20px)] sm:w-auto rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
                  {/* Title bar above image */}
                  <div className="px-3 pt-3 sm:px-4 sm:pt-4">
                    <div className="h-4 w-3/4 bg-slate-100 animate-pulse rounded-md" />
                  </div>
                  {/* Square image area */}
                  <div className="px-3 mt-2 sm:px-4 sm:mt-3">
                    <div className="aspect-square bg-slate-100 animate-pulse rounded-2xl" />
                  </div>
                  {/* Location + price + button */}
                  <div className="p-3 sm:p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="h-3 w-2/5 bg-slate-100 animate-pulse rounded" />
                      <div className="h-4 w-1/4 bg-slate-100 animate-pulse rounded" />
                    </div>
                    <div className="h-8 w-full bg-slate-100 animate-pulse rounded-xl mt-1" />
                  </div>
                </div>
              ))}
            </div>
            </div>
          )}

          {!loading && !error && (data?.items?.length ?? 0) === 0 && appliedChips.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden"
            >
              {/* Header */}
              <div className="px-5 pt-6 pb-4 text-center">
                <div className="mx-auto w-11 h-11 rounded-xl bg-slate-50 flex items-center justify-center mb-3">
                  <SearchX className="w-5 h-5 text-slate-400" />
                </div>
                <h3 className="text-[15px] font-bold text-slate-900">No matches for your search</h3>
                <p className="text-[12.5px] text-slate-500 mt-1 max-w-sm mx-auto">
                  We couldn&apos;t find properties matching your current filters. Try adjusting or explore a different area.
                </p>
              </div>

              {/* Suggestions */}
              <div className="px-5 pb-5">
                <div className="grid grid-cols-2 gap-2.5">
                  {(() => {
                    const currentCity = getParam(qp, "city").toLowerCase();
                    const cityOptions = [
                      { city: "Zanzibar", sub: "Island getaways" },
                      { city: "Dar es Salaam", sub: "City stays" },
                      { city: "Arusha", sub: "Safari gateway" },
                      { city: "Mwanza", sub: "Lakeside charm" },
                      { city: "Dodoma", sub: "Capital hub" },
                      { city: "Nairobi", sub: "Cross-border" },
                    ].filter((c) => c.city.toLowerCase() !== currentCity);
                    const suggestions: Array<{ label: string; sub: string; action: () => void }> = [
                      { label: "Clear all filters", sub: "Start fresh", action: () => clearFilters() },
                    ];
                    cityOptions.slice(0, 2).forEach((c) => {
                      suggestions.push({
                        label: `Try ${c.city}`,
                        sub: c.sub,
                        action: () => { const n = new URLSearchParams(); n.set("city", c.city); n.set("page", "1"); n.set("pageSize", "24"); router.push(`/public/properties?${n.toString()}`); },
                      });
                    });
                    suggestions.push({ label: "View all stays", sub: "No filters", action: () => router.push("/public/properties") });
                    return suggestions;
                  })().map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={s.action}
                      className="group flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-emerald-50 hover:border-emerald-100 px-3.5 py-3 text-left transition-all duration-200"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-slate-700 group-hover:text-emerald-700 truncate">{s.label}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{s.sub}</p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-emerald-500 flex-shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {!loading && !error && (data?.items?.length ?? 0) === 0 && appliedChips.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="space-y-7"
            >
              {/* Header */}
              <div className="text-center py-4">
                <div className="mx-auto w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mb-3">
                  <Globe className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-slate-900">We&apos;re building something big</h3>
                <p className="text-sm text-slate-500 mt-1.5 max-w-lg mx-auto leading-relaxed">
                  No approved stays yet- we&apos;re actively onboarding properties, partners, and drivers across Africa. Here&apos;s what NoLSAF brings to the table.
                </p>
              </div>

              {/* Platform feature cards — 2 cols mobile, 3 cols desktop */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {([
                  { title: "Unique Stays", desc: "Hotels, villas, lodges & hidden gems, from Dar to Nairobi and beyond", Icon: Hotel },
                  { title: "Solo-Friendly", desc: "Curated experiences for independent travelers exploring Africa", Icon: UserCircle },
                  { title: "Seamless Transport", desc: "Airport pickups, city rides & inter-city travel on demand", Icon: Car },
                  { title: "Mobile Payments", desc: "M-Pesa, Mixx by Yas, Airtel Money, cards - secure & instant", Icon: Wallet },
                  { title: "24/7 Support", desc: "Real human support whenever you need it, wherever you are", Icon: Headphones },
                  { title: "Pan-African Vision", desc: "Starting in East Africa, expanding across the entire continent", Icon: Globe },
                ] as const).map((item, i) => (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: 0.07 * i }}
                    className="group rounded-xl border border-slate-100 bg-white p-3.5 hover:shadow-md hover:border-emerald-100 transition-all duration-300"
                  >
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mb-3 group-hover:bg-emerald-100 transition-colors duration-300">
                      <item.Icon className="w-5 h-5 text-emerald-600" strokeWidth={1.8} />
                    </div>
                    <h4 className="text-sm font-semibold text-slate-800 leading-tight">{item.title}</h4>
                    <p className="text-xs text-slate-400 mt-1 leading-snug">{item.desc}</p>
                  </motion.div>
                ))}
              </div>

              {/* Onboarding banner */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.5 }}
                className="rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50/60 to-slate-50/60 p-4 flex items-start gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Properties are on the way</p>
                  <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                    We&apos;re verifying and onboarding quality stays across Tanzania, Kenya, Zanzibar, and more. Be among the first — register as an owner or driver today.
                  </p>
                </div>
              </motion.div>

              {/* CTAs — Owner + Driver */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.6 }}
                className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pb-2"
              >
                <a
                  href="/account/register?role=owner"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm hover:shadow transition-all duration-200 no-underline"
                >
                  <Building2 className="w-4 h-4" />
                  Register as owner
                </a>
                <a
                  href="/account/register?role=driver"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold shadow-sm hover:shadow transition-all duration-200 no-underline"
                >
                  <Car className="w-4 h-4" />
                  Register as driver
                </a>
              </motion.div>
            </motion.div>
          )}

          {!loading && !error && (data?.items?.length ?? 0) > 0 && (
            <>
              {/* ── Mobile: rows of 5, each row is a swipe strip (2 visible, swipe for rest) ── */}
              <div className="sm:hidden space-y-5">
                {/* Header: total count */}
                <div className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-1 h-4 rounded-full" style={{ background: 'linear-gradient(to bottom, #10b981, #02665e)' }} />
                    <span className="text-[11px] font-semibold text-slate-700 tracking-wide">
                      {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}
                      <span className="font-normal text-slate-400"> of {total} properties</span>
                    </span>
                  </div>
                  {totalPages > 1 && (
                    <span className="text-[10px] font-medium text-slate-400 tracking-wider uppercase">Page {page}/{totalPages}</span>
                  )}
                </div>

                {Array.from({ length: Math.ceil((data?.items?.length ?? 0) / 5) }).map((_, rowIdx) => {
                  const rowItems = (data?.items ?? []).slice(rowIdx * 5, rowIdx * 5 + 5);
                  const rowCount = Math.ceil((data?.items?.length ?? 0) / 5);
                  const startNum = (page - 1) * pageSize + rowIdx * 5 + 1;
                  const endNum = Math.min(startNum + rowItems.length - 1, total);
                  return (
                    <div key={rowIdx}>
                      {/* Row label */}
                      <div className="flex items-center justify-between mb-2 px-0.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#02665e,#10b981)' }}>
                            {rowIdx + 1}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
                            {startNum}–{endNum}
                          </span>
                        </div>
                        <motion.span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest select-none"
                          style={{ color: '#10b981' }}
                          animate={{ x: [0, 4, 0] }}
                          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
                        >
                          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
                          swipe
                        </motion.span>
                      </div>
                      <div className="relative">
                        <div className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth gap-3 pb-2 -mx-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {rowItems.map((p, idx) => (
                            <motion.div
                              key={p.id}
                              className="snap-start shrink-0 w-[calc(50vw-20px)]"
                              initial={{ opacity: 0, x: 40, scale: 0.97 }}
                              whileInView={{ opacity: 1, x: 0, scale: 1 }}
                              viewport={{ once: false, amount: 0.3, root: undefined }}
                              transition={{ duration: 0.35, delay: idx * 0.04, ease: [0.22, 0.8, 0.32, 1] }}
                              onClick={() => addRecentProperty({ title: p.title, slug: p.slug, location: p.location, primaryImage: p.primaryImage, basePrice: p.basePrice, currency: p.currency, services: p.services })}
                            >
                              <PublicApprovedPropertyCard
                                p={p}
                                systemCommission={systemCommission}
                                priorityImage={rowIdx === 0 && idx === 0}
                              />
                            </motion.div>
                          ))}
                        </div>
                      </div>
                      {/* Divider between rows */}
                      {rowIdx < rowCount - 1 && (
                        <div className="mt-5 flex items-center gap-3">
                          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                          <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-300 select-none">more</span>
                          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Mobile pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => goToPage(page - 1)}
                      disabled={page <= 1}
                      aria-label="Previous page"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Previous
                    </button>
                    <span className="text-xs text-slate-500">Page <span className="font-semibold">{page}</span> / {totalPages}</span>
                    <button
                      type="button"
                      onClick={() => goToPage(page + 1)}
                      disabled={page >= totalPages}
                      aria-label="Next page"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                    >
                      Next <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* ── Desktop: full grid (all items) ── */}
              <div className="hidden sm:flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-600 shadow-sm">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
                </span>
                <span className="text-[13px] font-bold text-slate-800 tracking-tight">All properties</span>
                <span className="ml-1 text-[11px] font-normal text-slate-400">{total} listed</span>
              </div>
              <div className="hidden sm:flex items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-1 h-4 rounded-full" style={{ background: 'linear-gradient(to bottom, #10b981, #02665e)' }} />
                  <span className="text-[11px] font-semibold text-slate-700 tracking-wide">
                    {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}
                    <span className="font-normal text-slate-400"> of {total} properties</span>
                  </span>
                </div>
                {totalPages > 1 && (
                  <span className="text-[10px] font-medium text-slate-400 tracking-wider uppercase">Page {page}/{totalPages}</span>
                )}
              </div>
              <div className="hidden sm:grid grid-cols-2 lg:grid-cols-5 gap-5">
                {(data?.items ?? []).map((p, idx) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.40, delay: Math.min(idx, 9) * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
                    onClick={() => addRecentProperty({ title: p.title, slug: p.slug, location: p.location, primaryImage: p.primaryImage, basePrice: p.basePrice, currency: p.currency, services: p.services })}
                  >
                    <PublicApprovedPropertyCard
                      p={p}
                      systemCommission={systemCommission}
                      priorityImage={idx === 0}
                    />
                  </motion.div>
                ))}
              </div>
              {/* Pagination */}
              <div className="mt-8 flex items-center justify-end gap-3 w-full">
                <button
                  type="button"
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  aria-label="Previous page"
                  className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-sm text-slate-700">
                  Page <span className="font-semibold">{page}</span> / {totalPages}
                </div>
                <button
                  type="button"
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  aria-label="Next page"
                  className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          <SectionSeparator className="mt-10" />
        </div>
      </section>

      {/* Filters: bottom sheet on phones, right-side drawer on larger screens */}
      {filtersOpen && (() => {
        const chip = (on: boolean) =>
          [
            "box-border inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid px-3 text-[13px] font-medium transition-colors select-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30",
            on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
          ].join(" ");
        const selectCls =
          "box-border h-11 w-full rounded-lg border border-solid border-slate-200 bg-white px-3 text-[14px] text-slate-900 outline-none transition focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
        const activeCount =
          (draft.sort ? 1 : 0) +
          (draft.region ? 1 : 0) +
          (draft.minPrice || draft.maxPrice ? 1 : 0) +
          draft.types.length +
          draft.amenities.length +
          draft.nearbyServices.length +
          draft.paymentModes.length +
          (draft.freeCancellation ? 1 : 0) +
          (draft.groupStay ? 1 : 0) +
          (draft.nearbyOn ? 1 : 0);
        const bucketIdx = priceBucketIndex(draft.minPrice, draft.maxPrice);
        const acc = (id: string) => ({
          id,
          open: filterPanel === id,
          onToggle: () => setFilterPanel((p) => (p === id ? null : id)),
        });
        const many = (list: readonly string[], label: (v: string) => string = (v) => v) =>
          list.length === 0 ? "Any" : list.length === 1 ? label(list[0]) : `${list.length} selected`;
        const regionName = (REGIONS as any[]).find((r) => String(r.id) === draft.region)?.name as string | undefined;
        const locationSummary = regionName ? [regionName, draft.district].filter(Boolean).join(", ") : "Anywhere";
        const sortSummary = draft.sort === "price_asc" ? "Lowest price" : draft.sort === "price_desc" ? "Highest price" : "Recommended";
        const policyList = [...draft.paymentModes, ...(draft.freeCancellation ? ["Free cancellation"] : []), ...(draft.groupStay ? ["Group stay"] : [])];

        // Portal to <body>: a transformed page wrapper would otherwise trap the sheet
        // under floating widgets and stretch its fixed positioning.
        return createPortal(
          <div className="fixed inset-0 z-[2147483000]" role="dialog" aria-modal="true" aria-labelledby="filters-title">
            <div
              aria-hidden
              onClick={closeFilters}
              className={`absolute inset-0 bg-slate-900/45 backdrop-blur-[2px] transition-opacity duration-200 ${filtersShown ? "opacity-100" : "opacity-0"}`}
            />

            <div
              className={[
                "absolute box-border flex h-auto flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-18px_rgba(0,0,0,0.45)]",
                // Phone: bottom sheet that hugs its content
                "inset-x-2 bottom-2 top-auto max-h-[calc(100vh-1rem)]",
                // sm+: floating panel at the top right, also content height
                "sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:max-h-[calc(100vh-2rem)] sm:w-[420px]",
                "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
                filtersShown ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 sm:translate-y-2",
              ].join(" ")}
            >

              {/* Header */}
              {/* Brand band: title, live count and one-tap quick picks */}
              <div
                className="relative flex-none overflow-hidden text-white sm:rounded-t-xl"
                style={{ background: "linear-gradient(135deg, #07090c 0%, #0b1211 55%, #02665e 160%)" }}
              >
                <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(320px circle at 100% 0%, rgba(52,211,153,0.18), transparent 60%)" }} />
                <div className="relative flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5">
                  <div className="min-w-0">
                    <h2 id="filters-title" className="m-0 flex items-center gap-2 text-[17px] font-bold leading-tight">
                      <SlidersHorizontal className="h-4 w-4 text-emerald-300" aria-hidden />
                      Filters
                      {activeCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-emerald-300 px-1.5 text-[11px] font-bold text-[#012e29]">{activeCount}</span>
                      )}
                    </h2>
                    <p className="m-0 mt-0.5 text-[12px] text-white/55">
                      {activeCount > 0 ? `${activeCount} filter${activeCount === 1 ? "" : "s"} ready to apply` : "Quick picks or refine below"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeFilters}
                    aria-label="Close filters"
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Quick picks: the most-used filters, one tap each */}
                <div className="relative grid grid-cols-3 gap-1.5 px-4 pb-3.5 pt-1">
                  {([
                    { label: "Flexible", Icon: BadgeCheck, on: draft.freeCancellation, toggle: () => setDraft((d) => ({ ...d, freeCancellation: !d.freeCancellation })) },
                    {
                      label: "Breakfast",
                      Icon: Coffee,
                      on: draft.amenities.includes("Breakfast included"),
                      toggle: () =>
                        setDraft((d) => ({
                          ...d,
                          amenities: d.amenities.includes("Breakfast included")
                            ? d.amenities.filter((x) => x !== "Breakfast included")
                            : [...d.amenities, "Breakfast included"],
                        })),
                    },
                    {
                      label: "Under 20k",
                      Icon: Wallet,
                      on: bucketIdx === 1,
                      toggle: () =>
                        setDraft((d) => (bucketIdx === 1 ? { ...d, minPrice: "", maxPrice: "" } : { ...d, minPrice: "5000", maxPrice: "20000" })),
                    },
                    {
                      label: "Pool",
                      Icon: Waves,
                      on: draft.amenities.includes("Pool"),
                      toggle: () =>
                        setDraft((d) => ({ ...d, amenities: d.amenities.includes("Pool") ? d.amenities.filter((x) => x !== "Pool") : [...d.amenities, "Pool"] })),
                    },
                    {
                      label: "Parking",
                      Icon: Car,
                      on: draft.amenities.includes("Free parking"),
                      toggle: () =>
                        setDraft((d) => ({
                          ...d,
                          amenities: d.amenities.includes("Free parking") ? d.amenities.filter((x) => x !== "Free parking") : [...d.amenities, "Free parking"],
                        })),
                    },
                    { label: "Groups", Icon: UsersRound, on: draft.groupStay, toggle: () => setDraft((d) => ({ ...d, groupStay: !d.groupStay })) },
                  ] as const).map(({ label, Icon, on, toggle }) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={toggle}
                      className={`box-border inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-solid px-2 text-[12.5px] font-semibold transition-colors ${
                        on ? "border-emerald-300 bg-emerald-300 text-[#012e29]" : "border-white/15 bg-white/[0.06] text-white/85 hover:bg-white/[0.12]"
                      }`}
                    >
                      {on ? <Check className="h-3.5 w-3.5 flex-none" strokeWidth={3} aria-hidden /> : <Icon className="h-3.5 w-3.5 flex-none" aria-hidden />}
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-initial overflow-y-auto overflow-x-hidden overscroll-contain bg-slate-50 p-3">
                <div className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
                <FilterSection
                  {...acc("sort")}
                  title="Sort by"
                  Icon={ArrowUpDown}
                  summary={sortSummary}
                  onClear={draft.sort ? () => setDraft((d) => ({ ...d, sort: "" })) : undefined}
                >
                  <OptionGrid
                    single
                    columns={1}
                    options={[
                      { key: "", label: "Recommended", Icon: BadgeCheck, hint: "Best match first" },
                      { key: "price_asc", label: "Lowest price", Icon: ArrowUpDown, hint: "Cheapest stays first" },
                      { key: "price_desc", label: "Highest price", Icon: ArrowUpDown, hint: "Premium stays first" },
                    ]}
                    isOn={(k) => (draft.sort || "") === k}
                    onPick={(k) => setDraft((d) => ({ ...d, sort: k as typeof d.sort }))}
                  />
                </FilterSection>

                <FilterSection
                  {...acc("location")}
                  title="Location"
                  Icon={MapPin}
                  summary={locationSummary}
                  onClear={draft.region ? () => setDraft((d) => ({ ...d, region: "", district: "", ward: "", street: "" })) : undefined}
                >
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-[12px] font-medium text-slate-500">Region</span>
                      <select
                        value={draft.region}
                        onChange={(e) => setDraft((d) => ({ ...d, region: e.target.value, district: "", ward: "", street: "" }))}
                        className={selectCls}
                      >
                        <option value="">Any region</option>
                        {REGIONS.map((r: any) => (
                          <option key={r.id} value={String(r.id)}>{r.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-[12px] font-medium text-slate-500">District</span>
                      <select
                        value={draft.district}
                        onChange={(e) => setDraft((d) => ({ ...d, district: e.target.value, ward: "", street: "" }))}
                        className={selectCls}
                        disabled={!draft.region}
                      >
                        <option value="">{draft.region ? "Any district" : "Pick region"}</option>
                        {locationOptions.districts.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                    {/* Ward and street only appear once a district narrows things down */}
                    {draft.district && (
                      <>
                        <label className="block min-w-0">
                          <span className="mb-1 block text-[12px] font-medium text-slate-500">Ward</span>
                          <select
                            value={draft.ward}
                            onChange={(e) => setDraft((d) => ({ ...d, ward: e.target.value, street: "" }))}
                            className={selectCls}
                          >
                            <option value="">Any ward</option>
                            {locationOptions.wards.map((w) => (
                              <option key={w} value={w}>{w}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block min-w-0">
                          <span className="mb-1 block text-[12px] font-medium text-slate-500">Street</span>
                          <select
                            value={draft.street}
                            onChange={(e) => setDraft((d) => ({ ...d, street: e.target.value }))}
                            className={selectCls}
                            disabled={!draft.ward}
                          >
                            <option value="">{draft.ward ? "Any street" : "Pick ward"}</option>
                            {locationOptions.streets.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                </FilterSection>

                <FilterSection
                  {...acc("price")}
                  title="Price per night"
                  Icon={Wallet}
                  summary={bucketIdx > 0 ? `TZS ${PRICE_BUCKETS[bucketIdx]?.label}` : "Any"}
                  onClear={bucketIdx > 0 ? () => setDraft((d) => ({ ...d, minPrice: "", maxPrice: "" })) : undefined}
                >
                  <OptionGrid
                    single
                    options={PRICE_BUCKETS.map((b, idx) => ({ key: String(idx), label: idx === 0 ? "Any price" : `TZS ${b.label}` }))}
                    isOn={(k) => String(bucketIdx) === k}
                    onPick={(k) => {
                      const b = PRICE_BUCKETS[Number(k)] || PRICE_BUCKETS[0];
                      setDraft((d) => ({ ...d, minPrice: b.min == null ? "" : String(b.min), maxPrice: b.max == null ? "" : String(b.max) }));
                    }}
                  />
                </FilterSection>

                <FilterSection
                  {...acc("type")}
                  title="Property type"
                  Icon={Building2}
                  summary={many(draft.types, (k) => PROPERTY_TYPES.find((t) => t.key === k)?.label || k)}
                  onClear={draft.types.length ? () => setDraft((d) => ({ ...d, types: [] })) : undefined}>
                  <OptionGrid
                    options={PROPERTY_TYPES.map((t) => ({ key: t.key, label: t.label, Icon: t.key === "HOTEL" ? Hotel : Building2 }))}
                    isOn={(k) => draft.types.includes(k as any)}
                    onPick={(k) =>
                      setDraft((d) => ({ ...d, types: d.types.includes(k as any) ? d.types.filter((x) => x !== k) : [...d.types, k as any] }))
                    }
                  />
                </FilterSection>

                <FilterSection
                  {...acc("amenities")}
                  title="Amenities"
                  Icon={ConciergeBell}
                  summary={many(draft.amenities)}
                  onClear={draft.amenities.length ? () => setDraft((d) => ({ ...d, amenities: [] })) : undefined}>
                  {/* Grouped, monochrome checklist: easier to scan than a wall of coloured pills */}
                  <div className="space-y-3">
                    {AMENITY_GROUPS.map((group) => (
                      <OptionGrid
                        key={group.title}
                        title={group.title}
                        options={group.items.map((a) => ({ key: a, label: a, Icon: AMENITY_ICON_META[a]?.Icon || Tag }))}
                        isOn={(k) => draft.amenities.includes(k as Amenity)}
                        onPick={(k) =>
                          setDraft((d) => ({
                            ...d,
                            amenities: d.amenities.includes(k as Amenity) ? d.amenities.filter((x) => x !== k) : [...d.amenities, k as Amenity],
                          }))
                        }
                      />
                    ))}
                  </div>
                </FilterSection>

                <FilterSection
                  {...acc("nearby")}
                  title="Nearby services"
                  Icon={Hospital}
                  summary={many(draft.nearbyServices, (t) => NEARBY_SERVICE_TAGS.find((x) => x.tag === t)?.label || t)}
                  onClear={draft.nearbyServices.length ? () => setDraft((d) => ({ ...d, nearbyServices: [] })) : undefined}>
                  <OptionGrid
                    options={NEARBY_SERVICE_TAGS.map(({ tag, label, Icon }) => ({ key: tag, label, Icon }))}
                    isOn={(k) => draft.nearbyServices.includes(k)}
                    onPick={(k) =>
                      setDraft((d) => ({
                        ...d,
                        nearbyServices: d.nearbyServices.includes(k) ? d.nearbyServices.filter((x) => x !== k) : [...d.nearbyServices, k],
                      }))
                    }
                  />
                </FilterSection>

                <FilterSection
                  {...acc("policies")}
                  title="Payments and policies"
                  Icon={CreditCard}
                  summary={many(policyList)}
                  onClear={
                    draft.paymentModes.length || draft.freeCancellation || draft.groupStay
                      ? () => setDraft((d) => ({ ...d, paymentModes: [], freeCancellation: false, groupStay: false }))
                      : undefined
                  }
                >
                  <div className="space-y-3">
                    <OptionGrid
                      title="Payment"
                      options={PAYMENT_MODES.map(({ key, Icon }) => ({ key, label: key, Icon }))}
                      isOn={(k) => draft.paymentModes.includes(k as PaymentMode)}
                      onPick={(k) =>
                        setDraft((d) => ({
                          ...d,
                          paymentModes: d.paymentModes.includes(k as PaymentMode)
                            ? d.paymentModes.filter((x) => x !== k)
                            : [...d.paymentModes, k as PaymentMode],
                        }))
                      }
                    />
                    <OptionGrid
                      title="Policies"
                      options={[
                        { key: "freeCancellation", label: "Free cancellation", Icon: BadgeCheck },
                        { key: "groupStay", label: "Group stay", Icon: UsersRound },
                      ]}
                      isOn={(k) => (k === "freeCancellation" ? draft.freeCancellation : draft.groupStay)}
                      onPick={(k) =>
                        setDraft((d) => (k === "freeCancellation" ? { ...d, freeCancellation: !d.freeCancellation } : { ...d, groupStay: !d.groupStay }))
                      }
                    />
                  </div>
                </FilterSection>

                {/* Near me: a direct switch row, no need to expand */}
                <section className="border-0 border-t border-solid border-slate-100">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.nearbyOn}
                    onClick={() => {
                      if (draft.nearbyOn) {
                        setDraft((d) => ({ ...d, nearbyOn: false, nearLat: "", nearLng: "" }));
                        return;
                      }
                      requestNearby();
                    }}
                    title="Uses your location only for this search"
                    className="box-border flex h-[52px] w-full items-center gap-3 border-0 bg-white px-4 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ${draft.nearbyOn ? "bg-[#02665e] text-white" : "bg-[#02665e]/[0.07] text-[#02665e]"}`}>
                      <LocateFixed className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-900">Near me</span>
                    <span className={`flex-none text-[13px] ${draft.nearbyOn ? "font-semibold text-[#02665e]" : "text-slate-500"}`}>
                      {draft.nearbyOn ? `${draft.radiusKm || "15"} km` : "Off"}
                    </span>
                    <FilterSwitch on={draft.nearbyOn} />
                  </button>
                  {draft.nearbyOn && (
                    <div className="border-0 border-t border-solid border-slate-100 bg-slate-50 px-4 pb-3.5 pt-2.5">
                      <div className="mb-1 flex items-center justify-between text-[12.5px]">
                        <span className="font-medium text-slate-600">Within</span>
                        <span className="font-semibold tabular-nums text-[#02665e]">{draft.radiusKm || "15"} km</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={50}
                        value={Number(draft.radiusKm || "15")}
                        onChange={(e) => setDraft((d) => ({ ...d, radiusKm: String(e.target.value) }))}
                        className="w-full accent-[#02665e]"
                        aria-label="Search radius in kilometres"
                      />
                    </div>
                  )}
                  {filtersError && <p className="m-0 px-4 pb-3 text-[12.5px] text-rose-600">{filtersError}</p>}
                </section>
                </div>
              </div>

              {/* Footer: two equal actions */}
              <div className="grid flex-none grid-cols-2 gap-2.5 border-0 border-t border-solid border-slate-200 bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={clearFilters}
                  disabled={activeCount === 0}
                  className="box-border inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-[14px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  <Trash2 className="h-4 w-4 flex-none" aria-hidden />
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={applyFilters}
                  className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] px-3 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-[#014e47] active:bg-[#013a35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/40"
                >
                  <Check className="h-4 w-4" aria-hidden />
                  Show results
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {pageNotice ? (
        <div
          className="fixed inset-0 z-[560] bg-black/40 backdrop-blur-[2px] p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Message"
          onClick={() => setPageNotice(null)}
        >
          <div
            className="relative mx-auto mt-[12vh] w-full max-w-md overflow-hidden rounded-3xl border border-[#02665e]/20 bg-white shadow-[0_20px_60px_rgba(2,102,94,0.26)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-6 py-4 text-white"
              style={{
                backgroundColor: "#02665e",
                backgroundImage: "repeating-linear-gradient(-32deg, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 2px, rgba(255,255,255,0) 2px, rgba(255,255,255,0) 14px)",
              }}
            >
              <div className="text-base font-bold">Notice</div>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-slate-700 leading-relaxed">{pageNotice}</p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setPageNotice(null)}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "#02665e" }}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

