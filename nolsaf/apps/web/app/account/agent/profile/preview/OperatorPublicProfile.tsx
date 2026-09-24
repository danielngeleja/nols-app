"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Compass,
  Camera,
  HeartPulse,
  Languages,
  Radio,
  SatelliteDish,
  UserCheck,
  Wifi,
  Palmtree,
  Trees,
  Flag,
  Moon,
  Route,
  Sun,
  Sunrise,
  Award,
  Plus,
  PawPrint,
  Plane,
  Tent,
  Waves,
  CreditCard,
  Eye,
  FileText,
  Image as ImageIcon,
  Landmark,
  LayoutGrid,
  Lock,
  MapPin,
  Mountain,
  Package,
  PlusCircle,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  Utensils,
  Wrench,
  X,
} from "lucide-react";
import "@/styles/photo-tour.css";

// ── Types: the slice of the operator profile this view reads ──────────────

type ItineraryEvent = { id: string; startTime: string; endTime: string; activity: string; difficulty: string };
type ItineraryDay = { id: string; day: number; title: string; description: string; events: ItineraryEvent[] };
export type PublicPackage = {
  id: string;
  name: string;
  description: string;
  destination: string;
  category: string;
  duration: string;
  minPax: string;
  maxPax: string;
  pricePerPerson: string;
  currency: string;
  discountFactor: string;
  discountType: string;
  discountValue: string;
  discountCondition: string;
  discountUnit: string;
  mode: string;
  accommodation: string;
  mealPlan: string;
  difficulty: string;
  meetingPoint: string;
  included: string[];
  excluded: string[];
  itinerary: ItineraryDay[];
  notes: string;
};
export type PublicOperatorProfileData = {
  companyName: string;
  description: string;
  physicalLocation: string;
  yearsInOperation?: number;
  teamSize?: number;
  languages?: string;
  operatingRegions: string[];
  registeredParks: string[];
  contactPhone: string;
  contactEmail: string;
  tourismTypes: string[];
  tools: string[];
  vehicles: Array<{ id: string; type: string; quantity: string; seatsPerVehicle: string; serviceMode: string; ownedBy: string }>;
  services: string[];
  serviceClassification?: Record<string, string[]>;
  specializations: string[];
  addOns: string[];
  packageItems: PublicPackage[];
  seasonalPrices: Array<{ id: string; seasonName: string; startMonth: string; endMonth: string; notes: string }>;
  maxTripsPerDay: string;
  minimumBookingNotice: string;
  guidesAvailable: string;
  peakSeasonAvailability: string;
  gallery: string[];
  classifiedPhotos: Record<string, string[]>;
  tripConfidence?: { averageRating?: number; totalRatings?: number };
};

const BRAND = "#02665e";
const TILE_MOTION =
  "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

/** "ARUSHA / MONDULI" and "arusha" both read as "Arusha". */
function tidyPlace(value: string): string {
  return String(value || "")
    .split(/\s*\/\s*/)[0]
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ratingWord(value: number): string {
  if (value >= 4.5) return "Excellent";
  if (value >= 4) return "Very good";
  if (value >= 3.5) return "Good";
  if (value >= 3) return "Fair";
  return "Rated";
}

function durationText(value: string): string {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^\d+$/.test(v)) return `${v} day${v === "1" ? "" : "s"}`;
  // "4 Days" and "4 days" read the same everywhere
  return v.replace(/^(\d+)\s*(day|night|hour|week)s?$/i, (_, n: string, unit: string) => `${n} ${unit.toLowerCase()}${n === "1" ? "" : "s"}`);
}

function groupText(pkg: PublicPackage): string {
  if (pkg.minPax && pkg.maxPax) return `${pkg.minPax} to ${pkg.maxPax} people`;
  if (pkg.minPax) return `From ${pkg.minPax} people`;
  if (pkg.maxPax) return `Up to ${pkg.maxPax} people`;
  return "";
}

function discountText(pkg: PublicPackage): string | null {
  if (!pkg.discountFactor || !pkg.discountType || !pkg.discountValue) return null;
  const amount = pkg.discountType === "Fixed amount" ? `${pkg.currency} ${pkg.discountValue} off` : `${pkg.discountValue}% off`;
  const condition = String(pkg.discountCondition || "").trim();
  const unit = String(pkg.discountUnit || "").trim();
  if (!condition) return amount;
  if (!/^\d+$/.test(condition)) return `${amount} ${condition}`;
  if (unit === "Travelers" || pkg.discountFactor === "Large group size") return `${amount} for ${condition}+ travellers`;
  if (unit === "Days before travel" || pkg.discountFactor === "Early booking") return `${amount} booked ${condition}+ days ahead`;
  if (unit === "Completed previous bookings" || pkg.discountFactor === "Returning customer") return `${amount} after ${condition} trips`;
  return `${amount} for ${condition}+ ${unit.toLowerCase()}`;
}

