"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin, ImageIcon, Star } from "lucide-react";
import { motion } from "framer-motion";

import VerifiedIcon from "./VerifiedIcon";
import { getPropertyCommission, calculatePriceWithCommission } from "../lib/priceUtils";
import { PriceDisplay } from "./PriceDisplay";

export type PublicApprovedPropertyCardData = {
  id?: number;
  slug: string;
  title: string;
  location: string;
  primaryImage: string | null;
  basePrice: number | null;
  currency: string | null;
  services?: any;
  /** Guest rating from visible reviews; null or missing when there are none. */
  rating?: { average: number; count: number } | null;
};

function PropertyCardImage({
  src,
  alt,
  priorityImage,
}: {
  src: string;
  alt: string;
  priorityImage: boolean;
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
      unoptimized={src.includes("cloudinary")}
    />
  );
}

export default function PublicApprovedPropertyCard({
  p,
  systemCommission = 0,
  priorityImage = false,
}: {
  p: PublicApprovedPropertyCardData;
  systemCommission?: number;
  priorityImage?: boolean;
}) {
  const href = `/public/properties/${p.slug}`;
  const rating = p.rating && p.rating.count > 0 && p.rating.average > 0 ? p.rating : null;

  // Calculate final price with commission (TZS — money of record).
  const finalPrice = p.basePrice
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
              <PropertyCardImage src={p.primaryImage} alt={p.title} priorityImage={priorityImage} />
            ) : (
              <PhotoPlaceholder />
            )}

            {/* Verification badge — top-right */}
            <VerifiedIcon />
          </div>
        </div>

        {/* Location, price and action button */}
        <div className="px-3 pb-3 sm:px-4 sm:pb-4 mt-2 sm:mt-3">
          {/* One row at every width: location and rating on the left, price and "per night" on the right. */}
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
            </div>
            <div className="text-right flex-shrink-0">
              <PriceDisplay
                amountTzs={finalPrice}
                className="text-sm font-bold text-slate-900"
                showNote={false}
              />
              <div className="text-[11px] text-slate-500">per night</div>
            </div>
          </div>

          <div className="mt-3">
            <span className="inline-flex items-center justify-center w-full rounded-xl bg-[#02665e] text-white py-2 sm:py-2.5 text-xs sm:text-sm font-semibold transition-colors group-hover:bg-[#014e47]">
              View details
            </span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
