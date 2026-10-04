"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import PropertyPreview from "@/components/PropertyPreview";
import { 
  MapPin, 
  Star, 
  Loader2, 
  CheckCircle, 
  Eye,
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#02665e] via-[#037a70] to-emerald-600 shadow-lg">
          <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative flex items-center gap-4 px-5 py-5 sm:px-6">
            <div className="h-12 w-12 flex-shrink-0 rounded-xl bg-white/20 flex items-center justify-center shadow-inner">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="m-0 text-xl sm:text-2xl font-bold text-white">Approved Properties</h1>
              <p className="m-0 mt-1 text-sm text-white/70">Loading your approved properties…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center px-4">

        {/* Empty-state card */}
        <div className="w-full max-w-sm rounded-3xl border border-dashed border-slate-300 bg-white px-8 py-10 flex flex-col items-center text-center shadow-sm">
          <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center mb-5 shadow-inner">
            <svg className="h-10 w-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.75L12 4l9 5.75V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.75z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 21V12h6v9" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-1.5">No approved properties yet</h2>
          <p className="text-sm text-slate-500 leading-relaxed mb-1">
            You haven&apos;t had a property approved yet. Submit your first listing and our team will review it — approvals typically take 1–2 business days.
          </p>
          <p className="text-xs text-slate-400 mb-6">
            Need help? Check the <span className="font-semibold text-slate-500">Pending</span> tab to see the status of your submissions.
          </p>
          <Link
            href="/owner/properties/add"
            className="inline-flex items-center gap-2 rounded-xl bg-[#02665e] px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/10 transition-all hover:bg-[#02665e]/90 hover:shadow-lg active:scale-95 no-underline"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add your property now
          </Link>
          <Link
            href="/owner/properties/pending"
            className="mt-3 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            View pending submissions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#02665e] via-[#037a70] to-emerald-600 shadow-lg">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="h-12 w-12 flex-shrink-0 rounded-xl bg-white/20 flex items-center justify-center shadow-inner">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="m-0 text-xl sm:text-2xl font-bold text-white">Approved Properties</h1>
              <p className="m-0 mt-1 text-sm text-white/70 max-w-xl">
                View and manage your approved properties. See reviews and interactions from guests.
              </p>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 text-xs font-semibold text-white">
              <CheckCircle className="h-3.5 w-3.5" />
              {list.length} {list.length === 1 ? "Property" : "Properties"}
            </div>
            <Link
              href="/owner/properties/add"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#02665e] shadow-sm transition-all hover:bg-white/90 active:scale-95 no-underline"
            >
              <Plus className="h-4 w-4" />
              Add property
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {list.map((property) => {
          const location = tidyLocation([property.ward, property.city, property.district, property.regionName]);
          
          const primaryImage = property.photos && Array.isArray(property.photos) && property.photos.length > 0
            ? property.photos[0]
            : null;

          const hotelStarLabels: Record<string, string> = {
            "basic": "1★",
            "simple": "2★",
            "moderate": "3★",
            "high": "4★",
            "luxury": "5★",
          };
          const _starLabel = property.hotelStar ? hotelStarLabels[property.hotelStar] || null : null;

          const reviews = reviewsMap[property.id] || { averageRating: 0, totalReviews: 0, reviews: [] };
          const hasReviews = reviews.totalReviews > 0;

          // Calculate final price with commission
          const bp = Number(property.basePrice) || 0;
          const roomPrices = Array.isArray(property.roomsSpec) ? (property.roomsSpec as any[]).map((r: any) => Number(r.pricePerNight) || 0).filter((v: number) => v > 0) : [];
          const effectiveBase = bp > 0 ? bp : (roomPrices.length > 0 ? Math.min(...roomPrices) : 0);
          const isFromRoom = bp <= 0 && roomPrices.length > 0;
          const finalPrice = effectiveBase > 0
            ? calculatePriceWithCommission(effectiveBase, getPropertyCommission(property, systemCommission))
            : null;
          const _price = fmtMoney(finalPrice, property.currency);
          const basePriceFormatted = effectiveBase > 0 ? fmtMoney(effectiveBase, property.currency) : null;

          const typeLabel = property.type
            ? String(property.type).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
            : "";
          const bookings = Number((property as any)._count?.bookings ?? 0);

          return (
            <div
              key={property.id}
              className="group flex min-w-0 overflow-hidden rounded-2xl border border-solid border-slate-200/80 bg-white shadow-sm transition-all duration-300 hover:border-[#02665e]/30 hover:shadow-md"
            >
              {/* Photo on the left */}
              <div className="relative w-28 flex-shrink-0 overflow-hidden bg-slate-100 sm:w-44">
                {primaryImage ? (
                  <Image
                    src={primaryImage}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 176px, 112px"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                    <ImageIcon className="h-7 w-7 text-slate-400" />
                  </div>
                )}
                <div className="absolute left-1.5 top-1.5 scale-90">
                  <VerifiedIcon />
                </div>
              </div>

              {/* Everything else on the right */}
              <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5 sm:p-4">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold leading-tight text-slate-900" title={property.title}>
                      {property.title}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-500" title={location}>
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" />
                      <span className="truncate">{location || "Location not set"}</span>
                    </div>
                  </div>
                  {typeLabel ? (
                    <span className="flex-shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {typeLabel}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  {hasReviews ? (
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span className="font-bold text-slate-900">{reviews.averageRating.toFixed(1)}</span>
                      <span>({reviews.totalReviews})</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <MessageSquare className="h-3.5 w-3.5" />
                      No reviews yet
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle className="h-3.5 w-3.5 text-[#02665e]" />
                    <span className="font-semibold text-slate-800">{bookings}</span> {bookings === 1 ? "booking" : "bookings"}
                  </span>
                  {property.tourismSite?.name ? (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1" title={property.tourismSite.name}>
                      <Trees className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" />
                      <span className="truncate">{property.tourismSite.name}</span>
                      {property.parkPlacement ? (
                        <span className="flex-shrink-0 rounded-full bg-[#02665e]/10 px-1.5 py-px text-[10px] font-bold text-[#02665e]">
                          {property.parkPlacement === "INSIDE" ? "Inside" : "Nearby"}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </div>

                {/* Price on the left, actions on the right */}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-slate-100 pt-2.5">
                  {basePriceFormatted ? (
                    <div className="flex items-baseline gap-1">
                      {isFromRoom ? <span className="text-[11px] text-slate-400">From</span> : null}
                      <span className="text-[15px] font-bold text-[#02665e]">{basePriceFormatted}</span>
                      <span className="text-[11px] text-slate-400">/ night</span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">No rate set</span>
                  )}

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedPropertyId(property.id)}
                      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#014e47]"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview
                    </button>
                    <Link
                      href={`/owner/properties/add?id=${property.id}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 no-underline transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Link>
                    {property.slug ? (
                      <Link
                        href={`/public/properties/${property.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View the public page"
                        aria-label="View the public page"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 no-underline transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