/** Section card in the stay page's language: header band with icon, eyebrow and title. */
function SectionCard({ icon, eyebrow, title, children, action }: { icon: ReactNode; eyebrow: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-0 border-b border-solid border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white text-[#02665e] shadow-sm ring-1 ring-[#02665e]/10">{icon}</span>
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-[0.08em] text-[#02665e]">{eyebrow}</div>
            <h2 className="m-0 mt-1 text-lg font-semibold text-slate-950">{title}</h2>
          </div>
        </div>
        {action}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

/**
 * Customer-facing operator profile, built as a sibling of the stay detail
 * page (public/properties/[slug]): header card with verification seal,
 * gallery, key facts, meaning-first section cards, a booking card in the side
 * column (and a booking bar on phones), and full-width tour cards laid out
 * like room cards: spec strip, highlights, price column with the action.
 */
export default function OperatorPublicProfile({
  profile: p,
  logoUrl,
  verified,
  verification,
  bookingKey,
  displayPrice,
  previewOnly = false,
}: {
  profile: PublicOperatorProfileData;
  logoUrl: string | null;
  verified: boolean;
  verification: { certificateId: string; approvedAt: string | null; verificationUrl: string | null } | null;
  bookingKey: string | null;
  displayPrice: (raw: unknown) => number;
  previewOnly?: boolean;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Photo tour sections, in the order a traveller cares about: where they go,
  // what they ride in, who guides them. Each photo belongs to its first section.
  const { photos, photoSections } = useMemo(() => {
    const c = p.classifiedPhotos || {};
    const groups: Array<{ key: string; label: string; urls: string[] }> = [
      { key: "attractions", label: "Trips and places", urls: c.attractions || [] },
      { key: "gallery", label: "Highlights", urls: p.gallery || [] },
      { key: "vehicles", label: "Vehicles", urls: c.vehicles || [] },
      { key: "team", label: "The team", urls: c.team || [] },
      { key: "office", label: "Office", urls: c.office || [] },
      { key: "proof", label: "Permits and awards", urls: c.proof || [] },
    ];
    const all: string[] = [];
    const sections: Array<{ key: string; label: string; idxs: number[] }> = [];
    for (const group of groups) {
      const idxs: number[] = [];
      for (const url of group.urls) {
        if (!url || all.includes(url)) continue;
        idxs.push(all.length);
        all.push(url);
      }
      if (idxs.length) sections.push({ key: group.key, label: group.label, idxs });
    }
    return { photos: all, photoSections: sections };
  }, [p]);
  const hasMorePhotos = photos.length > 3;

  const [allPhotosOpen, setAllPhotosOpen] = useState(false);
  const [allPhotosShown, setAllPhotosShown] = useState(false);
  const [activeTourKey, setActiveTourKey] = useState<string>("attractions");
  const openAllPhotos = () => {
    setAllPhotosOpen(true);
    requestAnimationFrame(() => setAllPhotosShown(true));
  };
  const closeAllPhotos = () => {
    setAllPhotosShown(false);
    window.setTimeout(() => setAllPhotosOpen(false), 180);
  };
  const openFromGrid = (idx: number) => {
    setAllPhotosShown(false);
    setAllPhotosOpen(false);
    requestAnimationFrame(() => setLightbox(idx));
  };
  const scrollToPhotoSection = (key: string) => {
    setActiveTourKey(key);
    document.getElementById(`photo-tour-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useEffect(() => {
    if (!allPhotosOpen && lightbox == null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightbox != null) setLightbox(null);
        if (allPhotosOpen) closeAllPhotos();
      }
      if (lightbox != null && photos.length > 1) {
        if (e.key === "ArrowRight") setLightbox((i) => (i == null ? i : i >= photos.length - 1 ? 0 : i + 1));
        if (e.key === "ArrowLeft") setLightbox((i) => (i == null ? i : i <= 0 ? photos.length - 1 : i - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [allPhotosOpen, lightbox, photos.length]);
  // Keep the active thumbnail centred in the filmstrip
  useEffect(() => {
    if (lightbox == null) return;
    document.getElementById(`op-lb-thumb-${lightbox}`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [lightbox]);
  // Highlight the section being viewed in the index as the tour scrolls
  useEffect(() => {
    if (!allPhotosOpen) return;
    const root = document.getElementById("photo-tour-scroll");
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const key = visible[0]?.target.getAttribute("data-tour-key");
        if (key) setActiveTourKey(key);
      },
      { root, rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    root.querySelectorAll("[data-tour-key]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [allPhotosOpen, photoSections]);

  const tours = p.packageItems || [];
  const priced = tours
    .map((pkg, index) => ({ pkg, index, price: displayPrice(pkg.pricePerPerson), currency: String(pkg.currency || "USD").toUpperCase() }))
    .filter((row) => Number.isFinite(row.price) && row.price > 0);
  const cheapest = priced.reduce<(typeof priced)[number] | null>((low, row) => (!low || row.price < low.price ? row : low), null);
  const money = (value: number, currency: string) => `${currency} ${Math.round(value).toLocaleString("en-US")}`;
  const bookHref = (pkg: PublicPackage, index: number) =>
    bookingKey ? `/public/booking/tour-confirm?agentKey=${encodeURIComponent(bookingKey)}&packageId=${encodeURIComponent(String(pkg.id ?? index))}` : null;
  const singleBookHref = tours.length === 1 ? bookHref(tours[0], 0) : null;

  const rating = Number(p.tripConfidence?.averageRating || 0);
  const ratingCount = Number(p.tripConfidence?.totalRatings || 0);
  const regions = Array.from(new Set((p.operatingRegions || []).map(tidyPlace).filter(Boolean)));
  const location = regions.slice(0, 3).join(", ") || tidyPlace(p.physicalLocation || "");
  const sites = (p.registeredParks?.length ? p.registeredParks : p.operatingRegions) || [];
  const serviceGroups = Object.entries(p.serviceClassification || {}).filter(([, list]) => list.length > 0);
  const grouped = new Set(serviceGroups.flatMap(([, list]) => list));
  const otherServices = (p.services || []).filter((s) => !grouped.has(s));
  const hasOffer = serviceGroups.length > 0 || otherServices.length > 0 || (p.specializations?.length ?? 0) > 0 || (p.addOns?.length ?? 0) > 0;
  const hasPlanning = Boolean(p.maxTripsPerDay || p.minimumBookingNotice || p.guidesAvailable || p.peakSeasonAvailability) || (p.seasonalPrices?.length ?? 0) > 0;
  const aboutLong = String(p.description || "").length > 360;

  const fleet = {
    units: (p.vehicles || []).reduce((sum, v) => sum + (Number(v.quantity) || 1), 0),
    seats: (p.vehicles || []).reduce((sum, v) => sum + (Number(v.quantity) || 1) * (Number(v.seatsPerVehicle) || 0), 0),
  };
  const thisMonth = new Date().getMonth();
  const seasons = (p.seasonalPrices || [])
    .map((s) => {
      const start = monthIndex(s.startMonth);
      const end = monthIndex(s.endMonth);
      if (start == null || end == null) return null;
      const months: number[] = [];
      for (let m = start; ; m = (m + 1) % 12) {
        months.push(m);
        if (m === end || months.length >= 12) break;
      }
      const lower = String(s.seasonName || "").toLowerCase();
      const hex = /high|peak/.test(lower) ? "#f59e0b" : /mid|shoulder/.test(lower) ? "#38bdf8" : /low|green|rain/.test(lower) ? "#10b981" : "#02665e";
      return { id: s.id, name: s.seasonName || "Season", range: `${MONTHS[start]} to ${MONTHS[end]}`, months, hex, notes: s.notes };
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const languages = String(p.languages || "")
    .split(/\s*(?:,|\/|&|\band\b)\s*/i)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.charAt(0).toUpperCase() + l.slice(1));
  const keyFacts = [
    typeof p.yearsInOperation === "number" ? { Icon: CalendarClock, value: `${p.yearsInOperation}+`, label: "years operating", hex: "#02665e" } : null,
    typeof p.teamSize === "number" ? { Icon: Users, value: String(p.teamSize), label: p.teamSize === 1 ? "team member" : "team members", hex: "#02665e" } : null,
    languages.length ? { Icon: Languages, value: String(languages.length), label: languages.length === 1 ? "language" : "languages", hex: "#02665e" } : null,
    tours.length ? { Icon: Package, value: String(tours.length), label: tours.length === 1 ? "tour" : "tours", hex: "#02665e" } : null,
    p.vehicles?.length ? { Icon: Car, value: String(fleet.units), label: fleet.units === 1 ? "vehicle" : "vehicles", hex: "#02665e" } : null,
  ].filter((f): f is { Icon: typeof Users; value: string; label: string; hex: string } => Boolean(f));

  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: p.companyName, text: `Tours by ${p.companyName} on NoLSAF`, url });
        return;
      }
      await navigator.clipboard?.writeText(url);
      setShareNote("Link copied");
      window.setTimeout(() => setShareNote(null), 2000);
    } catch {}
  };

  const scrollToTours = () => document.getElementById("toursSection")?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Tour chooser: one selected tour, a traveller count inside its group limits,
  // and an estimated total. Starts on the lowest-priced tour.
  const [pickedTour, setPickedTour] = useState<number | null>(null);
  const [travellers, setTravellers] = useState(1);
  const [detailsFor, setDetailsFor] = useState<number | null>(null);
  const selectedIdx = pickedTour ?? cheapest?.index ?? 0;
  const selected = tours[selectedIdx] || null;
  const selMin = Math.max(1, Number(selected?.minPax) || 1);
  const selMax = Math.max(selMin, Number(selected?.maxPax) || 20);
  const selTravellers = Math.min(selMax, Math.max(selMin, travellers));
  const selPrice = selected ? displayPrice(selected.pricePerPerson) : NaN;
  const selCurrency = String(selected?.currency || "USD").toUpperCase();
  const selHasPrice = Number.isFinite(selPrice) && selPrice > 0;
  const selHref = selected ? bookHref(selected, selectedIdx) : null;
  const pickTour = (index: number) => {
    setPickedTour(index);
    setTravellers(Math.max(1, Number(tours[index]?.minPax) || 1));
  };
  useEffect(() => {
    if (detailsFor == null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetailsFor(null);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [detailsFor]);

  return (
    <div id="operator-public-profile">
      <style>{"#operator-public-profile, #operator-public-profile * { box-sizing: border-box; }"}</style>

      {/* ── Header card ── */}
      <div className="relative overflow-hidden rounded-2xl border border-solid border-slate-100 bg-white shadow-[0_4px_24px_rgba(2,102,94,0.10)] sm:rounded-3xl">
        <div className="relative px-5 pb-6 pt-5 sm:px-8 sm:pb-7 sm:pt-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <Link
              href="/public/tour-packages"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold no-underline"
              style={{ color: BRAND, background: "rgba(2,102,94,0.07)", border: "1px solid rgba(2,102,94,0.15)" }}
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-180" aria-hidden />
              All tours
            </Link>
            <div className="flex items-center gap-2">
              {shareNote ? <span className="text-[12px] font-semibold text-[#02665e]">{shareNote}</span> : null}
              <button
                type="button"
                onClick={share}
                aria-label="Share this operator"
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full"
                style={{ background: "rgba(2,102,94,0.07)", border: "1px solid rgba(2,102,94,0.15)", color: BRAND }}
              >
                <Share2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
            {/* Identity: logo, what they are, who they are, the three things a traveller checks first */}
            <div className="flex min-w-0 items-start gap-4 sm:gap-5">
              {logoUrl ? (
                <span className="relative mt-1 h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-white shadow-[0_6px_18px_-10px_rgba(2,40,36,0.45)] ring-1 ring-slate-200 sm:h-[76px] sm:w-[76px]">
                  <Image src={logoUrl} alt={`${p.companyName} logo`} fill sizes="76px" className="object-contain p-1.5" unoptimized />
                </span>
              ) : null}
              <div className="min-w-0">
                <p className="m-0 mb-1.5 text-[10px] font-bold uppercase tracking-[0.20em] sm:text-xs" style={{ color: BRAND }}>
                  Tour operator
                  {typeof p.yearsInOperation === "number" && p.yearsInOperation > 0 ? (
                    <span className="font-semibold text-slate-400"> · {p.yearsInOperation}+ years</span>
                  ) : null}
                </p>
                <h1 className="m-0 break-words text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-4xl lg:text-[2.75rem]">{p.companyName || "Tour operator"}</h1>
                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                  {ratingCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[13px] text-amber-900 ring-1 ring-inset ring-amber-200/70">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                      <span className="font-bold tabular-nums">{rating.toFixed(1)}</span>
                      <span className="font-semibold">{ratingWord(rating)}</span>
                      <span className="text-amber-800/70">· {ratingCount} rating{ratingCount === 1 ? "" : "s"}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02665e]/[0.07] px-2.5 py-1 text-[13px] font-semibold text-[#02665e]">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden /> New on NoLSAF
                    </span>
                  )}
                  {location ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[13px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                      <span className="truncate">{location}</span>
                    </span>
                  ) : null}
                  {tours.length ? (
                    <button
                      type="button"
                      onClick={scrollToTours}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-slate-50 px-2.5 py-1 text-[13px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-[#02665e]/[0.07] hover:text-[#02665e]"
                    >
                      <Package className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                      {tours.length} tour{tours.length === 1 ? "" : "s"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Verification: one clear statement, the certificate as proof */}
            {verified ? (
              <div className="w-full flex-none overflow-hidden rounded-2xl border border-solid border-[#02665e]/15 bg-white shadow-[0_10px_28px_-18px_rgba(2,40,36,0.45)] sm:w-auto lg:w-[320px]">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <span className="relative flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#02665e] text-white">
                    <ShieldCheck className="h-5 w-5" aria-hidden />
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 ring-2 ring-white">
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} aria-hidden />
                    </span>
                  </span>
                  <div className="min-w-0 leading-tight">
                    <p className="m-0 text-[14px] font-bold text-slate-900">Verified by NoLSAF</p>
                    <p className="m-0 mt-0.5 text-[12px] text-slate-500">Company and profile checked before listing</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-[#02665e]/10 bg-[#02665e]/[0.04] px-4 py-2">
                  <span className="min-w-0 truncate text-[11.5px] text-slate-500">
                    {verification?.certificateId ? (
                      <>Certificate <span className="font-semibold tabular-nums text-slate-700">{verification.certificateId}</span></>
                    ) : (
                      "Active NoLSAF partner"
                    )}
                  </span>
                  {verification?.verificationUrl ? (
                    <a href={verification.verificationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex flex-shrink-0 items-center gap-0.5 text-[12px] font-semibold text-[#02665e] no-underline hover:underline">
                      View <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : (
                    <Link href="/verification-policy" className="inline-flex flex-shrink-0 items-center gap-0.5 text-[12px] font-semibold text-[#02665e] no-underline hover:underline">
                      How we verify <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Gallery: one large, two stacked ── */}
      {photos.length ? (
        <div className="mt-6 grid grid-cols-1 gap-3 overflow-hidden rounded-2xl border border-solid border-slate-200 md:grid-cols-3">
          <button type="button" onClick={() => setLightbox(0)} aria-label="Open photo gallery" className={`relative aspect-[16/10] cursor-pointer overflow-hidden rounded-2xl border-0 bg-slate-100 p-0 md:col-span-2 ${TILE_MOTION}`}>
            <Image src={photos[0]} alt={`${p.companyName} photo 1`} fill sizes="(min-width: 768px) 66vw, 100vw" className="object-cover" unoptimized priority />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0" />
          </button>
          <div className="grid grid-cols-2 gap-3 bg-white p-3 md:grid-cols-1">
            {[1, 2].map((i) => {
              const opensTour = i === 2 && hasMorePhotos;
              return photos[i] ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => (opensTour ? openAllPhotos() : setLightbox(i))}
                  aria-label={opensTour ? "View all photos" : `Open photo ${i + 1}`}
                  className={`relative aspect-[16/10] cursor-pointer overflow-hidden rounded-xl border-0 bg-slate-100 p-0 ${TILE_MOTION}`}
                >
                  <Image src={photos[i]} alt={`${p.companyName} photo ${i + 1}`} fill sizes="(min-width: 768px) 22vw, 50vw" className="object-cover" unoptimized priority />
                  {opensTour ? (
                    <div className="absolute bottom-3 right-3">
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1.5 shadow-sm ring-1 ring-white/10 backdrop-blur-sm">
                        <Eye className="h-3.5 w-3.5 flex-shrink-0 text-white/90" aria-hidden />
                        <span className="text-[11px] font-semibold leading-none text-white tabular-nums">{photos.length}</span>
                      </div>
                    </div>
                  ) : null}
                </button>
              ) : (
                <div key={i} className="relative aspect-[16/10] overflow-hidden rounded-xl bg-slate-100">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(2,102,94,0.10),transparent_55%),linear-gradient(135deg,#f8fafc,#e2e8f0)]" />
                  <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <ImageIcon className="h-6 w-6 text-slate-400" aria-hidden />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Main ── */}
        <div className="space-y-6 lg:col-span-2">
          {keyFacts.length ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-2xl border border-solid border-slate-200 bg-white px-5 py-3.5">
              {keyFacts.map(({ Icon, value, label }) => (
                <span key={`fact-${label}`} className="inline-flex items-center gap-2 text-[14px] text-slate-700">
                  <Icon className="h-[18px] w-[18px] flex-none text-[#02665e]" strokeWidth={1.8} aria-hidden />
                  <span><span className="font-semibold text-slate-900">{value}</span> {label}</span>
                </span>
              ))}
            </div>
          ) : null}

          {p.description ? (
            <SectionCard
              icon={<FileText className="h-5 w-5" aria-hidden />}
              eyebrow="Operator overview"
              title={`About ${p.companyName || "this operator"}`}
              action={aboutLong ? (
                <button type="button" onClick={() => setAboutOpen((v) => !v)} aria-label={aboutOpen ? "Show less" : "Read more"} className="inline-flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50">
                  {aboutOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                </button>
              ) : undefined}
            >
              <p className={`m-0 whitespace-pre-wrap text-[15px] leading-7 text-slate-700 ${aboutOpen || !aboutLong ? "" : "line-clamp-4"}`}>{p.description}</p>
              {aboutLong && !aboutOpen ? (
                <button type="button" onClick={() => setAboutOpen(true)} className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-[#02665e] hover:underline">Read more</button>
              ) : null}

              {/* Who you travel with: the languages they guide in and the kinds of trips they run */}
              {languages.length || p.tourismTypes?.length ? (
                <dl className="m-0 mt-4 grid grid-cols-1 gap-3 border-0 border-t border-solid border-slate-100 pt-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-x-4">
                  {languages.length ? (
                    <>
                      <dt className="pt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Speaks</dt>
                      <dd className="m-0 flex flex-wrap gap-1.5">
                        {languages.map((lang) => (
                          <span key={lang} className="inline-flex items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 pr-2.5 text-[12.5px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-rose-50 text-[9.5px] font-black uppercase tracking-wide text-rose-700">{lang.slice(0, 2)}</span>
                            {lang}
                          </span>
                        ))}
                      </dd>
                    </>
                  ) : null}
                  {p.tourismTypes?.length ? (
                    <>
                      <dt className="pt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Tour styles</dt>
                      <dd className="m-0 flex flex-wrap gap-1.5">
                        {p.tourismTypes.map((t) => {
                          const { Icon, hex } = experienceLook(t);
                          return (
                            <span key={t} className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-[12.5px] font-semibold" style={{ backgroundColor: `${hex}12`, color: hex }}>
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ backgroundColor: hex }}>
                                <Icon className="h-3.5 w-3.5" aria-hidden />
                              </span>
                              {t}
                            </span>
                          );
                        })}
                      </dd>
                    </>
                  ) : null}
                </dl>
              ) : null}
            </SectionCard>
          ) : null}

          {hasOffer ? (
            <SectionCard icon={<Sparkles className="h-5 w-5" aria-hidden />} eyebrow="Included in their service" title="What this operator offers">
              <OfferOverview
                groups={[...serviceGroups, ...(otherServices.length ? [["Other services", otherServices] as [string, string[]]] : [])]}
                specialities={p.specializations || []}
                extras={p.addOns || []}
              />
            </SectionCard>
          ) : null}

          {sites.length ? (
            <SectionCard icon={<Mountain className="h-5 w-5" aria-hidden />} eyebrow="Where they guide" title="Parks and places covered">
              {/* Each place as a typed stop: what kind of place it is, at a glance */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {sites.map((site, i) => {
                  const { Icon, kind, hex } = placeLook(site);
                  return (
                    <div key={site} className="flex min-w-0 items-center gap-3 rounded-xl border border-solid border-slate-200 bg-white px-3 py-2.5 transition-colors hover:border-slate-300">
                      <span className="relative inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${hex}14`, color: hex }}>
                        <Icon className="h-5 w-5" aria-hidden />
                        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9.5px] font-bold tabular-nums text-slate-600 shadow ring-1 ring-slate-200">{i + 1}</span>
                      </span>
                      <div className="min-w-0 leading-tight">
                        <div className="truncate text-[14px] font-semibold text-slate-900" title={site}>{site === site.toUpperCase() ? tidyPlace(site) : site}</div>
                        <div className="mt-0.5 text-[11.5px] font-medium" style={{ color: hex }}>{kind}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          ) : null}

          {p.vehicles?.length || p.tools?.length ? (
            <SectionCard
              icon={<Car className="h-5 w-5" aria-hidden />}
              eyebrow="On the road"
              title="Vehicles and equipment"
              action={fleet.units ? (
                <div className="hidden flex-shrink-0 text-right leading-tight sm:block">
                  <div className="text-[18px] font-black tabular-nums text-slate-900">{fleet.units}</div>
                  <div className="text-[11px] text-slate-500">vehicles{fleet.seats ? ` · ${fleet.seats} seats` : ""}</div>
                </div>
              ) : undefined}
            >
              {p.vehicles?.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {p.vehicles.map((v) => {
                    const seats = Math.max(0, Math.min(14, Number(v.seatsPerVehicle) || 0));
                    const modes = String(v.serviceMode || "").split(/\s*(?:,|\/|\band\b|&)\s*/i).map((m) => m.trim()).filter(Boolean);
                    return (
                      <div key={v.id} className="rounded-2xl border border-solid border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
                        <div className="flex items-start gap-3">
                          <span className="relative inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#02665e] text-white shadow-sm">
                            <Car className="h-6 w-6" aria-hidden />
                            <span className="absolute -bottom-1.5 -right-1.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-black tabular-nums text-[#02665e] shadow ring-1 ring-slate-200">×{v.quantity || 1}</span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[15px] font-bold leading-snug text-slate-900">{v.type || "Tour vehicle"}</div>
                            {modes.length ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {modes.map((m) => (
                                  <span key={m} className="rounded-md bg-[#02665e]/[0.08] px-1.5 py-0.5 text-[11px] font-semibold capitalize text-[#024d47]">{m}</span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {seats ? (
                          <div className="mt-3.5 flex items-center justify-between gap-3 border-0 border-t border-dashed border-slate-200 pt-3">
                            {/* One mark per seat, so capacity is seen, not read */}
                            <div className="flex flex-wrap gap-1" aria-hidden>
                              {Array.from({ length: seats }).map((_, s) => (
                                <span key={s} className="h-3.5 w-3 rounded-t-md rounded-b-sm bg-[#02665e]/70" />
                              ))}
                            </div>
                            <span className="flex-shrink-0 text-[12.5px] font-semibold tabular-nums text-slate-700">{v.seatsPerVehicle} seats each</span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {p.tools?.length ? (
                <div className={p.vehicles?.length ? "mt-5" : ""}>
                  <div className="mb-2.5 flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">On board and on hand</span>
                    <span className="text-[11.5px] tabular-nums text-slate-400">{p.tools.length} items</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {p.tools.map((tool) => {
                      const ToolIcon = toolIcon(tool);
                      return (
                        <div key={tool} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-inset ring-slate-200/80">
                          <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-[#02665e] shadow-sm ring-1 ring-slate-200">
                            <ToolIcon className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0 text-[12.5px] font-medium leading-tight text-slate-700">{tool}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </SectionCard>
          ) : null}

          {hasPlanning ? (
            <SectionCard icon={<CalendarClock className="h-5 w-5" aria-hidden />} eyebrow="Before you book" title="Planning your trip">
              {p.maxTripsPerDay || p.minimumBookingNotice || p.guidesAvailable || p.peakSeasonAvailability ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "Book ahead", value: p.minimumBookingNotice ? (/^\d+$/.test(p.minimumBookingNotice.trim()) ? `${p.minimumBookingNotice.trim()} hours` : p.minimumBookingNotice) : "", Icon: CalendarClock, hint: "before the start" },
                    { label: "Guides", value: p.guidesAvailable ? `${p.guidesAvailable} guide${p.guidesAvailable === "1" ? "" : "s"}` : "", Icon: Users, hint: "on the team" },
                    { label: "Daily capacity", value: p.maxTripsPerDay ? `${p.maxTripsPerDay} tour${p.maxTripsPerDay === "1" ? "" : "s"}` : "", Icon: Route, hint: "run per day" },
                    { label: "Peak season", value: p.peakSeasonAvailability, Icon: Sun, hint: "availability" },
                  ].filter((row) => row.value).map(({ label, value, Icon, hint }) => (
                    <div key={label} className="min-w-0 rounded-xl border border-solid border-slate-200 bg-white px-3 py-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                        <Icon className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                        {label}
                      </div>
                      <div className="mt-1.5 text-[16px] font-bold leading-tight text-slate-900">{value}</div>
                      <div className="text-[11.5px] text-slate-500">{hint}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Seasons on a 12-month ruler: when to go, at a glance */}
              {seasons.length ? (
                <div className="mt-4 rounded-xl border border-solid border-slate-200 bg-white p-3 sm:p-4">
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                    <span />
                    <div className="grid grid-cols-12">
                      {MONTHS.map((m, i) => (
                        <span key={m} className={`text-center text-[10px] font-semibold ${i === thisMonth ? "text-[#02665e]" : "text-slate-400"}`}>
                          <span className="sm:hidden">{m[0]}</span>
                          <span className="hidden sm:inline">{m}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-1.5 space-y-2">
                    {seasons.map((s) => (
                      <div key={s.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                        <div className="min-w-0 leading-tight">
                          <div className="truncate text-[12.5px] font-bold text-slate-900">{s.name}</div>
                          <div className="truncate text-[10.5px] text-slate-500">{s.range}</div>
                        </div>
                        <div className="relative grid h-7 grid-cols-12 overflow-hidden rounded-lg bg-slate-100">
                          {MONTHS.map((m, i) => (
                            <span
                              key={m}
                              className={`border-0 border-solid border-white/70 ${i ? "border-l" : ""}`}
                              style={s.months.includes(i) ? { backgroundColor: s.hex } : undefined}
                            />
                          ))}
                          <span aria-hidden className="absolute inset-y-0 w-0.5 bg-slate-900/70" style={{ left: `calc(${((thisMonth + 0.5) / 12) * 100}% - 1px)` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-slate-900/70" />Now: {MONTHS[thisMonth]}</span>
                    {seasons.find((s) => s.months.includes(thisMonth)) ? (
                      <span className="font-semibold text-slate-700">It is {seasons.filter((s) => s.months.includes(thisMonth)).map((s) => s.name.toLowerCase()).join(" and ")} now</span>
                    ) : null}
                  </div>
                  {seasons.some((s) => s.notes) ? (
                    <ul className="m-0 mt-3 list-none space-y-1 border-0 border-t border-dashed border-slate-200 p-0 pt-2.5">
                      {seasons.filter((s) => s.notes).map((s) => (
                        <li key={s.id} className="flex items-start gap-2 text-[12.5px] text-slate-600">
                          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: s.hex }} />
                          <span><span className="font-semibold text-slate-800">{s.name}: </span>{s.notes}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </SectionCard>
          ) : null}
        </div>

        {/* ── Side: booking card, payments, contact ── */}
        <aside className="h-fit min-w-0 space-y-6">
          {tours.length ? (
            <div id="booking-card" className="scroll-mt-24 rounded-2xl border border-solid border-slate-200 bg-white p-5 shadow-[0_18px_40px_-24px_rgba(2,40,36,0.35)]">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[13px] text-slate-500">From</span>
                <span className="text-[24px] font-bold leading-none tracking-tight text-slate-900">{cheapest ? money(cheapest.price, cheapest.currency) : "On request"}</span>
                {cheapest ? <span className="text-[13px] text-slate-500">/ person</span> : null}
              </div>
              <p className="m-0 mt-1 text-[13px] text-slate-500">
                {tours.length === 1 ? "One tour package" : `${tours.length} tour packages`}
                {cheapest?.pkg.duration ? ` · from ${durationText(cheapest.pkg.duration)}` : ""}
              </p>
              {singleBookHref ? (
                <Link href={singleBookHref} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#02665e] text-[15px] font-semibold text-white no-underline shadow-sm transition-colors hover:bg-[#014e47]">
                  Book this tour
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Link>
              ) : (
                <button type="button" onClick={scrollToTours} className="mt-4 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-[#014e47]">
                  {tours.length > 1 ? "Choose a tour" : "See the tour"}
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              )}
              {previewOnly ? <p className="m-0 mt-2 text-center text-[12px] text-amber-700">Preview: booking opens on your live profile.</p> : null}
              <p className="m-0 mt-3 flex items-center justify-center gap-1.5 text-[12px] text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                Secure payment with NoLSAF-supported methods
              </p>

              {/* Phones and tablets: keep price and the next step one tap away */}
              {mounted
                ? createPortal(
                    <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] z-40 border-0 border-t border-solid border-slate-200 bg-white/95 px-4 py-2.5 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)] backdrop-blur md:bottom-0 lg:hidden">
                      <div className="mx-auto flex max-w-3xl items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="m-0 flex items-baseline gap-1 text-[15px] font-bold text-slate-900">
                            {cheapest ? <><span className="text-[12px] font-normal text-slate-500">From</span> {money(cheapest.price, cheapest.currency)}</> : "Price on request"}
                            {cheapest ? <span className="text-[12px] font-normal text-slate-500">/ person</span> : null}
                          </p>
                          <p className="m-0 truncate text-[12px] text-slate-500">{p.companyName}</p>
                        </div>
                        {singleBookHref ? (
                          <Link href={singleBookHref} className="inline-flex h-11 flex-none items-center gap-1.5 rounded-xl bg-[#02665e] px-4 text-[14px] font-semibold text-white no-underline">Book now</Link>
                        ) : (
                          <button type="button" onClick={scrollToTours} className="inline-flex h-11 flex-none cursor-pointer items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-4 text-[14px] font-semibold text-white">
                            {tours.length > 1 ? "Choose a tour" : "See the tour"}
                          </button>
                        )}
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          ) : null}

          <div className="hidden rounded-2xl border border-solid border-slate-200 bg-white p-5 lg:block">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                <CreditCard className="h-6 w-6" aria-hidden />
              </span>
              <h2 className="m-0 text-2xl font-semibold text-slate-900">Payment Methods</h2>
            </div>
            {/* Same rows as the stay page: method name left, the real brand marks right */}
            <div className="mt-4 grid grid-cols-1 gap-3">
              <PaymentRow label="Mobile money">
                <PaymentLogo src="/assets/M-pesa.png" alt="M-Pesa" />
                <PaymentLogo src="/assets/mix%20by%20yas.png" alt="Tigo Pesa (Yas)" />
                <PaymentLogo src="/assets/airtel_money.png" alt="Airtel Money" />
                <PaymentLogo src="/assets/halopesa.png" alt="HaloPesa" />
              </PaymentRow>
              <PaymentRow label="Card">
                <PaymentLogo src="/assets/visa_card.png" alt="Visa card" />
                <PaymentLogo src="/assets/Mastercard_Logo.png" alt="Mastercard" />
              </PaymentRow>
              <PaymentRow label="Bank transfer">
                <span className="inline-flex items-center justify-center rounded-md bg-white/90 p-1.5 shadow-sm ring-1 ring-black/5">
                  <Building2 className="h-[28px] w-[28px] flex-shrink-0 text-blue-600" aria-hidden />
                </span>
              </PaymentRow>
            </div>
          </div>

          {/* ── Tour chooser: pick one, see what matters, set travellers, book ── */}
          {selected ? (
            <div id="toursSection" className="scroll-mt-24 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_18px_40px_-24px_rgba(2,40,36,0.35)]">
              <div className="flex items-center gap-2 px-5 pt-5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                  <Package className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 leading-tight">
                  <h2 className="m-0 text-lg font-semibold text-slate-900">{tours.length > 1 ? "Choose your tour" : "Your tour"}</h2>
                  {tours.length > 1 ? <p className="m-0 mt-0.5 text-[12px] text-slate-500">{tours.length} options from this operator</p> : null}
                </div>
              </div>

              {/* Options: one decision, compared on duration and price */}
              {tours.length > 1 ? (
                <div role="radiogroup" aria-label="Tour packages" className="mt-4 space-y-2 px-5">
                  {tours.map((pkg, idx) => {
                    const active = idx === selectedIdx;
                    const price = displayPrice(pkg.pricePerPerson);
                    const hasPrice = Number.isFinite(price) && price > 0;
                    const meta = [durationText(pkg.duration), pkg.destination].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={pkg.id || idx}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => pickTour(idx)}
                        className={[
                          "flex w-full cursor-pointer items-center gap-3 rounded-xl border border-solid px-3 py-2.5 text-left transition-colors",
                          active ? "border-[#02665e] bg-[#02665e]/[0.05] ring-1 ring-[#02665e]" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <span className={`flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-2 border-solid ${active ? "border-[#02665e]" : "border-slate-300"}`}>
                          {active ? <span className="h-2 w-2 rounded-full bg-[#02665e]" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-[14px] font-semibold text-slate-900">{pkg.name || `Tour ${idx + 1}`}</span>
                          <span className="mt-1 block truncate text-[12px] text-slate-500">{meta || "Guided tour"}</span>
                        </span>
                        <span className="flex flex-shrink-0 flex-col items-end leading-tight">
                          {cheapest && cheapest.index === idx && priced.length > 1 ? (
                            <span className="mb-1 rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.04em] text-emerald-800">Lowest price</span>
                          ) : null}
                          <span className="text-[14.5px] font-bold tabular-nums text-slate-900">{hasPrice ? money(price, String(pkg.currency || "USD").toUpperCase()) : "On request"}</span>
                          {hasPrice ? <span className="mt-0.5 text-[11px] text-slate-500">per person</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {/* The selected tour at a glance */}
              <div className="mt-4 border-0 border-t border-solid border-slate-100 px-5 pt-4">
                {tours.length === 1 ? (
                  <h3 className="m-0 text-[16px] font-bold text-slate-900">{selected.name || "Tour"}</h3>
                ) : (
                  <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">In this tour</div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    durationText(selected.duration) ? { Icon: Clock3, text: durationText(selected.duration) } : null,
                    groupText(selected) ? { Icon: Users, text: groupText(selected) } : null,
                    selected.mode ? { Icon: Car, text: selected.mode } : null,
                    selected.accommodation ? { Icon: Landmark, text: selected.accommodation } : selected.mealPlan ? { Icon: Utensils, text: selected.mealPlan } : null,
                  ].filter((c): c is { Icon: typeof Clock3; text: string } => Boolean(c)).map(({ Icon, text }) => (
                    <span key={text} className={`inline-flex max-w-full items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-[12.5px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200 ${tours.length === 1 ? "mt-2" : ""}`}>
                      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                      <span className="truncate">{text}</span>
                    </span>
                  ))}
                </div>
                {selected.included?.length ? (
                  <ul className="m-0 mt-3 grid list-none grid-cols-2 gap-x-3 gap-y-2 p-0">
                    {selected.included.slice(0, 4).map((item) => (
                      <li key={item} className="flex min-w-0 items-center gap-2 text-[13px] text-slate-700">
                        <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/10">
                          <Check className="h-2.5 w-2.5 text-[#02665e]" strokeWidth={3.2} aria-hidden />
                        </span>
                        <span className="truncate" title={item}>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDetailsFor(selectedIdx)}
                  className="group mt-3.5 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-solid border-[#02665e]/20 bg-[#02665e]/[0.04] px-3 py-2.5 text-left transition-colors hover:border-[#02665e]/45 hover:bg-[#02665e]/[0.07]"
                >
                  <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#02665e] text-white">
                    <Route className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[13.5px] font-semibold text-slate-900">{selected.itinerary?.length ? "See the day-by-day plan" : "Full tour details"}</span>
                    {selected.itinerary?.length ? (() => {
                      const dayCount = selected.itinerary.length;
                      const perDay = selected.itinerary.map((d) => d.events?.length || 0);
                      const total = perDay.reduce((a, b) => a + b, 0);
                      const peak = Math.max(1, ...perDay);
                      return (
                        <span className="mt-1 flex items-center gap-2">
                          {/* A tiny preview of how full each day is */}
                          <span className="flex h-3.5 items-end gap-[3px]" aria-hidden>
                            {perDay.slice(0, 10).map((count, i) => (
                              <span key={i} className="w-1.5 rounded-sm bg-[#02665e]/60" style={{ height: `${Math.max(25, (count / peak) * 100)}%` }} />
                            ))}
                          </span>
                          <span className="truncate text-[11.5px] text-slate-500">
                            {dayCount} day{dayCount === 1 ? "" : "s"}{total ? ` · ${total} timed activit${total === 1 ? "y" : "ies"}` : ""}
                          </span>
                        </span>
                      );
                    })() : (
                      <span className="mt-0.5 block text-[11.5px] text-slate-500">Inclusions, meeting point and more</span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-[#02665e] transition-transform group-hover:translate-x-0.5" aria-hidden />
                </button>
                {discountText(selected) ? (
                  <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-[#02665e]/[0.07] px-2.5 py-1.5 text-[12px] font-semibold text-[#02665e]">
                    <BadgeCheck className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                    {discountText(selected)}
                  </div>
                ) : null}
              </div>

              {/* Travellers and the estimated total */}
              <div className="mt-4 bg-slate-50/70 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="leading-tight">
                    <div className="text-[14px] font-semibold text-slate-900">Travellers</div>
                    <div className="mt-0.5 text-[11.5px] text-slate-500">{selected.maxPax ? `Group of ${selMin} to ${selMax}` : `Minimum ${selMin}`}</div>
                  </div>
                  <div className="inline-flex items-center rounded-full border border-solid border-slate-200 bg-white shadow-sm">
                    <button type="button" aria-label="Fewer travellers" disabled={selTravellers <= selMin} onClick={() => setTravellers(selTravellers - 1)} className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-lg font-semibold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300">−</button>
                    <span className="w-7 text-center text-[15px] font-bold tabular-nums text-slate-900" aria-live="polite">{selTravellers}</span>
                    <button type="button" aria-label="More travellers" disabled={selTravellers >= selMax} onClick={() => setTravellers(selTravellers + 1)} className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-lg font-semibold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300">+</button>
                  </div>
                </div>
                {selHasPrice ? (
                  <div className="mt-3.5 flex items-end justify-between gap-3 border-0 border-t border-dashed border-slate-200 pt-3.5">
                    <div className="leading-tight">
                      <div className="text-[13px] font-semibold text-slate-900">Estimated total</div>
                      <div className="mt-0.5 text-[11.5px] tabular-nums text-slate-500">
                        {money(selPrice, selCurrency)} × {selTravellers} traveller{selTravellers === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="text-[22px] font-black leading-none tabular-nums tracking-tight text-slate-900">{money(selPrice * selTravellers, selCurrency)}</div>
                  </div>
                ) : null}
                {selHref ? (
                  <Link
                    href={`${selHref}&travelers=${selTravellers}`}
                    className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#02665e] text-[15px] font-semibold text-white no-underline shadow-sm transition-colors hover:bg-[#014e47]"
                  >
                    Book this tour
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                ) : (
                  <span className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-xl bg-slate-200 text-[13px] font-semibold text-slate-500">
                    {previewOnly ? "Booking opens on your live profile" : "Booking unavailable"}
                  </span>
                )}
                <p className="m-0 mt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-slate-500">
                  <Lock className="h-3 w-3 text-emerald-600" aria-hidden />
                  Pick your date next. Final price confirmed at checkout.
                </p>
              </div>
            </div>
          ) : null}
        </aside>
      </div>


      {/* Room for the phone booking bar so it never covers the last section */}
      {tours.length ? <div aria-hidden className="h-20 lg:hidden" /> : null}

      {/* Tour details: the summary on one side, the day-by-day timeline on the other */}
      {mounted && detailsFor != null && tours[detailsFor] ? createPortal(
        <TourDetailsModal
          pkg={tours[detailsFor]}
          priceText={(() => { const v = displayPrice(tours[detailsFor].pricePerPerson); return Number.isFinite(v) && v > 0 ? money(v, String(tours[detailsFor].currency || "USD").toUpperCase()) : null; })()}
          bookUrl={(() => {
            // Straight to checkout: the chosen traveller count if this is the selected tour, else its minimum
            const href = bookHref(tours[detailsFor], detailsFor);
            if (!href) return null;
            const count = detailsFor === selectedIdx ? selTravellers : Math.max(1, Number(tours[detailsFor].minPax) || 1);
            return `${href}&travelers=${count}`;
          })()}
          onClose={() => setDetailsFor(null)}
        />,
        document.body,
      ) : null}

      {/* Lightbox: one photo, full screen, with a filmstrip (same as stay pages) */}
      {mounted && lightbox != null && photos[lightbox] ? createPortal((
        <div className="fixed inset-0 z-[2147483647] flex flex-col bg-[#0b0f12] text-white" style={{ isolation: "isolate" }} role="dialog" aria-modal="true" aria-label="Photo gallery">
          {/* Top bar */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-bold text-white sm:text-[15px]">{p.companyName}</div>
              <div className="mt-0.5 text-xs text-white/60">
                <span className="font-semibold text-white/85">{lightbox + 1} / {photos.length}</span>
                {(() => {
                  const sec = photoSections.find((x) => x.idxs.includes(lightbox));
                  return sec && photoSections.length > 1 ? <span> · {sec.label}</span> : null;
                })()}
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setLightbox(null);
                  openAllPhotos();
                }}
                className="hidden h-10 cursor-pointer items-center gap-2 rounded-full border-0 bg-white/10 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/20 sm:inline-flex"
              >
                <LayoutGrid className="h-4 w-4" aria-hidden />
                All photos
              </button>
              <button type="button" onClick={() => setLightbox(null)} aria-label="Close photo gallery" className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white transition-colors hover:bg-white/20">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          {/* Stage: the photo fills the height; empty space closes */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-20"
            onClick={(e) => {
              if (e.target === e.currentTarget) setLightbox(null);
            }}
          >
            <div className="relative h-full w-full max-w-6xl">
              <Image src={photos[lightbox]} alt={`${p.companyName} photo ${lightbox + 1}`} fill sizes="(min-width: 1280px) 1150px, 100vw" className="object-contain" unoptimized priority />
            </div>
            {photos.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => setLightbox((i) => (i == null ? i : i <= 0 ? photos.length - 1 : i - 1))}
                  aria-label="Previous photo"
                  className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white transition-colors hover:bg-white/25 sm:left-5"
                >
                  <ChevronLeft className="h-6 w-6" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setLightbox((i) => (i == null ? i : i >= photos.length - 1 ? 0 : i + 1))}
                  aria-label="Next photo"
                  className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white transition-colors hover:bg-white/25 sm:right-5"
                >
                  <ChevronRight className="h-6 w-6" aria-hidden />
                </button>
              </>
            ) : null}
          </div>

          {/* Filmstrip */}
          {photos.length > 1 ? (
            <div className="px-4 pb-4 pt-3 sm:px-6">
              <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {photos.map((src, i) => (
                  <button
                    key={`${src}-${i}`}
                    id={`op-lb-thumb-${i}`}
                    type="button"
                    onClick={() => setLightbox(i)}
                    aria-label={`View photo ${i + 1}`}
                    aria-current={i === lightbox ? "true" : undefined}
                    className={[
                      "relative h-14 w-20 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg border-0 bg-white/5 p-0 transition-opacity sm:h-16 sm:w-24",
                      i === lightbox ? "opacity-100 ring-2 ring-white ring-offset-2 ring-offset-[#0b0f12]" : "opacity-45 hover:opacity-90",
                    ].join(" ")}
                  >
                    <Image src={src} alt="" fill sizes="96px" className="object-cover" unoptimized />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ), document.body) : null}

      {/* All photos: the photo tour, one section per photo category */}
      {mounted && allPhotosOpen ? createPortal((
        <div className="fixed inset-0 z-[2147483647] bg-white" style={{ isolation: "isolate" }} role="dialog" aria-modal="true" aria-label="All photos">
          <div
            className={[
              "relative flex h-dvh w-full flex-col overflow-hidden bg-white",
              "transition-opacity duration-200 ease-out motion-reduce:transition-none",
              allPhotosShown ? "opacity-100" : "opacity-0",
            ].join(" ")}
          >
            {/* Header */}
            <div className="border-0 border-b border-solid border-slate-200 bg-white">
              <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-base font-bold text-slate-950 sm:text-lg">{p.companyName}</div>
                  <div className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                    {photos.length.toLocaleString()} photos
                    {photoSections.length > 1 ? ` · ${photoSections.length} sections` : ""}
                  </div>
                </div>
                <button type="button" onClick={closeAllPhotos} aria-label="Close" className="inline-flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>

            <div id="photo-tour-scroll" className="flex-1 overflow-y-auto bg-white">
              {photoSections.length > 1 ? (
                <nav className="pt-chips" aria-label="Photo sections">
                  {photoSections.map((sec) => (
                    <button key={sec.key} type="button" onClick={() => scrollToPhotoSection(sec.key)} className={`pt-chip${activeTourKey === sec.key ? " is-active" : ""}`}>
                      {sec.label} · {sec.idxs.length}
                    </button>
                  ))}
                </nav>
              ) : null}

              <div className="pt-layout">
                {photoSections.length > 1 ? (
                  <nav className="pt-index" aria-label="Photo sections">
                    <p className="pt-index-title">Photo tour</p>
                    {photoSections.map((sec) => (
                      <button
                        key={sec.key}
                        type="button"
                        onClick={() => scrollToPhotoSection(sec.key)}
                        className={`pt-index-item${activeTourKey === sec.key ? " is-active" : ""}`}
                        aria-current={activeTourKey === sec.key ? "true" : undefined}
                      >
                        <span className="pt-index-thumb">
                          <Image src={photos[sec.idxs[0]]} alt="" fill sizes="56px" className="object-cover" unoptimized />
                        </span>
                        <span className="min-w-0">
                          <span className="pt-index-label">{sec.label}</span>
                          <span className="pt-index-count">{sec.idxs.length} photos</span>
                        </span>
                      </button>
                    ))}
                  </nav>
                ) : null}

                <div className={photoSections.length > 1 ? "" : "lg:col-span-2"}>
                  {photoSections.map((sec) => {
                    // Balanced blocks: trios alternate sides, then a pair or a single
                    const blocks: Array<{ kind: "trio" | "pair" | "single"; idxs: number[]; flip: boolean }> = [];
                    let at = 0;
                    let trios = 0;
                    while (sec.idxs.length - at >= 3) {
                      blocks.push({ kind: "trio", idxs: sec.idxs.slice(at, at + 3), flip: trios % 2 === 1 });
                      at += 3;
                      trios += 1;
                    }
                    const rest = sec.idxs.slice(at);
                    if (rest.length === 2) blocks.push({ kind: "pair", idxs: rest, flip: false });
                    if (rest.length === 1) blocks.push({ kind: "single", idxs: rest, flip: false });

                    return (
                      <section key={sec.key} id={`photo-tour-${sec.key}`} data-tour-key={sec.key} className="pt-section">
                        <div className="pt-section-head">
                          <h3 className="pt-section-title">{sec.label}</h3>
                          <span className="pt-section-rule" aria-hidden />
                          <span className="pt-section-count">{sec.idxs.length} photos</span>
                        </div>
                        {blocks.map((block, bi) => (
                          <div key={`${sec.key}-${bi}`} className={`pt-block pt-${block.kind}${block.flip ? " is-flip" : ""}`}>
                            {block.idxs.map((i, n) => {
                              const big = block.kind === "trio" ? n === 0 : block.kind === "single";
                              return (
                                <button key={`${sec.key}-${i}`} type="button" onClick={() => openFromGrid(i)} className="pt-tile" aria-label={`Open photo ${i + 1} of ${photos.length}`}>
                                  <Image
                                    src={photos[i]}
                                    alt={`${p.companyName} photo ${i + 1}`}
                                    fill
                                    sizes={big ? "(min-width: 1024px) 700px, 100vw" : "(min-width: 1024px) 340px, 50vw"}
                                    className="object-cover"
                                    unoptimized
                                  />
                                  <span className="pt-tile-num">{i + 1} / {photos.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </section>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}

/** Payment rows copied from the stay page (PaymentModePill / PaymentLogo). */
function PaymentLogo({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-white/90 p-1.5 shadow-sm ring-1 ring-black/5">
      <span className="relative block h-[28px] w-[28px]">
        <Image src={src} alt={alt} fill sizes="28px" className="object-contain" />
      </span>
    </span>
  );
}

function PaymentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      title={label}
      className="group box-border inline-flex w-full select-none items-center justify-between gap-2 whitespace-nowrap rounded-xl border border-solid border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 shadow-sm shadow-transparent hover:border-slate-300 hover:bg-white active:scale-[0.98] motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-sm"
    >
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="inline-flex items-center gap-2">{children}</span>
    </div>
  );
}

/** Each experience gets an icon and colour that says what it is at a glance. */
function experienceLook(name: string): { Icon: typeof Check; bg: string; fg: string; hex: string } {
  const n = name.toLowerCase();
  if (/beach|marine|ocean|sea|island|zanzibar/.test(n)) return { Icon: Waves, bg: "bg-sky-50", fg: "text-sky-700", hex: "#0284c7" };
  if (/wildlife|safari|game/.test(n)) return { Icon: PawPrint, bg: "bg-amber-50", fg: "text-amber-700", hex: "#d97706" };
  if (/mountain|hik|trek|climb/.test(n)) return { Icon: Mountain, bg: "bg-emerald-50", fg: "text-emerald-700", hex: "#059669" };
  if (/cultur|heritage|history|city/.test(n)) return { Icon: Landmark, bg: "bg-rose-50", fg: "text-rose-700", hex: "#e11d48" };
  if (/camp|adventure/.test(n)) return { Icon: Tent, bg: "bg-lime-50", fg: "text-lime-700", hex: "#65a30d" };
  if (/common|transfer|airport|transport|service/.test(n)) return { Icon: Plane, bg: "bg-indigo-50", fg: "text-indigo-700", hex: "#4f46e5" };
  return { Icon: Compass, bg: "bg-[#02665e]/[0.08]", fg: "text-[#02665e]", hex: "#02665e" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "May", "may", "05" and "5" all read as index 4. */
function monthIndex(value: string): number | null {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (/^\d{1,2}$/.test(v)) {
    const n = Number(v);
    return n >= 1 && n <= 12 ? n - 1 : null;
  }
  const i = MONTHS.findIndex((m) => v.startsWith(m.toLowerCase()));
  return i >= 0 ? i : null;
}

/** An icon that says what each piece of equipment is. */
function toolIcon(name: string): typeof Check {
  const n = name.toLowerCase();
  if (/first.?aid|medical|medic/.test(n)) return HeartPulse;
  if (/satellite/.test(n)) return SatelliteDish;
  if (/radio|walkie/.test(n)) return Radio;
  if (/translat|language|interpret/.test(n)) return Languages;
  if (/photo|camera/.test(n)) return Camera;
  if (/camp|tent/.test(n)) return Tent;
  if (/driver/.test(n)) return Car;
  if (/guide/.test(n)) return UserCheck;
  if (/binocular|scope/.test(n)) return Eye;
  if (/wifi|internet/.test(n)) return Wifi;
  return Wrench;
}

/** Park, lake, island, mountain or town: each place type gets its own mark. */
function placeLook(name: string): { Icon: typeof Check; kind: string; hex: string } {
  const n = name.toLowerCase();
  if (/national park|\bnp\b|park/.test(n)) return { Icon: Trees, kind: "National park", hex: "#059669" };
  if (/conservation|reserve|sanctuary|game/.test(n)) return { Icon: PawPrint, kind: "Reserve", hex: "#d97706" };
  if (/lake|river|falls|spring/.test(n)) return { Icon: Waves, kind: "Lake and water", hex: "#0284c7" };
  if (/island|zanzibar|pemba|mafia|beach|coast/.test(n)) return { Icon: Palmtree, kind: "Island and coast", hex: "#0891b2" };
  if (/mount|kilimanjaro|meru|crater|hill/.test(n)) return { Icon: Mountain, kind: "Mountain", hex: "#7c3aed" };
  return { Icon: MapPin, kind: "Destination", hex: "#02665e" };
}

/**
 * "What this operator offers", read in three steps: the experiences they run
 * (each a tile with its own checklist), what they are known for, and what can
 * be added to a trip.
 */
function OfferOverview({ groups, specialities, extras }: { groups: Array<[string, string[]]>; specialities: string[]; extras: string[] }) {
  const serviceCount = groups.reduce((sum, [, items]) => sum + items.length, 0);
  const summary = [
    serviceCount ? `${serviceCount} service${serviceCount === 1 ? "" : "s"}` : null,
    groups.length > 1 ? `across ${groups.length} areas` : null,
  ].filter(Boolean).join(" ");
  // Two cards by default; everything else waits behind "View more"
  const [showAll, setShowAll] = useState(false);
  const cards = [
    ...groups.map(([group, items]) => ({ kind: "group" as const, key: group, group, items })),
    ...(specialities.length ? [{ kind: "known" as const, key: "__known" }] : []),
    ...(extras.length ? [{ kind: "extras" as const, key: "__extras" }] : []),
  ];
  const visible = new Set((showAll ? cards : cards.slice(0, 2)).map((c) => c.key));
  const hiddenCount = cards.length - 2;
  const shownGroups = groups.filter(([group]) => visible.has(group));
  const showKnown = visible.has("__known");
  const showExtras = visible.has("__extras");
  return (
    <div>
      {summary ? (
        <p className="m-0 mb-4 text-[14px] text-slate-600">
          <span className="font-semibold text-slate-900">{summary}</span>
          {extras.length ? `, plus ${extras.length} optional extra${extras.length === 1 ? "" : "s"}.` : "."}
        </p>
      ) : null}

      {shownGroups.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {shownGroups.map(([group, items]) => {
            const { Icon, hex } = experienceLook(group);
            return (
              <div
                key={group}
                className="group relative overflow-hidden rounded-2xl border border-solid bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-18px_rgba(15,23,42,0.35)]"
                style={{ borderColor: `${hex}33`, backgroundImage: `linear-gradient(160deg, ${hex}14 0%, #ffffff 55%)` }}
              >
                {/* Large faint mark: each area is recognisable before it is read */}
                <Icon aria-hidden className="pointer-events-none absolute -right-4 -top-4 h-28 w-28 opacity-[0.07] transition-transform duration-300 group-hover:rotate-6" style={{ color: hex }} strokeWidth={1.4} />
                <div className="relative flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl text-white shadow-sm" style={{ backgroundColor: hex }}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[15.5px] font-bold text-slate-900">{group}</div>
                    <div className="mt-0.5 text-[12px] font-medium" style={{ color: hex }}>{items.length} service{items.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <ul className="relative m-0 mt-3.5 list-none space-y-1.5 p-0">
                  {items.map((item) => (
                    <li key={item} className="flex items-center gap-2.5 rounded-lg bg-white/80 px-2.5 py-1.5 text-[13.5px] leading-snug text-slate-800 ring-1 ring-slate-200/70">
                      <span className="inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${hex}1f` }}>
                        <Check className="h-3 w-3" style={{ color: hex }} strokeWidth={3} aria-hidden />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {showKnown || showExtras ? (
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${shownGroups.length ? "mt-3" : ""}`}>
          {showKnown ? (
            <div className="min-w-0 rounded-xl border border-solid border-amber-200/70 bg-amber-50/40 p-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                  <Award className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="text-[15px] font-semibold text-slate-900">Known for</div>
                  <div className="mt-0.5 text-[12px] text-slate-500">What they do best</div>
                </div>
              </div>
              <ul className="m-0 mt-3 grid list-none grid-cols-2 gap-x-3 gap-y-2 border-0 border-t border-solid border-amber-200/60 p-0 pt-3">
                {specialities.map((item) => (
                  <li key={item} className="flex min-w-0 items-start gap-2 text-[13.5px] leading-snug text-slate-700">
                    <Star className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" aria-hidden />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {showExtras ? (
            <div className="min-w-0 rounded-xl border border-solid border-violet-200/70 bg-violet-50/40 p-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                  <PlusCircle className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="text-[15px] font-semibold text-slate-900">Add to your trip</div>
                  <div className="mt-0.5 text-[12px] text-slate-500">{extras.length} extra{extras.length === 1 ? "" : "s"} · on request</div>
                </div>
              </div>
              <ul className="m-0 mt-3 grid list-none grid-cols-2 gap-x-3 gap-y-2 border-0 border-t border-solid border-violet-200/60 p-0 pt-3">
                {extras.map((item) => (
                  <li key={item} className="flex min-w-0 items-start gap-2 text-[13.5px] leading-snug text-slate-700">
                    <Plus className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-600" strokeWidth={2.6} aria-hidden />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-3 text-[11.5px] text-slate-500">Priced separately. Ask when you book.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {hiddenCount > 0 ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-solid border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-800 shadow-sm transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
          >
            {showAll ? "Show less" : `View ${hiddenCount} more`}
            {showAll ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Tour details: the timeline is the product ────────────────────────────

function toMinutes(value: string): number | null {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

function lengthText(minutes: number): string {
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Morning, afternoon or evening, each with its own mark and colour on the rail. */
function dayPart(minutes: number | null): { label: string; Icon: typeof Sun; dot: string; soft: string; text: string; hex: string } {
  if (minutes == null) return { label: "Anytime", Icon: Clock3, dot: "bg-slate-400", soft: "bg-slate-100", text: "text-slate-600", hex: "#94a3b8" };
  if (minutes < 12 * 60) return { label: "Morning", Icon: Sunrise, dot: "bg-amber-400", soft: "bg-amber-50", text: "text-amber-700", hex: "#f59e0b" };
  if (minutes < 17 * 60) return { label: "Afternoon", Icon: Sun, dot: "bg-sky-500", soft: "bg-sky-50", text: "text-sky-700", hex: "#0ea5e9" };
  return { label: "Evening", Icon: Moon, dot: "bg-indigo-500", soft: "bg-indigo-50", text: "text-indigo-700", hex: "#6366f1" };
}

function difficultyTone(value: string): string {
  const v = value.toLowerCase();
  if (/hard|challeng|strenuous|difficult/.test(v)) return "bg-rose-50 text-rose-700 ring-rose-200";
  if (/moderate|medium/.test(v)) return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-emerald-50 text-emerald-700 ring-emerald-200";
}

/**
 * Full tour details. Left: what the tour is (facts, story, inclusions,
 * meeting point). Right: the journey as a real timetable, each day a stop on
 * one spine, each activity on a rail marked by time of day and length, so a
 * traveller sees exactly how their days are spent before paying.
 */
function TourDetailsModal({
  pkg,
  priceText,
  bookUrl,
  onClose,
}: {
  pkg: PublicPackage;
  priceText: string | null;
  bookUrl: string | null;
  onClose: () => void;
}) {
  const days = [...(pkg.itinerary || [])].sort((a, b) => (Number(a.day) || 0) - (Number(b.day) || 0));
  const [activeDay, setActiveDay] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  const moments = days.reduce((sum, d) => sum + (d.events?.length || 0), 0);

  // Keep the day tabs in step with the day being read
  useEffect(() => {
    const section = document.getElementById("tour-journey-scroll");
    // Large screens scroll the timeline column; phones scroll the whole body
    const root = section && section.scrollHeight > section.clientHeight + 1 ? section : section?.parentElement;
    if (!section || !root || typeof IntersectionObserver === "undefined" || !days.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const idx = Number(hit?.target.getAttribute("data-day-index"));
        if (Number.isFinite(idx)) setActiveDay(idx);
      },
      { root, rootMargin: "-20% 0px -65% 0px", threshold: 0 },
    );
    section.querySelectorAll("[data-day-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [days.length]);

  const goToDay = (idx: number) => {
    setActiveDay(idx);
    document.getElementById(`tour-day-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Journey summary from the itinerary itself
  const glance = (() => {
    if (!days.length) return null;
    const perDay = days.map((d) => d.events?.length || 0);
    const total = perDay.reduce((a, b) => a + b, 0);
    if (!total) return null;
    const all = days.flatMap((d) => d.events || []);
    const starts = all.map((e) => ({ m: toMinutes(e.startTime), t: e.startTime })).filter((x): x is { m: number; t: string } => x.m != null);
    const ends = all.map((e) => ({ m: toMinutes(e.endTime), t: e.endTime })).filter((x): x is { m: number; t: string } => x.m != null);
    const parts = [8 * 60, 13 * 60, 19 * 60].map((probe) => {
      const part = dayPart(probe);
      return { label: part.label, hex: part.hex, count: starts.filter((s) => dayPart(s.m).label === part.label).length };
    });
    const earliest = starts.length ? starts.reduce((a, b) => (b.m < a.m ? b : a)).t : "";
    const latest = ends.length ? ends.reduce((a, b) => (b.m > a.m ? b : a)).t : "";
    return { perDay, total, max: Math.max(1, ...perDay), parts, timed: starts.length, earliest, latest };
  })();

  const facts = [
    { label: "Duration", value: durationText(pkg.duration), Icon: Clock3 },
    { label: "Group", value: groupText(pkg), Icon: Users },
    { label: "Travel", value: pkg.mode, Icon: Car },
    { label: pkg.accommodation ? "Stay" : "Meals", value: pkg.accommodation || pkg.mealPlan, Icon: pkg.accommodation ? Landmark : Utensils },
  ];

  return (
    <div
      className="fixed inset-0 z-[2147483000] flex items-end justify-center bg-slate-950/55 backdrop-blur-[2px] sm:items-center sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-label={pkg.name || "Tour details"}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div id="tour-details-modal" className="flex h-[96dvh] w-full max-w-7xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-[94dvh] sm:rounded-3xl">
        <style>{"#tour-details-modal, #tour-details-modal * { box-sizing: border-box; }"}</style>

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-2.5 sm:px-6">
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-[0.08em] text-[#02665e]">{[pkg.category, pkg.destination].filter(Boolean).join(" · ") || "Tour package"}</div>
            <h2 className="m-0 mt-0.5 text-lg font-bold leading-tight tracking-tight text-slate-950 sm:text-xl">{pkg.name || "Tour"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:overflow-hidden">
          {/* ── Left: what the tour is ── */}
          <aside className="space-y-3.5 border-0 border-b border-solid border-slate-100 bg-slate-50/60 px-5 py-3.5 sm:px-6 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-4">
            {/* Facts: one compact strip */}
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
              {facts.map(({ label, value, Icon }, i) => (
                <div key={label} className={["flex min-w-0 items-start gap-2 border-0 border-solid border-slate-100 px-3 py-2", i % 2 === 1 ? "border-l" : "", i >= 2 ? "border-t" : ""].join(" ")}>
                  <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                  <div className="min-w-0 leading-tight">
                    <div className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</div>
                    <div className="line-clamp-2 break-words text-[12.5px] font-semibold text-slate-800" title={value || ""}>{value || "Not set"}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* The journey in one look: activity per day, and how the days are spent */}
            {glance ? (
              <div className="rounded-xl border border-solid border-slate-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#02665e]">Journey at a glance</span>
                  <span className="text-[11px] tabular-nums text-slate-500">{glance.total} activit{glance.total === 1 ? "y" : "ies"}</span>
                </div>

                {/* Activity per day: tap a bar to jump to that day */}
                <div className="mt-2.5 flex h-16 items-end gap-1">
                  {glance.perDay.map((count, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => goToDay(idx)}
                      title={`Day ${days[idx]?.day || idx + 1}: ${count} activit${count === 1 ? "y" : "ies"}`}
                      className="group flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1 border-0 bg-transparent p-0"
                    >
                      <span
                        className={`w-full max-w-[28px] rounded-md transition-colors ${idx === activeDay ? "bg-[#02665e]" : "bg-[#02665e]/25 group-hover:bg-[#02665e]/45"}`}
                        style={{ height: `${Math.max(10, (count / glance.max) * 100)}%` }}
                      />
                      <span className={`text-[10px] font-semibold tabular-nums ${idx === activeDay ? "text-[#02665e]" : "text-slate-400"}`}>D{days[idx]?.day || idx + 1}</span>
                    </button>
                  ))}
                </div>

                {/* Time of day split */}
                {glance.timed ? (
                  <div className="mt-3 border-0 border-t border-dashed border-slate-200 pt-2.5">
                    <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                      {glance.parts.map((p) => (p.count ? <span key={p.label} style={{ width: `${(p.count / glance.timed) * 100}%`, background: p.hex }} /> : null))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      {glance.parts.map((p) => (
                        <span key={p.label} className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.hex }} />
                          {p.label} <span className="font-semibold tabular-nums text-slate-900">{p.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {glance.earliest || glance.latest ? (
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    {glance.earliest ? (
                      <div className="rounded-lg bg-amber-50/70 px-2.5 py-1.5 leading-tight">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-amber-700/80">Earliest start</div>
                        <div className="text-[13px] font-bold tabular-nums text-slate-900">{glance.earliest}</div>
                      </div>
                    ) : null}
                    {glance.latest ? (
                      <div className="rounded-lg bg-indigo-50/70 px-2.5 py-1.5 leading-tight">
                        <div className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-indigo-700/80">Latest finish</div>
                        <div className="text-[13px] font-bold tabular-nums text-slate-900">{glance.latest}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Story: a short read, open on demand */}
            {pkg.description ? (
              <div>
                <p className={`m-0 whitespace-pre-wrap text-[13.5px] leading-6 text-slate-700 ${storyOpen ? "" : "line-clamp-3"}`}>{pkg.description}</p>
                {pkg.description.length > 160 ? (
                  <button type="button" onClick={() => setStoryOpen((v) => !v)} className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline">
                    {storyOpen ? "Show less" : "Read more"}
                  </button>
                ) : null}
              </div>
            ) : null}

            {pkg.notes && pkg.notes.trim() !== String(pkg.description || "").trim() ? (
              <p className="m-0 rounded-lg bg-white px-3 py-2 text-[12.5px] leading-relaxed text-slate-600 ring-1 ring-slate-200">
                <span className="font-semibold text-slate-900">Operator note: </span>{pkg.notes}
              </p>
            ) : null}

            {/* Covered or not, as two tight rows of tags */}
            {pkg.included?.length || pkg.excluded?.length ? (
              <div className="space-y-2.5 rounded-xl border border-solid border-slate-200 bg-white p-3">
                {pkg.included?.length ? (
                  <div>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#02665e]">Included · {pkg.included.length}</div>
                    <div className="flex flex-wrap gap-1">
                      {pkg.included.map((item) => (
                        <span key={item} className="inline-flex items-center gap-1 rounded-md bg-[#02665e]/[0.07] px-2 py-0.5 text-[12px] font-medium text-[#024d47]">
                          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {pkg.excluded?.length ? (
                  <div className={pkg.included?.length ? "border-0 border-t border-dashed border-slate-200 pt-2.5" : ""}>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Not included · {pkg.excluded.length}</div>
                    <div className="flex flex-wrap gap-1">
                      {pkg.excluded.map((item) => (
                        <span key={item} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[12px] text-slate-500">
                          <X className="h-3 w-3 text-rose-400" strokeWidth={3} aria-hidden />
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {pkg.meetingPoint ? (
              <div className="flex items-center gap-2 text-[12.5px] text-slate-700">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                <span className="min-w-0"><span className="font-semibold text-slate-900">Meet at </span>{pkg.meetingPoint}</span>
              </div>
            ) : null}
          </aside>

          {/* ── Right: the journey ── */}
          <section id="tour-journey-scroll" className="relative min-w-0 lg:overflow-y-auto">
            <div className="sticky top-0 z-10 border-0 border-b border-solid border-slate-100 bg-white/95 px-5 pb-2.5 pt-3 backdrop-blur sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 leading-tight">
                  <h3 className="m-0 inline text-[15.5px] font-bold text-slate-950">Your journey, day by day</h3>
                  <p className="m-0 ml-2 inline text-[12px] text-slate-500">
                    {days.length ? `${days.length} day${days.length === 1 ? "" : "s"} planned` : "Itinerary shared after booking"}
                    {moments ? ` · ${moments} scheduled moment${moments === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                {/* NoLSAF's part in this plan, said once and plainly */}
                <div
                  title="Kept on record with your booking and followed live in your NoLSAF account. If the trip differs from this plan, NoLSAF steps in."
                  className="flex max-w-full items-center gap-1.5 rounded-full bg-[#02665e]/[0.07] py-0.5 pl-0.5 pr-2.5 ring-1 ring-inset ring-[#02665e]/15"
                >
                  <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-white">
                    <ShieldCheck className="h-3 w-3" aria-hidden />
                  </span>
                  <span className="min-w-0 truncate text-[11.5px] font-semibold text-[#024d47]">Protected by NoLSAF</span>
                  <span className="hidden text-[11px] text-[#02665e]/70 sm:inline">· tracked live</span>
                </div>
              </div>
              {days.length > 1 ? (
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {days.map((day, idx) => {
                      const count = day.events?.length || 0;
                      const active = idx === activeDay;
                      return (
                        <button
                          key={day.id || idx}
                          type="button"
                          onClick={() => goToDay(idx)}
                          title={day.title || undefined}
                          className={[
                            "inline-flex h-8 flex-shrink-0 cursor-pointer items-center gap-2 rounded-full border border-solid pl-3 pr-1 text-[12.5px] font-semibold transition-colors",
                            active ? "border-[#02665e] bg-[#02665e] text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                          ].join(" ")}
                        >
                          Day {day.day || idx + 1}
                          <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold tabular-nums ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="hidden flex-shrink-0 items-center gap-3 text-[11px] text-slate-500 sm:flex">
                    {[dayPart(8 * 60), dayPart(13 * 60), dayPart(19 * 60)].map((part) => (
                      <span key={part.label} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${part.dot}`} />{part.label}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {days.length ? (
              <ol className="m-0 list-none px-5 pb-6 pt-4 sm:px-6">
                {days.map((day, idx) => {
                  const events = [...(day.events || [])].sort((a, b) => (toMinutes(a.startTime) ?? 9999) - (toMinutes(b.startTime) ?? 9999));
                  const starts = events.map((e) => toMinutes(e.startTime)).filter((v): v is number => v != null);
                  const ends = events.map((e) => toMinutes(e.endTime) ?? toMinutes(e.startTime)).filter((v): v is number => v != null);
                  const span = starts.length && ends.length ? `${events.find((e) => toMinutes(e.startTime) === Math.min(...starts))?.startTime} to ${events.find((e) => (toMinutes(e.endTime) ?? toMinutes(e.startTime)) === Math.max(...ends))?.endTime || ""}`.replace(/ to $/, "") : "";
                  const last = idx === days.length - 1;
                  return (
                    <li key={day.id || idx} id={`tour-day-${idx}`} data-day-index={idx} className="relative scroll-mt-32 pb-6 pl-14 sm:pl-16">
                      {/* The spine joining the days */}
                      {!last ? <span aria-hidden className="absolute bottom-0 left-[21px] top-12 w-0.5 bg-[repeating-linear-gradient(to_bottom,#cbd5e1_0_6px,transparent_6px_11px)] sm:left-[23px]" /> : null}
                      {/* Day marker */}
                      <span className="absolute left-0 top-0 flex h-11 w-11 flex-col items-center justify-center rounded-2xl bg-[#02665e] text-white shadow-[0_8px_18px_-10px_rgba(2,102,94,0.8)] sm:h-12 sm:w-12">
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/70">Day</span>
                        <span className="text-[17px] font-black leading-none tabular-nums">{String(day.day || idx + 1).padStart(2, "0")}</span>
                      </span>

                      <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
                        <div className="px-4 pb-3 pt-3.5 sm:px-5">
                          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                            <h4 className="m-0 text-[16px] font-bold leading-snug text-slate-900">{day.title || `Day ${day.day || idx + 1}`}</h4>
                            {span || events.length ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11.5px] font-semibold tabular-nums text-slate-600">
                                <Clock3 className="h-3 w-3" aria-hidden />
                                {[span, events.length ? `${events.length} activit${events.length === 1 ? "y" : "ies"}` : ""].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                          </div>
                          {day.description ? <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed text-slate-600">{day.description}</p> : null}
                        </div>

                        {events.length ? (
                          <ol className="m-0 list-none border-0 border-t border-solid border-slate-100 bg-slate-50/50 px-4 py-3 sm:px-5">
                            {events.map((evt, n) => {
                              const start = toMinutes(evt.startTime);
                              const end = toMinutes(evt.endTime);
                              const part = dayPart(start);
                              const length = start != null && end != null && end > start ? lengthText(end - start) : "";
                              const lastEvt = n === events.length - 1;
                              return (
                                <li key={evt.id || n} className="relative grid grid-cols-[4.25rem_1.75rem_minmax(0,1fr)] items-start gap-x-2 sm:grid-cols-[4.75rem_1.75rem_minmax(0,1fr)]">
                                  {/* Time */}
                                  <div className="pt-2 text-right leading-tight">
                                    <div className="text-[13.5px] font-bold tabular-nums text-slate-900">{evt.startTime || "Flexible"}</div>
                                    {evt.endTime ? <div className="text-[11px] tabular-nums text-slate-400">to {evt.endTime}</div> : null}
                                  </div>
                                  {/* Rail: a time-of-day badge, joined to the next one by a line that shifts colour as the day moves on */}
                                  <div className="relative flex h-full justify-center">
                                    {!lastEvt ? (
                                      <span
                                        aria-hidden
                                        className="absolute -bottom-2 top-8 w-0.5 rounded-full opacity-60"
                                        style={{ background: `linear-gradient(to bottom, ${part.hex}, ${dayPart(toMinutes(events[n + 1]?.startTime || "")).hex})` }}
                                      />
                                    ) : null}
                                    <span
                                      title={part.label}
                                      className={`relative mt-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-solid shadow-[0_4px_10px_-4px_rgba(15,23,42,0.35)] ${part.soft}`}
                                      style={{ borderColor: part.hex }}
                                    >
                                      <part.Icon className="h-3.5 w-3.5" style={{ color: part.hex }} strokeWidth={2.4} aria-hidden />
                                    </span>
                                  </div>
                                  {/* Activity */}
                                  <div className={`min-w-0 ${lastEvt ? "" : "pb-2.5"}`}>
                                    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200/80 sm:px-3.5 sm:py-2.5">
                                      {/* Activity left, its tags right: the row reads edge to edge */}
                                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                        <div className="min-w-0 text-[14px] font-semibold leading-snug text-slate-900">{evt.activity || "Activity"}</div>
                                        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-semibold ${part.soft} ${part.text}`}>
                                            <part.Icon className="h-3 w-3" aria-hidden />
                                            {part.label}
                                          </span>
                                          {length ? <span className="rounded-full bg-slate-100 px-2 py-px text-[10.5px] font-semibold tabular-nums text-slate-600">{length}</span> : null}
                                          {evt.difficulty ? (
                                            <span className={`rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset ${difficultyTone(evt.difficulty)}`}>{evt.difficulty}</span>
                                          ) : null}
                                        </div>
                                      </div>
                                      {/* Where this sits in the day: a 06:00 to 22:00 ruler */}
                                      {start != null ? (() => {
                                        const from = 6 * 60;
                                        const range = 16 * 60;
                                        const left = Math.min(100, Math.max(0, ((start - from) / range) * 100));
                                        const width = end != null && end > start ? Math.max(2, Math.min(100 - left, ((end - start) / range) * 100)) : 2;
                                        return (
                                          <div className="mt-2 flex items-center gap-2" aria-hidden>
                                            <span className="text-[9.5px] tabular-nums text-slate-300">06</span>
                                            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                              {[25, 50, 75].map((tick) => <span key={tick} className="absolute top-0 h-full w-px bg-white" style={{ left: `${tick}%` }} />)}
                                              <span className={`absolute top-0 h-full rounded-full ${part.dot}`} style={{ left: `${left}%`, width: `${width}%` }} />
                                            </div>
                                            <span className="text-[9.5px] tabular-nums text-slate-300">22</span>
                                          </div>
                                        );
                                      })() : null}
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ol>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                {/* Journey end */}
                <li className="relative pl-14 sm:pl-16">
                  <span className="absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-dashed border-[#02665e]/40 bg-[#02665e]/[0.06] text-[#02665e] sm:h-12 sm:w-12">
                    <Flag className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="flex min-h-[44px] flex-col justify-center leading-tight sm:min-h-[48px]">
                    <div className="text-[14px] font-bold text-slate-900">End of tour</div>
                    <div className="text-[12px] text-slate-500">Your timeline stays in your NoLSAF account, live during the trip.</div>
                  </div>
                </li>
              </ol>
            ) : (
              <div className="px-5 py-10 text-center sm:px-7">
                <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#02665e]/10 text-[#02665e]"><Route className="h-6 w-6" aria-hidden /></span>
                <p className="m-0 mt-3 text-[14px] font-semibold text-slate-900">Day plan coming from the operator</p>
                <p className="m-0 mt-1 text-[13px] text-slate-500">You will get the full timeline in your account once you book.</p>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 bg-white px-5 py-2.5 sm:px-6">
          <div className="leading-tight">
            <div className="text-[18px] font-black tabular-nums text-slate-900">{priceText || "Price on request"}</div>
            {priceText ? <div className="text-[11.5px] text-slate-500">per person{durationText(pkg.duration) ? ` · ${durationText(pkg.duration)}` : ""}</div> : null}
          </div>
          {bookUrl ? (
            <Link href={bookUrl} className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[#02665e] px-6 text-[15px] font-semibold text-white no-underline shadow-sm hover:bg-[#014e47]">
              Continue to book
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
