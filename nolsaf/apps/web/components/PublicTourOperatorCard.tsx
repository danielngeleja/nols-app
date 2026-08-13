"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Building2, CalendarDays, Car, CarFront, CheckCircle2, ExternalLink, Heart, MapPin, Phone, Plane, Sparkles, TrendingUp, Users } from "lucide-react";
import { slugifyProfile } from "@/lib/profileSlug";

export type PublicTourPackageItem = {
  id?: string;
  name?: string;
  title?: string;
  destination?: string;
  category?: string;
  pricePerPerson?: string | number;
  price?: string | number;
  currency?: string;
  status?: string;
  duration?: string;
  durationDays?: number;
  nights?: number;
};

export type PublicTourOperatorProfile = {
  companyName?: string;
  physicalLocation?: string;
  businessAddress?: string;
  operatingRegions?: string[];
  contactPhone?: string;
  companyLogoUrl?: string;
  gallery?: string[];
  classifiedPhotos?: Record<string, string[]>;
  services?: string[];
  addOns?: string[];
  tourismTypes?: string[];
  specializations?: string[];
  packageItems?: PublicTourPackageItem[];
  commissionPercent?: string | number;
  tripConfidence?: {
    score?: number;
    averageRating?: number;
    totalRatings?: number;
    completedTimelines?: number;
    completedTravellers?: number;
    topFeeling?: string | null;
    recentWindowDays?: number;
    allTime?: {
      totalRatings?: number;
      completedTimelines?: number;
      completedTravellers?: number;
    };
  };
};

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function serviceIcon(service: string) {
  const s = service.toLowerCase();
  if (s.includes("airport") || s.includes("flight") || s.includes("air")) return Plane;
  if (s.includes("transfer") || s.includes("hotel") || s.includes("lodge") || s.includes("pickup")) return CarFront;
  if (s.includes("meet") || s.includes("greet") || s.includes("guide") || s.includes("group")) return Users;
  if (s.includes("drive") || s.includes("game") || s.includes("safari") || s.includes("vehicle")) return Car;
  return Sparkles;
}

