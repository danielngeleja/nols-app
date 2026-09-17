"use client";

import Link from "next/link";
import NextImage from "next/image";
import React from "react";
import {
  User,
  ChevronRight,
  X,
  Sparkles,
  Gavel,
  Home,
  Car,
  Users,
  CreditCard,
  Calculator,
  Compass,
  KeyRound,
  ShieldCheck,
  Smartphone,
  BedDouble,
  Search,
  CalendarDays,
  MapPin,
  Megaphone,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, FormEvent, useMemo } from "react";
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AttentionBlink from '../../components/AttentionBlink';
import BookingFlowCard from '../../components/BookingFlowCard';
import FounderStory from '../../components/FounderStory';
import LatestUpdate from '../../components/LatestUpdate';
import PodcastSection from '../../components/PodcastSection';
import ScrollReveal from '../../components/ScrollReveal';
import TravelRolesConnected from '../../components/home/TravelRolesConnected';
import DatePicker from '../../components/ui/DatePicker';

type TrustPartnerBrand = { name: string; logoUrl?: string; href?: string };

const DESTINATION_IMAGES: Record<string, { src: string; position: string }> = {
  "Dar es Salaam": { src: "/assets/five_star.jpg", position: "center 58%" },
  Kilimanjaro: { src: "/assets/Apartments.jpg", position: "center" },
  Zanzibar: { src: "/assets/villa.jpg", position: "center 62%" },
  Arusha: { src: "/assets/Toursite.jpeg", position: "center" },
  Mwanza: { src: "/assets/hotel.jpg", position: "center 68%" },
  Dodoma: { src: "/assets/Bungalow.jpg", position: "center" },
};

