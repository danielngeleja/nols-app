"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin, ImageIcon, Star } from "lucide-react";
import { motion } from "framer-motion";

import VerifiedIcon from "./VerifiedIcon";
import { getPropertyCommission, calculatePriceWithCommission } from "../lib/priceUtils";
import { PriceDisplay } from "./PriceDisplay";
import { formatMoney } from "../lib/money";
import { propertyDetailHref } from "../lib/propertyNavigation";
import { eventVenueDetailHref } from "../lib/publicEventVenue";

export type PublicApprovedPropertyCardData = {
  id?: number;
  slug: string;
  title: string;
  location: string;
  primaryImage: string | null;
  basePrice: number | null;
  currency: string | null;
  rentalMode?: "NIGHTLY" | "LONG_STAY";
  longStay?: { monthlyRent: number; currency: string; inspected: boolean } | null;
  services?: any;
  /** Guest rating from visible reviews; null or missing when there are none. */
  rating?: { average: number; count: number } | null;
};

function PropertyCardImage({
  src,
  alt,
  priorityImage,
  unoptimized = false,
}: {
  src: string;
  alt: string;
  priorityImage: boolean;
  unoptimized?: boolean;
}) {
  if (/^data:image\//i.test(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.08]" loading={priorityImage ? "eager" : "lazy"} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
      className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.08]"
      loading={priorityImage ? "eager" : "lazy"}
      priority={priorityImage}
      unoptimized={unoptimized || src.includes("cloudinary")}
    />
  );
}

export default function PublicApprovedPropertyCard({
  p,
  systemCommission = 0,
  priorityImage = false,
  resultsHref,
  eventVenue,
}: {
  p: PublicApprovedPropertyCardData;
  systemCommission?: number;
  priorityImage?: boolean;
  resultsHref?: string;
  eventVenue?: {
    fromPrice: number | null;
    space: string | undefined;
    capacity: number;
  };
}) {
  const href = eventVenue
    ? eventVenueDetailHref(p.slug, resultsHref)
    : propertyDetailHref(p.slug, resultsHref);
  const rating = p.rating && p.rating.count > 0 && p.rating.average > 0 ? p.rating : null;
  const isLongStay = p.rentalMode === "LONG_STAY";

  // Calculate final price with commission (TZS — money of record).
  const finalPrice = !eventVenue && !isLongStay && p.basePrice
    ? calculatePriceWithCommission(p.basePrice, getPropertyCommission(p, systemCommission))
    : null;

  const PhotoPlaceholder = () => (
    <div className="absolute inset-0">
      {/* Soft “photo-like” background so you can preview layout before Cloudinary */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(2,102,94,0.18),transparent_55%),radial-gradient(circle_at_75%_85%,rgba(2,132,199,0.12),transparent_55%),linear-gradient(135deg,#f8fafc,#e2e8f0)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/0 via-black/0 to-white/35" />
      <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700">
        <div className="h-12 w-12 rounded-2xl bg-white/85 border border-slate-200 shadow-sm flex items-center justify-center">
          <ImageIcon className="w-6 h-6 text-slate-500" aria-hidden />
        </div>
        <div className="mt-2 text-sm font-semibold">Photo preview</div>
        <div className="text-xs text-slate-500">Approved photos will appear here</div>
      </div>
    </div>
  );

  return (
    <Link href={href} className="group no-underline text-slate-900 block" aria-label={`View ${p.title}`}>
      <motion.div
        className="rounded-2xl border border-slate-200 bg-white shadow-sm"
        whileHover={{ y: -5, boxShadow: "0 16px 40px rgba(2,6,23,0.13)" }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {/* Title at top */}
        <div className="px-3 pt-3 sm:px-4 sm:pt-4">
          <div className="text-sm sm:text-base font-bold text-slate-900 truncate">{p.title}</div>
        </div>

        {/* Image with padding and rounded corners */}
        <div className="px-3 mt-2 sm:px-4 sm:mt-3">
          <div className="relative aspect-square bg-slate-100 rounded-2xl overflow-hidden">
            {p.primaryImage ? (
              <PropertyCardImage src={p.primaryImage} alt={p.title} priorityImage={priorityImage} unoptimized={Boolean(eventVenue)} />
            ) : (
              <PhotoPlaceholder />
            )}

            {isLongStay || eventVenue?.space ? (
              <span className="absolute left-2 top-2 rounded-md bg-[#064d46] px-2 py-1 text-[11px] font-semibold text-white sm:left-3 sm:top-3">
                {eventVenue?.space ?? "Long stay"}
              </span>
            ) : null}
            {!isLongStay || p.longStay?.inspected ? <VerifiedIcon /> : null}
          </div>
        </div>

        {/* Location, price and action button */}
        <div className="px-3 pb-3 sm:px-4 sm:pb-4 mt-2 sm:mt-3">
          {/* Location and rating on the left, listed rate on the right. */}
          <div className="flex items-start justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{p.location || "Tanzania"}</span>
              </div>
              {rating ? (
                <div
                  className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"
                  aria-label={`Rated ${rating.average.toFixed(1)} out of 5 from ${rating.count} ${rating.count === 1 ? "review" : "reviews"}`}
                >
                  <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" aria-hidden />
                  <span className="font-bold text-slate-900">{rating.average.toFixed(1)}</span>
                  <span>({rating.count})</span>
                </div>
              ) : null}
              {!!eventVenue?.capacity && (
                <p className="m-0 mt-1 truncate text-[11px] text-slate-500">{eventVenue.capacity} guests</p>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              {eventVenue ? (
                <span className="text-sm font-bold text-slate-900">
                  {eventVenue.fromPrice === null ? "On request" : formatMoney(eventVenue.fromPrice, "TZS")}
                </span>
              ) : isLongStay ? (
                <span className="text-sm font-bold text-[#07574f]">
                  {p.longStay ? formatMoney(p.longStay.monthlyRent, p.longStay.currency) : "–"}
                </span>
              ) : (
                <PriceDisplay amountTzs={finalPrice} className="text-sm font-bold text-slate-900" showNote={false} />
              )}
              {(!eventVenue || eventVenue.fromPrice !== null) && <div className={`text-[11px] ${isLongStay ? "text-[#49746b]" : "text-slate-500"}`}>{eventVenue ? "starting price" : isLongStay ? "per month" : "per night"}</div>}
            </div>
          </div>

          <div className="mt-3">
            <span className="inline-flex items-center justify-center w-full rounded-xl bg-[#02665e] text-white py-2 sm:py-2.5 text-xs sm:text-sm font-semibold transition-colors group-hover:bg-[#014e47]">
              {eventVenue ? "View venue" : "View details"}
            </span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
