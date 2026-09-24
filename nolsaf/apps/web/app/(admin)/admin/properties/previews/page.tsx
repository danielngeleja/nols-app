"use client";

import { useState, useEffect, useCallback } from "react";
import PropertyPreview from "@/components/PropertyPreview";
import { Loader2, ScanEye, MapPin, Star, Search, X, ChevronDown, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";
import Image from "next/image";
import { 
  getPropertyCommission, 
  calculatePriceWithCommission 
} from "@/lib/priceUtils";
import { REGIONS } from "@/lib/tzRegions";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Property = {
  id: number;
  title: string;
  status: string;
  type: string | null;
  photos?: unknown;
  roomsSpec?: unknown;
  regionName?: string | null;
  district?: string | null;
  owner?: { id: number; name?: string | null; email?: string | null } | null;
  basePrice?: number | null;
  currency?: string;
  hotelStar?: string | null;
  services?: any; // Can contain commissionPercent and discountRules
  location?: {
    regionName?: string | null;
    district?: string | null;
    city?: string | null;
  } | null;
};

function isSafeNextImageSrc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  if (/^data:image\//i.test(v)) return true;
  if (v.startsWith("/")) return true;
  if (v.startsWith("http://") || v.startsWith("https://")) return true;
  return false;
}

function canUseNextImageForSrc(src: string): boolean {
  if (src.startsWith("/")) return true;
  if (/^data:image\//i.test(src)) return false;

  if (!src.startsWith("http://") && !src.startsWith("https://")) return false;
  try {
    const url = new URL(src);
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host === "res.cloudinary.com") return true;
    if (host === "img.youtube.com") return true;
    if (host === "api.mapbox.com") return true;
    if (host.endsWith(".mapbox.com")) return true;
    return false;
  } catch {
    return false;
  }
}

function normalizeRoomsSpec(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function effectiveBasePrice(property: Pick<Property, "basePrice" | "roomsSpec">): number | null {
  const explicit = property.basePrice != null ? Number(property.basePrice) : NaN;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const roomPrices = normalizeRoomsSpec(property.roomsSpec)
    .map((room: any) => {
      const raw = room?.pricePerNight ?? room?.price ?? null;
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    })
    .filter((value: number | null): value is number => value != null);

  return roomPrices.length ? Math.min(...roomPrices) : null;
}

/** Must match Property.type values stored by the owner flow (see prisma schema). */
const PROPERTY_TYPES = [
  { value: "HOTEL", label: "Hotel" },
  { value: "LODGE", label: "Lodge" },
  { value: "APARTMENT", label: "Apartment" },
  { value: "VILLA", label: "Villa" },
  { value: "GUEST_HOUSE", label: "Guest house" },
  { value: "BUNGALOW", label: "Bungalow" },
  { value: "CONDO", label: "Condo" },
  { value: "CABIN", label: "Cabin" },
  { value: "HOMESTAY", label: "Homestay" },
  { value: "TOWNHOUSE", label: "Townhouse" },
  { value: "HOUSE", label: "House" },
  { value: "OTHER", label: "Other" },
];

const STATUS_TABS = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Needs fixes", value: "NEEDS_FIXES" },
  { label: "Draft", value: "DRAFT" },
  { label: "Rejected", value: "REJECTED" },
  { label: "Suspended", value: "SUSPENDED" },
];

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  APPROVED: { label: "Live", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  PENDING: { label: "Pending", cls: "bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  NEEDS_FIXES: { label: "Needs fixes", cls: "bg-orange-50 text-orange-700", dot: "bg-orange-500" },
  REJECTED: { label: "Rejected", cls: "bg-rose-50 text-rose-700", dot: "bg-rose-500" },
  SUSPENDED: { label: "Suspended", cls: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  DRAFT: { label: "Draft", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};

const PAGE_SIZE = 24;

export default function PropertyPreviewsPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [systemCommission, setSystemCommission] = useState<number>(0);
  const [counts, setCounts] = useState<Record<string, number>>({
    DRAFT: 0,
    PENDING: 0,
    APPROVED: 0,
    NEEDS_FIXES: 0,
    REJECTED: 0,
    SUSPENDED: 0,
    ALL: 0,
  });

  const [searchInput, setSearchInput] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [districtFilter, setDistrictFilter] = useState<string>("");
  const [ownerQuery, setOwnerQuery] = useState<string>("");
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [owners, setOwners] = useState<Array<{ id: number; name: string | null; email: string }>>([]);
  const [loadingOwners, setLoadingOwners] = useState(false);
  // Kept separately: the search results change as you type, the choice should not
  const [selectedOwner, setSelectedOwner] = useState<{ id: number; name: string | null; email: string } | null>(null);

  // Debounce typing so the API is not hit on every keystroke
  useEffect(() => {
    const id = window.setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // Any filter change starts again from the first page
  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchQuery, regionFilter, districtFilter, typeFilter, ownerFilter]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await api.get("/api/admin/settings");
        if (mounted && response.data?.commissionPercent !== undefined) {
          const commission = Number(response.data.commissionPercent);
          setSystemCommission(isNaN(commission) ? 0 : commission);
        }
      } catch {
        // Falls back to 0
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Owner search runs on the server so every owner is reachable, not only the
  // newest page. Suspended owners are included: their properties still need review.
  useEffect(() => {
    if (!ownerMenuOpen) return;
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        setLoadingOwners(true);
        const q = ownerQuery.trim();
        const response = await api.get("/api/admin/owners", { params: { page: 1, pageSize: 20, ...(q ? { q } : {}) } });
        if (!cancelled) setOwners(Array.isArray(response.data?.items) ? response.data.items : []);
      } catch (err) {
        console.error("Failed to load owners:", err);
        if (!cancelled) setOwners([]);
      } finally {
        if (!cancelled) setLoadingOwners(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [ownerMenuOpen, ownerQuery]);

  /** Filters shared by the list and the status counts (status excluded for counts) */
  const filterParams = useCallback(() => {
    const params: Record<string, string | number> = {};
    if (searchQuery) params.q = searchQuery;
    if (regionFilter) params.region = regionFilter;
    if (regionFilter && districtFilter) params.district = districtFilter;
    if (typeFilter) params.type = typeFilter;
    if (ownerFilter) params.ownerId = Number(ownerFilter);
    return params;
  }, [searchQuery, regionFilter, districtFilter, typeFilter, ownerFilter]);

  const loadProperties = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { ...filterParams(), page, pageSize: PAGE_SIZE };
      if (statusFilter !== "ALL") params.status = statusFilter;
      const response = await api.get("/api/admin/properties", { params });
      const items: Property[] = response.data.items || [];
      setTotal(Number(response.data.total) || items.length);
      // Page 1 replaces the list; later pages append ("Show more")
      setProperties((prev) => (page === 1 ? items : [...prev, ...items.filter((it) => !prev.some((p) => p.id === it.id))]));
    } catch (err: any) {
      console.error("Failed to load properties:", err);
      if (page === 1) {
        setProperties([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [filterParams, page, statusFilter]);

  const loadCounts = useCallback(async () => {
    try {
      const r = await api.get<Record<string, number>>("/api/admin/properties/counts", { params: filterParams() });
      if (r?.data) {
        const next: Record<string, number> = { DRAFT: 0, PENDING: 0, APPROVED: 0, NEEDS_FIXES: 0, REJECTED: 0, SUSPENDED: 0, ...r.data };
        next.ALL = ["DRAFT", "PENDING", "APPROVED", "NEEDS_FIXES", "REJECTED", "SUSPENDED"].reduce((sum, k) => sum + (Number(next[k]) || 0), 0);
        setCounts(next);
      }
    } catch {
      // Counts are informational; the list still works
    }
  }, [filterParams]);

  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const refreshAll = useCallback(async () => {
    setPage(1);
    await Promise.all([loadProperties(), loadCounts()]);
  }, [loadProperties, loadCounts]);

  const clearFilters = () => {
    setSearchInput("");
    setSearchQuery("");
    setRegionFilter("");
    setDistrictFilter("");
    setTypeFilter("");
    setOwnerFilter("");
    setOwnerQuery("");
  };

  const hasActiveFilters = Boolean(searchQuery || regionFilter || districtFilter || typeFilter || ownerFilter);

  const badgeClasses = (v: string) => {
    switch (v) {
      case "APPROVED":
        return "bg-emerald-100 text-emerald-700";
      case "PENDING":
        return "bg-amber-100 text-amber-700";
      case "NEEDS_FIXES":
        return "bg-orange-100 text-orange-700";
      case "REJECTED":
        return "bg-rose-100 text-rose-700";
      case "SUSPENDED":
        return "bg-violet-100 text-violet-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  if (selectedPropertyId) {
    return (
      <PropertyPreview
        propertyId={selectedPropertyId}
        mode="admin"
        onClose={() => setSelectedPropertyId(null)}
        onApproved={() => {
          setSelectedPropertyId(null);
          void refreshAll();
        }}
        onRejected={() => {
          setSelectedPropertyId(null);
          void refreshAll();
        }}
        onUpdated={async () => {
          await refreshAll();
          try {
            const response = await api.get("/api/admin/settings");
            if (response.data?.commissionPercent !== undefined) {
              const commission = Number(response.data.commissionPercent);
              setSystemCommission(isNaN(commission) ? 0 : commission);
            }
          } catch {
            // ignore
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: compact, left aligned */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-[#02665e] text-white">
            <ScanEye className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-[20px] font-bold leading-tight text-slate-900">Property previews</h1>
            <p className="m-0 mt-0.5 text-[13px] text-slate-500">Review listings as guests will see them, then approve or act.</p>
          </div>
        </div>
        <p className="m-0 text-[13px] text-slate-500">
          {loading ? "Loading" : `${total.toLocaleString()} ${total === 1 ? "property" : "properties"}`}
          {hasActiveFilters ? " match your filters" : ""}
        </p>
      </div>

      {/* Toolbar */}
      <div className="box-border rounded-xl border border-solid border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <label className="relative block min-w-[220px] flex-1">
            <span className="sr-only">Search properties</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, area, owner or #ID"
              className="box-border h-10 w-full rounded-lg border border-solid border-slate-300 bg-white pl-9 pr-9 text-[13.5px] text-slate-900 outline-none focus:border-[#02665e] focus:ring-4 focus:ring-[#02665e]/10"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
          {(() => {
            const field =
              "box-border h-10 appearance-none rounded-lg border border-solid bg-white pl-3 pr-9 text-[13.5px] outline-none transition focus:border-[#02665e] focus:ring-4 focus:ring-[#02665e]/10";
            const on = (v: string) => (v ? "border-[#02665e]/50 text-[#02665e] font-semibold" : "border-slate-300 text-slate-700");
            const chevron = <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />;
            const region = REGIONS.find((r) => r.id === regionFilter);
            const districts: string[] = Array.isArray((region as any)?.districts) ? ((region as any).districts as string[]) : [];
            const ownerMatches = owners;
            return (
              <>
                <span className="relative block">
                  <select
                    value={regionFilter}
                    onChange={(e) => {
                      setRegionFilter(e.target.value);
                      setDistrictFilter("");
                    }}
                    aria-label="Region"
                    className={`${field} ${on(regionFilter)} min-w-[150px]`}
                  >
                    <option value="">All regions</option>
                    {REGIONS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {chevron}
                </span>

                {regionFilter && districts.length > 0 && (
                  <span className="relative block">
                    <select
                      value={districtFilter}
                      onChange={(e) => setDistrictFilter(e.target.value)}
                      aria-label="District"
                      className={`${field} ${on(districtFilter)} min-w-[150px]`}
                    >
                      <option value="">All districts</option>
                      {districts.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    {chevron}
                  </span>
                )}

                <span className="relative block">
                  <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Property type" className={`${field} ${on(typeFilter)} min-w-[130px]`}>
                    <option value="">All types</option>
                    {PROPERTY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {chevron}
                </span>

                {/* Owner: type to search instead of scrolling a long dropdown */}
                <span className="relative block w-[220px]">
                  <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    type="text"
                    role="combobox"
                    aria-expanded={ownerMenuOpen}
                    aria-label="Owner"
                    value={ownerMenuOpen ? ownerQuery : ownerFilter && selectedOwner ? String(selectedOwner.name || selectedOwner.email) : ""}
                    placeholder={ownerMenuOpen ? "Search name or email" : "Any owner"}
                    onFocus={() => {
                      setOwnerMenuOpen(true);
                      setOwnerQuery("");
                    }}
                    onBlur={() => window.setTimeout(() => setOwnerMenuOpen(false), 120)}
                    onChange={(e) => setOwnerQuery(e.target.value)}
                    className={`${field} ${on(ownerFilter)} w-full pl-9 ${ownerFilter ? "pr-9" : ""}`}
                  />
                  {ownerFilter ? (
                    <button
                      type="button"
                      aria-label="Clear owner"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setOwnerFilter("");
                        setOwnerQuery("");
                      }}
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    chevron
                  )}
                  {ownerMenuOpen && (
                    <ul className="absolute left-0 right-0 top-full z-30 m-0 mt-1 max-h-64 list-none overflow-y-auto rounded-lg border border-solid border-slate-200 bg-white p-1 shadow-lg">
                      {loadingOwners ? (
                        <li className="flex items-center gap-2 px-3 py-2 text-[13px] text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading owners
                        </li>
                      ) : ownerMatches.length === 0 ? (
                        <li className="px-3 py-2 text-[13px] text-slate-500">No owner matches</li>
                      ) : (
                        ownerMatches.map((o) => (
                          <li
                            key={o.id}
                            role="option"
                            aria-selected={String(o.id) === ownerFilter}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setOwnerFilter(String(o.id));
                              setSelectedOwner(o);
                              setOwnerMenuOpen(false);
                            }}
                            className={`cursor-pointer rounded-md px-3 py-2 ${String(o.id) === ownerFilter ? "bg-[#02665e]/10" : "hover:bg-slate-50"}`}
                          >
                            <span className="block truncate text-[13px] font-semibold text-slate-900">{o.name || `Owner #${o.id}`}</span>
                            {o.email && <span className="block truncate text-[11.5px] text-slate-500">{o.email}</span>}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </span>
              </>
            );
          })()}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2.5 text-[13px] font-semibold text-[#02665e] hover:bg-[#02665e]/5"
            >
              <X className="h-4 w-4" /> Clear
            </button>
          )}
        </div>

        {/* Active filters, each removable on its own */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5 border-0 border-t border-solid border-slate-100 px-3 py-2">
            <span className="mr-1 text-[12px] font-medium text-slate-500">Filtered by</span>
            {[
              searchQuery ? { key: "q", label: `"${searchQuery}"`, clear: () => { setSearchInput(""); setSearchQuery(""); } } : null,
              regionFilter
                ? { key: "region", label: REGIONS.find((r) => r.id === regionFilter)?.name || regionFilter, clear: () => { setRegionFilter(""); setDistrictFilter(""); } }
                : null,
              districtFilter ? { key: "district", label: districtFilter, clear: () => setDistrictFilter("") } : null,
              typeFilter ? { key: "type", label: PROPERTY_TYPES.find((t) => t.value === typeFilter)?.label || typeFilter, clear: () => setTypeFilter("") } : null,
              ownerFilter
                ? {
                    key: "owner",
                    label: (() => {
                      const o = selectedOwner && String(selectedOwner.id) === ownerFilter ? selectedOwner : null;
                      return o ? String(o.name || o.email) : `Owner #${ownerFilter}`;
                    })(),
                    clear: () => setOwnerFilter(""),
                  }
                : null,
            ]
              .filter(Boolean)
              .map((chip: any) => (
                <span key={chip.key} className="inline-flex h-7 items-center gap-1 rounded-md bg-[#02665e]/10 pl-2 pr-1 text-[12.5px] font-semibold text-[#02665e]">
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.clear}
                    aria-label={`Remove ${chip.label}`}
                    className="flex h-5 w-5 items-center justify-center rounded border-0 bg-transparent text-[#02665e]/70 hover:bg-[#02665e]/15 hover:text-[#02665e]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
          </div>
        )}

        {/* Status tabs: counts follow the search and filters above */}
        <div className="border-0 border-t border-solid border-slate-100 px-2 sm:px-4">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Status">
          {STATUS_TABS.map((s) => {
            const on = statusFilter === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setStatusFilter(s.value)}
                className={`relative -mb-px inline-flex h-11 flex-none items-center gap-2 whitespace-nowrap border-0 bg-transparent px-3 text-[13px] font-semibold transition-colors ${
                  on ? "text-[#02665e]" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {s.label}
                {on && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[#02665e]" />}
                <span className={`rounded-md px-1.5 text-[11px] font-bold tabular-nums ${on ? "bg-[#02665e] text-white" : badgeClasses(s.value)}`}>
                  {counts[s.value] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
        </div>
      </div>

      {/* Results */}
      {loading && properties.length === 0 ? (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-solid border-slate-200 bg-white py-14 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-[#02665e]" /> Loading properties
        </div>
      ) : properties.length === 0 ? (
        <div className="rounded-xl border border-solid border-slate-200 bg-white px-6 py-14 text-center">
          <p className="m-0 text-[15px] font-semibold text-slate-900">No properties found</p>
          <p className="m-0 mt-1 text-[13px] text-slate-500">
            {hasActiveFilters ? "Try another search or clear the filters." : "Nothing in this status yet."}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 inline-flex h-9 items-center rounded-lg border-0 bg-[#02665e] px-4 text-[13px] font-semibold text-white hover:bg-[#014e47]"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6 gap-5 ${loading ? "opacity-60" : ""}`}>
            {properties.map((property) => {
              const locationParts = [
                property.location?.city,
                property.location?.district || property.district,
                property.location?.regionName || property.regionName,
              ].filter(Boolean);
              const location = locationParts.join(", ") || "—";

              const primaryPhoto = (() => {
                if (Array.isArray(property.photos)) {
                  return property.photos.find(isSafeNextImageSrc) ?? null;
                }
                if (isSafeNextImageSrc(property.photos)) return property.photos;
                return null;
              })();
              const displayBasePrice = effectiveBasePrice(property);

              const hotelStarLabels: Record<string, string> = {
                basic: "1★",
                simple: "2★",
                moderate: "3★",
                high: "4★",
                luxury: "5★",
              };
              const starLabel = property.hotelStar ? hotelStarLabels[property.hotelStar] || null : null;

              return (
                <button
                  key={property.id}
                  onClick={() => setSelectedPropertyId(property.id)}
                  className="group bg-white rounded-2xl border border-solid border-slate-200 shadow-sm hover:shadow-md transition-shadow text-left"
                >
                  {/* Title (above image) */}
                  <div className="px-4 pt-4">
                    <div className="text-base font-bold text-slate-900 truncate">{property.title}</div>
                  </div>

                  {/* Image */}
                  <div className="px-4 mt-3">
                    <div className="relative aspect-square bg-slate-100 rounded-2xl overflow-hidden">
                      {primaryPhoto ? (
                        canUseNextImageForSrc(primaryPhoto) ? (
                          <Image
                            src={primaryPhoto}
                            alt=""
                            fill
                            sizes="(min-width: 1536px) 16vw, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                            className="object-cover group-hover:scale-105 transition-transform duration-200 rounded-2xl"
                          />
                        ) : (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={primaryPhoto}
                              alt=""
                              className="object-cover group-hover:scale-105 transition-transform duration-200 rounded-2xl"
                              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                            />
                          </>
                        )
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl">
                          <span className="text-slate-400 text-sm">No image</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-black/0 to-transparent rounded-2xl pointer-events-none" />
                    </div>
                  </div>

                  {/* Below image: location, type/status, price, and action */}
                  <div className="p-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{location}</span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        {starLabel && property.type === "HOTEL" ? (
                          <div className="flex items-center gap-0.5">
                            {starLabel.split("").map((char, i) => (
                              <Star
                                key={i}
                                className={`w-3.5 h-3.5 ${char === "★" ? "fill-amber-400 text-amber-400" : "text-slate-400"}`}
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-slate-500 uppercase">{property.type || "Property"}</span>
                        )}
                        <span
                          className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${
                            property.status === "PENDING"
                              ? "bg-amber-100 text-amber-800"
                              : property.status === "APPROVED"
                                ? "bg-emerald-100 text-emerald-800"
                                : property.status === "REJECTED"
                                  ? "bg-red-100 text-red-800"
                                  : property.status === "DRAFT"
                                    ? "bg-gray-100 text-gray-800"
                                    : property.status === "NEEDS_FIXES"
                                      ? "bg-orange-100 text-orange-800"
                                      : property.status === "SUSPENDED"
                                        ? "bg-indigo-100 text-indigo-800"
                                        : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {property.status}
                        </span>
                      </div>

                      {displayBasePrice && (() => {
                        const commission = getPropertyCommission(property, systemCommission);
                        const finalPrice = calculatePriceWithCommission(displayBasePrice, commission);
                        return (
                          <div className="flex items-baseline gap-1">
                            <div className="text-sm font-bold text-slate-900">
                              {new Intl.NumberFormat(undefined, {
                                style: "currency",
                                currency: property.currency || "TZS",
                                maximumFractionDigits: 0,
                              }).format(finalPrice)}
                            </div>
                            <div className="text-[11px] text-slate-500">per night</div>
                          </div>
                        );
                      })()}

                      <div className="mt-2">
                        <div className="inline-flex items-center gap-2 w-full justify-center rounded-xl bg-[#02665e] text-white py-2.5 text-sm font-semibold transition-colors group-hover:bg-[#014e47]">
                          <ScanEye className="h-4 w-4" />
                          <span>Full Preview</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {properties.length < total && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={loading}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-solid border-slate-300 bg-white px-4 text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Show more ({(total - properties.length).toLocaleString()} left)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
