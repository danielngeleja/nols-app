"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Building2, Clock3, MapPin, Star } from "lucide-react";
import VerifiedIcon from "./VerifiedIcon";
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

/** "ARUSHA / MONDULI" and "arusha" both read as "Arusha". */
function tidyPlace(value: string): string {
  return value
    .split(/\s*\/\s*/)[0]
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Marketplace card for one verified tour operator.
 *
 * Deliberately the twin of the stay card (PublicApprovedPropertyCard): title
 * on top, an inset square photo with the shared verified badge, one info row
 * (where on the left, price on the right) and one full-width action. The whole
 * card is a single link, so a visitor has exactly one decision to make.
 */
export default function PublicTourOperatorCard({
  agentId,
  agentPublicKey,
  profile,
  packages,
  commissionPercent,
}: {
  agentId: number;
  agentPublicKey: string;
  profile: PublicTourOperatorProfile;
  packages: PublicTourPackageItem[];
  commissionPercent?: number;
}) {
  const numericAgentId = Number(agentId);
  const hasValidAgentId = Number.isFinite(numericAgentId) && numericAgentId > 0;
  const companyName = profile.companyName || "Approved Tour Operator";

  // Lead with a photo that sells the trip: attractions, then the gallery,
  // then vehicles; office and verification-proof shots only as a last resort.
  const classified = profile.classifiedPhotos || {};
  const photo = [
    ...(classified.attractions || []),
    ...(profile.gallery || []),
    ...(classified.vehicles || []),
    ...(classified.office || []),
    ...(classified.proof || []),
  ].find(Boolean) || null;

  const profileCommission = toFiniteNumber((profile as any)?.commissionPercent);
  const effectiveCommissionPercent = Math.max(0, profileCommission ?? toFiniteNumber(commissionPercent) ?? 0);

  // The price a traveller pays (package price plus the NoLSAF commission).
  const priced = packages
    .map((pkg) => ({
      pkg,
      currency: String(pkg.currency || "USD").toUpperCase(),
      price: Number(pkg.pricePerPerson || pkg.price || 0) * (1 + effectiveCommissionPercent / 100),
    }))
    .filter((entry) => Number.isFinite(entry.price) && entry.price > 0);
  const cheapest = priced.reduce<(typeof priced)[number] | null>((low, entry) => (!low || entry.price < low.price ? entry : low), null);
  const leadPackage = cheapest?.pkg || packages[0] || null;
  const leadDays = leadPackage?.durationDays
    ? `${leadPackage.durationDays} day${leadPackage.durationDays === 1 ? "" : "s"}`
    : leadPackage?.duration || null;
  const packageCount = packages.length;

  const regions = (profile.operatingRegions || []).filter(Boolean).map(tidyPlace);
  const where = Array.from(new Set(regions)).slice(0, 2).join(", ")
    || (leadPackage?.destination ? tidyPlace(leadPackage.destination) : "")
    || tidyPlace(profile.physicalLocation || profile.businessAddress || "Tanzania");

  const hasPublicKey = /^[a-z0-9]{20,40}$/.test(agentPublicKey);
  const href = hasValidAgentId && hasPublicKey
    ? `/public/tour-packages/operators/${agentPublicKey}/submitted-profile/${slugifyProfile(companyName)}`
    : null;

  const rating = Number(profile.tripConfidence?.averageRating || 0);
  const ratingCount = Number(profile.tripConfidence?.totalRatings || 0);
  const hasRating = rating > 0 && ratingCount > 0;

  const card = (
    <motion.div
      className="flex h-full flex-col rounded-2xl border border-solid border-slate-200 bg-white shadow-sm"
      whileHover={href ? { y: -5, boxShadow: "0 16px 40px rgba(2,6,23,0.13)" } : undefined}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {/* Title at top, rating beside it */}
      <div className="flex items-center justify-between gap-2 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="min-w-0 truncate text-sm font-bold text-slate-900 sm:text-base">{companyName}</div>
        {hasRating ? (
          <span className="inline-flex flex-shrink-0 items-center gap-0.5 text-xs font-bold text-slate-800" aria-label={`Rated ${rating.toFixed(1)} of 5 from ${ratingCount} ratings`}>
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
            {rating.toFixed(1)}
          </span>
        ) : null}
      </div>

      {/* Inset square photo with the shared verified badge */}
      <div className="mt-2 px-3 sm:mt-3 sm:px-4">
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
          {photo ? (
            <Image
              src={photo}
              alt={companyName}
              fill
              sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.08]"
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(2,102,94,0.18),transparent_55%),linear-gradient(135deg,#f8fafc,#e2e8f0)]">
              <Building2 className="h-10 w-10 text-slate-400" aria-hidden />
            </div>
          )}
          <VerifiedIcon />
          {packageCount > 1 ? (
            <span className="absolute bottom-2.5 left-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-slate-800 shadow-sm">
              {packageCount} tours
            </span>
          ) : null}
        </div>
      </div>

      {/* Where + price, then the one action */}
      <div className="mt-2 flex flex-1 flex-col px-3 pb-3 sm:mt-3 sm:px-4 sm:pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              <span className="truncate">{where}</span>
            </div>
            {leadDays ? (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <Clock3 className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                <span className="truncate">{packageCount > 1 ? `From ${leadDays}` : leadDays}</span>
              </div>
            ) : null}
          </div>
          <div className="flex-shrink-0 sm:text-right">
            {cheapest ? (
              <>
                <div className="text-sm font-bold text-slate-900">
                  {packageCount > 1 ? <span className="mr-1 text-[11px] font-semibold text-slate-500">from</span> : null}
                  {cheapest.currency} {Math.round(cheapest.price).toLocaleString("en-US")}
                </div>
                <div className="text-[11px] text-slate-500">per person</div>
              </>
            ) : (
              <div className="text-xs font-semibold text-slate-600">Price on request</div>
            )}
          </div>
        </div>

        <div className="mt-auto pt-3">
          <span
            className={`inline-flex w-full items-center justify-center rounded-xl py-2 text-xs font-semibold transition-colors sm:py-2.5 sm:text-sm ${
              href ? "bg-[#02665e] text-white group-hover:bg-[#014e47]" : "bg-slate-100 text-slate-400"
            }`}
          >
            {href ? (packageCount > 1 ? "View tours" : "View tour") : "Not available"}
          </span>
        </div>
      </div>
    </motion.div>
  );

  return href ? (
    <Link
      href={href}
      className="group block h-full text-slate-900 no-underline"
      aria-label={`View tours by ${companyName}${cheapest ? `, from ${cheapest.currency} ${Math.round(cheapest.price).toLocaleString("en-US")} per person` : ""}`}
    >
      {card}
    </Link>
  ) : (
    <div className="h-full">{card}</div>
  );
}