export default function PublicTourOperatorCard({
  agentId,
  profile,
  packages,
  commissionPercent,
}: {
  agentId: number;
  profile: PublicTourOperatorProfile;
  packages: PublicTourPackageItem[];
  commissionPercent?: number;
}) {
  const numericAgentId = Number(agentId);
  const hasValidAgentId = Number.isFinite(numericAgentId) && numericAgentId > 0;
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedPackageIndex, setSelectedPackageIndex] = useState(0);
  const [favorited, setFavorited] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const index = Math.round(el.scrollLeft / el.offsetWidth);
    setActiveIndex(index);
  }
  const classified = profile.classifiedPhotos || {};
  const photos = [
    ...(classified.attractions || []),
    ...(classified.proof || []),
    ...(classified.office || []),
    ...(classified.vehicles || []),
    ...(profile.gallery || []),
  ]
    .filter(Boolean)
    .slice(0, 6);
  const services = [
    ...(profile.services || []),
    ...(profile.addOns || []),
    ...(profile.tourismTypes || []),
    ...(profile.specializations || []),
  ].filter((item, index, arr) => item && arr.indexOf(item) === index);

  const profileCommission = toFiniteNumber((profile as any)?.commissionPercent);
  const effectiveCommissionPercent = Math.max(0, profileCommission ?? toFiniteNumber(commissionPercent) ?? 0);

  const selectedPackage = packages[selectedPackageIndex] || packages[0] || null;
  const selectedPackagePrice = selectedPackage
    ? {
        currency: String(selectedPackage.currency || "USD").toUpperCase(),
        price: Number(selectedPackage.pricePerPerson || selectedPackage.price || 0) * (1 + effectiveCommissionPercent / 100),
      }
    : null;
  const selectedPackageDuration = selectedPackage?.duration
    || (selectedPackage?.durationDays ? `${selectedPackage.durationDays} days${selectedPackage.nights ? ` · ${selectedPackage.nights} nights` : ""}` : null);
  const location = profile.physicalLocation || profile.businessAddress || profile.operatingRegions?.[0] || "Location not set";
  const companyName = profile.companyName || "Approved Tour Operator";
  const profileSlug = slugifyProfile(companyName, numericAgentId);
  const reviewHref = hasValidAgentId ? `/public/tour-packages/operators/${numericAgentId}/submitted-profile/${profileSlug}` : "/public/tour-packages";
  const confidence = profile.tripConfidence;
  const confidenceScore = Number(confidence?.score || 0);
  const hasConfidence = confidenceScore > 0 && Number(confidence?.totalRatings || 0) > 0;

  return (
    <div className="min-w-0">
      <div className="px-2 pb-3">
        <h3 className="text-xl font-black leading-tight tracking-tight text-slate-950 sm:text-2xl">{companyName}</h3>
      </div>
      <article className="min-w-0 overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-[0_20px_40px_rgba(15,23,42,0.09)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_28px_52px_rgba(2,102,94,0.16)]">

        {/* ── Photo area ── */}
        <div className="relative mx-4 mt-4 overflow-hidden rounded-xl bg-slate-100">
          {photos.length > 0 ? (
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex h-64 snap-x snap-mandatory overflow-x-auto sm:h-72"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {photos.map((url, index) => (
                <div key={`${url}-${index}`} className="group relative h-64 w-full flex-none snap-start overflow-hidden bg-slate-100 sm:h-72">
                  <Image src={url} alt={`${companyName} photo ${index + 1}`} fill sizes="(max-width: 768px) 100vw, 420px" className="object-cover transition-transform duration-500 ease-out group-hover:scale-110" unoptimized />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center sm:h-72" style={{ background: "linear-gradient(135deg, #02665e 0%, #0b6f68 100%)" }}>
              <Building2 className="h-16 w-16 text-white/30" aria-hidden />
            </div>
          )}

          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white shadow-md sm:px-3 sm:text-xs">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            Verified
          </span>

          {photos.length > 1 ? (
            <div className="absolute bottom-2.5 left-0 right-0 flex justify-center gap-1.5">
              {photos.map((_, index) => (
                <span
                  key={index}
                  className={`h-1 w-4 rounded-sm transition-all duration-300 ${
                    index === activeIndex
                      ? "bg-white"
                      : "bg-white/45"
                  }`}
                />
              ))}
            </div>
          ) : null}
        </div>

        {/* ── Body ── */}
        <div className="px-6 pb-4 pt-5">
          {packages.length > 0 ? (
            <div className="mb-3">
              <div className="mb-2">
                <span className="text-lg font-black tracking-tight text-slate-900">Packages ({packages.length})</span>
              </div>
              <div
                className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {packages.map((pkg, index) => {
                  const label = pkg.name || pkg.title || `Package ${index + 1}`;
                  const selected = index === selectedPackageIndex;
                  return (
                    <button
                      key={`${pkg.id || label}-${index}`}
                      type="button"
                      onClick={() => setSelectedPackageIndex(index)}
                      className={`flex ${packages.length > 1 ? "w-[72%]" : "w-full"} flex-none snap-start items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition ${selected ? "border-[#02665e] bg-[#02665e]/5 text-slate-900 shadow-md shadow-[#02665e]/10" : "border-slate-200 bg-white text-slate-500 hover:border-[#02665e]/40 hover:text-[#02665e]"}`}
                      aria-pressed={selected}
                    >
                      {selected ? (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#02665e]">
                          <CheckCircle2 className="h-3 w-3 text-white" aria-hidden />
                        </span>
                      ) : null}
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Location + Price row */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#02665e]/15 bg-[#02665e]/5 px-4 py-3.5 ring-1 ring-[#02665e]/5">
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-slate-600">
                <MapPin className="h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
                <span className="truncate">{location}</span>
              </div>
              {selectedPackageDuration ? (
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
                  <span className="truncate">{selectedPackageDuration}</span>
                </div>
              ) : null}
            </div>
            {selectedPackagePrice && Number.isFinite(selectedPackagePrice.price) && selectedPackagePrice.price > 0 ? (
              <div className="flex shrink-0 items-baseline gap-0.5">
                <span className="text-xl font-black leading-none text-[#02665e] sm:text-2xl">
                  {selectedPackagePrice.currency} {Math.round(selectedPackagePrice.price).toLocaleString()}
                </span>
                <span className="ml-0.5 text-[10px] text-slate-400">/ person</span>
              </div>
            ) : profile.contactPhone ? (
              <div className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[#02665e]">
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {profile.contactPhone}
              </div>
            ) : null}
          </div>

          {hasConfidence ? (
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e] text-base font-black text-white">
                {confidenceScore}%
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-black text-slate-950">
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
                  <span className="whitespace-nowrap">Trip confidence</span>
                </div>
                <div className="mt-0.5 whitespace-nowrap text-xs font-medium text-slate-500">
                  {Number(confidence?.averageRating || 0).toFixed(1)}/5 from {confidence?.totalRatings || 0} ratings
                </div>
              </div>
              {confidence?.topFeeling ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-[#02665e]">
                  <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                  {confidence.topFeeling}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Service chips */}
          {services.length > 0 && (
            <div
              className="mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {services.map((service) => {
                const Icon = serviceIcon(service);
                return (
                  <span key={service} className="flex flex-none snap-start items-center gap-2 whitespace-nowrap rounded-2xl border border-slate-200/80 bg-white px-3.5 py-2.5 text-[11px] font-semibold text-slate-700 shadow-sm">
                    <Icon className="h-5 w-5 shrink-0 text-slate-800" aria-hidden />
                    <span>{service}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* ── CTA ── */}
        <div className="flex items-stretch gap-2 px-6 pb-6 pt-4">
          {hasValidAgentId ? (
            <Link
              href={reviewHref}
              className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white no-underline transition-all duration-200 hover:shadow-lg hover:shadow-[#02665e]/30"
              style={{ background: "linear-gradient(135deg, #02665e 0%, #028a7e 100%)" }}
            >
              Preview &amp; Book
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : (
            <span className="flex min-w-0 flex-1 cursor-not-allowed items-center justify-center rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-400">
              Profile unavailable
            </span>
          )}
          <button
            type="button"
            onClick={() => setFavorited((v) => !v)}
            aria-label={favorited ? "Remove from saved" : "Save operator"}
            aria-pressed={favorited}
            className={`flex w-12 shrink-0 items-center justify-center rounded-xl border transition ${favorited ? "border-[#02665e] bg-[#02665e]/5 text-[#02665e]" : "border-slate-200 bg-white text-slate-500 hover:border-[#02665e]/40 hover:text-[#02665e]"}`}
          >
            <Heart className={`h-5 w-5 ${favorited ? "fill-[#02665e]" : ""}`} aria-hidden />
          </button>
        </div>
      </article>
    </div>
  );
}
