"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import PropertyPreview from "@/components/PropertyPreview";
import { 
  MapPin,
  Star,
  Eye,
  Building2,
  BedDouble,
  CalendarCheck,
  Search,
  MessageSquare,
  ImageIcon,
  ArrowRight,
  Pencil,
  Plus,
  ArrowUpRight,
  Trees
} from "lucide-react";
import { 
  getPropertyCommission, 
  calculatePriceWithCommission 
} from "@/lib/priceUtils";
import VerifiedIcon from "@/components/VerifiedIcon";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Property = {
  id: number;
  nrmsBookingKey: string;
  title: string;
  status: string;
  type: string | null;
  photos?: string[];
  regionName?: string | null;
  district?: string | null;
  city?: string | null;
  ward?: string | null;
  country?: string | null;
  basePrice?: number | null;
  currency?: string;
  roomsSpec?: any[];
  hotelStar?: string | null;
  services?: any;
  slug?: string;
  tourismSiteId?: number | null;
  parkPlacement?: "INSIDE" | "NEARBY" | null;
  tourismSite?: {
    id: number;
    slug: string;
    name: string;
    country: string;
  } | null;
};

type ReviewsData = {
  averageRating: number;
  totalReviews: number;
  reviews?: any[];
};

function fmtMoney(amount: number | null | undefined, currency?: string | null) {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  const cur = currency || "TZS";
  try {
    return new Intl.NumberFormat(undefined, { 
      style: "currency", 
      currency: cur, 
      maximumFractionDigits: 0 
    }).format(Number(amount));
  } catch {
    return `${cur} ${Number(amount).toLocaleString()}`;
  }
}

/** "MAKUBURI", "DAR-ES-SALAAM" and "Dar es Salaam" become one tidy, de-duplicated line */
function tidyLocation(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/[^a-z]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isShouting = text === text.toUpperCase();
    const pretty = isShouting
      ? text
          .toLowerCase()
          .replace(/-/g, " ")
          .replace(/\b(\w)/g, (c) => c.toUpperCase())
          .replace(/\bEs\b/g, "es")
      : text;
    out.push(pretty);
  }
  return out.join(", ");
}