function _SectionHeading({
  title,
  subtitle,
  kicker,
  variant = "bar",
  className = "",
  tone = "light",
}: {
  title: string;
  subtitle?: string;
  kicker?: string;
  variant?: "bar" | "center" | "split" | "eyebrow" | "compact";
  className?: string;
  tone?: "light" | "dark";
}) {
  const titleClass = tone === "dark" ? "text-white" : "text-slate-900";
  const subtitleClass = tone === "dark" ? "text-white/80" : "text-slate-600";
  const dividerNeutral = tone === "dark" ? "via-white/12" : "via-slate-200/75";
  const titleEnhance = tone === "dark" ? "drop-shadow-sm" : "";

  const accentBar = (
    <span
      className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#02b4f5] via-[#02b4f5] to-[#02665e] shadow-[0_10px_22px_rgba(2,180,245,0.16)]"
      aria-hidden
    />
  );

  if (variant === "center") {
    return (
      <div className={["relative text-center", className].join(" ")}>
        {kicker ? (
          <div className="inline-flex items-center rounded-full bg-[#02665e]/8 ring-1 ring-[#02665e]/18 px-3 py-1 text-[#02665e] text-[11px] font-semibold tracking-wide">
            {kicker}
          </div>
        ) : null}
        <h2 className={[titleClass, kicker ? "mt-3" : "", "text-2xl sm:text-3xl font-semibold tracking-tight"].join(" ")}>
          {title}
        </h2>
        {subtitle ? (
          <p className={["mt-3 mx-auto text-sm leading-relaxed max-w-[74ch]", subtitleClass].join(" ")}>
            {subtitle}
          </p>
        ) : null}
        <div className={["mt-5 h-px w-full bg-gradient-to-r from-transparent", dividerNeutral, "to-transparent"].join(" ")} aria-hidden />
      </div>
    );
  }

  if (variant === "split") {
    return (
      <div className={["relative", className].join(" ")}>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="min-w-0">
            {kicker ? (
              <div className="inline-flex items-center rounded-full bg-[#02b4f5]/8 ring-1 ring-[#02b4f5]/18 px-3 py-1 text-[#035c8b] text-[11px] font-semibold tracking-wide">
                {kicker}
              </div>
            ) : null}
            <div className={["flex items-center gap-3", kicker ? "mt-3" : ""].join(" ")}>
              {accentBar}
              <h2 className={[titleClass, "text-2xl sm:text-3xl font-semibold tracking-tight"].join(" ")}>
                {title}
              </h2>
            </div>
          </div>

          {subtitle ? (
            <p className={["text-sm leading-relaxed max-w-[70ch] lg:text-right", subtitleClass].join(" ")}>
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className={["mt-4 h-px w-full bg-gradient-to-r from-transparent", dividerNeutral, "to-transparent"].join(" ")} aria-hidden />
        <div className="mt-2 h-px w-full bg-gradient-to-r from-[#02b4f5]/0 via-[#02b4f5]/22 to-[#02665e]/0" aria-hidden />
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className={["relative", className].join(" ")}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            {kicker ? (
              <div className={[tone === "dark" ? "text-white/80" : "text-[#02665e]", "text-[11px] font-semibold tracking-wide"].join(" ")}>
                {kicker}
              </div>
            ) : null}
            <h2 className={[titleClass, titleEnhance, kicker ? "mt-1" : "", "text-xl sm:text-2xl font-semibold tracking-tight"].join(" ")}>
              {title}
            </h2>
          </div>

          <div className="hidden md:flex items-center gap-2" aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-[#02b4f5]/55" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]/55" />
            <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />
          </div>
        </div>
        {subtitle ? (
          <p className={["mt-2 text-sm leading-relaxed max-w-[76ch]", subtitleClass].join(" ")}>
            {subtitle}
          </p>
        ) : null}
        <div className={[("mt-4 h-px w-full bg-gradient-to-r from-transparent"), dividerNeutral, ("to-transparent")].join(" ")} aria-hidden />
      </div>
    );
  }

  // "eyebrow" and default "bar" share a strong left-aligned, premium layout.
  return (
    <div className={["relative", className].join(" ")}>
      {variant === "eyebrow" && kicker ? (
        <div
          className={[
            "inline-flex items-center rounded-full backdrop-blur-md ring-1 px-3 py-1 text-[11px] font-semibold tracking-wide shadow-sm",
            tone === "dark" ? "bg-white/10 ring-white/20 text-white/85" : "bg-white/70 ring-slate-200/70 text-[#02665e]",
          ].join(" ")}
        >
          {kicker}
        </div>
      ) : null}

      <div className={["flex items-start justify-between gap-6", variant === "eyebrow" && kicker ? "mt-3" : ""].join(" ")}>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {accentBar}
            <h2 className={[titleClass, titleEnhance, "text-2xl sm:text-3xl font-semibold tracking-tight"].join(" ")}>
              {title}
            </h2>
          </div>

          {subtitle ? (
            <p className={["mt-2 text-sm leading-relaxed max-w-[76ch]", subtitleClass].join(" ")}>
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className="hidden lg:block flex-1 pt-3">
          <div className={[("h-px w-full bg-gradient-to-r from-transparent"), dividerNeutral, ("to-transparent")].join(" ")} aria-hidden />
          <div className="mt-2 h-px w-full bg-gradient-to-r from-[#02b4f5]/0 via-[#02b4f5]/28 to-[#02665e]/0" aria-hidden />
        </div>
      </div>

      <div className={[("mt-4 h-px w-full bg-gradient-to-r from-transparent lg:hidden"), dividerNeutral, ("to-transparent")].join(" ")} aria-hidden />
    </div>
  );
}

import { useRouter } from 'next/navigation';

export default function Page() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  // Group Stays is now a standalone page; removed inline event integration.

  type HeroMode = "stays" | "transport" | "host";
  const [, setHeroMode] = useState<HeroMode>("stays");

  // Cursor/touch-adaptive hero glow (premium interactive background)
  const heroRef = useRef<HTMLElement | null>(null);
  const heroPointerRafRef = useRef<number | null>(null);
  const heroPointerPendingRef = useRef<{ x: number; y: number } | null>(null);
  const heroPressTimerRef = useRef<number | null>(null);
  const [_heroPointerActive, setHeroPointerActive] = useState(false);
  const [_heroPressed, setHeroPressed] = useState(false);
  const queueHeroPointer = useCallback((clientX: number, clientY: number) => {
    heroPointerPendingRef.current = { x: clientX, y: clientY };
    if (heroPointerRafRef.current != null) return;

    heroPointerRafRef.current = window.requestAnimationFrame(() => {
      heroPointerRafRef.current = null;
      const el = heroRef.current;
      const pending = heroPointerPendingRef.current;
      if (!el || !pending) return;
      const rect = el.getBoundingClientRect();
      const x = Math.min(Math.max(pending.x - rect.left, 0), rect.width);
      const y = Math.min(Math.max(pending.y - rect.top, 0), rect.height);
      el.style.setProperty("--hero-x", `${Math.round(x)}px`);
      el.style.setProperty("--hero-y", `${Math.round(y)}px`);
    });
  }, []);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    // Initialize CSS vars to center so first hover/touch looks intentional.
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--hero-x", `${Math.round(rect.width * 0.52)}px`);
    el.style.setProperty("--hero-y", `${Math.round(rect.height * 0.42)}px`);

    return () => {
      if (heroPointerRafRef.current != null) window.cancelAnimationFrame(heroPointerRafRef.current);
      if (heroPressTimerRef.current != null) window.clearTimeout(heroPressTimerRef.current);
    };
  }, []);

  const _scrollToBookingFlow = useCallback(() => {
    const el = document.getElementById("booking-flow");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Property type cards (counts + quick navigation)
  type PropertyTypeKey =
    | "HOTEL"
    | "LODGE"
    | "APARTMENT"
    | "VILLA"
    | "GUEST_HOUSE"
    | "BUNGALOW"
    | "CABIN"
    | "HOMESTAY"
    | "CONDO"
    | "HOUSE";

  type PublicPropertyCardLite = {
    title: string;
    location: string;
    primaryImage: string | null;
    basePrice: number | null;
    currency: string | null;
  };

  type PublicHomeSummary = {
    trustPartners?: {
      items?: Array<{ name: string; logoUrl?: string | null; href?: string | null }>;
    };
    propertyTypes?: {
      counts?: Record<string, number | null>;
      samples?: Record<string, PublicPropertyCardLite | null>;
    };
    featuredDestinations?: {
      counts?: Record<string, number | null>;
    };
  };

  const PROPERTY_TYPE_CARDS: Array<{
    key: PropertyTypeKey;
    title: string;
    fallbackImageSrc: string;
  }> = [
    { key: "HOTEL", title: "Hotel", fallbackImageSrc: "/assets/hotel.jpg" },
    { key: "LODGE", title: "Lodge", fallbackImageSrc: "/assets/guest_house.jpg" },
    { key: "APARTMENT", title: "Apartment", fallbackImageSrc: "/assets/Local_houses.jpg" },
    { key: "VILLA", title: "Villa", fallbackImageSrc: "/assets/villa.jpg" },
    { key: "GUEST_HOUSE", title: "Guest house", fallbackImageSrc: "/assets/Villagestay.jpg" },
    { key: "BUNGALOW", title: "Bungalow", fallbackImageSrc: "/assets/villa.jpg" },
    { key: "CABIN", title: "Cabin", fallbackImageSrc: "/assets/campsite.jpg" },
    { key: "HOMESTAY", title: "Homestay", fallbackImageSrc: "/assets/Local_houses.jpg" },
    { key: "CONDO", title: "Condo", fallbackImageSrc: "/assets/Local_houses.jpg" },
    { key: "HOUSE", title: "House", fallbackImageSrc: "/assets/Local_houses.jpg" },
  ];

  const [typeCounts, setTypeCounts] = useState<Record<string, number | null>>({});
  const [typeSamples, setTypeSamples] = useState<Record<string, PublicPropertyCardLite | null>>({});
  const [countsLoading, setCountsLoading] = useState(true);
  const [blinkCounts, setBlinkCounts] = useState(false);
  const [trustBrands, setTrustBrands] = useState<TrustPartnerBrand[]>([]);
  const [trustBrandsLoading, setTrustBrandsLoading] = useState(true);

  // Newest updates, listed inside the expanded "Latest updates" band on large screens.
  const [latestUpdatePreviews, setLatestUpdatePreviews] = useState<{ id: string; title: string; createdAt: string }[]>([]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(min-width: 1024px)").matches) return;
    const controller = new AbortController();
    fetch("/api/public/updates", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : [];
        setLatestUpdatePreviews(
          items
            .filter((u: any) => u?.title)
            .slice(0, 3)
            .map((u: any) => ({ id: String(u.id ?? u.title), title: String(u.title), createdAt: String(u.createdAt || "") }))
        );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const FEATURED_DESTINATIONS = useMemo(
    () =>
      [
        {
          city: "Dar es Salaam",
          country: "Tanzania",
          tagline: "Coastal city stays, business travel, and quick getaways.",
          filterParam: "region",
        },
        // Tanzania only while it is our live market (Nairobi was here; re-add Kenya when we launch there).
        {
          city: "Kilimanjaro",
          country: "Tanzania",
          tagline: "Moshi stays and mountain lodges near the peak.",
          filterParam: "region",
        },
        {
          city: "Zanzibar",
          country: "Tanzania",
          tagline: "Beachfront escapes, old town charm, and island stays.",
          filterParam: "region",
        },
        {
          city: "Arusha",
          country: "Tanzania",
          tagline: "Gateway to parks lodges, villas, and adventure trips.",
          filterParam: "region",
        },
        {
          city: "Mwanza",
          country: "Tanzania",
          tagline: "Lake views, local hospitality, and weekend retreats.",
          filterParam: "region",
        },
        {
          city: "Dodoma",
          country: "Tanzania",
          tagline: "New capital energy apartments, hotels, and homes.",
          filterParam: "region",
        },
      ] as const,
    []
  );

  const [featuredCityCounts, setFeaturedCityCounts] = useState<Record<string, number | null>>({});
  const [featuredCitiesLoading, setFeaturedCitiesLoading] = useState(true);

  const [_groupStaySlide, setGroupStaySlide] = useState(0);
  const [_connectedSlide, setConnectedSlide] = useState(0);
  const [connectedServicesPaused, _setConnectedServicesPaused] = useState(false);
  const [featuredSlide, setFeaturedSlide] = useState(0);
  const [featuredSlidePaused, setFeaturedSlidePaused] = useState(false);

  const _fmtMoney = (amount: number | null | undefined, currency?: string | null) => {
    if (amount == null || !Number.isFinite(Number(amount))) return "";
    const cur = currency || "TZS";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(Number(amount));
    } catch {
      return `${cur} ${Number(amount).toLocaleString()}`;
    }
  };

  const connectedSlides = useMemo(
    () =>
      [
        {
          key: "e2e",
          pill: "End‑to‑end",
          title: "Book → Pay → Receive code",
          body: "Verified listings, clear terms, and secure payments — designed for confidence.",
          Icon: CreditCard,
          chips: ["Verified stays", "Instant booking code"],
        },
        {
          key: "transport",
          pill: "Connected transport",
          title: "Pickup to your booking",
          body: "Add transport and track confirmation before the trip starts.",
          Icon: Car,
          chips: ["Driver confirmation", "Safety checks"],
        },
        {
          key: "authentic",
          pill: "Authentic local",
          title: "Guides & experiences",
          body: "Connect to trusted local experiences through one request.",
          Icon: Users,
          chips: ["Local guides", "Assisted planning"],
        },
      ] as const,
    []
  );

  const featuredDestinationSlides = useMemo(() => {
    const perSlide = 4;
    const list = FEATURED_DESTINATIONS;
    if (list.length <= perSlide) return [list];
    const first = list.slice(0, perSlide);
    const rest = list.slice(perSlide);
    const fill = first.slice(0, Math.max(0, perSlide - rest.length));
    return [first, [...rest, ...fill]];
  }, [FEATURED_DESTINATIONS]);

  const groupStaySlides = useMemo(
    () =>
      [
        {
          key: "auction",
          pill: "Group Stay",
          title: "Auction‑based offers",
          body: "Submit your requirements once — owners compete by sending offers. You pick the best fit.",
          Icon: Gavel,
          chips: ["Competitive offers", "Fast confirmation"],
        },
        {
          key: "budget",
          pill: "Budget control",
          title: "You decide the budget",
          body: "Keep the trip within your target budget while still getting verified options.",
          Icon: CreditCard,
          chips: ["Budget‑first", "Verified options"],
        },
        {
          key: "logistics",
          pill: "Logistics",
          title: "Rooms + transport",
          body: "Coordinate rooms and pickup with one request and clear confirmation steps.",
          Icon: Home,
          chips: ["Rooms", "Transport"],
        },
      ] as const,
    []
  );

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (connectedServicesPaused) return;
    const ms = 6500;
    const t = window.setInterval(() => {
      setGroupStaySlide((s) => (s + 1) % groupStaySlides.length);
      setConnectedSlide((s) => (s + 1) % connectedSlides.length);
    }, ms);
    return () => window.clearInterval(t);
  }, [prefersReducedMotion, connectedServicesPaused, groupStaySlides.length, connectedSlides.length]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (featuredSlidePaused) return;
    if (featuredDestinationSlides.length <= 1) return;

    const ms = 7000;
    const t = window.setInterval(() => {
      setFeaturedSlide((s) => (s + 1) % featuredDestinationSlides.length);
    }, ms);
    return () => window.clearInterval(t);
  }, [prefersReducedMotion, featuredSlidePaused, featuredDestinationSlides.length]);

  useEffect(() => {
    let cancelled = false;
    async function loadHomeSummary() {
      setCountsLoading(true);
      setFeaturedCitiesLoading(true);
      setTrustBrandsLoading(true);
      try {
        const res = await fetch("/api/public/properties/home-summary", { cache: "no-store" });
        if (!res.ok) throw new Error("home_summary_failed");
        const summary = (await res.json()) as PublicHomeSummary;
        if (cancelled) return;

        const brands = Array.isArray(summary?.trustPartners?.items) ? summary.trustPartners.items : [];
        setTrustBrands(
          brands
            .map((item) => ({
              name: String(item.name || ""),
              logoUrl: item.logoUrl || undefined,
              href: item.href || undefined,
            }))
            .filter((item) => Boolean(item.name))
        );
        setTypeCounts(summary?.propertyTypes?.counts ?? {});
        setTypeSamples(summary?.propertyTypes?.samples ?? {});
        setFeaturedCityCounts(summary?.featuredDestinations?.counts ?? {});
        setBlinkCounts(true);
        window.setTimeout(() => setBlinkCounts(false), 1800);
      } catch {
        if (cancelled) return;
        setTrustBrands([]);
        setTypeCounts({});
        setTypeSamples({});
        setFeaturedCityCounts({});
      } finally {
        if (!cancelled) {
          setCountsLoading(false);
          setFeaturedCitiesLoading(false);
          setTrustBrandsLoading(false);
        }
      }
    }
    void loadHomeSummary();
    return () => {
      cancelled = true;
    };
  }, []);
  
  // Search form state for hero (first slide)
  const [q, setQ] = useState('');
  const [adults, setAdults] = useState<number>(1);
  const [children, setChildren] = useState<number>(0);
  const [pets, setPets] = useState<number>(0);
  const [pregnancy, setPregnancy] = useState<boolean>(false);
  const [checkin, setCheckin] = useState<string>('');
  const [checkout, setCheckout] = useState<string>('');
  const [guestOpen, setGuestOpen] = useState(false);
  const guestRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileGuestTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const dateRef = useRef<HTMLDivElement | null>(null);
  const mobileDateRef = useRef<HTMLButtonElement | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Auto-rotate hero modes (no manual toggles). Pause while popovers are open.
  useEffect(() => {
    if (prefersReducedMotion) return;
    if (guestOpen || dateOpen) return;

    const modes: HeroMode[] = ["stays", "transport", "host"];
    const id = window.setInterval(() => {
      setHeroMode((m) => {
        const idx = modes.indexOf(m);
        const next = idx >= 0 ? (idx + 1) % modes.length : 0;
        return modes[next];
      });
    }, 30000);
    return () => window.clearInterval(id);
  }, [prefersReducedMotion, guestOpen, dateOpen]);

  // Responsive: show two months on md+ screens, single month on small screens
  const [isWideScreen, setIsWideScreen] = useState(false);
  useEffect(() => {
    const check = () => setIsWideScreen(window.innerWidth >= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Rotating search hints for the search input placeholder
  const searchHints = ['Zanzibar', 'Serengeti', 'Dar es Salaam', 'Arusha', 'Kilimanjaro', 'Ngorongoro'];
  const [hintIdx, setHintIdx] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setHintIdx((i) => (i + 1) % searchHints.length), 2500);
    return () => clearInterval(id);
  }, [searchHints.length]);
  const searchPlaceholder = `Where are you going? e.g. ${searchHints[hintIdx]}`;
  const guestCount = adults + children;
  const guestLabel = `${guestCount} ${guestCount === 1 ? 'guest' : 'guests'}${pets ? `, ${pets} ${pets === 1 ? 'pet' : 'pets'}` : ''}`;

  // Format a concise range like "21-25/11/2025" when month/year are the same
  const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formatSingleShort = (iso?: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const day = String(d.getDate()).padStart(2, '0');
      const mon = monthShort[d.getMonth()];
      return `${mon} ${day}`;
    } catch (e) {
      return iso;
    }
  };

  // Format ranges like "Nov 22-30" or "Dec 31-Jan 02" (no year shown)
  const formatRangeShort = (fromStr?: string, toStr?: string) => {
    if (!fromStr) return '';
    if (!toStr) return formatSingleShort(fromStr);
    try {
      const f = new Date(fromStr);
      const t = new Date(toStr);
      const fDay = String(f.getDate()).padStart(2, '0');
      const tDay = String(t.getDate()).padStart(2, '0');
      const fMon = monthShort[f.getMonth()];
      const tMon = monthShort[t.getMonth()];
      if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) {
        // same month & year: "Nov 22-30"
        return `${fMon} ${parseInt(fDay, 10)}-${parseInt(tDay, 10)}`;
      }
      // different month or year: "Dec 31-Jan 02"
      return `${fMon} ${parseInt(fDay, 10)}-${tMon} ${tDay}`;
    } catch (e) {
      return `${fromStr}${toStr ? ` - ${toStr}` : ''}`;
    }
  };

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    // Build query params
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (adults) params.set('adults', String(adults));
    if (children) params.set('children', String(children));
    if (pets) params.set('pets', String(pets));
    if (pregnancy) params.set('pregnancy', '1');
    if (checkin) params.set('checkin', checkin);
    if (checkout) params.set('checkout', checkout);
    const href = `/public/properties?${params.toString()}`;
    // navigate to search results
    setMobileSearchOpen(false);
    setGuestOpen(false);
    setDateOpen(false);
    router.push(href);
  };

  // Inject lightweight animations used in the hero (no photo assets)
  useEffect(() => {
    const styleId = "nolsaf-public-hero-anim";
    if (document.getElementById(styleId)) return;

    const css = [
      "@keyframes nolsafFloat {",
      "  0% { transform: translate3d(0, 0, 0); }",
      "  50% { transform: translate3d(0, -10px, 0); }",
      "  100% { transform: translate3d(0, 0, 0); }",
      "}",
      ".nolsaf-float { animation: nolsafFloat 6s ease-in-out infinite; }",
      ".nolsaf-float-slow { animation: nolsafFloat 9s ease-in-out infinite; }",
      "@media (prefers-reduced-motion: reduce) {",
      "  .nolsaf-float, .nolsaf-float-slow { animation: none !important; }",
      "}",
    ].join("\n");

    const el = document.createElement("style");
    el.id = styleId;
    el.textContent = css;
    document.head.appendChild(el);
  }, []);

  // Close guest selector when clicking outside or pressing Escape
  // Guest popover: intentionally do not close on outside click or Escape —
  // it should only close via the Close or Done buttons so users can clear selections safely.

  // Position popover using fixed coordinates via CSS variables so it won't be clipped by hero's overflow-hidden
  useEffect(() => {
    if (!guestOpen) {
      // clear vars
      document.documentElement.style.removeProperty('--nolsaf-guest-left');
      document.documentElement.style.removeProperty('--nolsaf-guest-top');
      document.documentElement.style.removeProperty('--nolsaf-guest-width');
      return;
    }
    const update = () => {
      const btn = window.innerWidth < 768 ? mobileGuestTriggerRef.current : triggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 220), 360);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const top = Math.min(window.innerHeight - 40, r.bottom + 8);
      document.documentElement.style.setProperty('--nolsaf-guest-left', `${left}px`);
      document.documentElement.style.setProperty('--nolsaf-guest-top', `${top}px`);
      document.documentElement.style.setProperty('--nolsaf-guest-width', `${width}px`);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [guestOpen, mobileSearchOpen]);

  // Position date panel using fixed coordinates via CSS variables so it won't be clipped by hero's overflow-hidden
  useEffect(() => {
    if (!dateOpen) {
      document.documentElement.style.removeProperty('--nolsaf-date-left');
      document.documentElement.style.removeProperty('--nolsaf-date-top');
      document.documentElement.style.removeProperty('--nolsaf-date-width');
      return;
    }
    const update = () => {
      const btn = window.innerWidth < 768 ? mobileDateRef.current : dateRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      // Ensure enough width for two months on desktop; increase minimum to improve visibility
      const isDesktop = window.innerWidth >= 768;
      const desiredMin = isDesktop ? 760 : 300; // increased desktop minimum to 760px
      const desiredMax = isDesktop ? Math.min(1100, window.innerWidth - 32) : Math.min(520, window.innerWidth - 32);
      const width = Math.min(desiredMax, Math.max(desiredMin, r.width));
      // Center the popper horizontally around the trigger when possible
      let left = r.left - Math.max(0, (width - r.width) / 2);
      // clamp within viewport
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const top = Math.min(window.innerHeight - 40, r.bottom + 8);
      document.documentElement.style.setProperty('--nolsaf-date-left', `${left}px`);
      document.documentElement.style.setProperty('--nolsaf-date-top', `${top}px`);
      document.documentElement.style.setProperty('--nolsaf-date-width', `${width}px`);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [dateOpen, mobileSearchOpen]);

  useEffect(() => {
    // Inject card animations and fade-in effects
    const styleId = 'nolsaf-card-animations';
    if (!document.getElementById(styleId)) {
      const css = `
        .nls-blink { animation: nls-blink 800ms linear infinite; }
        @keyframes nls-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.18; } }
        
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `;
      const el = document.createElement('style');
      el.id = styleId;
      el.textContent = css;
      document.head.appendChild(el);
    }

    return () => {};
  }, []);

  // Countries list: stable order (no auto-rotation)
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Layout edge markers (left/right) to indicate content boundaries */}
      {/* Hero surround frame */}
      <div className="public-container py-5 sm:py-8">
        <div className="relative mx-0 overflow-hidden rounded-3xl p-0">

          {/* Inner 1px border — teal-to-blue premium line */}
          <div className="relative rounded-3xl border border-emerald-950/15 bg-[#02665e]">

            <section
              id="public-hero"
              className="relative isolate overflow-hidden rounded-[23px] text-white"
              ref={heroRef as any}
              onPointerEnter={() => setHeroPointerActive(true)}
              onPointerLeave={() => { setHeroPointerActive(false); setHeroPressed(false); }}
              onPointerMove={(e) => { if (prefersReducedMotion) return; queueHeroPointer(e.clientX, e.clientY); }}
              onPointerDown={(e) => {
                setHeroPointerActive(true); queueHeroPointer(e.clientX, e.clientY); setHeroPressed(true);
                if (heroPressTimerRef.current != null) window.clearTimeout(heroPressTimerRef.current);
                heroPressTimerRef.current = window.setTimeout(() => setHeroPressed(false), 220);
              }}
              onPointerUp={() => setHeroPressed(false)}
            >
          {/* Inner ring highlight */}
         {/*FULL-BLEED HERO BACKGROUND */}
        <div className="hidden" aria-hidden>

          {/* Background — owner portal teal gradient */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#020f0d 0%,#011c18 22%,#023a32 48%,#025549 72%,#02705f 90%,#048070 100%)" }} />

          {/* Dot grid */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.13]" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "20px 20px" }} />

          {/* Horizontal depth lines */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,1) 39px,rgba(255,255,255,1) 40px)" }} />

          {/* Vignette */}
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%,rgba(0,0,0,0) 0%,rgba(0,0,0,0.45) 100%)" }} />

          {/* Ambient glows */}
          <div className="pointer-events-none absolute -top-20 left-1/3 h-72 w-72 rounded-full" style={{ background: "radial-gradient(circle,rgba(4,180,150,0.22) 0%,transparent 70%)" }} />
          <div className="pointer-events-none absolute -bottom-16 -left-10 h-56 w-56 rounded-full" style={{ background: "radial-gradient(circle,rgba(0,240,190,0.10) 0%,transparent 70%)" }} />



          {/* SVG area wave */}
          <svg className="pointer-events-none absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 400 180" style={{ opacity: 0.07 }}>
            <defs>
              <linearGradient id="heroWave" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00ffcc" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#00ffcc" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0,140 C60,100 100,160 160,90 C220,30 260,120 320,70 C360,30 380,60 400,50 L400,180 L0,180 Z" fill="url(#heroWave)" />
            <path d="M0,140 C60,100 100,160 160,90 C220,30 260,120 320,70 C360,30 380,60 400,50" fill="none" stroke="#00ffcc" strokeWidth="2" />
          </svg>

          {/* ════════════════════════════════════════════
               ARCHITECTURAL LUXURY VISUALIZATION
               Inspired by: hotel atrium floor plans,
               premium property blueprints, and skyline
               silhouettes — all teal+gold palette
          ════════════════════════════════════════════ */}
          <div className="pointer-events-none absolute inset-0" aria-hidden style={{ display: "none" }}>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 680" preserveAspectRatio="xMidYMid slice">
              <defs>
                {/* Fade mask — strong centre, dissolves at edges */}
                <radialGradient id="vis-fade" cx="62%" cy="48%" r="52%">
                  <stop offset="0%"  stopColor="white" stopOpacity="1" />
                  <stop offset="50%" stopColor="white" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="white" stopOpacity="0" />
                </radialGradient>
                <mask id="vis-mask">
                  <rect width="1200" height="680" fill="url(#vis-fade)" />
                </mask>
                {/* Dot grid fill */}
                <pattern id="arch-dots" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
                  <circle cx="16" cy="16" r="1.0" fill="#5eead4" fillOpacity="0.22" />
                </pattern>
                {/* Gold tint for luxury accents */}
                <linearGradient id="gold-line" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="#fbbf24" stopOpacity="0.70" />
                  <stop offset="100%" stopColor="#02665e" stopOpacity="0.50" />
                </linearGradient>
                <linearGradient id="teal-line" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="#02665e" stopOpacity="0.60" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.35" />
                </linearGradient>
                <linearGradient id="sky-line" x1="0%" y1="0%" x2="100%" y2="98%">
                  <stop offset="0%"   stopColor="#38bdf8" stopOpacity="0.50" />
                  <stop offset="100%" stopColor="#02665e" stopOpacity="0.30" />
                </linearGradient>
              </defs>

              <g mask="url(#vis-mask)">
                {/* ─── Dot grid base ─── */}
                <rect width="1200" height="680" fill="url(#arch-dots)" />

                {/* ─── Skyline silhouette (right side) ─── */}
                <g fill="none" stroke="#2dd4bf" strokeOpacity="0.14" strokeWidth="0.8">
                  {/* Building columns */}
                  <rect x="720" y="280" width="28" height="280" rx="2" />
                  <rect x="760" y="220" width="36" height="340" rx="2" />
                  <rect x="808" y="300" width="24" height="260" rx="2" />
                  <rect x="844" y="180" width="44" height="380" rx="2" />
                  <rect x="900" y="250" width="30" height="310" rx="2" />
                  <rect x="942" y="310" width="22" height="250" rx="2" />
                  <rect x="976" y="200" width="40" height="360" rx="2" />
                  <rect x="1028" y="260" width="26" height="300" rx="2" />
                  <rect x="1066" y="320" width="20" height="240" rx="2" />
                  <rect x="1098" y="230" width="32" height="330" rx="2" />
                  {/* Window grid lines on tallest building */}
                  {[230,260,290,320,350,380,410,440,470,500].map(y => (
                    <line key={y} x1="846" y1={y} x2="886" y2={y} strokeOpacity="0.09" />
                  ))}
                  {[854,866,878].map(x => (
                    <line key={x} x1={x} y1="182" x2={x} y2="558" strokeOpacity="0.09" />
                  ))}
                </g>

                {/* ─── Concentric luxury ellipses (atrium / grand hall feel) ─── */}
                <g fill="none">
                  <ellipse cx="860" cy="420" rx="280" ry="160" stroke="#02665e" strokeOpacity="0.32" strokeWidth="1.0" />
                  <ellipse cx="860" cy="420" rx="210" ry="118" stroke="#02665e" strokeOpacity="0.40" strokeWidth="1.1" />
                  <ellipse cx="860" cy="420" rx="145" ry="80" stroke="#2dd4bf" strokeOpacity="0.50" strokeWidth="1.3" />
                  <ellipse cx="860" cy="420" rx="85" ry="46" stroke="#2dd4bf" strokeOpacity="0.65" strokeWidth="1.4" />
                  <ellipse cx="860" cy="420" rx="40" ry="22" stroke="#fbbf24" strokeOpacity="0.55" strokeWidth="1.2" />
                </g>

                {/* ─── Floor plan grid (hotel room layout) ─── */}
                <g stroke="#38bdf8" strokeOpacity="0.10" strokeWidth="0.7" fill="none">
                  {/* Horizontal corridors */}
                  <line x1="580" y1="340" x2="1180" y2="340" />
                  <line x1="580" y1="400" x2="1180" y2="400" />
                  <line x1="580" y1="460" x2="1180" y2="460" />
                  <line x1="580" y1="520" x2="1180" y2="520" />
                  {/* Vertical room dividers */}
                  {[620,660,700,740,780].map(x => (
                    <line key={x} x1={x} y1="340" x2={x} y2="520" />
                  ))}
                </g>

                {/* ─── Property location routes ─── */}
                <g fill="none" strokeWidth="1.4" strokeDasharray="8 5">
                  <path d="M 60 560 Q 220 340 480 200" stroke="url(#teal-line)" />
                  <path d="M 480 200 Q 620 120 780 170" stroke="url(#sky-line)" />
                  <path d="M 130 600 Q 340 400 620 320" stroke="url(#teal-line)" strokeDasharray="5 7" strokeWidth="1.1" />
                  <path d="M 300 580 Q 460 360 700 260" stroke="url(#gold-line)" strokeDasharray="6 6" strokeWidth="1.0" />
                </g>

                {/* ─── Location nodes ─── */}
                <g fill="none">
                  {/* Primary — teal rings */}
                  <circle cx="480" cy="200" r="11" stroke="#2dd4bf" strokeOpacity="0.80" strokeWidth="1.6" />
                  <circle cx="480" cy="200" r="22" stroke="#2dd4bf" strokeOpacity="0.34" strokeWidth="1.0" />
                  <circle cx="780" cy="170" r="9"  stroke="#fbbf24" strokeOpacity="0.75" strokeWidth="1.5" />
                  <circle cx="780" cy="170" r="19" stroke="#fbbf24" strokeOpacity="0.28" strokeWidth="0.9" />
                  <circle cx="620" cy="320" r="8"  stroke="#38bdf8" strokeOpacity="0.72" strokeWidth="1.4" />
                  <circle cx="620" cy="320" r="17" stroke="#38bdf8" strokeOpacity="0.28" strokeWidth="0.8" />
                  {/* Secondary */}
                  <circle cx="60"  cy="560" r="6"  stroke="#5eead4" strokeOpacity="0.55" strokeWidth="1.2" />
                  <circle cx="300" cy="580" r="5"  stroke="#93c5fd" strokeOpacity="0.50" strokeWidth="1.1" />
                </g>

                {/* ─── Node fill dots ─── */}
                <g>
                  <circle cx="480" cy="200" r="4.5" fill="#2dd4bf" fillOpacity="1" />
                  <circle cx="780" cy="170" r="4.0" fill="#fbbf24" fillOpacity="1" />
                  <circle cx="620" cy="320" r="3.5" fill="#38bdf8" fillOpacity="1" />
                  <circle cx="60"  cy="560" r="3.0" fill="#5eead4" fillOpacity="0.88" />
                  <circle cx="300" cy="580" r="2.5" fill="#93c5fd" fillOpacity="0.80" />
                  <circle cx="130" cy="600" r="2.5" fill="#5eead4" fillOpacity="0.75" />
                </g>

                {/* ─── Gold accent star (luxury marker) at primary node ─── */}
                <g transform="translate(776,166)" fill="#fbbf24" fillOpacity="0.95">
                  <polygon points="4,0 5,3 8,3 5.5,5 6.5,8 4,6 1.5,8 2.5,5 0,3 3,3" />
                </g>
              </g>

              {/* ══════════════════════════════════════════════
                   BOTTOM-LEFT CORNER DECORATION (no mask)
                   Quarter-circle arcs · building blueprint
                   location cluster · scan lines · label chip
              ══════════════════════════════════════════════ */}
              <g>
                {/* Quarter-circle arcs radiating from bottom-left corner */}
                <g fill="none">
                  <path d="M 0 680 A 90 90 0 0 1 90 590" stroke="#2dd4bf" strokeOpacity="0.60" strokeWidth="1.3" />
                  <path d="M 0 680 A 165 165 0 0 1 165 515" stroke="#2dd4bf" strokeOpacity="0.44" strokeWidth="1.1" />
                  <path d="M 0 680 A 255 255 0 0 1 255 425" stroke="#02665e" strokeOpacity="0.50" strokeWidth="1.0" />
                  <path d="M 0 680 A 360 360 0 0 1 360 320" stroke="#38bdf8" strokeOpacity="0.28" strokeWidth="0.8" />
                  <path d="M 0 680 A 460 460 0 0 1 420 240" stroke="#5eead4" strokeOpacity="0.16" strokeWidth="0.7" />
                </g>

                {/* Mini hotel / property blueprint sketch */}
                <g stroke="#2dd4bf" strokeOpacity="0.52" strokeWidth="0.9" fill="none">
                  <rect x="46" y="496" width="56" height="38" rx="1.5" />
                  <line x1="74" y1="496" x2="74" y2="534" />
                  <line x1="46" y1="515" x2="102" y2="515" />
                  <path d="M 40 496 L 74 482 L 108 496" strokeOpacity="0.38" />
                  <path d="M 66 534 L 66 544 L 82 544 L 82 534" strokeOpacity="0.60" />
                  <rect x="52" y="500" width="14" height="10" rx="1" strokeOpacity="0.35" />
                  <rect x="86" y="500" width="14" height="10" rx="1" strokeOpacity="0.35" />
                </g>
                <g transform="translate(70,478)" fill="#fbbf24" fillOpacity="0.75">
                  <polygon points="4,0 5,3 8,3 5.5,5 6.5,8 4,6 1.5,8 2.5,5 0,3 3,3" />
                </g>

                {/* Location cluster — nodes with rings */}
                <g fill="none">
                  <circle cx="60"  cy="562" r="13" stroke="#5eead4" strokeOpacity="0.48" strokeWidth="1.1" />
                  <circle cx="60"  cy="562" r="24" stroke="#5eead4" strokeOpacity="0.22" strokeWidth="0.8" />
                  <circle cx="145" cy="604" r="10" stroke="#2dd4bf" strokeOpacity="0.52" strokeWidth="1.1" />
                  <circle cx="145" cy="604" r="20" stroke="#2dd4bf" strokeOpacity="0.22" strokeWidth="0.7" />
                  <circle cx="210" cy="572" r="8"  stroke="#38bdf8" strokeOpacity="0.48" strokeWidth="1.0" />
                  <circle cx="210" cy="572" r="16" stroke="#38bdf8" strokeOpacity="0.20" strokeWidth="0.6" />
                  <circle cx="270" cy="612" r="6"  stroke="#a78bfa" strokeOpacity="0.40" strokeWidth="0.9" />
                  <circle cx="310" cy="588" r="5"  stroke="#fbbf24" strokeOpacity="0.38" strokeWidth="0.9" />
                </g>

                {/* Node fill dots */}
                <g>
                  <circle cx="60"  cy="562" r="3.5" fill="#5eead4"  fillOpacity="0.95" />
                  <circle cx="145" cy="604" r="3.0" fill="#2dd4bf"  fillOpacity="0.90" />
                  <circle cx="210" cy="572" r="2.5" fill="#38bdf8"  fillOpacity="0.88" />
                  <circle cx="270" cy="612" r="2.5" fill="#a78bfa"  fillOpacity="0.78" />
                  <circle cx="310" cy="588" r="2.0" fill="#fbbf24"  fillOpacity="0.72" />
                  <circle cx="180" cy="640" r="2.0" fill="#5eead4"  fillOpacity="0.65" />
                  <circle cx="245" cy="650" r="1.8" fill="#93c5fd"  fillOpacity="0.60" />
                </g>

                {/* Route connectors between nodes */}
                <g fill="none" strokeWidth="1.1" strokeDasharray="5 5">
                  <path d="M 60 562 Q 102 583 145 604" stroke="#5eead4" strokeOpacity="0.55" />
                  <path d="M 145 604 Q 177 588 210 572" stroke="#2dd4bf" strokeOpacity="0.50" />
                  <path d="M 210 572 Q 240 580 270 612" stroke="#a78bfa" strokeOpacity="0.38" strokeDasharray="4 6" />
                  <path d="M 210 572 Q 260 580 310 588" stroke="#fbbf24" strokeOpacity="0.32" strokeDasharray="4 7" />
                  <path d="M 60 562 Q 135 567 210 572" stroke="#38bdf8" strokeOpacity="0.28" strokeDasharray="3 7" />
                </g>

                {/* Horizontal terrain / scan lines */}
                <g stroke="#2dd4bf" strokeOpacity="0.14" strokeWidth="0.65">
                  {[574, 590, 606, 622, 638, 654, 668].map((y) => (
                    <line key={y} x1="0" y1={y} x2="360" y2={y} />
                  ))}
                </g>

                {/* Left-edge tick marks */}
                <g stroke="#2dd4bf" strokeOpacity="0.40" strokeWidth="1.2">
                  {[520, 560, 600, 640].map((y) => (
                    <line key={y} x1="0" y1={y} x2="7" y2={y} />
                  ))}
                </g>

                {/* NOLSAF label chip */}
                <rect x="12" y="622" width="92" height="19" rx="9.5" fill="#02665e" fillOpacity="0.30" />
                <rect x="12" y="622" width="92" height="19" rx="9.5" stroke="#2dd4bf" strokeOpacity="0.48" strokeWidth="0.8" fill="none" />
                <text x="27" y="635.5" fill="#5eead4" fillOpacity="0.90" fontSize="8.5" fontFamily="monospace" letterSpacing="1.5">NOLSAF</text>
              </g>
            </svg>
          </div>

          {/* Bottom teal horizon */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48"
            style={{ background: "linear-gradient(to top,rgba(2,102,94,0.40) 0%,rgba(5,40,90,0.18) 50%,transparent 100%)" }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-teal-400/60 to-transparent" />

          {/* Right-edge tick ruler */}
          <div className="pointer-events-none absolute inset-y-0 right-0" aria-hidden>
            <svg className="h-full w-8" viewBox="0 8 32 684" preserveAspectRatio="none">
              {[80,160,240,320,400,480,560,640].map((y) => (
                <line key={y} x1="28" y1={y} x2="32" y2={y} stroke="#2dd4bf" strokeOpacity="0.30" strokeWidth="1.5" />
              ))}
              <line x1="30" y1="8" x2="30" y2="692" stroke="#2dd4bf" strokeOpacity="0.07" strokeWidth="0.8" />
            </svg>
          </div>

          {/* Top highlight */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </div>

        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          aria-hidden
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="relative z-10">
          <div className="relative flex flex-col lg:flex-row lg:items-stretch gap-0">
              <div className="flex flex-1 flex-col items-center px-5 py-9 sm:px-8 sm:py-12 lg:px-12 lg:py-14">
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                  className="mx-auto max-w-3xl text-center"
                >
                  <h1 className="mx-auto max-w-3xl text-balance text-3xl font-bold leading-[1.08] tracking-[-0.04em] text-white sm:text-4xl lg:text-[3.25rem]">
                    Quality stays for every wallet.
                  </h1>

                  <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/75 sm:text-base">
                    One platform for stays, transport &amp; experiences.
                  </p>
                  <div className="mx-auto mt-5 flex max-w-md items-center" aria-hidden>
                    <span className="h-px flex-1 bg-white/25" />
                    <span className="mx-3 h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.14)]" />
                    <span className="h-px flex-1 bg-white/25" />
                  </div>

                </motion.div>

                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.08, ease: [0.2, 0.8, 0.2, 1] }}
                  className="mx-auto mt-6 w-full max-w-[620px]"
                >
                <form onSubmit={submitSearch} className="w-full pointer-events-auto">
                  <div className="md:hidden w-full max-w-md mx-auto">
                    {!mobileSearchOpen ? (
                      <button
                        type="button"
                        aria-label="Open search"
                        aria-expanded={false}
                        onClick={() => setMobileSearchOpen(true)}
                        className="flex h-12 w-full items-center gap-2.5 rounded-full border border-slate-200 bg-white px-1.5 pr-3 text-left text-slate-900 shadow-[0_8px_22px_rgba(2,6,23,0.18)] transition active:scale-[0.99]"
                      >
                        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#087f69] text-white">
                          <Search className="h-4 w-4 stroke-[2.5]" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold">{q || 'Search stays'}</span>
                          <span className="block truncate text-[10px] leading-4 text-slate-500">
                            {q || 'Anywhere'}
                            {' · '}
                            {checkin ? (checkout ? formatRangeShort(checkin, checkout) : formatSingleShort(checkin)) : 'Any week'}
                            {' · '}
                            {guestLabel}
                          </span>
                        </span>
                      </button>
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5 text-left text-slate-900 shadow-[0_14px_34px_rgba(2,6,23,0.22)]">
                        <div className="mb-1.5 flex items-center justify-between px-1">
                          <span className="text-xs font-bold">Find your stay</span>
                          <button
                            type="button"
                            aria-label="Close search"
                            onClick={() => {
                              setMobileSearchOpen(false);
                              setDateOpen(false);
                              setGuestOpen(false);
                            }}
                            className="grid h-8 w-8 place-items-center rounded-full border-0 bg-slate-100 text-slate-700 outline-none hover:bg-slate-200"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <label className="flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-emerald-600 focus-within:bg-white">
                          <MapPin className="h-4 w-4 flex-none text-[#087f69]" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <input
                              aria-label="Search query"
                              value={q}
                              onChange={(e) => setQ(e.target.value)}
                              placeholder={searchPlaceholder}
                              className="w-full min-w-0 border-0 bg-transparent text-xs font-medium text-slate-900 shadow-none outline-none placeholder:text-slate-400 focus:border-0 focus:outline-none focus:ring-0"
                            />
                          </span>
                        </label>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            ref={mobileDateRef}
                            aria-label="Select dates"
                            aria-expanded={dateOpen}
                            onClick={() => {
                              setGuestOpen(false);
                              setDateOpen((value) => !value);
                            }}
                            className="flex h-11 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left shadow-none outline-none hover:bg-slate-50"
                          >
                            <CalendarDays className="h-4 w-4 flex-none text-slate-700" aria-hidden />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium text-slate-700">
                                {checkin ? (checkout ? formatRangeShort(checkin, checkout) : formatSingleShort(checkin)) : 'Add dates'}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            ref={mobileGuestTriggerRef}
                            aria-label="Open guest selector"
                            aria-expanded={guestOpen}
                            onClick={() => {
                              setDateOpen(false);
                              setGuestOpen(true);
                            }}
                            className="flex h-11 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left shadow-none outline-none hover:bg-slate-50"
                          >
                            <User className="h-4 w-4 flex-none text-slate-700" aria-hidden />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium text-slate-700">{guestLabel}</span>
                            </span>
                          </button>
                        </div>
                        <button
                          type="submit"
                          className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#087f69] px-4 text-xs font-bold text-white shadow-none outline-none hover:bg-[#066b59] active:scale-[0.99]"
                        >
                          <Search className="h-4 w-4" aria-hidden />
                          Search
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="hidden h-[52px] w-full items-stretch overflow-visible rounded-full border border-emerald-100 bg-white p-1.5 text-slate-900 shadow-[0_12px_30px_-20px_rgba(6,78,59,0.38)] md:flex">
                    <label className="order-1 flex min-w-0 flex-[1.2] cursor-text items-center gap-2 rounded-full px-3 text-left transition hover:bg-slate-50 focus-within:bg-slate-50">
                      <MapPin className="h-4 w-4 flex-none text-emerald-700" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <input
                          aria-label="Search query"
                          value={q}
                          onChange={(e) => setQ(e.target.value)}
                          placeholder="Where to?"
                          className="w-full min-w-0 border-0 bg-transparent text-[13px] font-medium text-slate-900 shadow-none outline-none placeholder:text-slate-500 focus:border-0 focus:outline-none focus:ring-0"
                        />
                      </span>
                    </label>
                    <span className="order-2 my-2 w-px flex-none bg-slate-200" aria-hidden />
                      <span className="order-4 my-2 hidden w-px flex-none bg-slate-200 md:block" aria-hidden />
                      <div ref={guestRef} className="order-5 hidden min-w-0 flex-[0.8] items-center justify-center overflow-visible rounded-full px-3 text-left transition hover:bg-slate-50 md:inline-flex">
                        <div className="relative w-full">
                          <button
                            type="button"
                            aria-label="Open guest selector"
                            aria-expanded={guestOpen}
                            ref={triggerRef}
                            onClick={() => { setDateOpen(false); setGuestOpen(true); }}
                            className="flex w-full min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left text-slate-900 shadow-none outline-none"
                          >
                            <User className="h-4 w-4 flex-none text-slate-500" aria-hidden />
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium text-slate-800">{guestLabel}</span>
                            </span>
                          </button>
                        </div>

                        {guestOpen ? (
                          createPortal(
                            <div className="nolsaf-guest-popper pointer-events-auto bg-white rounded shadow-lg z-30 text-slate-900 border border-slate-200">
                              <div className="p-3">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">Guests</div>
                                    <div className="text-xs text-slate-500">Adults, children, pets</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => { setGuestOpen(false); }} aria-label="Close guest selector" className="p-1 text-slate-600 rounded hover:bg-slate-100">
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>

                                <div className="mt-3 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-sm font-medium">Adults</div>
                                      <div className="text-xs text-slate-500">Age 16 and older</div>
                                    </div>
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        aria-label="Decrease adults"
                                        onClick={() => setAdults((a) => Math.max(1, a - 1))}
                                        disabled={adults <= 1}
                                        aria-disabled={adults <= 1}
                                        className="h-8 w-8 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 active:scale-95 transition"
                                      >
                                        −
                                      </button>
                                      <div className="px-3 py-1 min-w-[2.25rem] text-center">{adults}</div>
                                      <button
                                        type="button"
                                        aria-label="Increase adults"
                                        onClick={() => setAdults((a) => Math.min(10, a + 1))}
                                        disabled={adults >= 10}
                                        aria-disabled={adults >= 10}
                                        className="h-8 w-8 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 active:scale-95 transition"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-sm font-medium">Children</div>
                                      <div className="text-xs text-slate-500">Ages 0 to 15</div>
                                    </div>
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        aria-label="Decrease children"
                                        onClick={() => setChildren((c) => Math.max(0, c - 1))}
                                        disabled={children <= 0}
                                        aria-disabled={children <= 0}
                                        className="h-8 w-8 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 active:scale-95 transition"
                                      >
                                        −
                                      </button>
                                      <div className="px-3 py-1 min-w-[2rem] text-center">{children}</div>
                                      <button
                                        type="button"
                                        aria-label="Increase children"
                                        onClick={() => setChildren((c) => Math.min(10, c + 1))}
                                        disabled={children >= 10}
                                        aria-disabled={children >= 10}
                                        className="h-8 w-8 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 active:scale-95 transition"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-sm font-medium">Pets</div>
                                      <div className="text-xs text-slate-500">Optional</div>
                                    </div>
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        aria-label="Decrease pets"
                                        onClick={() => setPets((p) => Math.max(0, p - 1))}
                                        disabled={pets <= 0}
                                        aria-disabled={pets <= 0}
                                        className="h-8 w-8 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 active:scale-95 transition"
                                      >
                                        −
                                      </button>
                                      <div className="px-3 py-1 min-w-[2rem] text-center">{pets}</div>
                                      <button
                                        type="button"
                                        aria-label="Increase pets"
                                        onClick={() => setPets((p) => Math.min(5, p + 1))}
                                        disabled={pets >= 5}
                                        aria-disabled={pets >= 5}
                                        className="h-8 w-8 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 active:scale-95 transition"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-sm font-medium">Pregnancy</div>
                                      <div id="preg-help" className="text-xs text-slate-500">Hosts are notified when selected</div>
                                    </div>
                                    <div>
                                      <button
                                        type="button"
                                        role="switch"
                                        aria-checked={pregnancy}
                                        aria-describedby="preg-help"
                                        aria-label={pregnancy ? 'Pregnancy selected; hosts will be notified' : 'Indicate pregnancy to notify hosts'}
                                        onClick={() => setPregnancy((p) => !p)}
                                        className={`nolsaf-preg-toggle inline-flex items-center p-0.5 rounded-full focus:outline-none ${pregnancy ? 'is-on' : 'is-off'}`}
                                      >
                                        <span className="nolsaf-preg-knob" />
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-3">
                                  <button
                                    type="button"
                                    onClick={() => { setAdults(1); setChildren(0); setPets(0); setPregnancy(false); }}
                                    className="rounded-lg border-0 bg-transparent px-3 py-2 text-xs font-semibold text-slate-600 outline-none transition hover:bg-slate-100"
                                  >
                                    Clear
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setGuestOpen(false); }}
                                    className="rounded-lg border-0 bg-emerald-700 px-4 py-2 text-xs font-bold text-white outline-none transition hover:bg-emerald-800 active:scale-95"
                                  >
                                    Done
                                  </button>
                                </div>
                              </div>
                            </div>, document.body
                          )
                        ) : null}
                      </div>
                      <div ref={dateRef} className="order-3 hidden min-w-0 flex-1 items-center justify-center rounded-full px-3 text-left transition hover:bg-slate-50 md:inline-flex">
                        <button
                          type="button"
                          aria-label="Select dates"
                          aria-expanded={dateOpen}
                          onClick={() => { setGuestOpen(false); setDateOpen((v) => !v); }}
                          className="flex w-full min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left text-slate-900 shadow-none outline-none"
                        >
                          <CalendarDays className="h-4 w-4 flex-none text-slate-500" aria-hidden />
                          <span className="min-w-0">
                            <span className="block w-full truncate text-[13px] font-medium text-slate-800">
                              {checkin ? (checkout ? formatRangeShort(checkin, checkout) : formatSingleShort(checkin)) : 'Any dates'}
                            </span>
                          </span>
                        </button>

                        {dateOpen ? (
                          createPortal(
                            <div className="nolsaf-date-popper z-30">
                              {/* Mobile grabber */}
                              <div className="nolsaf-sheet-grabber-wrapper">
                                <div className="nolsaf-sheet-grabber" aria-hidden />
                              </div>
                              <DatePicker
                                selected={checkin && checkout ? [checkin, checkout] : checkin || undefined}
                                onSelectAction={(s) => {
                                  if (!s) { setCheckin(''); setCheckout(''); return; }
                                  if (Array.isArray(s)) {
                                    setCheckin(s[0] || '');
                                    setCheckout(s[1] || '');
                                  } else {
                                    setCheckin(s);
                                    setCheckout('');
                                  }
                                }}
                                onCloseAction={() => setDateOpen(false)}
                                allowRange
                                allowPast={false}
                                twoMonths={isWideScreen}
                              />
                            </div>,
                            document.body
                          )
                        ) : null}
                      </div>
                      <button
                        type="submit"
                        aria-label="Search stays"
                        className="order-7 ml-1 hidden h-10 w-10 flex-none items-center justify-center rounded-full border-0 bg-emerald-700 text-white shadow-[0_8px_18px_-10px_rgba(4,120,87,0.7)] outline-none transition hover:bg-emerald-800 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/30 md:flex"
                      >
                        <Search className="h-[18px] w-[18px]" aria-hidden />
                        <span className="sr-only">Search</span>
                      </button>
                    </div>
                  </form>
                  {/* Primary CTA */}
                  <div className="mt-5 hidden w-full justify-center sm:flex sm:mt-6">
                    <Link href="/public/properties" aria-label="Browse all stays" className="no-underline">
                      <span className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-neutral-950 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-neutral-900/10 transition hover:-translate-y-0.5 hover:bg-emerald-700">
                        <BedDouble className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="whitespace-nowrap">Browse all stays</span>
                        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
                      </span>
                    </Link>
                  </div>

                  {/* Social proof strip */}
                  <div className="mt-6 hidden w-full justify-center sm:flex">
                    <div className="flex items-center gap-4 text-[11px] font-medium tracking-wide text-white/70 sm:gap-6 sm:text-xs">
                      <span className="flex items-center gap-1.5">
                        <BedDouble className="h-3.5 w-3.5 text-white/85" />
                        2,500+ Stays
                      </span>
                      <span className="h-3 w-px bg-white/20" aria-hidden />
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-white/85" />
                        30+ Regions
                      </span>
                      <span className="h-3 w-px bg-white/20" aria-hidden />
                      <span className="flex items-center gap-1.5">
                        <span className="text-white/85">★</span>
                        Trusted by travelers
                      </span>
                    </div>
                  </div>

                </motion.div>

              </div>



          </div>

        </div>

        {/* Decorative separator marking end of hero */}
        <div className="hidden">
          <div className="public-container pb-8 lg:pb-12">
            <div className="h-px w-full bg-gradient-to-r from-transparent via-white/15 to-transparent" aria-hidden />
          </div>
        </div>
            </section>
          </div>
        </div>
      </div>

      <section id="public-audience" className="relative py-10 sm:py-12 lg:py-14 overflow-hidden">
        {/* Section background: soft brand tint only */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,#f0fdf8 0%,#ffffff 55%,#f0fdf4 100%)' }} />
        <div aria-hidden className="pointer-events-none absolute -top-32 -left-24 w-[500px] h-[500px] rounded-full opacity-[0.07] blur-[100px]"
          style={{ background: 'radial-gradient(circle, #10b981, transparent 70%)' }} />
        {/* Subtle dot grid */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.018]"
          style={{ backgroundImage: 'radial-gradient(circle, #64748b 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        {/* Top + bottom accent lines */}
        <div aria-hidden className="pointer-events-none absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
        <div aria-hidden className="pointer-events-none absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

        <div className="public-container relative z-10">

          {/* Compact header: same scale as the other homepage sections */}
          <div className="mb-6 flex flex-col items-center text-center sm:mb-8">
            <p className="m-0 inline-flex items-center rounded-md bg-[#02665e]/[0.08] px-2 py-1 text-[11px] font-semibold text-[#02665e]">
              Who it&apos;s for
            </p>
            <h2 className="m-0 mt-3 text-[22px] font-bold leading-snug tracking-tight text-slate-900 sm:text-[26px] lg:text-[30px]">
              Built for <span className="text-[#02665e]">everyone in the trip</span>
            </h2>
            <p className="m-0 mt-2 max-w-[52ch] text-[14px] leading-relaxed text-slate-500">
              Travellers, drivers, property owners and tour operators, connected in one booking.
            </p>
          </div>

          <div className="mb-6 sm:mb-8">
            <TravelRolesConnected />
          </div>

          {/* ── Explore heading — left-aligned editorial ── */}
          <ScrollReveal direction="up" className="relative z-10 mt-10 sm:mt-12">
            {/* Compact header: label, title and one line on the left, the next step on the right */}
            <div className="border-0 border-b border-solid border-slate-200/80 pb-3">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-[20px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[24px]">
                  Explore stays
                </h2>
                <Link
                  href="/public/properties"
                  className="group inline-flex shrink-0 items-center gap-0.5 text-[13.5px] font-semibold text-[#02665e] no-underline hover:no-underline"
                >
                  See all
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </div>
              <p className="m-0 mt-1 text-[13.5px] text-slate-500">Verified places to stay, by type</p>
            </div>
          </ScrollReveal>

          {/* ── Property type cards — bespoke premium grid ── */}
          <div className="mt-7 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {PROPERTY_TYPE_CARDS.map((c, idx) => {
              const count = typeCounts[c.key];
              const sample = typeSamples[c.key];
              const href = `/public/properties?types=${encodeURIComponent(c.key)}&page=1`;
              const img = sample?.primaryImage || c.fallbackImageSrc;
              const bypassOptimizer = Boolean(img && img.includes("cloudinary"));

              // Per-card accent — curated 5-colour cycle so adjacent cards never clash
              const accents = [
                { glow: 'rgba(2,180,245,0.55)',  line: '#02b4f5', tint: 'rgba(2,180,245,0.16)'  },   // cyan
                { glow: 'rgba(16,185,129,0.55)', line: '#10b981', tint: 'rgba(16,185,129,0.16)' },   // emerald
                { glow: 'rgba(251,191,36,0.50)', line: '#fbbf24', tint: 'rgba(251,191,36,0.14)' },   // amber
                { glow: 'rgba(167,139,250,0.55)',line: '#a78bfa', tint: 'rgba(167,139,250,0.16)'},   // violet
                { glow: 'rgba(251,113,133,0.50)',line: '#fb7185', tint: 'rgba(251,113,133,0.14)'},   // rose
              ];
              const ac = accents[idx % accents.length];

              return (
                <motion.div
                  key={c.key}
                  transition={{ duration: 0.45, delay: (idx % 5) * 0.07, ease: [0.2, 0.8, 0.2, 1] }}
                >
                <Link
                  href={href}
                  aria-label={`Browse ${c.title} stays`}
                  className="group relative block overflow-hidden rounded-[22px] no-underline
                    ring-1 ring-white/20 shadow-[0_8px_28px_rgba(2,6,23,0.13)]
                    transition-all duration-500
                    hover:ring-white/40 hover:shadow-[0_20px_56px_rgba(2,6,23,0.22)] hover:-translate-y-1"
                >
                  {/* ── Image ── */}
                  <div className="relative h-[190px] sm:h-[215px] overflow-hidden">
                    {img ? (
                      <NextImage
                        src={img}
                        alt={sample?.title || c.title}
                        fill
                        sizes="(min-width:1024px) 20vw, (min-width:640px) 33vw, 50vw"
                        className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.07] group-hover:saturate-[1.08]"
                        unoptimized={bypassOptimizer}
                      />
                    ) : (
                      <div className="absolute inset-0" style={{ background: '#012e29' }} />
                    )}

                    {/* Base dark scrim for legibility */}
                    <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10" />
                    {/* Colour wash at bottom matching accent */}
                    <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[var(--ac-tint)] via-transparent to-transparent"
                      style={{ '--ac-tint': ac.tint } as React.CSSProperties} />

                    {/* ── Top-right count pill ── */}
                    <div className="absolute top-2.5 right-2.5 z-10">
                      <AttentionBlink active={blinkCounts}>
                        <span className={[
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
                          "bg-black/45 backdrop-blur-md ring-1 ring-white/20",
                          "text-[11px] font-bold text-white tabular-nums",
                          countsLoading ? "animate-pulse" : "",
                        ].join(" ")}>
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: ac.line, boxShadow: `0 0 6px ${ac.glow}` }} aria-hidden />
                          {typeof count === "number" ? count.toLocaleString() : "—"}
                        </span>
                      </AttentionBlink>
                    </div>

                    {/* ── Slide-up hover CTA ── */}
                    <div aria-hidden
                      className="absolute inset-x-0 bottom-0 flex items-center justify-center pb-3
                        translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100
                        transition-all duration-400 ease-out z-10">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-white
                        backdrop-blur-md ring-1 ring-white/35 shadow-lg"
                        style={{ background: `linear-gradient(135deg, ${ac.line}cc, ${ac.line}88)` }}>
                        Browse &rarr;
                      </span>
                    </div>
                  </div>

                  {/* ── Footer strip ── */}
                  <div className="bg-white px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold text-slate-900 tracking-tight leading-none">{c.title}</span>
                    {/* thin coloured accent dot + line */}
                    <span aria-hidden className="flex items-center gap-1 flex-shrink-0">
                      <span className="h-0.5 w-4 rounded-full" style={{ background: ac.line, opacity: 0.6 }} />
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ac.line, boxShadow: `0 0 5px ${ac.glow}` }} />
                    </span>
                  </div>
                </Link>
                </motion.div>
              );
            })}
          </div>

          {/* ── Featured Destinations ── */}
          {/* Header row: title on the left; slide arrows and See all together on the right */}
          <div className="relative mt-10 border-0 border-b border-solid border-slate-200/80 pb-3 sm:mt-12">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="m-0 text-[20px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[24px]">
                  Popular destinations
                </h2>
                <p className="m-0 mt-1 text-[13.5px] text-slate-500">
                  Top places to stay in Tanzania
                  {featuredDestinationSlides.length > 1 && (
                    <span className="text-slate-400" aria-live="polite">
                      {" · "}
                      {featuredSlide + 1} of {featuredDestinationSlides.length}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {featuredDestinationSlides.length > 1 && (
                  <div className="hidden items-center gap-1 sm:flex">
                    <button
                      type="button"
                      onClick={() => setFeaturedSlide((s) => (s - 1 + featuredDestinationSlides.length) % featuredDestinationSlides.length)}
                      aria-label="Previous destinations"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-600 transition hover:border-[#02665e]/40 hover:text-[#02665e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
                    >
                      <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeaturedSlide((s) => (s + 1) % featuredDestinationSlides.length)}
                      aria-label="Next destinations"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-600 transition hover:border-[#02665e]/40 hover:text-[#02665e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )}
                <Link
                  href="/public/properties?page=1"
                  className="group/all inline-flex items-center gap-0.5 text-[13.5px] font-semibold text-[#02665e] no-underline hover:no-underline"
                >
                  See all
                  <ChevronRight className="h-4 w-4 transition-transform group-hover/all:translate-x-0.5" aria-hidden />
                </Link>
              </div>
            </div>
          </div>

            <div
              className="mt-7"
              onMouseEnter={() => setFeaturedSlidePaused(true)}
              onMouseLeave={() => setFeaturedSlidePaused(false)}
              onFocus={() => setFeaturedSlidePaused(true)}
              onBlur={() => setFeaturedSlidePaused(false)}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`featured-slide-${featuredSlide}`}
                  initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -8 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4"
                >
                  {(featuredDestinationSlides[featuredSlide] || featuredDestinationSlides[0] || []).map((d, idx) => {
                    const filterParam = d.filterParam === "region" ? "region" : "city";
                    const href = `/public/properties?${filterParam}=${encodeURIComponent(d.city)}&page=1`;
                    const total = featuredCityCounts[d.city];

                    const image = DESTINATION_IMAGES[d.city] || DESTINATION_IMAGES["Dar es Salaam"];

                    return (
                      <Link
                        key={`${d.city}-${idx}`}
                        href={href}
                        aria-label={`Browse stays in ${d.city}${typeof total === "number" && total > 0 ? `, ${total} stays` : ""}`}
                        className="group/card relative block min-h-[170px] overflow-hidden rounded-xl bg-[#02665e] no-underline shadow-[0_5px_18px_rgba(15,23,42,0.08)] transition-[transform,box-shadow] duration-500 ease-out hover:-translate-y-0.5 hover:no-underline hover:shadow-[0_12px_28px_rgba(15,23,42,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-4 sm:aspect-[16/10] sm:min-h-0"
                      >
                        <NextImage
                          src={image.src}
                          alt=""
                          fill
                          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                          className="object-cover transition-transform duration-700 ease-out group-hover/card:scale-[1.03]"
                          style={{ objectPosition: image.position }}
                        />
                        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/70" />

                        <div className="absolute inset-0 z-10 flex flex-col p-3.5 sm:p-4">
                          <div className="flex justify-end">
                            {featuredCitiesLoading ? (
                              <span className="inline-block h-5 w-12 animate-pulse rounded bg-white/30" aria-hidden />
                            ) : typeof total === "number" && total > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded bg-white/95 px-1.5 py-0.5 text-[11px] font-semibold text-[#02665e] shadow-sm">
                                <span className="tabular-nums">{total.toLocaleString()}</span> {total === 1 ? "stay" : "stays"}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-auto flex items-end justify-between gap-3">
                            <h3 className="m-0 text-[20px] font-bold leading-none tracking-tight text-white drop-shadow-sm sm:text-[22px]">{d.city}</h3>
                            <ChevronRight className="mb-0.5 h-4 w-4 flex-none text-white/80 transition-transform duration-300 group-hover/card:translate-x-0.5" aria-hidden />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </motion.div>
              </AnimatePresence>

              {featuredDestinationSlides.length > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2" aria-label="Featured destination pages">
                  {featuredDestinationSlides.map((_, slideIndex) => {
                    const active = slideIndex === featuredSlide;
                    return (
                      <button
                        key={`featured-dot-${slideIndex}`}
                        type="button"
                        onClick={() => setFeaturedSlide(slideIndex)}
                        aria-label={`Show destination page ${slideIndex + 1}`}
                        aria-current={active ? "true" : undefined}
                        className={`h-1.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087f69]/50 focus-visible:ring-offset-4 ${
                          active ? "w-8 bg-[#087f69]" : "w-2.5 bg-slate-300 hover:bg-slate-400"
                        }`}
                      />
                    );
                  })}
                </div>
              )}
            </div>

          {/* ── Why NoLSAF: compact trust section ── */}
          <ScrollReveal direction="up" distance={24} className="mt-10">
            <section
              aria-labelledby="why-nolsaf-heading"
              className="relative box-border w-full max-w-full overflow-hidden rounded-2xl text-white shadow-[0_18px_44px_-20px_rgba(0,0,0,0.75)] ring-1 ring-inset ring-white/[0.06] lg:rounded-[20px]"
              style={{ background: "linear-gradient(135deg, #07090c 0%, #0b1211 60%, #0d1714 100%)" }}
            >
              <div aria-hidden className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0" style={{ background: "radial-gradient(520px circle at 100% 0%, rgba(2,102,94,0.28), transparent 60%), radial-gradient(360px circle at 0% 100%, rgba(52,211,153,0.07), transparent 60%)" }} />
                <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(52,211,153,0.45), transparent)" }} />
                <div
                  className="absolute inset-0 opacity-[0.14]"
                  style={{
                    backgroundImage: "radial-gradient(rgba(255,255,255,0.55) 1px, transparent 1px)",
                    backgroundSize: "18px 18px",
                    WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 65%)",
                    maskImage: "linear-gradient(90deg, transparent 0%, #000 65%)",
                  }}
                />
              </div>

              <div className="relative box-border grid w-full grid-cols-[minmax(0,1fr)] gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-8 lg:p-8">
                {/* Left: the promise, in one breath */}
                <div className="min-w-0">
                  <p className="m-0 inline-flex items-center gap-1.5 rounded-md bg-emerald-300/10 px-2 py-1 text-[11px] font-semibold tracking-[0.04em] text-emerald-200 ring-1 ring-inset ring-emerald-300/20">Why NoLSAF</p>
                  <h2 id="why-nolsaf-heading" className="m-0 mt-3 text-[21px] font-bold leading-snug tracking-tight sm:text-[24px] lg:text-[26px]">
                    Protected from search to arrival
                  </h2>

                  <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
                    {[
                      { Icon: ShieldCheck, text: "Verified listings" },
                      { Icon: Smartphone, text: "Mobile money, bank & card" },
                      { Icon: KeyRound, text: "Code on arrival" },
                    ].map(({ Icon, text }) => (
                      <li key={text} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/[0.06] py-1 pl-1.5 pr-2.5 text-[12px] font-medium text-white/80 ring-1 ring-inset ring-white/10">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-300/15 text-emerald-300">
                          <Icon className="h-3 w-3" aria-hidden />
                        </span>
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Right: where to go next, as real links */}
                <nav aria-label="NoLSAF services" className="min-w-0">
                  <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl bg-white/[0.05] p-0 ring-1 ring-inset ring-white/10 sm:grid-cols-2 sm:gap-2 sm:overflow-visible sm:rounded-none sm:bg-transparent sm:ring-0">
                    {[
                      { title: "Verified stays", desc: "Checked properties, instant booking code", Icon: Home, href: "/public/properties?page=1" },
                      { title: "Tour packages", desc: "Trusted operators with a clear itinerary", Icon: Compass, href: "/public/tour-packages" },
                      { title: "Group stays", desc: "One request, compare real owner offers", Icon: Users, href: "/public/group-stays" },
                      { title: "Transport", desc: "Pickup linked to your booking", Icon: Car, href: "/account/rides" },
                      { title: "Cost estimator", desc: "See trip costs before you commit", Icon: Calculator, href: "/public/nolscope", wide: true },
                    ].map(({ title, desc, Icon, href, wide }) => (
                      <li key={title} className={`min-w-0 border-0 border-t border-solid border-white/10 first:border-t-0 sm:border-t-0 ${wide ? "sm:col-span-2" : ""}`}>
                        <Link
                          href={href}
                          className="group box-border flex h-full min-w-0 items-center gap-3 px-3 py-3 no-underline transition active:bg-white/[0.06] hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300/50 sm:rounded-xl sm:bg-white/[0.045] sm:ring-1 sm:ring-inset sm:ring-white/[0.08] sm:hover:bg-white/[0.08] sm:hover:ring-emerald-300/30"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#02665e] shadow-[0_6px_14px_-8px_rgba(0,0,0,0.6)]">
                            <Icon className="h-[18px] w-[18px]" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-semibold text-white">{title}</span>
                            <span className="mt-0.5 block truncate text-[12px] text-white/55 sm:whitespace-normal sm:leading-snug">{desc}</span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>
            </section>
          </ScrollReveal>
          {/* ── Explore Tanzania: our current coverage, in one compact block ── */}
          <ScrollReveal direction="up" distance={24} className="mt-10">
            <section
              aria-labelledby="explore-tanzania-heading"
              className="relative box-border w-full max-w-full overflow-hidden rounded-2xl text-white shadow-[0_18px_44px_-20px_rgba(1,40,36,0.7)] lg:rounded-[20px]"
              style={{ background: "linear-gradient(135deg, #023a35 0%, #02665e 60%, #037a70 100%)" }}
            >
              <div aria-hidden className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0" style={{ background: "radial-gradient(480px circle at 0% 100%, rgba(1,26,24,0.55), transparent 60%)" }} />
                <div
                  className="absolute inset-0 opacity-[0.12]"
                  style={{
                    backgroundImage: "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                    WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 70%)",
                    maskImage: "linear-gradient(90deg, transparent 0%, #000 70%)",
                  }}
                />
              </div>

              <div className="relative box-border grid w-full grid-cols-[minmax(0,1fr)] gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-8 lg:p-8">
                <div className="min-w-0">
                  <p className="m-0 inline-flex items-center gap-2 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/85 ring-1 ring-inset ring-white/15">
                    {/* Tanzania flag colours */}
                    <span className="flex h-2 w-6 overflow-hidden rounded-sm" aria-hidden>
                      <span className="flex-1 bg-[#1eb53a]" />
                      <span className="flex-1 bg-[#fcd116]" />
                      <span className="flex-1 bg-black" />
                      <span className="flex-1 bg-[#00a3dd]" />
                    </span>
                    Destination
                  </p>
                  <h2 id="explore-tanzania-heading" className="m-0 mt-3 text-[21px] font-bold leading-snug tracking-tight sm:text-[24px] lg:text-[26px]">
                    Explore Tanzania
                  </h2>
                  <p className="m-0 mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-white/70">
                    Safaris, parks and islands. Find verified stays near the places you want to see, and arrange transport in the same booking.
                  </p>
                  <Link
                    href="/public/countries/tanzania"
                    className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-lg bg-white px-4 text-[13.5px] font-semibold text-[#02665e] no-underline shadow-[0_8px_18px_-10px_rgba(0,0,0,0.6)] transition hover:bg-emerald-50 hover:no-underline"
                  >
                    Explore Tanzania
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>

                {/* Popular places: straight into a filtered stay search */}
                <nav aria-label="Popular places in Tanzania" className="min-w-0">
                  <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Popular places</p>
                  <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
                    {[
                      { name: "Zanzibar", note: "Beaches & Stone Town" },
                      { name: "Arusha", note: "Gateway to safaris" },
                      { name: "Dar es Salaam", note: "City & coast" },
                      { name: "Kilimanjaro", note: "Moshi & the mountain" },
                    ].map((place) => (
                      <li key={place.name} className="min-w-0">
                        <Link
                          href={`/public/properties?q=${encodeURIComponent(place.name)}`}
                          className="group box-border flex h-full min-w-0 items-center gap-2.5 rounded-xl bg-white/[0.08] px-3 py-2.5 no-underline ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.14] hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                        >
                          <MapPin className="h-4 w-4 shrink-0 text-emerald-200" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-semibold text-white">{place.name}</span>
                            <span className="block truncate text-[11.5px] text-white/60">{place.note}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>
            </section>
          </ScrollReveal>

          

          {/* Booking flow card: explain booking steps and allow driver options */}
          <ScrollReveal direction="up" distance={24} className="mt-10">
            <div id="booking-flow">
              <BookingFlowCard />
            </div>
          </ScrollReveal>

          <ScrollReveal direction="up" delay={0.1}>
            <FounderStory />
          </ScrollReveal>

          {/* ── Trusted by: admin-managed partner logos. Hidden entirely when there are none. ── */}
          {trustBrands.length > 0 && (
            <ScrollReveal direction="up" distance={20} className="mt-10">
              <section
                aria-labelledby="trusted-by-heading"
                className="relative box-border w-full max-w-full overflow-hidden rounded-2xl text-white ring-1 ring-inset ring-white/[0.06] shadow-[0_18px_44px_-22px_rgba(0,0,0,0.7)] lg:rounded-[20px]"
                style={{ background: "linear-gradient(135deg, #07090c 0%, #0b1211 60%, #0d1714 100%)" }}
              >
                <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(420px circle at 0% 0%, rgba(2,102,94,0.3), transparent 60%)" }} />

                <div className="relative box-border flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center md:gap-6">
                  {/* Label */}
                  <div className="flex shrink-0 items-center gap-3 md:w-[220px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-300 ring-1 ring-inset ring-emerald-300/20">
                      <ShieldCheck className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 id="trusted-by-heading" className="m-0 text-[16px] font-bold leading-tight tracking-tight text-white">
                        Trusted by
                      </h2>
                      <p className="m-0 mt-0.5 text-[12px] text-white/55">
                        {trustBrands.length} {trustBrands.length === 1 ? "partner" : "partners"} and growing
                      </p>
                    </div>
                  </div>

                  {/* Logo strip: scrolls on its own, pauses on hover, sits still for reduced-motion users */}
                  <div
                    className="nols-marquee-wrap relative min-w-0 flex-1 overflow-hidden"
                    style={{
                      WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 40px, #000 calc(100% - 40px), transparent 100%)",
                      maskImage: "linear-gradient(90deg, transparent 0, #000 40px, #000 calc(100% - 40px), transparent 100%)",
                    }}
                  >
                    <ul className="nols-marquee m-0 flex w-max list-none p-0">
                      {[...trustBrands, ...trustBrands, ...(trustBrands.length < 4 ? [...trustBrands, ...trustBrands] : [])].map((brand, index) => {
                        const duplicate = index >= trustBrands.length;
                        const chip = (
                          <span className="box-border flex h-14 w-[148px] items-center justify-center rounded-xl bg-white px-4 shadow-[0_8px_20px_-12px_rgba(0,0,0,0.6)] transition-transform duration-300 hover:-translate-y-0.5">
                            {brand.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={brand.logoUrl} alt={duplicate ? "" : brand.name} loading="lazy" className="max-h-9 max-w-full object-contain" />
                            ) : (
                              <span className="truncate text-[13px] font-semibold text-slate-700">{brand.name}</span>
                            )}
                          </span>
                        );
                        return (
                          // Copies exist only to make the loop seamless; hide them from assistive tech.
                          <li key={`${brand.name}-${index}`} className="shrink-0 pr-3" aria-hidden={duplicate || undefined}>
                            {brand.href && !duplicate ? (
                              <a href={brand.href} target="_blank" rel="noopener noreferrer" aria-label={`${brand.name} (opens in a new tab)`} className="block no-underline">
                                {chip}
                              </a>
                            ) : (
                              chip
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </section>
            </ScrollReveal>
          )}

          {/* ── Latest updates. Phones: compact bar. Large screens: expanded band with the latest three updates. ── */}
          <ScrollReveal direction="up" distance={20} className="mt-10">
            <section
              aria-labelledby="latest-updates-heading"
              className="relative box-border w-full max-w-full overflow-hidden rounded-2xl text-white lg:rounded-[20px]"
              style={{ background: "linear-gradient(135deg, #013d38 0%, #02665e 55%, #037a70 100%)" }}
            >
              <div aria-hidden className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0" style={{ background: "radial-gradient(520px circle at 100% 0%, rgba(255,255,255,0.14), transparent 60%), radial-gradient(420px circle at 0% 100%, rgba(1,26,24,0.45), transparent 60%)" }} />
                <div
                  className="absolute inset-0 hidden opacity-[0.14] lg:block"
                  style={{
                    backgroundImage: "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
                    backgroundSize: "18px 18px",
                    WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 60%)",
                    maskImage: "linear-gradient(90deg, transparent 0%, #000 60%)",
                  }}
                />
                {/* Large megaphone watermark */}
                <Megaphone className="absolute -bottom-10 left-[38%] hidden h-48 w-48 -rotate-12 text-white opacity-[0.05] lg:block" />
              </div>

              <div className="relative box-border grid grid-cols-[minmax(0,1fr)] gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-10 lg:p-9">
                {/* Left: what this is */}
                <div className="flex min-w-0 items-center justify-between gap-4 lg:block">
                  <div className="flex min-w-0 items-center gap-3 lg:block">
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/20 lg:h-12 lg:w-12">
                      <Megaphone className="h-[18px] w-[18px] lg:h-[22px] lg:w-[22px]" aria-hidden />
                      <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5" aria-hidden>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300 ring-2 ring-[#02665e]" />
                      </span>
                    </span>
                    <div className="min-w-0 lg:mt-5">
                      <h2 id="latest-updates-heading" className="m-0 text-[18px] font-bold leading-tight tracking-tight sm:text-[21px] lg:text-[30px]">
                        Latest updates
                      </h2>
                      <p className="m-0 mt-0.5 truncate text-[12.5px] text-white/70 lg:mt-2 lg:whitespace-normal lg:text-[15px] lg:leading-relaxed">
                        New features and news from NoLSAF<span className="hidden lg:inline">, so you always know what just got better.</span>
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/updates"
                    className="group inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-white px-3 text-[13px] font-semibold text-[#02665e] no-underline transition hover:bg-emerald-50 hover:no-underline lg:mt-6 lg:h-11 lg:px-5 lg:text-[14px]"
                  >
                    <span className="lg:hidden">View all</span>
                    <span className="hidden lg:inline">See all updates</span>
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </div>

                {/* Right (large screens): the latest three as a small timeline */}
                {latestUpdatePreviews.length > 0 && (
                  <ol className="relative m-0 hidden list-none p-0 lg:block">
                    <span aria-hidden className="absolute bottom-6 left-[15px] top-6 w-px bg-white/20" />
                    {latestUpdatePreviews.map((u, index) => {
                      const date = new Date(u.createdAt);
                      const valid = !Number.isNaN(date.getTime());
                      const isRecent = valid && Date.now() - date.getTime() < 30 * 24 * 60 * 60 * 1000;
                      return (
                        <li key={u.id} className={index > 0 ? "mt-2.5" : ""}>
                          <Link
                            href="/updates"
                            className="group/item relative flex items-center gap-4 rounded-xl py-1 pr-2 no-underline hover:no-underline"
                          >
                            <span
                              aria-hidden
                              className={`relative z-10 flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-4 ring-[#02665e] ${
                                index === 0 ? "bg-emerald-300 text-[#013d38]" : "bg-white/15 text-white/80"
                              }`}
                            >
                              {index + 1}
                            </span>
                            <span className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-black/15 px-4 py-3 ring-1 ring-inset ring-white/10 transition group-hover/item:bg-black/25 group-hover/item:ring-white/25">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14.5px] font-semibold text-white">{u.title}</span>
                                {valid && (
                                  <span className="mt-0.5 block text-[12px] text-white/55">
                                    {date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                                  </span>
                                )}
                              </span>
                              {isRecent && (
                                <span className="shrink-0 rounded-md bg-emerald-300 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[#013d38]">New</span>
                              )}
                              <ChevronRight className="h-4 w-4 shrink-0 text-white/40 transition group-hover/item:translate-x-0.5 group-hover/item:text-white" aria-hidden />
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </section>
          </ScrollReveal>
          <ScrollReveal direction="up" delay={0.1}>
            <LatestUpdate hideTitle />
          </ScrollReveal>

          <ScrollReveal direction="up" delay={0.15}>
            <PodcastSection />
          </ScrollReveal>
        </div>
      </section>
    </main>
  );
}