function buildPropertySlug(title: string, publicKey: string): string {
  const base = String(title || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  return base ? `${base}-${publicKey}` : publicKey;
}

export default function ApprovedProps() {
  const [list, setList] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [reviewsMap, setReviewsMap] = useState<Record<number, ReviewsData>>({});
  const [systemCommission, setSystemCommission] = useState<number>(0);
  const [query, setQuery] = useState("");
  const loadingReviewsRef = useRef<Record<number, boolean>>({});

  function normalizeItems(payload: any): any[] {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data?.items)) return payload.data.items;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }

  // Load system commission settings
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await api.get("/api/public/support/system-settings");
        const settings = response.data?.data ?? response.data;
        if (mounted && settings?.commissionPercent !== undefined) {
          const commission = Number(settings.commissionPercent);
          setSystemCommission(isNaN(commission) ? 0 : commission);
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

  const loadReviewsForProperty = useCallback(async (propertyId: number) => {
    // Prevent duplicate concurrent fetches using a ref to track loading per property
    if (loadingReviewsRef.current[propertyId]) return;
    loadingReviewsRef.current[propertyId] = true;
    
    try {
      const response = await api.get(`/api/property-reviews/${propertyId}`);
      const data = response.data;
      
      setReviewsMap(prev => ({
        ...prev,
        [propertyId]: {
          averageRating: data.averageRating || 0,
          totalReviews: data.totalReviews || 0,
          reviews: data.reviews || [],
        },
      }));
    } catch (err) {
      // Silently fail - reviews are optional
      setReviewsMap(prev => ({
        ...prev,
        [propertyId]: {
          averageRating: 0,
          totalReviews: 0,
          reviews: [],
        },
      }));
    } finally {
      loadingReviewsRef.current[propertyId] = false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const timer = setTimeout(() => {
      if (!mounted) return;
    api.get<any>("/api/owner/properties/mine", { params: { status: "APPROVED" } })
      .then(r => {
        if (!mounted) return;
        const properties = normalizeItems(r.data);
          
          // Add slugs to properties
          const propertiesWithSlugs = properties.map((p: any) => ({
            ...p,
            slug: buildPropertySlug(p.title, p.nrmsBookingKey),
          }));
          
          setList(propertiesWithSlugs);
          
          // Load reviews for all properties
          propertiesWithSlugs.forEach((property: Property) => {
            loadReviewsForProperty(property.id);
          });
      })
      .catch(() => {
        if (!mounted) return;
        setList([]);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [loadReviewsForProperty]);

  // If a property is selected, show PropertyPreview
  if (selectedPropertyId) {
    return (
      <PropertyPreview
        propertyId={selectedPropertyId}
        mode="owner"
        onUpdated={() => {
          // Reload properties after update
          api.get<any>("/api/owner/properties/mine", { params: { status: "APPROVED" } })
            .then(r => {
              const properties = normalizeItems(r.data);
              const propertiesWithSlugs = properties.map((p: any) => ({
                ...p,
                slug: buildPropertySlug(p.title, p.nrmsBookingKey),
              }));
              setList(propertiesWithSlugs);
            })
            .catch(() => {});
        }}
      />
    );
  }

  const shell = "w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6";
  const styles = `
    #owner-properties, #owner-properties * { box-sizing: border-box; }
    @keyframes op-shimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
    #owner-properties .op-sk { background: linear-gradient(90deg, #eef2f1 0%, #f8faf9 40%, #eef2f1 80%); background-size: 800px 100%; animation: op-shimmer 1.3s linear infinite; }
    #owner-properties .op-sk-dark { background: linear-gradient(90deg, rgba(255,255,255,.06) 0%, rgba(255,255,255,.14) 40%, rgba(255,255,255,.06) 80%); background-size: 800px 100%; animation: op-shimmer 1.3s linear infinite; }
  `;

  if (loading) {
    return (
      <div id="owner-properties" className={shell} aria-busy="true" aria-label="Loading properties">
        <style>{styles}</style>
        <div className="rounded-3xl bg-[#012a26] px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="space-y-2.5">
            <div className="op-sk-dark h-3 w-28 rounded-full" />
            <div className="op-sk-dark h-8 w-52 rounded-lg" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="op-sk-dark h-[72px] rounded-2xl" />)}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="op-sk h-[340px] rounded-2xl" />)}</div>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div id="owner-properties" className={shell}>
        <style>{styles}</style>
        <section className="grid overflow-hidden rounded-3xl border border-solid border-slate-300/80 bg-white md:grid-cols-2">
          <div className="p-8">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#012a26] text-[#5eead4]">
              <Building2 className="h-6 w-6" aria-hidden />
            </span>
            <p className="m-0 mt-4 text-xl font-bold text-slate-900">No approved properties yet</p>
            <p className="m-0 mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">
              Submit your first listing and the NoLSAF team reviews it. Approvals usually take 1 to 2 business days.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2.5 border-0 border-t border-solid border-slate-200 bg-slate-50 p-8 md:border-l md:border-t-0">
            <Link href="/owner/properties/add" className="group inline-flex h-12 items-center justify-between gap-2 rounded-xl bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white no-underline transition hover:bg-[#02665e]">
              Add your property
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5eead4] text-[#012a26]"><Plus className="h-4 w-4" aria-hidden /></span>
            </Link>
            <Link href="/owner/properties/pending" className="inline-flex h-12 items-center justify-between gap-2 rounded-xl border border-solid border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-100">
              See pending submissions <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
            </Link>
          </div>
        </section>
      </div>
    );
  }

  // Portfolio figures for the header.
  const totalBookings = list.reduce((t, p) => t + Number((p as any)._count?.bookings ?? 0), 0);
  const rated = list.map((p) => reviewsMap[p.id]).filter((r) => r && r.totalReviews > 0) as ReviewsData[];
  const totalReviews = rated.reduce((t, r) => t + r.totalReviews, 0);
  const avgRating = totalReviews > 0 ? rated.reduce((t, r) => t + r.averageRating * r.totalReviews, 0) / totalReviews : null;
  const q = query.trim().toLowerCase();
  const visible = q
    ? list.filter((p) => [p.title, p.type, p.city, p.district, p.regionName, p.ward].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
    : list;

  return (
    <div id="owner-properties" className={shell}>
      <style>{styles}</style>

      {/* ── Header band ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)", WebkitMaskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Property owner</p>
              <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">My properties</h1>
              <p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">Approved and live on NoLSAF. Preview a listing, edit it, or open its public page.</p>
            </div>
            <Link
              href="/owner/properties/add"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 self-start rounded-xl bg-[#5eead4] px-3.5 text-sm font-bold text-[#012a26] no-underline transition hover:bg-[#8ff3e1] sm:self-auto"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add property
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            {[
              { label: "Live properties", value: String(list.length), Icon: Building2 },
              { label: "Bookings", value: String(totalBookings), Icon: CalendarCheck },
              { label: "Guest rating", value: avgRating ? avgRating.toFixed(1) : "No reviews", Icon: Star },
              { label: "Reviews", value: String(totalReviews), Icon: MessageSquare },
            ].map((s) => (
              <div key={s.label} className="min-w-0 rounded-2xl border border-solid border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
                  <s.Icon className="h-3.5 w-3.5 text-[#5eead4]" aria-hidden />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className={`mt-1 block truncate font-bold tabular-nums ${s.value === "No reviews" ? "text-base text-white/40" : "text-2xl text-white"}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-slate-600">
          <span className="font-bold text-slate-900">{visible.length}</span> {visible.length === 1 ? "property" : "properties"}
        </p>
        {list.length > 3 ? (
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search properties</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, type or area"
              className="h-10 w-full rounded-xl border border-solid border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
            />
          </label>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">No property matches that search.</div>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((property) => {
            const location = tidyLocation([property.ward, property.city, property.district, property.regionName]);
            const primaryImage = Array.isArray(property.photos) && property.photos.length > 0 ? property.photos[0] : null;
            const photoCount = Array.isArray(property.photos) ? property.photos.length : 0;
            const reviews = reviewsMap[property.id] || { averageRating: 0, totalReviews: 0, reviews: [] };
            const hasReviews = reviews.totalReviews > 0;

            const bp = Number(property.basePrice) || 0;
            const roomPrices = Array.isArray(property.roomsSpec) ? (property.roomsSpec as any[]).map((r: any) => Number(r.pricePerNight) || 0).filter((v: number) => v > 0) : [];
            const effectiveBase = bp > 0 ? bp : roomPrices.length > 0 ? Math.min(...roomPrices) : 0;
            const isFromRoom = bp <= 0 && roomPrices.length > 0;
            const basePriceFormatted = effectiveBase > 0 ? fmtMoney(effectiveBase, property.currency) : null;
            const roomTypes = Array.isArray(property.roomsSpec) ? property.roomsSpec.length : 0;
            // What the guest sees on NoLSAF: your rate plus the platform commission.
            const guestPrice = effectiveBase > 0
              ? calculatePriceWithCommission(effectiveBase, getPropertyCommission(property, systemCommission))
              : null;

            const typeLabel = property.type
              ? String(property.type).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
              : "";
            const bookings = Number((property as any)._count?.bookings ?? 0);

            return (
              <li
                key={property.id}
                className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-26px_rgba(15,23,42,0.4)] transition hover:-translate-y-0.5 hover:border-[#02665e]/40 hover:shadow-[0_22px_44px_-26px_rgba(1,42,38,0.5)]"
              >
                {/* Photo with the facts a guest sees first */}
                <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
                  {primaryImage ? (
                    <Image
                      src={primaryImage}
                      alt=""
                      fill
                      sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-slate-400">
                      <ImageIcon className="h-8 w-8" aria-hidden />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent" aria-hidden />
                  <div className="absolute left-3 top-3 flex items-center gap-1.5">
                    {typeLabel ? (
                      <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-slate-800 shadow-sm">{typeLabel}</span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#012a26]/85 px-2.5 py-1 text-[11px] font-bold text-[#5eead4] backdrop-blur-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#5eead4]" aria-hidden /> Live
                    </span>
                  </div>
                  <div className="absolute right-3 top-3 scale-90">
                    <VerifiedIcon />
                  </div>
                  <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2 text-white">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold">
                      {hasReviews ? (
                        <>
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                          {reviews.averageRating.toFixed(1)}
                          <span className="font-normal text-white/75">({reviews.totalReviews})</span>
                        </>
                      ) : (
                        <span className="font-normal text-white/80">No reviews yet</span>
                      )}
                    </span>
                    {photoCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-white/80">
                        <ImageIcon className="h-3.5 w-3.5" aria-hidden /> {photoCount}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Body */}
                <div className="flex flex-1 flex-col p-4">
                  <p className="m-0 truncate text-base font-bold text-slate-900" title={property.title}>{property.title}</p>
                  <p className="m-0 mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-500" title={location}>
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
                    <span className="truncate">{location || "Location not set"}</span>
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                      <CalendarCheck className="h-3 w-3 text-slate-400" aria-hidden /> {bookings} {bookings === 1 ? "booking" : "bookings"}
                    </span>
                    {roomTypes > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                        <BedDouble className="h-3 w-3 text-slate-400" aria-hidden /> {roomTypes} {roomTypes === 1 ? "room type" : "room types"}
                      </span>
                    ) : null}
                    {property.tourismSite?.name ? (
                      <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-[#02665e]/[0.07] px-2.5 py-1 text-[11px] font-medium text-[#02665e]" title={property.tourismSite.name}>
                        <Trees className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{property.parkPlacement === "INSIDE" ? "Inside" : "Near"} {property.tourismSite.name}</span>
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-auto pt-4">
                    <div className="flex items-baseline justify-between gap-2 border-0 border-t border-dashed border-slate-200 pt-3">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Your rate</span>
                      {basePriceFormatted ? (
                        <span className="flex items-baseline gap-1">
                          {isFromRoom ? <span className="text-[11px] text-slate-400">From</span> : null}
                          <span className="text-lg font-bold tabular-nums text-[#02665e]">{basePriceFormatted}</span>
                          <span className="text-[11px] text-slate-400">/ night</span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">No rate set</span>
                      )}
                    </div>
                    {guestPrice && guestPrice > effectiveBase ? (
                      <p className="m-0 mt-0.5 text-right text-[11px] text-slate-500">
                        Guests see {fmtMoney(guestPrice, property.currency)} / night
                      </p>
                    ) : null}

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedPropertyId(property.id)}
                        className="group/btn inline-flex h-10 flex-1 items-center justify-between gap-2 rounded-xl border border-solid border-[#012a26] bg-[#012a26] pl-4 pr-1.5 text-sm font-bold text-white transition hover:bg-[#02665e]"
                      >
                        Preview
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#5eead4] text-[#012a26] transition group-hover/btn:translate-x-0.5">
                          <Eye className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      </button>
                      <Link
                        href={`/owner/properties/add?id=${property.id}`}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 no-underline transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                      </Link>
                      {property.slug ? (
                        <Link
                          href={`/public/properties/${property.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open the public page"
                          aria-label="Open the public page"
                          className="grid h-10 w-10 place-items-center rounded-xl border border-solid border-slate-300 bg-white text-slate-600 no-underline transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                        >
                          <ArrowUpRight className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}