"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import Image from "next/image";
import { createPortal } from "react-dom";

import Link from "next/link";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";

import { motion } from "framer-motion";

import type { Socket } from "socket.io-client";

import type { ComponentType } from "react";

import { useParams, useRouter } from "next/navigation";
import { fetchAccountSession } from "@/lib/accountSession";
import { captureShareToken, createShareLink } from "@/lib/propertyShareToken";

import {
  MapPin,
  Users,
  BedDouble,
  Bath,
  ShieldCheck,
  ChevronLeft,
  ImageIcon,
  Eye,
  FileText,
  Tag,
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
  CreditCard,
  Banknote,
  Building2,
  BadgeCheck,
  UsersRound,
  Fuel,
  Bus,
  Hospital,
  Route,
  ExternalLink,
  Plane,
  Tags,
  DoorClosed,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  CheckCircle2,
  CigaretteOff,
  MessageSquare,
  Map as MapIcon,
  Lock,
  Share2,
  AlertCircle,
  Clock,
  PlayCircle,
  ExternalLink as ExternalLinkIcon,
  Heart,
  Copy,
  Mail,
  Facebook,
  Twitter,
  Home,
  Calendar,
  LogIn,
  LogOut,
  Wifi,
  QrCode,
  Star,
  Check,
  LayoutGrid,
  Footprints,
  Bike,
  Navigation,
  Stethoscope,
  Pill,
  Landmark,
  PawPrint,
  Cigarette,
} from "lucide-react";

import LogoSpinner from "@/components/LogoSpinner";

import DatePicker from "../../../../components/ui/DatePicker";

import { PropertyVisualizationPreview } from "@/app/(owner)/owner/properties/add/_components/PropertyVisualizationPreview";
import "@/styles/photo-tour.css";
import { parseFloorUses } from "@/app/(owner)/owner/properties/add/_components/floorUses";

import { 

  getPropertyCommission, 

  calculatePriceWithCommission

} from "../../../../lib/priceUtils";

import { BATHROOM_ICONS, OTHER_AMENITIES_ICONS } from "../../../../lib/amenityIcons";
import { PriceDisplay } from "@/components/PriceDisplay";

function isCloudinaryImage(src: string) {
  try {
    return new URL(src).hostname === "res.cloudinary.com";
  } catch {
    return src.includes("res.cloudinary.com");
  }
}

function cloudinaryPreviewUrl(src: string, sizes: string, className: string) {
  if (!isCloudinaryImage(src)) return src;
  const uploadMarker = "/image/upload/";
  const uploadIndex = src.indexOf(uploadMarker);
  if (uploadIndex === -1) return src;

  const beforeUpload = src.slice(0, uploadIndex + uploadMarker.length);
  const afterUpload = src.slice(uploadIndex + uploadMarker.length);
  const firstSegment = afterUpload.split("/")[0] || "";
  const alreadyTransformed = /^(c_|f_|g_|h_|q_|w_|ar_|e_)/.test(firstSegment) || firstSegment.includes(",");
  if (alreadyTransformed) return src;

  const isThumbnail = sizes.includes("120px") || sizes.includes("260px");
  const isCoverTile = className.includes("object-cover");
  const transform = isThumbnail
    ? "f_auto,q_auto,w_360,c_fill,g_auto"
    : isCoverTile
      ? "f_auto,q_auto,w_900,c_fill,g_auto"
      : "f_auto,q_auto,w_1400";

  return `${beforeUpload}${transform}/${afterUpload}`;
}

function PropertyGalleryImage({
  src,
  alt,
  sizes,
  priority = false,
  className = "object-cover",
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  // Every photo shows a shimmer until it arrives, fades in, and falls back quietly on failure
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  if (/^data:image\//i.test(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={`h-full w-full ${className}`} loading={priority ? "eager" : "lazy"} />;
  }

  const imageSrc = cloudinaryPreviewUrl(src, sizes, className);
  const bypassNextOptimizer =
    isCloudinaryImage(src) ||
    src.startsWith("http://localhost") ||
    src.startsWith("http://127.0.0.1");

  return (
    <>
      {!loaded && !failed ? (
        <span aria-hidden className="pv-skeleton absolute inset-0 flex items-center justify-center">
          <span className="pv-spinner" />
        </span>
      ) : null}
      {failed ? (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-400">
          <ImageIcon className="h-6 w-6" />
        </span>
      ) : null}
      {!failed ? (
        <Image
          src={imageSrc}
          alt={alt}
          fill
          className={`${className} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          sizes={sizes}
          priority={priority}
          unoptimized={bypassNextOptimizer}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </>
  );
}

type PublicPropertyDetail = {
  id: number;
  slug: string;
  title: string;
  type: string;
  description: string | null;
  regionName: string | null;
  district: string | null;
  city: string | null;
  street: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  images: string[];
  basePrice: number | null;
  currency: string | null;
  maxGuests: number | null;
  totalBedrooms: number | null;
  totalBathrooms: number | null;
  buildingType: string | null;
  totalFloors: number | null;
  services: string[];
  roomsSpec: any[];
  ownerId?: number;
  nrmsMenuUrl?: string | null;
  verificationVideoUrl?: string | null;
  physicalVerification?: {
    status: "VERIFIED" | "PENDING";
    verifiedAt: string | null;
    verifiedBy: string | null;
    verifiedByRole: string | null;
    method: string;
    note: string | null;
    checklist: string[];
    verificationUrl?: string | null;
    qrCodeDataUrl?: string | null;
  } | null;
  houseRules?: string | string[] | {
    checkIn?: string;
    checkOut?: string;
    smoking?: boolean;
    pets?: boolean;
    petsNote?: string;
    parties?: string;
    safetyMeasures?: string[];
    other?: string;
  } | null;
  faq?: Array<{ question?: string; answer?: string; q?: string; a?: string }> | null;

};

type ReviewUser = { id: number; name: string | null };

type PropertyReview = {
  id: number;
  rating: number;
  title: string | null;
  comment: string | null;
  isVerified: boolean;
  ownerResponse: string | null;
  ownerResponseAt: string | null;
  createdAt: string;
  user: ReviewUser;

};

type ReviewsResponse = {
  reviews: PropertyReview[];
  stats: {
    totalReviews: number;
    averageRating: number;
    ratingDistribution: Record<string, number>;
    categoryAverages: Record<string, number> | null;
  };

};

type PolicyItem = {
  text: string;
  Icon?: ComponentType<{ className?: string }>;
  iconColor?: string;

};

type RoomSpecRow = {
  roomType: string;
  roomCode?: string; // Room code from roomsSpec
  roomsCount: number | null;
  bedsSummary: string;
  description: string;
  amenities: string[];
  bathItems: string[];
  bathPrivate?: string; // "yes" | "no" | undefined
  pricePerNight: number | null;
  discountLabel: string | null;
  payActionLabel: string;
  policies: PolicyItem[];

};

function amenityMeta(label: string): { Icon: any; colorClass: string } {
  const key = String(label || "").trim().toLowerCase();
  const map: Record<string, { Icon: any; colorClass: string }> = {
    "free parking": { Icon: Car, colorClass: "text-blue-600" },
    "breakfast included": { Icon: Coffee, colorClass: "text-amber-600" },
    "breakfast available": { Icon: Coffee, colorClass: "text-orange-600" },
    restaurant: { Icon: UtensilsCrossed, colorClass: "text-rose-600" },
    bar: { Icon: Beer, colorClass: "text-purple-600" },
    pool: { Icon: Waves, colorClass: "text-cyan-600" },
    sauna: { Icon: Thermometer, colorClass: "text-orange-600" },
    laundry: { Icon: WashingMachine, colorClass: "text-indigo-600" },
    "room service": { Icon: ConciergeBell, colorClass: "text-emerald-700" },
    "24h security": { Icon: Shield, colorClass: "text-red-600" },
    "first aid": { Icon: Bandage, colorClass: "text-green-700" },
    "fire extinguisher": { Icon: FireExtinguisher, colorClass: "text-red-600" },
    "on-site shop": { Icon: ShoppingBag, colorClass: "text-pink-600" },
    "nearby mall": { Icon: Store, colorClass: "text-pink-600" },
    "social hall": { Icon: PartyPopper, colorClass: "text-yellow-600" },
    "sports & games": { Icon: Gamepad2, colorClass: "text-yellow-700" },
    gym: { Icon: Dumbbell, colorClass: "text-slate-700" },
    "free wi-fi": { Icon: Wifi, colorClass: "text-cyan-700" },
    "air conditioning": { Icon: Thermometer, colorClass: "text-sky-700" },
  };
  return map[key] ?? { Icon: Tag, colorClass: "text-slate-500" };

}

function normalizeOwnerDeclaredServices(servicesObj: any, servicesArray: string[]) {
  const normalizeBoolean = (value: any) =>
    value === true ||
    value === "true" ||
    value === 1 ||
    value === "1" ||
    String(value || "").toLowerCase() === "yes";

  const addUnique = (items: string[], label: string) => {
    const cleaned = String(label || "").trim();
    if (!cleaned) return;
    if (!items.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      items.push(cleaned);
    }
  };

  const tags = Array.isArray(servicesObj?.tags)
    ? servicesObj.tags.map((tag: any) => String(tag || "").trim()).filter(Boolean)
    : [];
  const allRawLabels = [...servicesArray, ...tags];
  const amenities: string[] = [];
  const included: string[] = [];
  const available: string[] = [];

  const addAmenity = (label: string, includedInPrice = false, availableService = true) => {
    addUnique(amenities, label);
    if (includedInPrice) addUnique(included, label);
    if (availableService && !includedInPrice) addUnique(available, label);
  };

  const parking = String(servicesObj?.parking || "").toLowerCase();
  if (parking === "free") {
    addAmenity("Free parking", true);
  } else if (parking === "paid") {
    const price = String(servicesObj?.parkingPrice || "").trim();
    addAmenity(price ? `Paid parking (${price} TZS)` : "Paid parking");
  }

  if (normalizeBoolean(servicesObj?.breakfastIncluded)) addAmenity("Breakfast included", true);
  if (normalizeBoolean(servicesObj?.breakfastAvailable)) addAmenity("Breakfast available");
  if (normalizeBoolean(servicesObj?.restaurant)) addAmenity("Restaurant");
  if (normalizeBoolean(servicesObj?.bar)) addAmenity("Bar");
  if (normalizeBoolean(servicesObj?.pool)) addAmenity("Pool");
  if (normalizeBoolean(servicesObj?.sauna)) addAmenity("Sauna");
  if (normalizeBoolean(servicesObj?.laundry)) addAmenity("Laundry");
  if (normalizeBoolean(servicesObj?.roomService)) addAmenity("Room service");
  if (normalizeBoolean(servicesObj?.security24)) addAmenity("24h security");
  if (normalizeBoolean(servicesObj?.firstAid)) addAmenity("First aid");
  if (normalizeBoolean(servicesObj?.fireExtinguisher)) addAmenity("Fire extinguisher");
  if (normalizeBoolean(servicesObj?.onSiteShop)) addAmenity("On-site shop");
  if (normalizeBoolean(servicesObj?.nearbyMall)) addAmenity("Nearby mall");
  if (normalizeBoolean(servicesObj?.socialHall)) addAmenity("Social hall");
  if (normalizeBoolean(servicesObj?.sportsGames)) addAmenity("Sports & games");
  if (normalizeBoolean(servicesObj?.gym)) addAmenity("Gym");
  if (normalizeBoolean(servicesObj?.wifi)) addAmenity("Free Wi-Fi", true);
  if (normalizeBoolean(servicesObj?.ac)) addAmenity("Air conditioning", true);

  allRawLabels
    .filter((service) => !/^payment:\s*/i.test(service))
    .filter((service) => !/^(free cancellation|group stay)$/i.test(service))
    .filter((service) => !/^near\s+/i.test(service))
    .forEach((service) => {
      const includedInPrice = /^(free parking|breakfast included|free wi-?fi|air conditioning)$/i.test(service);
      addAmenity(service, includedInPrice);
    });

  return { amenities, included, available };
}

function PaymentLogo({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-white/90 ring-1 ring-black/5 p-1.5 shadow-sm">
      <span className="relative block h-[28px] w-[28px]">
        <Image src={src} alt={alt} fill sizes="28px" className="object-contain" />
      </span>
    </span>
  );

}

function PaymentModePill({ mode }: { mode: string }) {
  const m = String(mode || "").trim();
  const key = m.toLowerCase();
  const baseCls = [
    "group box-border w-full inline-flex items-center gap-2 rounded-xl border border-solid px-3 py-2",
    "bg-slate-50 border-slate-200 text-slate-800",
    "shadow-sm shadow-transparent select-none",
    "motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out",
    "motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-sm",
    "hover:bg-white hover:border-slate-300",
    "active:scale-[0.98]",
    "whitespace-nowrap",
  ].join(" ");
  if (key === "mobile money" || key === "mobilemoney" || key === "momo") {
    return (
      <div className={[baseCls, "justify-between"].join(" ")} title="Mobile money">
        <span className="text-sm font-semibold text-slate-700">Mobile money</span>
        <span className="inline-flex items-center gap-2">
          <PaymentLogo src="/assets/M-pesa.png" alt="M-Pesa" />
          <PaymentLogo src="/assets/mix%20by%20yas.png" alt="Tigo Pesa (Yas)" />
          <PaymentLogo src="/assets/airtel_money.png" alt="Airtel Money" />
          <PaymentLogo src="/assets/halopesa.png" alt="HaloPesa" />
        </span>
      </div>
    );
  }
  if (key === "card" || key === "cards") {
    return (
      <div className={[baseCls, "justify-between"].join(" ")} title="Card payments">
        <span className="text-sm font-semibold text-slate-700">Card</span>
        <span className="inline-flex items-center gap-2">
          <PaymentLogo src="/assets/visa_card.png" alt="Visa card" />
          <PaymentLogo src="/assets/Mastercard_Logo.png" alt="Mastercard" />
        </span>
      </div>
    );
  }
  if (key === "cash") {
    return (
      <div className={[baseCls, "justify-between"].join(" ")} title="Cash">
        <span className="text-sm font-semibold text-slate-700">Cash</span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center justify-center rounded-md bg-white/90 ring-1 ring-black/5 p-1.5 shadow-sm">
            <Banknote className="h-[28px] w-[28px] text-green-600 flex-shrink-0" aria-hidden />
          </span>
        </span>
      </div>
    );
  }
  if (key === "bank transfer" || key === "banktransfer") {
    return (
      <div className={[baseCls, "justify-between"].join(" ")} title="Bank transfer">
        <span className="text-sm font-semibold text-slate-700">Bank transfer</span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center justify-center rounded-md bg-white/90 ring-1 ring-black/5 p-1.5 shadow-sm">
            <Building2 className="h-[28px] w-[28px] text-blue-600 flex-shrink-0" aria-hidden />
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className={baseCls} title={m}>
      <span className="text-sm font-semibold text-slate-700">{m}</span>
    </div>
  );

}

function extractFirstUrl(s: string): { url: string | null; textWithoutUrl: string } {
  const str = String(s || "");
  const m = str.match(/https?:\/\/[^\s]+/i);
  if (!m) return { url: null, textWithoutUrl: str.trim() };
  const url = m[0];
  const textWithoutUrl = str.replace(url, "").replace(/\s{2,}/g, " ").trim();
  return { url, textWithoutUrl };

}

// Interactive Map Component for Property

function PropertyMap({ latitude, longitude, propertyTitle }: { latitude: number; longitude: number; propertyTitle: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any | null>(null);
  const markerRef = useRef<any | null>(null);
  const initStartedRef = useRef(false);
  const [mapFailed, setMapFailed] = useState(false);
  // Lazy: map stays dormant until user explicitly opens it.
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === 'undefined') return;
    if (!hostRef.current) return;
    if (initStartedRef.current || mapRef.current) return;
    const token =
      (process.env.NEXT_PUBLIC_MAPBOX_TOKEN as string) ||
      (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN as string) ||
      (window as any).__MAPBOX_TOKEN ||
      '';
    if (!token) { setMapFailed(true); return; }
    let cancelled = false;
    initStartedRef.current = true;
    setMapFailed(false);
    hostRef.current.replaceChildren();
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    hostRef.current.appendChild(container);
    (async () => {
      try {
        const mod = await import('mapbox-gl');
        if (cancelled) return;
        const mapboxgl = (mod as any).default ?? mod;
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({
          container,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [longitude, latitude],
          zoom: 15,
          interactive: true,
          attributionControl: false,
          cooperativeGestures: true,
        });
        mapRef.current = map;
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        const el = document.createElement('div');
        el.className = 'property-map-marker';
        el.style.width = '32px';
        el.style.height = '32px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = '#10b981';
        el.style.border = '3px solid white';
        el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
        el.style.cursor = 'pointer';
        el.setAttribute('aria-label', propertyTitle);
        const marker = new mapboxgl.Marker(el)
          .setLngLat([longitude, latitude])
          .addTo(map);
        markerRef.current = marker;
      } catch {
        setMapFailed(true);
        initStartedRef.current = false;
        if (container.parentNode) container.parentNode.removeChild(container);
      }
    })();
    return () => {
      cancelled = true;
      if (markerRef.current) {
        try { markerRef.current.remove(); } catch { }
        markerRef.current = null;
      }
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch { }
        mapRef.current = null;
      }
      if (container.parentNode) container.parentNode.removeChild(container);
      initStartedRef.current = false;
    };
  }, [isOpen, latitude, longitude, propertyTitle]);
  const googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  if (!isOpen) {
    return (
      <div className="relative w-full h-[340px] rounded-xl overflow-hidden">
        {/* Brand teal gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#02665e] via-[#025c55] to-[#013d38]" />
        {/* Decorative rings */}
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full border border-solid border-white/10" />
        <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full border border-solid border-white/10" />
        <div className="absolute -bottom-16 -left-16 w-52 h-52 rounded-full border border-solid border-white/10" />
        <div className="absolute bottom-6 left-6 w-24 h-24 rounded-full border border-solid border-white/10" />
        {/* Dot grid — map-like texture */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
        {/* Content */}
        <div className="relative h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
          {/* Pin icon in glass ring */}
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/25 shadow-lg">
            <MapPin className="h-8 w-8 text-white" />
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-bold text-white leading-tight">{propertyTitle}</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-mono text-white/80 ring-1 ring-white/20">
              <MapIcon className="h-3 w-3 shrink-0" />
              {latitude.toFixed(4)}, {longitude.toFixed(4)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-[#02665e] shadow-lg hover:bg-white/90 active:scale-[0.98] transition-all"
          >
            <MapIcon className="h-4 w-4" />
            View interactive map
          </button>
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-white/60 underline underline-offset-2 hover:text-white transition-colors"
          >
            Open in Google Maps
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="relative w-full h-[400px] bg-slate-100">
      <div ref={hostRef} className="absolute inset-0 w-full h-full" />
      {mapFailed && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
          <div className="text-center">
            <MapIcon className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-600 font-medium">Map unavailable</p>
            <p className="text-xs text-slate-500 mt-1">{latitude}, {longitude}</p>
          </div>
        </div>
      )}
      {/* Close button - lets mobile users collapse map to stop scroll interference */}
      <button
        type="button"
        onClick={() => { setIsOpen(false); initStartedRef.current = false; }}
        className="absolute top-2 left-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-solid border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow backdrop-blur-sm transition hover:bg-white"
        aria-label="Close map"
      >
        <X className="h-3 w-3" />
        Close map
      </button>
    </div>
  );
}

type NearbyItem = {
  key: string;
  title: string;
  detail: string | null;
  url: string | null;
  Icon: any;
  colorClass: string;

};

function normalizeNearby(nearby: string[]): NearbyItem[] {
  const map = new Map<string, NearbyItem>();
  const pickIcon = (cat: string) => {
    const c = cat.toLowerCase();
    if (c.includes("petrol")) return { Icon: Fuel, colorClass: "text-orange-600" };
    if (c.includes("bus")) return { Icon: Bus, colorClass: "text-amber-700" };
    if (c.includes("hospital")) return { Icon: Hospital, colorClass: "text-rose-600" };
    return { Icon: Route, colorClass: "text-slate-700" };
  };
  for (const raw of nearby) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const cleaned = s.replace(/^near\s+/i, "").trim();
    const [left, ...rest] = cleaned.split(":");
    const category = (left || "").trim() || "Nearby";
    const detailRaw = rest.join(":").trim();
    const { url, textWithoutUrl } = extractFirstUrl(detailRaw);
    const detail = textWithoutUrl ? textWithoutUrl : null;
    const key = category.toLowerCase();
    const iconMeta = pickIcon(category);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        title: `Near ${category}`,
        detail,
        url,
        Icon: iconMeta.Icon,
        colorClass: iconMeta.colorClass,
      });
    } else {
      // Prefer keeping a more detailed row if we later find one
      if (!existing.detail && detail) existing.detail = detail;
      if (!existing.url && url) existing.url = url;
    }
  }
  return Array.from(map.values());

}

function PolicyCard({
  icon,
  label,
  tone = "neutral",

}: {
  icon: React.ReactNode;
  label: string;
  tone?: "neutral" | "success";

}) {
  const cls =
    tone === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : "bg-slate-50 border-slate-200 text-slate-800";
  return (
    <div
      className={[
        "group box-border w-full inline-flex items-center gap-2 rounded-xl border border-solid px-3 py-2",
        cls,
        "shadow-sm shadow-transparent select-none",
        "motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out",
        "motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-sm",
        "hover:bg-white hover:border-slate-300",
        "active:scale-[0.98]",
      ].join(" ")}
    >
      <span className="text-[#02665e]">{icon}</span>
      <span className="text-xs font-semibold truncate">{label}</span>
    </div>
  );

}

function fmtMoney(amount: number | null | undefined, currency?: string | null) {
  if (amount == null || !Number.isFinite(Number(amount))) return "-";
  const cur = currency || "TZS";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(Number(amount));
  } catch {
    return `${cur} ${Number(amount).toLocaleString()}`;
  }

}

function capWords(s: string, maxChars: number) {
  const t = String(s || "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1).trimEnd() + "...";

}

// Bed size dimensions reference

const BED_DIMENSIONS: Record<string, string> = {
  twin: "38\" x 75\" (96.5 x 190.5 cm)",
  full: "54\" x 75\" (137 x 190.5 cm)",
  queen: "60\" x 80\" (152.4 x 203.2 cm)",
  king: "76\" x 80\" (193 x 203.2 cm)",

};

function bedsToSummary(beds: any): string {
  if (!beds || typeof beds !== "object") return "-";
  const entries: Array<{ key: string; label: string }> = [
    { key: "twin", label: "Twin" },
    { key: "full", label: "Full" },
    { key: "queen", label: "Queen" },
    { key: "king", label: "King" },
  ];
  const parts = entries
    .map(({ key, label }) => {
      const n = Number((beds as any)[key]);
      if (!Number.isFinite(n) || n <= 0) return null;
      return `${n} ${label}`;
    })
    .filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : "-";

}

function getBedDimensions(bedsSummary: string): string | null {
  if (!bedsSummary || bedsSummary === "-") return null;
  

  // Extract bed types from summary (e.g., "2 Queen, 1 Twin")
  const bedTypes = bedsSummary.split(',').map(s => {
    const match = s.trim().match(/\d+\s+(twin|full|queen|king)/i);
    return match ? match[1].toLowerCase() : null;
  }).filter(Boolean) as string[];
  

  if (bedTypes.length === 0) return null;
  

  // Get unique bed types and their dimensions
  const uniqueTypes = Array.from(new Set(bedTypes));
  const dimensions = uniqueTypes
    .map(type => {
      const dim = BED_DIMENSIONS[type];
      return dim ? `${type.charAt(0).toUpperCase() + type.slice(1)}: ${dim}` : null;
    })
    .filter(Boolean) as string[];
  

  return dimensions.length > 0 ? dimensions.join(" | ") : null;

}

function normalizeRoomSpec(
  r: any, 

  idx: number, 

  currency: string | null, 

  fallbackBasePrice: number | null,
  property?: any,
  systemCommission: number = 0

): RoomSpecRow {
  const roomType = String(r?.roomType || r?.name || r?.label || `Room ${idx + 1}`).trim() || `Room ${idx + 1}`;
  const roomsCountRaw = r?.roomsCount ?? r?.count ?? r?.quantity ?? null;
  const roomsCount = roomsCountRaw == null ? null : (Number.isFinite(Number(roomsCountRaw)) ? Number(roomsCountRaw) : null);
  const bedsSummary = bedsToSummary(r?.beds);
  const description = String(r?.roomDescription || r?.description || "").trim();
  const amenities = Array.from(
    new Set<string>([
      ...(Array.isArray(r?.otherAmenities) ? r.otherAmenities : []),
      ...(Array.isArray(r?.amenities) ? r.amenities : []),
    ].map((x: any) => String(x || "").trim()).filter(Boolean))
  );
  const priceRaw = r?.pricePerNight ?? r?.price ?? null;
  const originalPricePerNight = Number.isFinite(Number(priceRaw)) && Number(priceRaw) > 0 ? Number(priceRaw) : (fallbackBasePrice != null ? Number(fallbackBasePrice) : null);
  

  // Calculate final price with commission
  const pricePerNight = originalPricePerNight && property
    ? calculatePriceWithCommission(originalPricePerNight, getPropertyCommission(property, systemCommission))
    : originalPricePerNight;
  // Discounts are not currently captured in owner form, but support common shapes.
  const discountPercent = Number.isFinite(Number(r?.discountPercent)) ? Number(r.discountPercent) : null;
  const discountAmount = Number.isFinite(Number(r?.discountAmount)) ? Number(r.discountAmount) : null;
  const discountedPrice = Number.isFinite(Number(r?.discountedPrice)) ? Number(r.discountedPrice) : null;
  const discountLabel =
    discountPercent && discountPercent > 0
      ? `${discountPercent}% off`
      : discountAmount && discountAmount > 0
        ? `${fmtMoney(discountAmount, currency)} off`
        : discountedPrice && discountedPrice > 0 && pricePerNight && discountedPrice < pricePerNight
          ? `Now ${fmtMoney(discountedPrice, currency)}`
          : null;
  const smoking = String(r?.smoking || "").toLowerCase();
  const bathPrivate = String(r?.bathPrivate || "").toLowerCase();
  const towelColor = String(r?.towelColor || "").trim();
  const bathItems = Array.isArray(r?.bathItems) ? r.bathItems.map((x: any) => String(x || "").trim()).filter(Boolean) : [];
  const policies: PolicyItem[] = [
    smoking ? {
      text: "Smoking",
      Icon: smoking === "yes" ? CheckCircle : CigaretteOff,
      iconColor: smoking === "yes" ? "text-green-600" : "text-red-600",
    } : null,
    towelColor ? {
      text: `Towels: ${towelColor}`,
    } : null,
  ].filter(Boolean) as PolicyItem[];
  return {
    roomType,
    roomCode: r?.code || r?.roomCode || undefined, // Extract room code
    roomsCount,
    bedsSummary,
    description,
    amenities,
    bathItems,
    bathPrivate,
    pricePerNight,
    discountLabel,
    payActionLabel: "Pay now",
    policies: policies.length ? policies : [{ text: "-" }],
  };

}

function normalizeRoomsSpec(
  roomsSpec: any[], 

  currency: string | null, 

  fallbackBasePrice: number | null,
  property?: any,
  systemCommission: number = 0

): RoomSpecRow[] {
  if (!Array.isArray(roomsSpec)) return [];
  return roomsSpec.map((r, idx) => normalizeRoomSpec(r, idx, currency, fallbackBasePrice, property, systemCommission));

}

function joinLocation(p: Pick<PublicPropertyDetail, "city" | "district" | "regionName" | "country">) {
  // Owners often type parts in capitals ("DAR-ES-SALAAM"); show them in title case
  // and drop repeats such as a region that matches the city.
  const tidy = (raw: unknown) => {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    if (s !== s.toUpperCase()) return s;
    return s
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/\b(\w)(\w*)/g, (_m, a: string, b: string) => (["es", "wa", "la", "ya", "na"].includes(a + b) ? a + b : a.toUpperCase() + b));
  };
  const seen = new Set<string>();
  return [p.city, p.district, p.regionName, p.country]
    .map(tidy)
    .filter((part) => {
      const key = part.toLowerCase().replace(/[^a-z]/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");

}

function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];

}

function getFloorName(floorNum: number): string {
  if (floorNum === 0) return "Ground";
  return `${floorNum}${getOrdinal(floorNum)}`;

}

function parseBookingDateOnly(dateString: string) {
  const value = String(dateString || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return parsed;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function todayBookingDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateString: string) {
  const d = parseBookingDateOnly(dateString);
  if (isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

}

function cleanPublicText(value: string) {
  let text = String(value || "");
  for (let i = 0; i < 4; i += 1) {
    text = text
      .replace(/&amp;/gi, "&")
      .replace(/&#x27;|&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&nbsp;/gi, " ");
  }

  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?])(?=[A-Z])/g, "$1 ")
    .trim();
}

function formatTimeAgo(ms: number): string {
  if (!ms || ms <= 0) return "-";
  const diff = Date.now() - ms;
  if (diff < 10 * 1000) return "just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "< 1m ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;

}

// Availability Checker Component

function PropertyAvailabilityChecker({
  propertyId,
  onAvailability,
  onDatesChange,
  refreshSignal,
  dates,
  compact = false,
  openPickerSignal,
  selectedRoomCode,
  onRoomTypeSelect,

}: {
  propertyId: number;
  onAvailability?: (data: any | null) => void;
  onDatesChange?: (checkIn: string, checkOut: string) => void;
  refreshSignal?: number;
  dates?: { checkIn: string; checkOut: string };
  /** Booking-card layout: one date pair plus a single live status line */
  compact?: boolean;
  /** Bump to open the next missing date picker (e.g. from the booking button) */
  openPickerSignal?: number;
  /** Room type chosen in the booking card. Booking stays locked without it. */
  selectedRoomCode?: string | null;
  onRoomTypeSelect?: (roomCode: string | null) => void;

}) {
  const [checkIn, setCheckIn] = useState<string>("");
  const [checkOut, setCheckOut] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [availability, setAvailability] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkInPickerOpen, setCheckInPickerOpen] = useState(false);
  const [checkOutPickerOpen, setCheckOutPickerOpen] = useState(false);
  const inFlightRef = useRef(false);
  const debounceTimerRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRunAtRef = useRef<number>(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(0);
  const [, setNowTick] = useState(0);
  const runCheckNow = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!checkIn || !checkOut) return;
    const checkInDate = parseBookingDateOnly(checkIn);
    const checkOutDate = parseBookingDateOnly(checkOut);
    const today = todayBookingDateOnly();
    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      setError("Please select valid dates");
      return;
    }
    if (checkInDate < today) {
      setError("Check-in date cannot be in the past");
      return;
    }
    if (checkOutDate <= checkInDate) {
      setError("Check-out date must be after check-in date");
      return;
    }
    // Simple throttle: avoid bursts when both date pickers fire quickly.
    const nowMs = Date.now();
    if (nowMs - lastRunAtRef.current < 800) return;
    lastRunAtRef.current = nowMs;
    // Cancel any previous request (date changes)
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/availability/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          propertyId,
          checkIn,
          checkOut,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to check availability");
      setAvailability(data);
      onAvailability?.(data);
      setLastUpdatedAt(Date.now());
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const msg = err?.message || "Failed to check availability";
      setError(msg);
      // If we get rate-limited, keep the last known availability visible.
      if (!/Too many availability requests/i.test(msg)) {
        setAvailability(null);
        onAvailability?.(null);
      }
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [checkIn, checkOut, onAvailability, propertyId]);
  const scheduleCheck = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void runCheckNow();
    }, 1500);
  }, [runCheckNow]);
  const incomingCheckIn = dates?.checkIn || "";
  const incomingCheckOut = dates?.checkOut || "";
  // Keep local inputs in sync if parent provides date values.
  useEffect(() => {
    if (!incomingCheckIn && !incomingCheckOut) return;
    if (incomingCheckIn !== checkIn) setCheckIn(incomingCheckIn);
    if (incomingCheckOut !== checkOut) setCheckOut(incomingCheckOut);
  }, [incomingCheckIn, incomingCheckOut, checkIn, checkOut]);
  // Live updates: whenever the date range changes, auto-check (debounced).
  useEffect(() => {
    if (!checkIn || !checkOut) return;
    scheduleCheck();
  }, [checkIn, checkOut, scheduleCheck]);
  // Live updates: socket/parent can bump refreshSignal to re-check (debounced).
  useEffect(() => {
    if (refreshSignal == null) return;
    if (!checkIn || !checkOut) return;
    scheduleCheck();
  }, [refreshSignal, checkIn, checkOut, scheduleCheck]);
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 30 * 1000);
    return () => clearInterval(id);
  }, []);
  const formatDate = (dateString: string) => {
    const date = parseBookingDateOnly(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };
  // The booking button can ask us to open whichever date is still missing.
  useEffect(() => {
    if (!openPickerSignal) return;
    if (!checkIn) {
      setCheckInPickerOpen(true);
      setCheckOutPickerOpen(false);
    } else if (!checkOut) {
      setCheckOutPickerOpen(true);
      setCheckInPickerOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPickerSignal]);

  if (compact) {
    const shortDate = (s: string) =>
      parseBookingDateOnly(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const rooms = Number(availability?.summary?.totalAvailableRooms ?? 0);
    return (
      <div>
        {/* One bordered date pair, split down the middle */}
        <div className="relative grid grid-cols-2 rounded-xl border border-solid border-slate-300 bg-white">
          <button
            type="button"
            onClick={() => {
              setCheckInPickerOpen(true);
              setCheckOutPickerOpen(false);
            }}
            className={`box-border min-w-0 rounded-l-xl border-0 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50 ${checkInPickerOpen ? "bg-slate-50 ring-2 ring-inset ring-[#02665e]" : "bg-transparent"}`}
          >
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">Check-in</span>
            <span className={`mt-0.5 block truncate text-[14px] ${checkIn ? "font-semibold text-slate-900" : "text-slate-400"}`}>
              {checkIn ? shortDate(checkIn) : "Add date"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!checkIn) {
                setCheckInPickerOpen(true);
                return;
              }
              setCheckOutPickerOpen(true);
              setCheckInPickerOpen(false);
            }}
            className={`box-border min-w-0 rounded-r-xl border-0 border-l border-solid border-slate-300 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50 ${checkOutPickerOpen ? "bg-slate-50 ring-2 ring-inset ring-[#02665e]" : "bg-transparent"}`}
          >
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">Check-out</span>
            <span className={`mt-0.5 block truncate text-[14px] ${checkOut ? "font-semibold text-slate-900" : "text-slate-400"}`}>
              {checkOut ? shortDate(checkOut) : "Add date"}
            </span>
          </button>

          {checkInPickerOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setCheckInPickerOpen(false)} />
              <div className="absolute left-0 top-full z-50 mt-2 rounded-xl border border-solid border-slate-200 bg-white shadow-xl">
                <DatePicker
                  selected={checkIn}
                  allowRange={false}
                  onSelectAction={(s) => {
                    const date = Array.isArray(s) ? s[0] : s;
                    setError(null);
                    setAvailability(null);
                    onAvailability?.(null);
                    setCheckIn(date);
                    onDatesChange?.(date, checkOut);
                    setCheckInPickerOpen(false);
                    if (checkOut && date && parseBookingDateOnly(checkOut) <= parseBookingDateOnly(date)) {
                      setCheckOut("");
                      onDatesChange?.(date, "");
                    }
                    // Flow straight on to check-out
                    if (!checkOut || (date && parseBookingDateOnly(checkOut) <= parseBookingDateOnly(date))) setCheckOutPickerOpen(true);
                  }}
                  onCloseAction={() => setCheckInPickerOpen(false)}
                  minDate={localIsoDate()}
                />
              </div>
            </>
          )}
          {checkOutPickerOpen && checkIn && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setCheckOutPickerOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 rounded-xl border border-solid border-slate-200 bg-white shadow-xl">
                <DatePicker
                  selected={checkOut}
                  allowRange={false}
                  onSelectAction={(s) => {
                    const date = Array.isArray(s) ? s[0] : s;
                    setError(null);
                    setAvailability(null);
                    onAvailability?.(null);
                    setCheckOut(date);
                    onDatesChange?.(checkIn, date);
                    setCheckOutPickerOpen(false);
                  }}
                  onCloseAction={() => setCheckOutPickerOpen(false)}
                  minDate={checkIn || localIsoDate()}
                />
              </div>
            </>
          )}
        </div>

        {/* Live status line */}
        <div className="mt-2.5 min-h-[20px] text-[12.5px]" aria-live="polite">
          {error ? (
            <p className="m-0 flex items-start gap-1.5 text-rose-600">
              <AlertCircle className="mt-px h-3.5 w-3.5 flex-none" aria-hidden />
              {error}
            </p>
          ) : loading && !availability ? (
            <p className="m-0 flex items-center gap-1.5 text-slate-500">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-solid border-slate-300 border-t-[#02665e]" aria-hidden />
              Checking live availability
            </p>
          ) : availability && checkIn && checkOut ? (
            availability.available ? (
              <p className="m-0 flex items-center gap-1.5 font-medium text-emerald-700">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                Available{rooms > 0 ? `: ${rooms} room${rooms === 1 ? "" : "s"} left for these dates` : " for these dates"}
                {loading && <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-normal text-slate-400"><span className="h-2.5 w-2.5 animate-spin rounded-full border border-solid border-slate-300 border-t-[#02665e]" />Refreshing</span>}
              </p>
            ) : (
              <p className="m-0 flex items-center gap-1.5 font-medium text-amber-700">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                Fully booked for these dates. Try other dates.
              </p>
            )
          ) : (
            <p className="m-0 text-slate-500">Add your dates to see live availability.</p>
          )}
        </div>

        {/* Per room type breakdown, folded away until asked for */}
        {!error && availability?.available && checkIn && checkOut && availability.byRoomType && Object.keys(availability.byRoomType).length > 0 && (
          <details className="group mt-2 rounded-lg border border-solid border-slate-200 bg-slate-50/60 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[12.5px] font-semibold text-[#02665e]">
              <span className="truncate">{selectedRoomCode ? `Selected: ${selectedRoomCode === "default" ? "All rooms" : selectedRoomCode}` : "Choose a room type"}</span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="m-0 list-none border-0 border-t border-solid border-slate-200 px-0 py-1">
              {Object.entries(availability.byRoomType).map(([code, d]: [string, any]) => {
                const free = Math.max(0, Number(d?.availableRooms ?? 0));
                const total = Math.max(0, Number(d?.totalRooms ?? 0));
                const pct = total > 0 ? Math.round((free / total) * 100) : 0;
                const selected = selectedRoomCode === code;
                const label = code === "default" ? "All rooms" : code;
                return (
                  <li key={code} className="px-1.5 py-0.5">
                    <button
                      type="button"
                      disabled={free <= 0}
                      aria-pressed={selected}
                      onClick={() => onRoomTypeSelect?.(selected ? null : code)}
                      className={`box-border w-full rounded-lg border border-solid px-2 py-2 text-left transition ${selected ? "border-emerald-400 bg-emerald-50" : "border-transparent bg-transparent hover:border-slate-200 hover:bg-white"} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-full border border-solid ${selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-transparent"}`}><Check className="h-2.5 w-2.5" aria-hidden /></span>
                          <span className="truncate font-medium text-slate-800">{label}</span>
                        </span>
                        <span className={`flex-none tabular-nums ${free > 0 ? "text-slate-600" : "text-amber-700"}`}>
                          {free > 0 ? <><span className="font-bold text-slate-900">{free}</span> of {total} free</> : "Full"}
                        </span>
                      </span>
                      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-solid border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
          <Calendar className="w-5 h-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Availability Live Updates</h2>
          <div className="text-xs text-slate-500">
            Select check-in and check-out dates to see live availability | Last updated: {formatTimeAgo(lastUpdatedAt)}
            <span className="text-slate-400"> (refreshes up to every 4 minutes)</span>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        {/* Date Pickers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              Check-in Date
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setCheckInPickerOpen(true);
                  setCheckOutPickerOpen(false);
                }}
                className="w-full px-4 py-3 border-2 border-solid border-slate-300 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-white shadow-sm flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#02665e]" />
                  <span className="text-slate-900">
                    {checkIn ? formatDate(checkIn) : "Select date"}
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </button>
              {checkInPickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCheckInPickerOpen(false)} />
                  <div className="absolute z-50 top-full left-0 mt-2 bg-white rounded-xl border-2 border-solid border-slate-200 shadow-xl">
                    <DatePicker
                      selected={checkIn}
                      allowRange={false}
                      onSelectAction={(s) => {
                        const date = Array.isArray(s) ? s[0] : s;
                        setError(null);
                        setCheckIn(date);
                        onDatesChange?.(date, checkOut);
                        setCheckInPickerOpen(false);
                        // Reset check-out if it's before new check-in
                        if (checkOut && date && parseBookingDateOnly(checkOut) <= parseBookingDateOnly(date)) {
                          setCheckOut("");
                          onDatesChange?.(date, "");
                        }
                      }}
                      onCloseAction={() => setCheckInPickerOpen(false)}
                      minDate={localIsoDate()}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              Check-out Date
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setCheckOutPickerOpen(true);
                  setCheckInPickerOpen(false);
                }}
                disabled={!checkIn}
                className="w-full px-4 py-3 border-2 border-solid border-slate-300 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-white shadow-sm flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#02665e]" />
                  <span className="text-slate-900">
                    {checkOut ? formatDate(checkOut) : "Select date"}
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </button>
              {checkOutPickerOpen && checkIn && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCheckOutPickerOpen(false)} />
                  <div className="absolute z-50 top-full left-0 mt-2 bg-white rounded-xl border-2 border-solid border-slate-200 shadow-xl">
                    <DatePicker
                      selected={checkOut}
                      allowRange={false}
                      onSelectAction={(s) => {
                        const date = Array.isArray(s) ? s[0] : s;
                        setError(null);
                        setCheckOut(date);
                        onDatesChange?.(checkIn, date);
                        setCheckOutPickerOpen(false);
                      }}
                      onCloseAction={() => setCheckOutPickerOpen(false)}
                      minDate={checkIn || localIsoDate()}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {/* Three-dot loading indicator alternating green/blue like a car indicator */}
        <div className={`flex items-center justify-center gap-1.5 h-5 transition-opacity duration-300 ${loading ? 'opacity-100' : 'opacity-0'}`}>
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.3s]" />
          <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" />
        </div>
        {/* Error Message */}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-solid border-red-200 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {/* Availability Results */}
        {availability && !error && (
          <div className="mt-4 overflow-hidden rounded-3xl border border-solid border-[#02665e]/20 bg-white shadow-[0_16px_40px_rgba(2,102,94,0.18)]">
            <div className="relative px-5 py-4 border-b border-white/15 bg-gradient-to-br from-[#02665e] via-[#025c55] to-[#024a43] overflow-hidden">
              {/* Diagonal white slash stripes */}
              <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 18px)' }} />
              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                                        {/* Animated live pulse icon */}
                    <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/25 flex-shrink-0">
                      {/* Outer pulsing ring */}
                      <span className="absolute inset-0 rounded-2xl animate-ping bg-white/20" style={{ animationDuration: '2.4s' }} />
                      <Wifi className="w-5 h-5 relative z-10" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-extrabold tracking-tight text-white">Availability</h3>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-white ring-1 ring-white/30">
                          {/* Triple-ring live dot */}
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75 animate-ping" style={{ animationDuration: '1.5s' }} />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                          </span>
                          LIVE
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12px]">
                        <span className="font-semibold text-white/90">{formatDate(checkIn)} - {formatDate(checkOut)}</span>
                        <span className="text-white/40"> • </span>
                        <span className="text-white/60">Updated {formatTimeAgo(lastUpdatedAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white/80 ring-1 ring-white/20">
                    Refreshes up to every 4 minutes
                  </span>
                </div>
              </div>
            </div>
            {availability.available ? (
              <div className="p-5 bg-[#f5fbfa]">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Premium summary */}
                  <div className="lg:col-span-1">
                    <div className="rounded-3xl border border-solid border-[#02665e]/15 bg-white p-4 shadow-[0_4px_16px_rgba(2,102,94,0.08)]">
                      <div className="text-[11px] font-bold tracking-wide text-[#02665e] uppercase">Available now</div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-[#f0faf9] ring-1 ring-[#02665e]/15 p-3">
                          <div className="text-[11px] font-medium text-slate-600">Rooms</div>
                          <div className="mt-1 text-3xl font-semibold tracking-tight text-[#02665e]">{availability.summary.totalAvailableRooms}</div>
                        </div>
                        <div className="rounded-2xl bg-[#f0faf9] ring-1 ring-[#02665e]/15 p-3">
                          <div className="text-[11px] font-medium text-slate-600">Beds</div>
                          <div className="mt-1 text-3xl font-semibold tracking-tight text-[#02665e]">{availability.summary.totalAvailableBeds}</div>
                        </div>
                      </div>
                      <div className="mt-3 text-[11px] text-slate-500">
                        Numbers reflect the selected date range.
                      </div>
                    </div>
                  </div>
                  {/* Clean breakdown table */}
                  <div className="lg:col-span-2">
                    <div className="rounded-3xl border border-solid border-[#02665e]/15 overflow-hidden bg-white">
                      <div className="px-4 py-3 bg-[#f0faf9] border-b border-[#02665e]/10">
                        <div className="hidden md:grid grid-cols-12 gap-3 text-[11px] font-bold tracking-wide text-[#02665e]/70 uppercase">
                          <div className="col-span-4">Room type</div>
                          <div className="col-span-3 text-right">Rooms</div>
                          <div className="col-span-3 text-right">Beds</div>
                          <div className="col-span-2 text-right">Status</div>
                        </div>
                        <div className="md:hidden text-xs font-bold tracking-wide text-slate-600 uppercase">By room type</div>
                      </div>
                      <div className="divide-y divide-slate-200">
                        {(availability.byRoomType && Object.keys(availability.byRoomType).length > 0
                          ? Object.entries(availability.byRoomType)
                          : [])
                          .map(([roomCode, data]: [string, any]) => {
                            const availableRooms = Number(data?.availableRooms ?? 0);
                            const totalRooms = Math.max(0, Number(data?.totalRooms ?? 0));
                            const availableBeds = Number(data?.availableBeds ?? 0);
                            const totalBeds = Math.max(0, Number(data?.totalBeds ?? 0));
                            const bookedRooms = Math.max(0, Number(data?.bookedRooms ?? 0));
                            const blockedRooms = Math.max(0, Number(data?.blockedRooms ?? 0));
                            const roomsPct = totalRooms > 0 ? Math.round((availableRooms / totalRooms) * 100) : 0;
                            const bedsPct = totalBeds > 0 ? Math.round((availableBeds / totalBeds) * 100) : 0;
                            return (
                              <div key={roomCode} className="px-4 py-3">
                                <div className="grid grid-cols-12 gap-3 items-center">
                                  <div className="col-span-12 md:col-span-4 min-w-0">
                                    <div className="text-sm font-extrabold text-slate-900 truncate">
                                      {roomCode === "default" ? "All Rooms" : roomCode}
                                    </div>
                                    <div className="mt-1 flex md:hidden items-center gap-2 text-[11px] text-slate-500">
                                      <span className="font-semibold">{availableRooms}</span>/{totalRooms} rooms
                                      <span className="text-slate-300">|</span>
                                      <span className="font-semibold">{availableBeds}</span>/{totalBeds} beds
                                    </div>
                                  </div>
                                  <div className="col-span-6 md:col-span-3 md:text-right">
                                    <div className="md:hidden text-[10px] font-bold tracking-wide text-slate-500 uppercase">Rooms</div>
                                    <div className="text-sm font-extrabold text-slate-900">
                                      {availableRooms}
                                      <span className="text-slate-300">/</span>
                                      <span className="text-slate-600 font-bold">{totalRooms}</span>
                                    </div>
                                    <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden ring-1 ring-slate-200">
                                      <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600" style={{ width: `${roomsPct}%` }} />
                                    </div>
                                  </div>
                                  <div className="col-span-6 md:col-span-3 md:text-right">
                                    <div className="md:hidden text-[10px] font-bold tracking-wide text-slate-500 uppercase">Beds</div>
                                    <div className="text-sm font-extrabold text-slate-900">
                                      {availableBeds}
                                      <span className="text-slate-300">/</span>
                                      <span className="text-slate-600 font-bold">{totalBeds}</span>
                                    </div>
                                    <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden ring-1 ring-slate-200">
                                      <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600" style={{ width: `${bedsPct}%` }} />
                                    </div>
                                  </div>
                                  <div className="col-span-12 md:col-span-2 md:flex md:justify-end">
                                    <div className="flex flex-wrap gap-2 md:justify-end">
                                      {bookedRooms > 0 ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900 ring-1 ring-amber-200">
                                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                                          {bookedRooms} booked
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                                          Available
                                        </span>
                                      )}
                                      {blockedRooms > 0 ? (
                                        <span
                                          className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200"
                                          title="These rooms are already booked or reserved for the selected dates."
                                        >
                                          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                                          {blockedRooms} booked
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-5 bg-[#f5fbfa]">
                <div className="rounded-3xl border border-solid border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-800 ring-1 ring-amber-500/20">
                      <AlertCircle className="w-5 h-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="text-base font-extrabold tracking-tight text-amber-950">Not available</div>
                      <div className="mt-1 text-sm text-amber-800">No rooms or beds are available for the selected dates.</div>
                      <div className="mt-2 text-[12px] text-amber-700">Try a different date range.</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

}

// ─── Room Quick View Modal ────────────────────────────────────────────────────
function RoomQuickViewModal({
  roomType,
  floor,
  propertyId,
  propertySlug,
  initialCheckIn,
  initialCheckOut,
  onClose,
  router,
}: {
  roomType: string;
  floor: number;
  propertyId: number;
  propertySlug: string;
  initialCheckIn: string;
  initialCheckOut: string;
  onClose: () => void;
  router: ReturnType<typeof import("next/navigation").useRouter>;
}) {
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ available: number; checked: boolean }>({ available: 0, checked: false });
  const inFlight = useRef(false);
  const [pickerField, setPickerField] = useState<"checkIn" | "checkOut" | null>(null);

  const today = localIsoDate();

  const nightCount = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    const ci = parseBookingDateOnly(checkIn);
    const co = parseBookingDateOnly(checkOut);
    if (isNaN(ci.getTime()) || isNaN(co.getTime())) return 0;
    return Math.max(0, Math.round((co.getTime() - ci.getTime()) / 86400000));
  }, [checkIn, checkOut]);

  // ciStr/coStr allow callers to pass freshly-picked values before React state settles
  const check = useCallback(async (ciStr?: string, coStr?: string) => {
    if (inFlight.current) return;
    const ci_s = ciStr ?? checkIn;
    const co_s = coStr ?? checkOut;
    if (!ci_s || !co_s) { setError("Select both check-in and check-out dates"); return; }
    const ci = parseBookingDateOnly(ci_s);
    const co = parseBookingDateOnly(co_s);
    if (isNaN(ci.getTime()) || isNaN(co.getTime())) { setError("Invalid dates"); return; }
    if (ci < todayBookingDateOnly()) { setError("Check-in cannot be in the past"); return; }
    if (co <= ci) { setError("Check-out must be after check-in"); return; }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/public/availability/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          checkIn: ci_s,
          checkOut: co_s,
          roomCode: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check availability");
      const byType = data?.byRoomType ?? {};
      const total = Object.values(byType).reduce((sum: number, b: any) => sum + Number((b as any)?.availableRooms ?? 0), 0);
      setResult({ available: total, checked: true });
    } catch (e: any) {
      setError(e?.message || "Failed to check availability");
      setResult({ available: 0, checked: false });
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [checkIn, checkOut, propertyId]);

  const canBook = result.checked && result.available > 0 && !!checkIn && !!checkOut;
  const bookUrl = `/public/booking/confirm?property=${encodeURIComponent(propertySlug)}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`;

  // Escape: close picker first, then modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickerField) setPickerField(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, pickerField]);

  const modal = (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Quick booking — ${roomType}`}
    >
      {/* Backdrop — clicking while picker is open closes picker, otherwise closes modal */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => { if (pickerField) setPickerField(null); else onClose(); }}
        aria-hidden="true"
      />

      {/* Card — relative so the picker overlay can be absolute inside it */}
      <div
        className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl ring-1 ring-black/[0.08] flex flex-col overflow-hidden"
        style={{ minHeight: pickerField ? 460 : undefined }}
      >
        {/* ── Inline date picker overlay ── */}
        {pickerField && (
          <div className="absolute inset-0 z-20 bg-white rounded-3xl flex flex-col">
            {/* Mini-header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 flex-shrink-0">
              <span className="text-sm font-bold text-slate-700">
                {pickerField === "checkIn" ? "Select check-in date" : "Select check-out date"}
              </span>
              <button
                type="button"
                onClick={() => setPickerField(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
                aria-label="Close date picker"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            {/* Calendar — centered in remaining space */}
            <div className="flex-1 flex items-start justify-center pt-2 pb-4 px-3">
              <DatePicker
                selected={pickerField === "checkIn" ? (checkIn || undefined) : (checkOut || undefined)}
                allowRange={false}
                allowPast={false}
                twoMonths={false}
                minDate={pickerField === "checkIn" ? today : (checkIn || today)}
                initialViewDate={pickerField === "checkIn" ? (checkIn || today) : (checkOut || checkIn || today)}
                onSelectAction={(s) => {
                  const v = String(Array.isArray(s) ? s[0] : s);
                  if (pickerField === "checkIn") {
                    setCheckIn(v);
                    setResult({ available: 0, checked: false });
                    setError(null);
                    // Auto-advance to check-out if not set or now invalid
                    if (!checkOut || checkOut <= v) setPickerField("checkOut");
                    else setPickerField(null);
                  } else {
                    setCheckOut(v);
                    setResult({ available: 0, checked: false });
                    setError(null);
                    setPickerField(null);
                    // Pass fresh values directly — state hasn't settled yet
                    check(checkIn, v);
                  }
                }}
                onCloseAction={() => setPickerField(null)}
              />
            </div>
          </div>
        )}

        {/* ── Header ── */}
        <div className="bg-[#02665e] px-6 py-5 relative overflow-hidden flex-shrink-0">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{ backgroundImage: "repeating-linear-gradient(-55deg,rgba(255,255,255,1) 0px,rgba(255,255,255,1) 1.5px,transparent 1.5px,transparent 20px)" }}
          />
          <div className="relative z-10 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1">Quick Booking</div>
              <div className="text-2xl font-black text-white truncate leading-tight">{roomType}</div>
              <div className="mt-1 text-sm text-white/70 flex items-center gap-1.5">
                <span>{getFloorName(floor)} Floor</span>
                {nightCount > 0 && (
                  <>
                    <span className="text-white/30">·</span>
                    <span className="text-white/80 font-semibold">{nightCount} night{nightCount !== 1 ? "s" : ""}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex-shrink-0 w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 transition-colors flex items-center justify-center mt-0.5"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Date selector buttons */}
          <div className="grid grid-cols-2 gap-3">
            {/* Check-in */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                Check-in
              </label>
              <button
                type="button"
                onClick={() => setPickerField("checkIn")}
                className={
                  "w-full h-12 rounded-xl border text-left text-sm relative pl-10 pr-3 transition-all focus:outline-none " +
                  (pickerField === "checkIn"
                    ? "border-[#02665e] ring-2 ring-[#02665e]/20 bg-[#02665e]/5"
                    : "border-slate-200 bg-white hover:border-[#02665e]/50 hover:bg-slate-50")
                }
              >
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                <span className={checkIn ? "text-slate-800 font-semibold" : "text-slate-400 text-xs"}>
                  {checkIn ? formatDateLabel(checkIn) : "Select date"}
                </span>
              </button>
            </div>

            {/* Check-out */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                Check-out
              </label>
              <button
                type="button"
                onClick={() => setPickerField("checkOut")}
                className={
                  "w-full h-12 rounded-xl border text-left text-sm relative pl-10 pr-3 transition-all focus:outline-none " +
                  (pickerField === "checkOut"
                    ? "border-[#02665e] ring-2 ring-[#02665e]/20 bg-[#02665e]/5"
                    : "border-slate-200 bg-white hover:border-[#02665e]/50 hover:bg-slate-50")
                }
              >
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                <span className={checkOut ? "text-slate-800 font-semibold" : "text-slate-400 text-xs"}>
                  {checkOut ? formatDateLabel(checkOut) : "Select date"}
                </span>
              </button>
            </div>
          </div>

          {/* Check availability button */}
          <button
            type="button"
            onClick={() => check()}
            disabled={loading || !checkIn || !checkOut}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#02665e] text-white py-3.5 text-sm font-bold hover:bg-[#014e47] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <LogoSpinner size="xs" ariaLabel="Checking" />
                Checking...
              </>
            ) : (result.checked ? "Re-check availability" : "Check availability")}
          </button>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-solid border-rose-200 px-3.5 py-3">
              <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
              <span className="text-xs font-semibold text-rose-700">{error}</span>
            </div>
          )}

          {/* Result */}
          {result.checked && !error && (
            <div className={`rounded-2xl border px-4 py-3.5 ${result.available > 0 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
              <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${result.available > 0 ? "text-emerald-600" : "text-amber-600"}`}>
                {result.available > 0 ? "Great news!" : "Availability"}
              </div>
              <div className={`text-lg font-black ${result.available > 0 ? "text-emerald-800" : "text-amber-800"}`}>
                {result.available > 0
                  ? `${result.available} room${result.available !== 1 ? "s" : ""} available`
                  : "No rooms available for these dates"}
              </div>
              {result.available > 0 && (
                <div className="mt-1 text-xs text-emerald-600 font-medium">
                  {formatDateLabel(checkIn)} {"\u2192"} {formatDateLabel(checkOut)}
                  {nightCount > 0 && ` \u00b7 ${nightCount} night${nightCount !== 1 ? "s" : ""}`}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 pb-6 pt-1 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => router.push(bookUrl)}
            disabled={!canBook}
            className="inline-flex items-center justify-center rounded-xl bg-[#02665e] text-white py-3.5 text-sm font-bold hover:bg-[#014e47] active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Book now
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              setTimeout(() => document.getElementById("roomsSection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
            }}
            className="inline-flex items-center justify-center rounded-xl border border-solid border-slate-200 bg-white text-slate-700 py-3.5 text-sm font-semibold hover:bg-slate-50 active:scale-[0.98] transition-all"
          >
            View rooms
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

export default function PublicPropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String((params as any)?.slug ?? "");

  // A visitor arriving on ?s=<token> came through someone's shared link. Record
  // the open once per session and remember the token so a registration later in
  // the month still credits the person who shared it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = new URLSearchParams(window.location.search).get("s");
    if (token) captureShareToken(token);
  }, []);
  // Currency display context — presentation only, never affects charges.
  const [property, setProperty] = useState<PublicPropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewsData, setReviewsData] = useState<ReviewsResponse | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(0);
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [reviewTitle, setReviewTitle] = useState<string>("");
  const [reviewComment, setReviewComment] = useState<string>("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitMsg, setReviewSubmitMsg] = useState<string | null>(null);
  const [showAllNearbyServices, setShowAllNearbyServices] = useState(false);
  // Room cards: which descriptions and amenity lists are opened
  const [openRoomDesc, setOpenRoomDesc] = useState<Set<number>>(() => new Set());
  const [openRoomAmen, setOpenRoomAmen] = useState<Set<number>>(() => new Set());
  const toggleInSet = (set: Set<number>, key: number) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  // Nearby panel: which category is shown, and whether the list has more below
  const [nearbyKind, setNearbyKind] = useState<"all" | "medical" | "transport" | "public">("all");
  const nearbyListRef = useRef<HTMLDivElement | null>(null);
  const [nearbyHasMore, setNearbyHasMore] = useState(false);
  const measureNearbyList = useCallback(() => {
    const el = nearbyListRef.current;
    if (!el) return;
    setNearbyHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6);
  }, []);
  useEffect(() => {
    const el = nearbyListRef.current;
    if (!el) return;
    el.scrollTop = 0;
    measureNearbyList();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureNearbyList());
    ro.observe(el);
    return () => ro.disconnect();
  }, [nearbyKind, measureNearbyList]);
  const [categoryRatings, setCategoryRatings] = useState<{
    customerCare: number;
    security: number;
    reality: number;
    comfort: number;
  }>({
    customerCare: 0,
    security: 0,
    reality: 0,
    comfort: 0,
  });
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [verificationDetailsOpen, setVerificationDetailsOpen] = useState(false);
  const [priceServicesOpen, setPriceServicesOpen] = useState(false);
  const [roomAmenityHint, setRoomAmenityHint] = useState<string | null>(null);
  const [systemCommission, setSystemCommission] = useState<number>(0);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [, setShowSaveLoginPrompt] = useState(false);
  const [, setFavoriteNotice] = useState<string | null>(null);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copyLinkSuccess, setCopyLinkSuccess] = useState(false);
  const [selectedDates, setSelectedDates] = useState<{ checkIn: string; checkOut: string }>({ checkIn: "", checkOut: "" });
  // Pre-fill dates from a link (Twiga's "Book these dates" passes ?checkIn=&checkOut=),
  // so the availability checker runs for the dates the visitor already asked about.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkIn = params.get("checkIn") ?? "";
    const checkOut = params.get("checkOut") ?? "";
    const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (isDay(checkIn) && isDay(checkOut) && checkOut > checkIn) setSelectedDates({ checkIn, checkOut });
  }, []);
  const [roomQuickView, setRoomQuickView] = useState<null | { roomType: string; floor: number }>(null);
  const [availabilityData, setAvailabilityData] = useState<any | null>(null);
  const [selectedRoomCode, setSelectedRoomCode] = useState<string | null>(null);
  const [datePickerSignal, setDatePickerSignal] = useState(0);
  const [, setAvailabilitySocket] = useState<Socket | null>(null);
  const [, setAvailabilityConnected] = useState(false);
  const [availabilityRefreshTick, setAvailabilityRefreshTick] = useState(0);
  const selectedDatesRef = useRef(selectedDates);
  // Throttle socket-driven refresh signals so we don't spam the availability endpoint.
  const socketRefreshTimerRef = useRef<any>(null);
  const lastSocketRefreshAtRef = useRef<number>(0);
  useEffect(() => {
    selectedDatesRef.current = selectedDates;
  }, [selectedDates]);
  const handleBookingDatesChange = useCallback((checkIn: string, checkOut: string) => {
    const current = selectedDatesRef.current;
    if (current.checkIn !== checkIn || current.checkOut !== checkOut) {
      setSelectedRoomCode(null);
      setAvailabilityData(null);
    }
    const next = { checkIn, checkOut };
    selectedDatesRef.current = next;
    setSelectedDates(next);
  }, []);
  const handleBookingAvailability = useCallback((data: any | null) => {
    setAvailabilityData(data);
    setSelectedRoomCode((current) => {
      if (!current || !data) return data ? current : null;
      return Number(data?.byRoomType?.[current]?.availableRooms ?? 0) > 0 ? current : null;
    });
  }, []);
  // Live updates: socket updates bump a refresh signal.
  // Socket.IO connection for real-time availability updates
  useEffect(() => {
    const propertyId = property?.id;
    if (!propertyId) return;
    if (!selectedDates.checkIn || !selectedDates.checkOut) return;
    let cancelled = false;
    let socket: Socket | null = null;
    (async () => {
      try {
        const { io } = await import("socket.io-client");
        if (cancelled) return;
        const newSocket = io({
          transports: ["websocket", "polling"],
          withCredentials: true,
        });
        socket = newSocket;
        setAvailabilitySocket(newSocket);
        newSocket.on("connect", () => {
          if (cancelled) return;
          setAvailabilityConnected(true);
          newSocket.emit("join-property-availability", { propertyId });
        });
        newSocket.on("disconnect", () => {
          if (cancelled) return;
          setAvailabilityConnected(false);
        });
        newSocket.on("availability:update", (data: any) => {
          if (cancelled) return;
          if (Number(data?.propertyId) !== Number(propertyId)) return;
          const { checkIn, checkOut } = selectedDatesRef.current;
          if (!checkIn || !checkOut) return;
          const nowMs = Date.now();
          const minGapMs = 4 * 60 * 1000; // at most one refresh signal per 4 minutes
          const since = nowMs - lastSocketRefreshAtRef.current;
          if (since >= minGapMs) {
            lastSocketRefreshAtRef.current = nowMs;
            setAvailabilityRefreshTick((t) => t + 1);
            return;
          }
          if (socketRefreshTimerRef.current) return;
          socketRefreshTimerRef.current = setTimeout(() => {
            socketRefreshTimerRef.current = null;
            lastSocketRefreshAtRef.current = Date.now();
            setAvailabilityRefreshTick((t) => t + 1);
          }, minGapMs - Math.max(0, since));
        });
      } catch (e) {
        console.warn("Socket.IO client failed to initialize for availability", e);
      }
    })();
    return () => {
      cancelled = true;
      if (socket) {
        socket.emit("leave-property-availability", { propertyId });
        socket.disconnect();
      }
    };
  }, [property?.id, selectedDates.checkIn, selectedDates.checkOut]);
  useEffect(() => {
    return () => {
      if (socketRefreshTimerRef.current) {
        clearTimeout(socketRefreshTimerRef.current);
        socketRefreshTimerRef.current = null;
      }
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
  // Load current user to check if they are the owner
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetchAccountSession();
        

        if (res.ok) {
          const user = res.data;
          if (mounted) {
            // Check if user is the owner of this property
            if (property?.ownerId && user?.id && Number(user.id) === Number(property.ownerId)) {
              setIsOwner(true);
            } else {
              setIsOwner(false);
            }
          }
        } else {
          if (mounted) setIsOwner(false);
        }
      } catch (e) {
        // Silently fail - user not logged in or error
        if (mounted) setIsOwner(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [property?.ownerId]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/properties/${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (res.status === 404) throw new Error("This property is not available.");
        if (!res.ok) throw new Error(`Failed to load property (${res.status})`);
        const json = await res.json();
        if (!mounted) return;
        setProperty(json?.property ?? null);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Failed to load property");
        setProperty(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [slug]);
  useEffect(() => {
    if (!property?.id) return;
    let mounted = true;
    const load = async () => {
      setReviewsLoading(true);
      setReviewsError(null);
      try {
        const res = await fetch(`/api/property-reviews/${property.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load reviews (${res.status})`);
        const json = (await res.json()) as ReviewsResponse;
        if (!mounted) return;
        setReviewsData(json);
      } catch (e: any) {
        if (!mounted) return;
        setReviewsError(e?.message || "Failed to load reviews");
        setReviewsData(null);
      } finally {
        if (mounted) setReviewsLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [property?.id]);
  // Check if property is saved
  useEffect(() => {
    if (!property?.id) return;
    let mounted = true;
    const checkSaved = async () => {
      try {
        const res = await fetch(`/api/customer/saved-properties?page=1&pageSize=100`, {
          credentials: "include",
        });
        if (res.ok) {
          const json = await res.json();
          if (!mounted) return;
          const isSaved = json?.items?.some((p: any) => p.id === property.id) || false;
          setIsFavorite(isSaved);
        }
      } catch (e) {
        // Silently fail - user might not be logged in
      }
    };
    void checkSaved();
    return () => {
      mounted = false;
    };
  }, [property?.id]);
  const location = useMemo(() => (property ? joinLocation(property) : ""), [property]);
  

  // Calculate final price with commission
  const finalBasePrice = useMemo(() => {
    if (!property?.basePrice) return null;
    const commission = getPropertyCommission(property, systemCommission);
    return calculatePriceWithCommission(property.basePrice, commission);
  }, [property, systemCommission]);
  

  const about = useMemo(() => {
    const fallback = "No description provided yet.";
    const raw = cleanPublicText(String(property?.description || ""));
    const text = raw ? raw : fallback;
    const limit = 260;
    const hasMore = raw.length > limit;
    const collapsed = hasMore ? raw.slice(0, limit).trimEnd() + "..." : text;
    return { raw, text, hasMore, collapsed };
  }, [property?.description]);
  const images = useMemo(() => {
    const rawImages = Array.isArray(property?.images) ? property.images : [];
    const seen = new Set<string>();
    return rawImages
      .map((src) => String(src || "").trim())
      .filter(Boolean)
      .filter((src) => !/^thumb\s*\d+$/i.test(src))
      .filter((src) => {
        const key = src.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [property?.images]);
  const hero = images[0] ?? null;
  const gallery = images.slice(0, 48);
  const hasMorePhotos = images.length > 3;
  const placeholderLightboxImages = useMemo(() => {
    const mk = (a: string, b: string) =>
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="${a}"/>
              <stop offset="1" stop-color="${b}"/>
            </linearGradient>
            <radialGradient id="r" cx="30%" cy="25%" r="80%">
              <stop offset="0" stop-color="#02665e" stop-opacity="0.16"/>
              <stop offset="1" stop-color="#000" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <rect width="1600" height="1000" fill="url(#g)"/>
          <rect width="1600" height="1000" fill="url(#r)"/>
        </svg>`
      )}`;
    return [
      mk("#f8fafc", "#e2e8f0"),
      mk("#eef2ff", "#e0f2fe"),
      mk("#ecfeff", "#e0f2f1"),
      mk("#f0fdf4", "#dcfce7"),
      mk("#fff7ed", "#ffedd5"),
      mk("#fdf2f8", "#fce7f3"),
      mk("#f1f5f9", "#e2e8f0"),
      mk("#eff6ff", "#dbeafe"),
    ];
  }, []);
  const lightboxImages = images.length ? images : placeholderLightboxImages;
  // Parse services - can be array of strings or object
  const servicesRaw = useMemo(() => property?.services ?? [], [property?.services]);
  const servicesArray = useMemo(
    () => (Array.isArray(servicesRaw) ? servicesRaw.map(String).map((s) => s.trim()).filter(Boolean) : []),
    [servicesRaw]
  );
  const servicesObj: any = useMemo(
    () => (typeof servicesRaw === 'object' && !Array.isArray(servicesRaw) && servicesRaw !== null ? servicesRaw : {}),
    [servicesRaw]
  );
  const verificationRecord = useMemo(() => {
    const fromProperty = property?.physicalVerification;
    if (fromProperty) return fromProperty;

    const raw = servicesObj?.verification || servicesObj?.physicalVerification;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        status: "PENDING" as const,
        verifiedAt: null,
        verifiedBy: null,
        verifiedByRole: null,
        method: "On-site property inspection",
        note: "NoLSAF verification details will be added after the inspection record is completed.",
        checklist: [
          "Location confirmation",
          "Room and amenity review",
          "Photo accuracy check",
          "Host details review",
        ],
        verificationUrl: null,
        qrCodeDataUrl: null,
      };
    }

    return {
      status: raw.status === "VERIFIED" ? "VERIFIED" as const : "PENDING" as const,
      verifiedAt: typeof raw.verifiedAt === "string" && raw.verifiedAt.trim() ? raw.verifiedAt.trim() : null,
      verifiedBy: typeof raw.verifiedBy === "string" && raw.verifiedBy.trim() ? raw.verifiedBy.trim() : null,
      verifiedByRole: typeof raw.verifiedByRole === "string" && raw.verifiedByRole.trim() ? raw.verifiedByRole.trim() : null,
      method: typeof raw.method === "string" && raw.method.trim() ? raw.method.trim() : "On-site property inspection",
      note: typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : null,
      checklist: Array.isArray(raw.checklist)
        ? raw.checklist.map((item: any) => String(item || "").trim()).filter(Boolean).slice(0, 8)
        : [
            "Location confirmation",
            "Room and amenity review",
            "Photo accuracy check",
            "Host details review",
          ],
      verificationUrl: typeof raw.verificationUrl === "string" && raw.verificationUrl.trim() ? raw.verificationUrl.trim() : null,
      qrCodeDataUrl: typeof raw.qrCodeDataUrl === "string" && raw.qrCodeDataUrl.trim() ? raw.qrCodeDataUrl.trim() : null,
    };
  }, [property?.physicalVerification, servicesObj]);
  

  // Extract nearby facilities from services object (owner fills this in)
  const nearbyFacilities = useMemo(() => {
    let facilities: any[] = [];
    try {
      // Try to find nearbyFacilities in services object
      if (servicesObj.nearbyFacilities && Array.isArray(servicesObj.nearbyFacilities)) {
        facilities = servicesObj.nearbyFacilities;
      }
      // Also check if it's stored as a JSON string in the services array
      const facilitiesStr = servicesArray.find((s: string) => s.includes('nearbyFacilities') || s.startsWith('['));
      if (facilitiesStr) {
        try {
          const parsed = JSON.parse(facilitiesStr);
          if (Array.isArray(parsed)) facilities = parsed;
        } catch {}
      }
    } catch {}
    return facilities;
  }, [servicesObj, servicesArray]);
  // Parse houseRules - can be a JSON string or object
  const houseRules = useMemo(() => {
    const parseHouseRulesValue = (v: any) => {
      if (!v) return null;
      if (typeof v === "string") {
        try {
          const parsed = JSON.parse(v);
          return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return v;
      return null;
    };
    const normalize = (hr: any) => {
      if (!hr || typeof hr !== "object") return null;
      // Already-normalized shape used by the owner submit payload:
      // { checkIn, checkOut, pets, petsNote, smoking, other, safetyMeasures? }
      const out: any = {};
      if (typeof hr.checkIn === "string" && hr.checkIn.trim()) out.checkIn = hr.checkIn.trim();
      if (typeof hr.checkOut === "string" && hr.checkOut.trim()) out.checkOut = hr.checkOut.trim();
      // Support legacy/un-normalized shape (from TotalsStep state)
      const fmtWindow = (from: string, to: string) => {
        const f = String(from || "").trim();
        const t = String(to || "").trim();
        if (f && t) return `${f} - ${t}`;
        if (f) return `From ${f}`;
        if (t) return `Until ${t}`;
        return "";
      };
      if (!out.checkIn) {
        const v = fmtWindow(hr.checkInFrom, hr.checkInTo);
        if (v) out.checkIn = v;
      }
      if (!out.checkOut) {
        const v = fmtWindow(hr.checkOutFrom, hr.checkOutTo);
        if (v) out.checkOut = v;
      }
      if (typeof hr.pets === "boolean") out.pets = hr.pets;
      if (typeof hr.petsAllowed === "boolean") out.pets = hr.petsAllowed;
      if (typeof hr.petsNote === "string" && hr.petsNote.trim()) out.petsNote = hr.petsNote.trim();
      // In the public UI, `houseRules.smoking === true` means "Smoking Not Allowed"
      if (typeof hr.smoking === "boolean") out.smoking = hr.smoking;
      if (typeof hr.smokingNotAllowed === "boolean") out.smoking = hr.smokingNotAllowed;
      if (Array.isArray(hr.safetyMeasures)) out.safetyMeasures = hr.safetyMeasures;
      if (typeof hr.other === "string" && hr.other.trim()) out.other = hr.other.trim();
      return Object.keys(out).length ? out : null;
    };
    // Prefer direct `property.houseRules` if it exists (future-proof), otherwise fallback to `services.houseRules`
    const direct = parseHouseRulesValue((property as any)?.houseRules);
    const viaServices = parseHouseRulesValue((servicesObj as any)?.houseRules);
    return normalize(direct) || normalize(viaServices) || null;
  }, [property, servicesObj]);
  // Default payment methods that should always be displayed
  const servicesByCategory = useMemo(() => {
    const DEFAULT_PAYMENT_METHODS = ["Mobile money", "Cash", "Card", "Bank transfer"];
    const paymentModes = servicesArray
      .filter((s) => /^payment:\s*/i.test(s))
      .map((s) => s.replace(/^payment:\s*/i, "").trim())
      .filter(Boolean);
    

    // If no payment modes are provided by owner, use defaults
    const finalPaymentModes = paymentModes.length > 0 ? paymentModes : DEFAULT_PAYMENT_METHODS;
    

    const freeCancellation = servicesArray.some((s) => s.toLowerCase() === "free cancellation");
    const groupStay = servicesArray.some((s) => s.toLowerCase() === "group stay");
    const nearby = servicesArray.filter((s) => /^near\s+/i.test(s));
    const { amenities, included, available } = normalizeOwnerDeclaredServices(servicesObj, servicesArray);
    return { paymentModes: finalPaymentModes, freeCancellation, groupStay, nearby, amenities, included, available };
  }, [servicesArray, servicesObj]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [allPhotosOpen, setAllPhotosOpen] = useState(false);
  const [allPhotosShown, setAllPhotosShown] = useState(false);
  const [photoPortalReady, setPhotoPortalReady] = useState(false);

  useEffect(() => {
    setPhotoPortalReady(true);
  }, []);
  const openLightbox = (idx: number) => {
    setActiveIdx(Math.max(0, Math.min(idx, lightboxImages.length - 1)));
    setLightboxOpen(true);
  };
  const closeLightbox = () => setLightboxOpen(false);
  const openAllPhotos = () => {
    setAllPhotosOpen(true);
    requestAnimationFrame(() => setAllPhotosShown(true));
  };
  const closeAllPhotos = () => {
    setAllPhotosShown(false);
    window.setTimeout(() => setAllPhotosOpen(false), 180);
  };
  useEffect(() => {
    if (!allPhotosOpen && !lightboxOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightboxOpen) setLightboxOpen(false);
        if (allPhotosOpen) closeAllPhotos();
      }
      if (lightboxOpen && lightboxImages.length > 1) {
        if (e.key === "ArrowRight") setActiveIdx((i) => (i >= lightboxImages.length - 1 ? 0 : i + 1));
        if (e.key === "ArrowLeft") setActiveIdx((i) => (i <= 0 ? lightboxImages.length - 1 : i - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [allPhotosOpen, lightboxOpen, lightboxImages.length]);
  // Keep the active thumbnail centred in the filmstrip
  useEffect(() => {
    if (!lightboxOpen) return;
    document.getElementById(`lb-thumb-${activeIdx}`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeIdx, lightboxOpen]);
  useEffect(() => {
    if (!roomAmenityHint) return;
    const t = window.setTimeout(() => setRoomAmenityHint(null), 1200);
    return () => window.clearTimeout(t);
  }, [roomAmenityHint]);
  // Photo tour sections: room photos are matched to their room type through the
  // owner's room groups; everything else belongs to the property itself.
  const photoSections = useMemo(() => {
    const indexOf = new Map<string, number>();
    lightboxImages.forEach((u, i) => {
      if (!indexOf.has(u)) indexOf.set(u, i);
    });
    const claimed = new Set<number>();
    const rooms = new Map<string, number[]>();
    const spec: any[] = Array.isArray((property as any)?.roomsSpec) ? (property as any).roomsSpec : [];
    for (const r of spec) {
      const imgs: unknown[] = Array.isArray(r?.roomImages) ? r.roomImages : [];
      const label = `${String(r?.roomType || r?.name || "Room").trim() || "Room"} room`;
      for (const u of imgs) {
        const i = indexOf.get(String(u || ""));
        if (i === undefined || claimed.has(i)) continue;
        claimed.add(i);
        rooms.set(label, [...(rooms.get(label) || []), i]);
      }
    }
    const propertyIdx = lightboxImages.map((_, i) => i).filter((i) => !claimed.has(i));
    return [
      { key: "property", label: "The property", idxs: propertyIdx },
      ...Array.from(rooms, ([label, idxs], n) => ({ key: `room-${n}`, label, idxs })),
    ].filter((sec) => sec.idxs.length > 0);
  }, [lightboxImages, property]);
  const scrollToPhotoSection = (key: string) => {
    setActiveTourKey(key);
    document.getElementById(`photo-tour-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [activeTourKey, setActiveTourKey] = useState<string>("property");
  // Highlight the section being viewed in the index as the tour scrolls
  useEffect(() => {
    if (!allPhotosOpen) return;
    const root = document.getElementById("photo-tour-scroll");
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.getAttribute("data-tour-key");
        if (id) setActiveTourKey(id);
      },
      { root, rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    root.querySelectorAll("[data-tour-key]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [allPhotosOpen, photoSections]);

  const openFromGrid = (idx: number) => {
    // Close grid first, then open lightbox to keep UX clean.
    setAllPhotosShown(false);
    setAllPhotosOpen(false);
    setActiveIdx(Math.max(0, Math.min(idx, lightboxImages.length - 1)));
    requestAnimationFrame(() => setLightboxOpen(true));
  };
  if (loading) {
    // The page's own shape, in still blocks, so the content fills in without jumping
    const Bone = ({ className = "" }: { className?: string }) => <span aria-hidden className={`block rounded-md bg-slate-100 ${className}`} />;
    return (
      <main className="min-h-screen bg-white text-slate-900 header-offset" aria-busy="true">
        <span role="status" className="sr-only">Loading property</span>
        <div className="public-container py-8">
          {/* Header card */}
          <div className="rounded-2xl border border-solid border-slate-100 bg-white px-5 pb-6 pt-5 shadow-[0_4px_24px_rgba(2,102,94,0.08)] sm:rounded-3xl sm:px-8 sm:pb-7 sm:pt-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <Bone className="h-7 w-20 rounded-full" />
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-flex items-center gap-2 rounded-full bg-[#02665e]/[0.06] px-3 py-1.5 text-[11.5px] font-semibold text-[#02665e]">
                  <span className="pv-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Loading property
                </span>
                <Bone className="h-9 w-9 rounded-full" />
                <Bone className="h-9 w-9 rounded-full" />
              </div>
            </div>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 flex-1">
                <Bone className="h-3 w-20" />
                <Bone className="mt-4 h-9 w-3/4 max-w-[420px] rounded-lg" />
                <div className="mt-4 flex items-center gap-3">
                  <Bone className="h-4 w-48" />
                  <Bone className="h-4 w-28" />
                </div>
              </div>
              <div className="flex w-full max-w-[420px] items-center gap-3 rounded-2xl border border-solid border-slate-100 p-3.5 lg:w-[420px]">
                <Bone className="h-11 w-11 flex-shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <Bone className="h-4 w-36" />
                  <Bone className="mt-2 h-3 w-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Gallery */}
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="pv-skeleton relative flex aspect-[16/10] items-center justify-center rounded-2xl md:col-span-2 md:aspect-auto md:min-h-[420px]">
              <span className="pv-spinner" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
              <div className="pv-skeleton aspect-[16/10] rounded-xl" />
              <div className="pv-skeleton aspect-[16/10] rounded-xl" />
            </div>
          </div>

          {/* Content and booking */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-[#02665e]/15 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5 bg-[#02665e]/[0.07] px-4 py-3">
                    <Bone className="h-8 w-8 rounded-full bg-[#02665e]/15" />
                    <div className="flex-1">
                      <Bone className="h-4 w-10 bg-[#02665e]/15" />
                      <Bone className="mt-1.5 h-3 w-16 bg-[#02665e]/10" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <Bone className="h-10 w-10 rounded-xl" />
                  <div>
                    <Bone className="h-3 w-24" />
                    <Bone className="mt-2 h-5 w-40" />
                  </div>
                </div>
                <div className="mt-5 space-y-2.5">
                  <Bone className="h-3.5 w-full" />
                  <Bone className="h-3.5 w-[96%]" />
                  <Bone className="h-3.5 w-[90%]" />
                  <Bone className="h-3.5 w-[70%]" />
                </div>
              </div>

              <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <Bone className="h-9 w-9 rounded-xl" />
                  <Bone className="h-5 w-20" />
                </div>
                <div className="mt-5 space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="flex flex-col gap-4 rounded-2xl border border-solid border-slate-100 p-4 md:flex-row md:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <Bone className="h-8 w-8 rounded-full" />
                          <Bone className="h-5 w-32" />
                        </div>
                        <Bone className="mt-4 h-11 w-full rounded-xl" />
                        <Bone className="mt-3 h-3.5 w-[85%]" />
                      </div>
                      <div className="flex items-center justify-between gap-3 md:w-48 md:flex-col md:items-stretch">
                        <Bone className="h-6 w-28" />
                        <Bone className="h-11 w-28 rounded-xl md:w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Booking card */}
            <aside className="hidden lg:block">
              <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 shadow-sm">
                <Bone className="h-3 w-12" />
                <Bone className="mt-2 h-8 w-40 rounded-lg" />
                <Bone className="mt-1.5 h-3 w-20" />
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <Bone className="h-12 rounded-xl" />
                  <Bone className="h-12 rounded-xl" />
                </div>
                <Bone className="mt-2 h-12 rounded-xl" />
                <Bone className="mt-4 h-12 rounded-xl bg-[#02665e]/15" />
                <Bone className="mx-auto mt-3 h-3 w-32" />
              </div>
            </aside>
          </div>
        </div>
      </main>
    );
  }
  if (error || !property) {
    return (
      <main className="min-h-screen bg-white text-slate-900 header-offset">
        <div className="public-container py-10">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="mt-6 rounded-2xl border border-solid border-rose-200 bg-rose-50 p-6">
            <div className="font-semibold text-rose-900">Property not available</div>
            <div className="text-sm text-rose-800 mt-1">{error || "This property could not be loaded."}</div>
            <div className="mt-4">
              <Link href="/public/properties" className="text-sm font-semibold text-[#02665e] no-underline hover:underline">
                Browse properties
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-white text-slate-900 header-offset">
      <div className="public-container py-8">
        {/* Property header card */}
        <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white border border-solid border-slate-100 shadow-[0_4px_24px_rgba(2,102,94,0.10)]">
          <div className="relative px-5 sm:px-8 pt-5 sm:pt-6 pb-6 sm:pb-7">
            {/* Subtle radial tint */}
            <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 60% at 100% 0%,rgba(2,180,245,0.05),transparent 65%)' }} aria-hidden />
            <div className="relative z-10">
              {/* Top row: Back pill + action buttons */}
              <div className="flex items-center justify-between gap-3 mb-5">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20"
                  style={{ color: '#02665e', background: 'rgba(2,102,94,0.07)', border: '1px solid rgba(2,102,94,0.15)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(2,102,94,0.13)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(2,102,94,0.07)')}
                  aria-label="Back"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back
                </button>
                {/* Favorite + Share */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!property?.id || favoriteLoading) return;
                      setFavoriteLoading(true);
                      try {
                        if (isFavorite) {
                          const res = await fetch(`/api/customer/saved-properties/${property.id}`, {
                            method: "DELETE",
                            credentials: "include",
                          });
                          if (res.ok) {
                            setIsFavorite(false);
                          } else {
                            const json = await res.json().catch(() => ({}));
                            if (json.error?.includes("not found")) {
                              setIsFavorite(false);
                            } else {
                              setFavoriteNotice(json.error || "Failed to remove from saved list. Please try again.");
                            }
                          }
                        } else {
                          const propertyId = Number(property.id);
                          if (!propertyId || isNaN(propertyId)) {
                            setFavoriteNotice("Invalid property ID");
                            setFavoriteLoading(false);
                            return;
                          }
                          const res = await fetch(`/api/customer/saved-properties`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ propertyId }),
                          });
                          const json = await res.json().catch(() => ({}));
                          if (res.ok) {
                            setIsFavorite(true);
                          } else if (res.status === 401 || res.status === 403) {
                            setShowSaveLoginPrompt(true);
                            

                          } else {
                            const errorMsg = json.error || json.message || "Failed to save property. Please try again.";
                            const normalizedError = String(errorMsg || "").toLowerCase(); if (normalizedError.includes("log in") || normalizedError.includes("login") || normalizedError.includes("unauthorized") || normalizedError.includes("forbidden") || normalizedError.includes("not authenticated")) { setShowSaveLoginPrompt(true); } else { setFavoriteNotice(errorMsg); }
                          }
                        }
                      } catch (e: any) {
                        setFavoriteNotice("Network error. Please check your connection and try again.");
                      } finally {
                        setFavoriteLoading(false);
                      }
                    }}
                    disabled={favoriteLoading}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200 hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: isFavorite ? 'rgba(244,63,94,0.10)' : 'rgba(2,102,94,0.07)',
                      border: isFavorite ? '1px solid rgba(244,63,94,0.25)' : '1px solid rgba(2,102,94,0.15)',
                      color: isFavorite ? '#e11d48' : '#64748b',
                    }}
                    aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                  >
                    {favoriteLoading ? (
                      <LogoSpinner size="sm" ariaLabel="Saving" />
                    ) : (
                      <Heart className={`w-4 h-4 transition-all duration-300 ${isFavorite ? "fill-current scale-110" : "scale-100"}`} />
                    )}
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowShareMenu(!showShareMenu)}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200 hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20"
                      style={{
                        background: showShareMenu ? 'rgba(2,102,94,0.12)' : 'rgba(2,102,94,0.07)',
                        border: '1px solid rgba(2,102,94,0.15)',
                        color: '#02665e',
                      }}
                      aria-label="Share property"
                    >
                      <Share2 className={`w-4 h-4 transition-transform duration-300 ${showShareMenu ? "rotate-12" : ""}`} />
                    </button>
                    {showShareMenu && (
                      <>
                        <div
                          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity duration-200"
                          onClick={() => setShowShareMenu(false)}
                        />
                        <div
                          className="absolute right-0 top-full mt-2 w-56 max-w-none rounded-2xl border border-solid border-slate-200/60 bg-white/95 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 z-50 overflow-hidden transform transition-all duration-200 origin-top-right"
                          style={{ maxWidth: "none" }}
                        >
                          <div className="p-3 grid gap-2">
                          {/* Every entry mints a tracked link first, so the token
                              is in the URL the recipient actually receives. The
                              social links open after the link is ready, which is
                              why they are buttons rather than plain anchors. */}
                          <button
                            type="button"
                            onClick={async () => {
                              setShowShareMenu(false);
                              const url = property?.id
                                ? await createShareLink(property.id, "COPY_LINK", window.location.href)
                                : window.location.href;
                              navigator.clipboard.writeText(url).then(() => {
                                setCopyLinkSuccess(true);
                                setTimeout(() => setCopyLinkSuccess(false), 2000);
                              });
                            }}
                            className="group w-full flex items-center gap-3 rounded-xl border border-solid border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm font-medium text-slate-800 transition-colors duration-200 hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
                          >
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-black/5">
                              <Copy className={`w-4 h-4 flex-shrink-0 transition-colors duration-200 ${copyLinkSuccess ? "text-[#02665e]" : "text-slate-600"}`} />
                            </span>
                            <span className={copyLinkSuccess ? "font-semibold text-[#02665e]" : ""}>{copyLinkSuccess ? "Link copied!" : "Copy link"}</span>
                          </button>
                          {([
                            {
                              key: "EMAIL" as const,
                              label: "Email",
                              icon: Mail,
                              className: "border-amber-200/60 bg-amber-50/70 text-amber-900 hover:bg-amber-100/70",
                              iconClass: "text-amber-700",
                              ringClass: "ring-amber-900/10",
                              build: (url: string) => `mailto:?subject=${encodeURIComponent(property.title)}&body=${encodeURIComponent(url)}`,
                              newTab: false,
                            },
                            {
                              key: "FACEBOOK" as const,
                              label: "Facebook",
                              icon: Facebook,
                              className: "border-blue-200/60 bg-blue-50/70 text-blue-900 hover:bg-blue-100/70",
                              iconClass: "text-blue-700",
                              ringClass: "ring-blue-900/10",
                              build: (url: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
                              newTab: true,
                            },
                            {
                              key: "WHATSAPP" as const,
                              label: "WhatsApp",
                              icon: MessageSquare,
                              className: "border-emerald-200/60 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-100/70",
                              iconClass: "text-emerald-700",
                              ringClass: "ring-emerald-900/10",
                              build: (url: string) => `https://wa.me/?text=${encodeURIComponent(`${property.title} - ${url}`)}`,
                              newTab: true,
                            },
                            {
                              key: "TWITTER" as const,
                              label: "Twitter",
                              icon: Twitter,
                              className: "border-sky-200/60 bg-sky-50/70 text-sky-900 hover:bg-sky-100/70",
                              iconClass: "text-sky-700",
                              ringClass: "ring-sky-900/10",
                              build: (url: string) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(property.title)}`,
                              newTab: true,
                            },
                          ]).map((target) => {
                            const TargetIcon = target.icon;
                            return (
                              <button
                                key={target.key}
                                type="button"
                                onClick={async () => {
                                  setShowShareMenu(false);
                                  const url = property?.id
                                    ? await createShareLink(property.id, target.key, window.location.href)
                                    : window.location.href;
                                  const destination = target.build(url);
                                  if (target.newTab) {
                                    window.open(destination, "_blank", "noopener,noreferrer");
                                  } else {
                                    window.location.href = destination;
                                  }
                                }}
                                className={`group w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 ${target.className}`}
                              >
                                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ${target.ringClass}`}>
                                  <TargetIcon className={`w-4 h-4 flex-shrink-0 transition-colors duration-200 ${target.iconClass}`} />
                                </span>
                                <span>{target.label}</span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {/* Title + location */}
              <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
                <div className="min-w-0">
                  <p className="text-[10px] sm:text-xs font-bold tracking-[0.20em] uppercase mb-2" style={{ color: '#02665e' }}>
                    Property
                  </p>
                  <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight leading-[1.1] text-slate-900 break-words">
                    {property.title}
                  </h1>
                  {(() => {
                    const avg = Number(reviewsData?.stats?.averageRating ?? 0);
                    const count = Number(reviewsData?.stats?.totalReviews ?? 0);
                    return (
                      <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                        {location && (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                            <span className="font-medium text-slate-500 truncate">{location}</span>
                          </span>
                        )}
                        {location && <span aria-hidden className="h-3.5 w-px bg-slate-200" />}
                        {count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                            <span className="font-semibold tabular-nums text-slate-900">{avg.toFixed(1)}</span>
                            <span>({count} review{count === 1 ? "" : "s"})</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-[#02665e]">
                            <Star className="h-3.5 w-3.5" aria-hidden /> New on NoLSAF
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Verification seal: fills the right side and replaces the old full-width strip */}
                <div className="relative box-border flex w-full flex-none items-center gap-3.5 overflow-hidden rounded-xl border border-solid border-[#02665e]/15 bg-white px-4 py-3 shadow-[0_10px_28px_-18px_rgba(2,40,36,0.45)] sm:w-auto lg:min-w-[340px]">
                  <span className="relative flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[#02665e]/[0.08] ring-1 ring-inset ring-[#02665e]/15">
                    <ShieldCheck className="h-5 w-5 text-[#02665e]" aria-hidden />
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} aria-hidden />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex items-center justify-between gap-3 text-[13.5px] font-bold leading-tight text-slate-900">
                      Verified by NoLSAF
                      <Link href="/verification-policy" className="text-[11.5px] font-semibold text-[#02665e] no-underline hover:underline">
                        How we verify
                      </Link>
                    </p>
                    <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[11.5px] text-slate-600">
                      {["Site visited", "Location checked", "Documents reviewed"].map((item) => (
                        <li key={item} className="inline-flex items-center gap-1 whitespace-nowrap">
                          <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} aria-hidden />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Gallery */}
        <div className="mt-6">
          {hero ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl overflow-hidden border border-solid border-slate-200">
              <button
                type="button"
                className={[
                  "relative md:col-span-2 aspect-[16/10] bg-slate-100 cursor-pointer rounded-2xl overflow-hidden",
                  "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
                  "motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                ].join(" ")}
                onClick={() => openLightbox(0)}
                aria-label="Open photo gallery"
              >
                <PropertyGalleryImage src={gallery[0]} alt={`${property.title} photo 1`} sizes="(min-width: 768px) 66vw, 100vw" priority />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0" />
              </button>
              <div className="grid grid-cols-2 md:grid-cols-1 gap-3 bg-white p-3">
                {gallery[1] ? (
                  <button
                    type="button"
                    className={[
                      "relative aspect-[16/10] bg-slate-100 rounded-xl overflow-hidden cursor-pointer",
                      "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
                      "motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                    ].join(" ")}
                    onClick={() => openLightbox(1)}
                    aria-label="Open photo 2"
                  >
                    <PropertyGalleryImage src={gallery[1]} alt={`${property.title} photo 2`} sizes="(min-width: 768px) 22vw, 50vw" />
                  </button>
                ) : (
                  <div className="relative aspect-[16/10] bg-slate-100 rounded-xl overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(2,102,94,0.10),transparent_55%),linear-gradient(135deg,#f8fafc,#e2e8f0)]" />
                    <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-slate-400" aria-hidden />
                    </div>
                  </div>
                )}
                {gallery[2] ? (
                  <button
                    type="button"
                    className={[
                      "relative aspect-[16/10] bg-slate-100 rounded-xl overflow-hidden cursor-pointer",
                      "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
                      "motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                    ].join(" ")}
                    onClick={() => (hasMorePhotos ? openAllPhotos() : openLightbox(2))}
                    aria-label={hasMorePhotos ? "View all photos" : "Open photo 3"}
                  >
                    <PropertyGalleryImage src={gallery[2]} alt={`${property.title} photo 3`} sizes="(min-width: 768px) 22vw, 50vw" />
                    {hasMorePhotos ? (
                      <div className="absolute right-3 bottom-3">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-1.5 shadow-sm ring-1 ring-white/10">
                          <Eye className="w-3.5 h-3.5 flex-shrink-0 text-white/90" aria-hidden />
                          <span className="text-[11px] font-semibold text-white leading-none tabular-nums">{images.length}</span>
                        </div>
                      </div>
                    ) : null}
                  </button>
                ) : (
                  <div className="relative aspect-[16/10] bg-slate-100 rounded-xl overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(2,102,94,0.10),transparent_55%),linear-gradient(135deg,#f8fafc,#e2e8f0)]" />
                    <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-slate-400" aria-hidden />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              {/* Photo layout preview (until Cloudinary / approved photos are available) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl overflow-hidden border border-solid border-slate-200">
                <button
                  type="button"
                  onClick={() => openAllPhotos()}
                  className={[
                    "relative md:col-span-2 aspect-[16/10] bg-slate-100 rounded-2xl overflow-hidden cursor-pointer",
                    "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
                    "motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                  ].join(" ")}
                  aria-label="View all photos"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(2,102,94,0.14),transparent_55%),radial-gradient(circle_at_75%_85%,rgba(2,132,199,0.10),transparent_55%),linear-gradient(135deg,#f8fafc,#e2e8f0)]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-black/0 to-white/35" />
                  <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700">
                    <div className="h-14 w-14 rounded-2xl bg-white/85 border border-solid border-slate-200 shadow-sm flex items-center justify-center">
                      <ImageIcon className="w-7 h-7 text-slate-500" aria-hidden />
                    </div>
                    <div className="mt-3 text-sm font-semibold">Photo preview</div>
                    <div className="text-xs text-slate-500">Hero image will appear here</div>
                  </div>
                </button>
                <div className="grid grid-cols-2 md:grid-cols-1 gap-3 bg-white p-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => openAllPhotos()}
                      className={[
                        "relative aspect-[16/10] bg-slate-100 rounded-xl overflow-hidden cursor-pointer",
                        "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
                        "motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                      ].join(" ")}
                      aria-label="View all photos"
                    >
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(2,102,94,0.10),transparent_55%),linear-gradient(135deg,#f8fafc,#e2e8f0)]" />
                      <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <ImageIcon className="w-6 h-6 text-slate-400" aria-hidden />
                      </div>
                                            {i === 1 ? (
                        <div className="absolute right-3 bottom-3">
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-1.5 shadow-sm ring-1 ring-white/10">
                            <Eye className="w-3.5 h-3.5 flex-shrink-0 text-white/90" aria-hidden />
                            <span className="text-[11px] font-semibold text-white leading-none tabular-nums">0</span>
                          </div>
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main */}
          <div className="lg:col-span-2 space-y-6">
            {/* Facts: the original teal bar, refined */}
            <div className="relative grid grid-cols-2 overflow-hidden rounded-xl bg-[#02665e] shadow-sm sm:grid-cols-4">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{ backgroundImage: "repeating-linear-gradient(135deg,rgba(255,255,255,0.08) 0px,rgba(255,255,255,0.08) 1.5px,transparent 1.5px,transparent 10px)" }}
              />
              {[
                { Icon: Users, value: property.maxGuests ?? "-", label: "Guests" },
                { Icon: BedDouble, value: property.totalBedrooms ?? "-", label: "Bedrooms" },
                { Icon: Bath, value: property.totalBathrooms ?? "-", label: "Bathrooms" },
                { Icon: ShieldCheck, value: "Verified", label: "by NoLSAF", verified: true },
              ].map(({ Icon, value, label, verified }, i) => (
                <div
                  key={label}
                  className={[
                    "relative flex min-w-0 items-center gap-2.5 px-4 py-3",
                    verified ? "bg-white/10" : "",
                    i % 2 === 1 ? "border-0 border-l border-solid border-white/10" : "",
                    i >= 2 ? "border-0 border-t border-solid border-white/10 sm:border-t-0" : "",
                    i === 2 ? "sm:border-l" : "",
                  ].join(" ")}
                >
                  <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/15 text-white">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 leading-none">
                    <div className="truncate text-base font-bold tabular-nums text-white">{value}</div>
                    <div className="mt-1 truncate text-[11.5px] text-white/75">{label}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* Description */}
            <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#02665e] shadow-sm ring-1 ring-[#02665e]/10">
                        <FileText className="w-5 h-5" aria-hidden />
                      </span>
                      <div>
                        <div className="text-xs font-bold tracking-[0.08em] text-[#02665e]">Host overview</div>
                        <h2 className="mt-1 text-lg font-semibold text-slate-950">About this place</h2>
                      </div>
                    </div>
                  </div>
                  {about.hasMore ? (
                    <button
                      type="button"
                      onClick={() => setAboutExpanded((v) => !v)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                      aria-label={aboutExpanded ? "Show less" : "Read more"}
                    >
                      {aboutExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="p-5 sm:p-6">
                <div className="relative rounded-xl border border-solid border-slate-100 bg-white px-4 py-4">
                  <p className="text-[15px] leading-7 text-slate-700 whitespace-pre-wrap">
                    {aboutExpanded ? about.text : about.collapsed}
                  </p>
                  {!aboutExpanded && about.hasMore ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-xl bg-gradient-to-t from-white to-white/0" />
                  ) : null}
                </div>
              </div>
            </div>
            {/* Physical Verification - Our Competitive Advantage */}
            <div className="overflow-hidden rounded-2xl border border-solid border-[#02665e]/15 bg-white shadow-sm">
              <div className="relative bg-[#02665e]/5 px-5 py-5 sm:px-6">
                <div className="flex justify-center">
                  <div className="flex min-w-0 max-w-2xl flex-col items-center gap-3 text-center">
                    <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white text-[#02665e] shadow-sm ring-1 ring-[#02665e]/10">
                      <ShieldCheck className="w-5 h-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold tracking-[0.08em] text-[#02665e]">NoLSAF trust check</div>
                      <h2 className="mt-1 text-lg sm:text-xl font-semibold text-slate-950">Physical verification</h2>
                      <div className="mt-3 flex w-full flex-nowrap items-center justify-center gap-1 text-[11px] font-semibold text-slate-700 sm:gap-2 sm:text-xs">
                        {[
                          { label: "Reviewed", Icon: FileText },
                          { label: "Verified", Icon: ShieldCheck },
                          { label: "Approved", Icon: BadgeCheck },
                        ].map(({ label, Icon }, idx) => (
                          <div key={label} className="flex min-w-0 flex-shrink items-center gap-1 sm:gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[#02665e] ring-1 ring-[#02665e]/15 sm:gap-1.5 sm:px-2.5">
                              <Icon className="h-3.5 w-3.5" aria-hidden />
                              {label}
                            </span>
                            {idx < 2 ? <span className="h-px w-3 bg-[#02665e]/30 sm:w-6" aria-hidden /> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="absolute right-5 top-5 flex shrink-0 items-center gap-2 sm:right-6">
                    <button
                      type="button"
                      onClick={() => setVerificationDetailsOpen((open) => !open)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-solid border-[#02665e]/20 bg-white text-[#02665e] shadow-sm hover:bg-[#02665e]/5"
                      aria-label={verificationDetailsOpen ? "Hide verification details" : "Show verification details"}
                      aria-expanded={verificationDetailsOpen}
                      aria-controls="property-verification-details"
                    >
                      {verificationDetailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-5 sm:p-6">
                {verificationRecord.verificationUrl ? (
                  <a
                    href={verificationRecord.verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 rounded-2xl border border-solid border-[#02665e]/20 bg-[#02665e]/5 px-4 py-4 text-slate-950 no-underline transition hover:border-[#02665e]/30 hover:bg-[#02665e]/10"
                  >
                    <span className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-solid border-[#02665e]/20 bg-white text-[#02665e]">
                      <QrCode className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">View verification certificate</span>
                      <span className="mt-1 block text-sm leading-5 text-slate-600">Scan or open the public NoLSAF certificate.</span>
                    </span>
                    <ExternalLinkIcon className="h-5 w-5 flex-shrink-0 text-[#02665e]" aria-hidden />
                  </a>
                ) : null}

                {verificationDetailsOpen ? (
                  <div id="property-verification-details" className="mt-5">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">What NoLSAF checked</div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {verificationRecord.checklist.map((item: string) => (
                          <div key={item} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {property?.verificationVideoUrl ? (
                  <a
                    href={property.verificationVideoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex items-center gap-2 rounded-xl border border-solid border-[#02665e]/20 bg-white px-4 py-2 text-sm font-semibold text-[#02665e] no-underline hover:bg-[#02665e]/5"
                  >
                    <PlayCircle className="h-4 w-4" />
                    View verification media
                    <ExternalLinkIcon className="h-3.5 w-3.5" />
                  </a>
                ) : null}

                {verificationDetailsOpen ? (
                  <div className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span>Verification details are maintained by NoLSAF and refreshed when a property is inspected again.</span>
                  </div>
                ) : null}
              </div>
            </div>
            {/* What's included and the live menu: moved out of the booking card so it stays focused */}
            {(servicesByCategory.included.length > 0 || servicesByCategory.available.length > 0 || property.nrmsMenuUrl) ? (
              <div className="rounded-2xl border border-solid border-slate-200 bg-white p-4 sm:p-5">
              {servicesByCategory.included.length > 0 || servicesByCategory.available.length > 0 ? (
                <div className="rounded-xl bg-slate-50/80 p-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white text-[#02665e] shadow-sm ring-1 ring-[#02665e]/10">
                        <BadgeCheck className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-950">What's included</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">Covered by the listed price.</p>
                      </div>
                    </div>
                    {servicesByCategory.available.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setPriceServicesOpen(true)}
                        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#02665e] shadow-sm ring-1 ring-slate-200 hover:bg-[#02665e]/5"
                        aria-label="View services"
                        aria-expanded={priceServicesOpen}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>

                  {servicesByCategory.included.length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {servicesByCategory.included.slice(0, 3).map((item: string) => {
                        const meta = amenityMeta(item);
                        return (
                          <div key={item} className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-2.5 py-2 shadow-sm ring-1 ring-emerald-100">
                            <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-800">
                              <meta.Icon className={`h-4 w-4 flex-shrink-0 ${meta.colorClass}`} aria-hidden />
                              <span className="truncate">{item}</span>
                            </span>
                          </div>
                        );
                      })}
                      {servicesByCategory.included.length > 3 ? (
                        <button
                          type="button"
                          onClick={() => setPriceServicesOpen(true)}
                          className="flex min-h-10 items-center justify-center rounded-xl bg-white px-2.5 py-2 text-xs font-bold text-[#02665e] shadow-sm ring-1 ring-[#02665e]/15 hover:bg-[#02665e]/5"
                        >
                          +{servicesByCategory.included.length - 3} more
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-500 shadow-sm ring-1 ring-slate-100">
                      No included services were declared separately from the room price.
                    </p>
                  )}
                </div>
              ) : null}

              {property.nrmsMenuUrl ? (
                <Link
                  href={property.nrmsMenuUrl}
                  className="group mt-3 flex items-center gap-3 rounded-2xl p-3.5 no-underline shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  style={{ border: "1.5px solid rgba(2, 102, 94, 0.45)", background: "linear-gradient(135deg, rgba(2,102,94,0.07), rgba(2,102,94,0.02))" }}
                >
                  <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-white shadow-sm">
                    <UtensilsCrossed className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14.5px] font-bold text-slate-950">View live restaurant and bar menu</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#02665e] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-white">
                        <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
                        Live
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">See today&apos;s dishes, drinks and prices.</span>
                  </span>
                  <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-solid border-[#02665e]/30 bg-white text-[#02665e] transition-all group-hover:border-[#02665e] group-hover:bg-[#02665e] group-hover:text-white">
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              ) : null}
              </div>
            ) : null}
            {/* Payment Methods (mobile/tablet only; on large screens it sits in the right column) */}
            <div className="lg:hidden rounded-2xl border border-solid border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                  <CreditCard className="w-6 h-6" aria-hidden />
                </span>
                <h2 className="text-2xl font-semibold text-slate-900">Payment Methods</h2>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {servicesByCategory.paymentModes.slice(0, 6).map((m) => (
                  <PaymentModePill key={m} mode={m} />
                ))}
                {servicesByCategory.freeCancellation ? (
                  <PolicyCard tone="success" icon={<BadgeCheck className="w-4 h-4" aria-hidden />} label="Free cancellation" />
                ) : null}
                {servicesByCategory.groupStay ? (
                  <PolicyCard tone="neutral" icon={<UsersRound className="w-4 h-4" aria-hidden />} label="Group stay" />
                ) : null}
              </div>
            </div>
          </div>
          {/* Side / CTA */}
          <aside className="lg:sticky lg:top-24 h-fit space-y-6">
            {/* Booking card: price, dates, live availability and the next step, in reading order */}
            {(() => {
              const { checkIn: ci, checkOut: co } = selectedDates;
              const hasDates = Boolean(ci && co);
              const nights = hasDates
                ? Math.max(0, Math.round((parseBookingDateOnly(co).getTime() - parseBookingDateOnly(ci).getTime()) / 86_400_000))
                : 0;
              const soldOut = hasDates && availabilityData && availabilityData.available === false;
              const checkingAvailability = hasDates && availabilityData == null;
              const hasRoomSelection = Boolean(selectedRoomCode);
              const canRequestBooking = hasDates && availabilityData?.available === true && hasRoomSelection;
              const bookingActionLabel = !hasDates ? "Check availability" : checkingAvailability ? "Checking availability" : soldOut ? "Not available" : !hasRoomSelection ? "Select room type" : "Request booking";
              return (
                <div id="booking-card" className="box-border scroll-mt-24 rounded-2xl border border-solid border-slate-200 bg-white p-5 shadow-[0_18px_40px_-24px_rgba(2,40,36,0.35)]">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[13px] text-slate-500">From</span>
                    <span className="text-[24px] font-bold leading-none tracking-tight text-slate-900">
                      <PriceDisplay amountTzs={finalBasePrice} noteClassName="text-xs font-normal text-slate-500 mt-0.5" />
                    </span>
                    <span className="text-[13px] text-slate-500">/ night</span>
                  </div>

                  <div className="mt-4">
                    <PropertyAvailabilityChecker
                      compact
                      propertyId={property.id}
                      onAvailability={handleBookingAvailability}
                      onDatesChange={handleBookingDatesChange}
                      refreshSignal={availabilityRefreshTick}
                      dates={selectedDates}
                      openPickerSignal={datePickerSignal}
                      selectedRoomCode={selectedRoomCode}
                      onRoomTypeSelect={setSelectedRoomCode}
                    />
                  </div>

                  <button
                    type="button"
                    disabled={hasDates && !canRequestBooking}
                    onClick={() => {
                      if (!hasDates) {
                        setDatePickerSignal((n) => n + 1);
                        return;
                      }
                      if (!canRequestBooking || !selectedRoomCode) return;
                      const params = new URLSearchParams({ property: property.slug, checkIn: ci, checkOut: co, roomCode: selectedRoomCode });
                      router.push(`/public/booking/confirm?${params.toString()}`);
                    }}
                    className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-[#014e47] active:bg-[#013a35] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {bookingActionLabel}
                    {(!hasDates || canRequestBooking) && <ChevronRight className="h-4 w-4" aria-hidden />}
                  </button>

                  {hasDates && nights > 0 && finalBasePrice != null && (
                    <div className="mt-4 space-y-1.5 border-0 border-t border-solid border-slate-100 pt-3 text-[13px]">
                      <div className="flex items-center justify-between gap-3 text-slate-600">
                        <span className="inline-flex items-baseline gap-1">
                          <PriceDisplay amountTzs={finalBasePrice} showNote={false} /> × {nights} night{nights === 1 ? "" : "s"}
                        </span>
                        <span className="tabular-nums">
                          <PriceDisplay amountTzs={finalBasePrice * nights} showNote={false} />
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 font-semibold text-slate-900">
                        <span>Estimated total</span>
                        <span className="tabular-nums">
                          <PriceDisplay amountTzs={finalBasePrice * nights} showNote={false} />
                        </span>
                      </div>
                      <p className="m-0 text-[11.5px] text-slate-500">Final price depends on the room you choose.</p>
                    </div>
                  )}

                  <p className="m-0 mt-3 flex items-center justify-center gap-1.5 text-[12px] text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                    Secure payment with NoLSAF-supported methods
                  </p>

                  {/* Phones and tablets: the booking card sits far down, so keep price and the next step one tap away */}
                  {typeof document !== "undefined" &&
                    createPortal(
                      <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] z-40 border-0 border-t border-solid border-slate-200 bg-white/95 px-4 py-2.5 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)] backdrop-blur md:bottom-0 lg:hidden">
                        <div className="mx-auto flex max-w-3xl items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="m-0 flex items-baseline gap-1 text-[15px] font-bold text-slate-900">
                              <PriceDisplay amountTzs={finalBasePrice} showNote={false} />
                              <span className="text-[12px] font-normal text-slate-500">/ night</span>
                            </p>
                            <p className="m-0 truncate text-[12px] text-slate-500">
                              {hasDates
                                ? `${parseBookingDateOnly(ci).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${parseBookingDateOnly(co).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${selectedRoomCode || "choose room type"}`
                                : "Add dates for live availability"}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={hasDates && !canRequestBooking}
                            onClick={() => {
                              if (canRequestBooking && selectedRoomCode) {
                                const params = new URLSearchParams({ property: property.slug, checkIn: ci, checkOut: co, roomCode: selectedRoomCode });
                                router.push(`/public/booking/confirm?${params.toString()}`);
                                return;
                              }
                              if (hasDates) return;
                              document.getElementById("booking-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
                              window.setTimeout(() => setDatePickerSignal((n) => n + 1), 450);
                            }}
                            className="inline-flex h-11 flex-none items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-4 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-[#014e47] disabled:bg-slate-300"
                          >
                            {bookingActionLabel}
                          </button>
                        </div>
                      </div>,
                      document.body
                    )}
                </div>
              );
            })()}
            {/* Payment Methods (large screens: right column, touches the right layout frame) */}
            <div className="hidden lg:block rounded-2xl border border-solid border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                  <CreditCard className="w-6 h-6" aria-hidden />
                </span>
                <h2 className="text-2xl font-semibold text-slate-900">Payment Methods</h2>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3">
                {servicesByCategory.paymentModes.slice(0, 6).map((m) => (
                  <PaymentModePill key={m} mode={m} />
                ))}
                {servicesByCategory.freeCancellation ? (
                  <PolicyCard tone="success" icon={<BadgeCheck className="w-4 h-4" aria-hidden />} label="Free cancellation" />
                ) : null}
                {servicesByCategory.groupStay ? (
                  <PolicyCard tone="neutral" icon={<UsersRound className="w-4 h-4" aria-hidden />} label="Group stay" />
                ) : null}
              </div>
            </div>
          </aside>
          {priceServicesOpen && photoPortalReady ? createPortal((
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/50 px-4 py-4 backdrop-blur-sm">
              <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="Close services details"
                onClick={() => setPriceServicesOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10"
                role="dialog"
                aria-modal="true"
                aria-labelledby="price-services-title"
              >
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#02665e]">Host declaration</p>
                    <h3 id="price-services-title" className="mt-1 text-base font-semibold text-slate-950">
                      Price services
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPriceServicesOpen(false)}
                    className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                    aria-label="Close services details"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {servicesByCategory.included.length > 0 ? (
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold text-slate-950">Included in price</h4>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                          {servicesByCategory.included.length}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-2">
                        {servicesByCategory.included.map((item: string) => {
                          const meta = amenityMeta(item);
                          return (
                            <div key={item} className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50/70 px-3 py-2 ring-1 ring-emerald-100">
                              <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-800">
                                <meta.Icon className={`h-4 w-4 flex-shrink-0 ${meta.colorClass}`} aria-hidden />
                                <span>{item}</span>
                              </span>
                              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" aria-hidden />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {servicesByCategory.available.length > 0 ? (
                    <div className={servicesByCategory.included.length > 0 ? "mt-4" : ""}>
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold text-slate-950">Other available services</h4>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          {servicesByCategory.available.length}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {servicesByCategory.available.map((item: string) => {
                          const meta = amenityMeta(item);
                          return (
                            <span key={item} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-slate-50 px-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                              <meta.Icon className={`h-3.5 w-3.5 flex-shrink-0 ${meta.colorClass}`} aria-hidden />
                              <span className="truncate">{item}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-100">
                    Other services may depend on rules, timing, or separate charges.
                  </div>
                </div>
              </motion.div>
            </div>
          ), document.body) : null}
        </div>
        {/* Building visualization (owner-declared) */}
        {property.roomsSpec && property.roomsSpec.length > 0 && (
          <div className="mt-6 rounded-2xl border border-solid border-slate-200 bg-white shadow-sm overflow-hidden">
            {/* Content (the component draws the section header with live totals) */}
            <div className="p-4 sm:p-5">
              {(() => {
                const roomsSpec = Array.isArray(property.roomsSpec) ? property.roomsSpec : [];
                const explicitFloors = typeof property.totalFloors === "number" ? property.totalFloors : null;
                const derivedFloors = (() => {
                  let max = 0;
                  for (const r of roomsSpec) {
                    const dist = (r as any)?.floorDistribution;
                    let obj: any = dist;
                    if (typeof dist === "string") {
                      try { obj = JSON.parse(dist); } catch { obj = null; }
                    }
                    if (obj && typeof obj === "object") {
                      for (const k of Object.keys(obj)) {
                        const n = Number(k);
                        if (Number.isFinite(n)) max = Math.max(max, n);
                      }
                    }
                  }
                  return max > 0 ? max : 1;
                })();
                const effectiveTotalFloors = explicitFloors && explicitFloors > 0 ? explicitFloors : derivedFloors;
                const effectiveBuildingType =
                  (property.buildingType && String(property.buildingType).trim()) ||
                  (effectiveTotalFloors > 1 ? "multi_storey" : "single_storey");
                return (
                  <PropertyVisualizationPreview
                    title={property.title || "Property"}
                    buildingType={effectiveBuildingType}
                    totalFloors={effectiveTotalFloors}
                    floorUses={parseFloorUses((property as any).services)}
                    showHeader={false}
                    sectionEyebrow="Property structure"
                    sectionTitle="Building layout"
                    sectionBadge={
                      <span
                        className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-2.5 text-[12px] font-semibold text-emerald-700"
                        title="Floors and rooms as declared by the property owner"
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Owner-declared
                      </span>
                    }
                    rooms={roomsSpec.map((r: any) => {
                      // floorDistribution may arrive as JSON string or object
                      let floorDist: Record<number, number> | undefined = undefined;
                      const dist = r?.floorDistribution;
                      if (dist) {
                        if (typeof dist === "string") {
                          try {
                            const parsed = JSON.parse(dist);
                            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                              floorDist = parsed;
                            }
                          } catch {}
                        } else if (typeof dist === "object" && dist !== null && !Array.isArray(dist)) {
                          floorDist = dist;
                        }
                      }
                      return {
                        roomType: String(r?.roomType || r?.name || r?.label || "Room"),
                        roomsCount: Number(r?.roomsCount ?? r?.count ?? r?.quantity ?? 0) || 0,
                        floorDistribution: floorDist,
                      };
                    })}
                    onRoomTypeClick={({ roomType, floor }) => setRoomQuickView({ roomType, floor })}
                  />
                );
              })()}
            </div>
          </div>
        )}
        {roomQuickView && (
          <RoomQuickViewModal
            roomType={roomQuickView.roomType}
            floor={roomQuickView.floor}
            propertyId={property.id}
            propertySlug={property.slug}
            initialCheckIn={selectedDates.checkIn}
            initialCheckOut={selectedDates.checkOut}
            onClose={() => setRoomQuickView(null)}
            router={router}
          />
        )}
        {/* Rooms (full-width on large screens; no horizontal scroll) */}
        <div id="roomsSection" className="mt-6 rounded-2xl border border-solid border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
              <DoorClosed className="w-5 h-5" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold text-slate-900">Rooms</h2>
          </div>
          {(() => {
            const rows = normalizeRoomsSpec(property.roomsSpec, property.currency, property.basePrice, property, systemCommission);
            if (!rows.length) return <p className="mt-2 text-sm text-slate-600">Room details coming soon.</p>;
            return (
              <div className="mt-5 space-y-4">
                {rows.map((r, idx) => {
                  const descOpen = openRoomDesc.has(idx);
                  const amenOpen = openRoomAmen.has(idx);
                  const bath = r.bathItems || [];
                  const allAmenities = r.amenities.length + bath.length;
                  const TOP = 5;
                  const dims = getBedDimensions(r.bedsSummary);
                  const iconOf = (label: string) => (BATHROOM_ICONS as any)[label] || (OTHER_AMENITIES_ICONS as any)[label] || Tags;
                  // Policies arrive as short phrases ("Towels: White", "No smoking"); turn them into label and value
                  const specOf = (text: string) => {
                    const t = String(text || "").trim();
                    if (t.includes(":")) {
                      const [label, ...rest] = t.split(":");
                      return { label: label!.trim(), value: rest.join(":").trim() };
                    }
                    if (/smok/i.test(t)) return { label: "Smoking", value: /\b(no|not|non)\b/i.test(t) ? "Not allowed" : "Allowed" };
                    return { label: "Note", value: t };
                  };
                  const specs: Array<{ key: string; label: string; value: string; Icon: any }> = [];
                  if (r.bedsSummary) specs.push({ key: "bed", label: "Bed", value: dims ? `${r.bedsSummary} · ${dims.replace(/^[^:]*:\s*/, "").replace(/^.*\((.*)\)$/, "$1")}` : r.bedsSummary, Icon: BedDouble });
                  if (r.bathPrivate === "yes" || r.bathPrivate === "no") specs.push({ key: "bath", label: "Bathroom", value: r.bathPrivate === "yes" ? "Private" : "Shared", Icon: Bath });
                  r.policies.slice(0, 2).forEach((pol, i) => {
                    const sp = specOf(pol.text);
                    specs.push({ key: `pol-${i}`, label: sp.label, value: sp.value, Icon: pol.Icon || Check });
                  });
                  const reserve = () => {
                    const params = new URLSearchParams({ property: property.slug });
                    if (r.roomCode) {
                      params.set("roomCode", r.roomCode);
                    } else {
                      const roomIndex = rows.findIndex((row) => row === r);
                      if (roomIndex >= 0) params.set("roomIndex", String(roomIndex));
                    }
                    router.push(`/public/booking/confirm?${params.toString()}`);
                  };
                  return (
                    <motion.div
                      key={r.roomType + "-" + idx}
                      transition={{ duration: 0.42, delay: idx * 0.07, ease: [0.2, 0.8, 0.2, 1] }}
                      className="flex flex-col overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md md:flex-row"
                    >
                      {/* Details */}
                      <div className="min-w-0 flex-1 p-4 sm:p-5">
                        {/* Header */}
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-[13px] font-bold tabular-nums text-white">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <h3 className="m-0 truncate text-[17px] font-bold leading-tight text-slate-900">{r.roomType}</h3>
                            {typeof r.roomsCount === "number" && r.roomsCount > 0 ? (
                              <div className="text-[12px] text-slate-500">
                                {r.roomsCount} {r.roomsCount === 1 ? "room" : "rooms"} of this type
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {/* Spec strip */}
                        {specs.length ? (
                          <div className="mt-3.5 grid grid-cols-2 overflow-hidden rounded-xl border border-solid border-slate-200 sm:grid-cols-4">
                            {specs.map(({ key, label, value, Icon }, i) => (
                              <div
                                key={key}
                                className={[
                                  "flex min-w-0 items-center gap-2.5 px-3 py-2.5",
                                  i % 2 === 1 ? "border-0 border-l border-solid border-slate-200" : "",
                                  i >= 2 ? "border-0 border-t border-solid border-slate-200 sm:border-t-0" : "",
                                  i === 2 ? "sm:border-l" : "",
                                ].join(" ")}
                              >
                                <Icon className="h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden />
                                <div className="min-w-0 leading-tight">
                                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</div>
                                  <div className="truncate text-[13px] font-semibold text-slate-800" title={value}>{value}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {/* Description */}
                        {r.description ? (
                          <p className="m-0 mt-3.5 text-[13.5px] leading-relaxed text-slate-600">
                            <span style={descOpen ? undefined : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {r.description}
                            </span>
                            {String(r.description).length > 160 ? (
                              <button
                                type="button"
                                onClick={() => setOpenRoomDesc((prev) => toggleInSet(prev, idx))}
                                className="mt-0.5 cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline"
                              >
                                {descOpen ? "Show less" : "Read more"}
                              </button>
                            ) : null}
                          </p>
                        ) : null}

                        {/* Amenities: the highlights in one line, everything on request */}
                        {allAmenities ? (
                          <div className="mt-3.5 border-0 border-t border-solid border-slate-100 pt-3">
                            {!amenOpen ? (
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                {[...r.amenities, ...bath].slice(0, TOP).map((a) => {
                                  const A = iconOf(a);
                                  return (
                                    <span key={a} className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-700">
                                      <A className="h-4 w-4 text-[#02665e]" aria-hidden />
                                      {a}
                                    </span>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => setOpenRoomAmen((prev) => toggleInSet(prev, idx))}
                                  className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-solid border-slate-200 bg-white px-3 py-1 text-[12px] font-semibold text-slate-800 transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                                >
                                  All {allAmenities} amenities
                                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </div>
                            ) : (
                              <div>
                                {(() => {
                                  // Group by purpose so guests scan by need, not a flat list
                                  // One muted tone per group: its line, icons and chip tint. Text stays neutral.
                                  const tone = (hex: string) => {
                                    const n = parseInt(hex.slice(1), 16);
                                    const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
                                    return { accent: hex, soft: `rgba(${rgb}, 0.08)`, ring: `rgba(${rgb}, 0.22)`, line: `rgba(${rgb}, 0.45)` };
                                  };
                                  type Group = { title: string; Icon: any; items: string[]; t: ReturnType<typeof tone> };
                                  const ROOM_GROUPS: Group[] = [
                                    { title: "Tech & entertainment", Icon: Wifi, t: tone("#4f46e5"), items: ["Free Wi-Fi", "TV", "Flat Screen TV", "PS Station", "Phone"] },
                                    { title: "Comfort & climate", Icon: Thermometer, t: tone("#d97706"), items: ["Air Conditioning", "Heating", "Blackout Curtains", "Bedside Lamps", "Couches"] },
                                    { title: "Work & refreshments", Icon: Coffee, t: tone("#02665e"), items: ["Table", "Desk", "Chair", "Coffee Maker", "Mini Fridge"] },
                                    { title: "Storage & care", Icon: Lock, t: tone("#7c3aed"), items: ["Wardrobe", "Clothes Rack", "Iron", "Mirror", "Safe"] },
                                  ];
                                  const BATH_GROUPS: Group[] = [
                                    { title: "Bathroom fixtures", Icon: Bath, t: tone("#0284c7"), items: ["Shower", "Toilet", "Water Heater", "Mirror", "Bath Mat", "Trash Bin", "Toilet Brush"] },
                                    { title: "Bathroom supplies", Icon: Waves, t: tone("#e11d48"), items: ["Free toiletries", "Toilet paper", "Towel", "Hairdryer", "Slippers", "Bathrobe"] },
                                  ];
                                  const OTHER_TONE = tone("#64748b");
                                  const group = (list: string[], defs: typeof ROOM_GROUPS, otherTitle: string) => {
                                    const used = new Set<string>();
                                    const out = defs
                                      .map((d) => {
                                        const items = list.filter((x) => d.items.some((k) => k.toLowerCase() === x.toLowerCase()) && !used.has(x));
                                        items.forEach((x) => used.add(x));
                                        return { ...d, items };
                                      })
                                      .filter((g) => g.items.length);
                                    const rest = list.filter((x) => !used.has(x));
                                    if (rest.length) out.push({ title: otherTitle, Icon: Tags, items: rest, t: OTHER_TONE });
                                    return out;
                                  };
                                  const groups = [...group(r.amenities, ROOM_GROUPS, "Other in the room"), ...group(bath, BATH_GROUPS, "Other in the bathroom")];
                                  return (
                                    <>
                                      <div className="mb-2.5 flex items-center justify-between gap-3">
                                        <span className="text-[12px] font-semibold text-slate-500">{allAmenities} amenities in this room</span>
                                        <button
                                          type="button"
                                          onClick={() => setOpenRoomAmen((prev) => toggleInSet(prev, idx))}
                                          className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12px] font-semibold text-[#02665e] hover:underline"
                                        >
                                          Show fewer
                                          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                                        </button>
                                      </div>
                                      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                                        {groups.map((g) => (
                                          <div key={g.title} className="min-w-0 border-0 border-l-2 border-solid pl-3" style={{ borderColor: g.t.line }}>
                                            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-slate-800">
                                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: g.t.soft, color: g.t.accent }}>
                                                <g.Icon className="h-3 w-3" aria-hidden />
                                              </span>
                                              {g.title}
                                              <span className="rounded-full px-1.5 py-px text-[10.5px] font-bold" style={{ backgroundColor: g.t.soft, color: g.t.accent }}>
                                                {g.items.length}
                                              </span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                              {g.items.map((a) => {
                                                const A = iconOf(a);
                                                return (
                                                  <span
                                                    key={a}
                                                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-slate-700"
                                                    style={{ backgroundColor: g.t.soft, boxShadow: `inset 0 0 0 1px ${g.t.ring}` }}
                                                  >
                                                    <A className="h-3.5 w-3.5" style={{ color: g.t.accent }} aria-hidden />
                                                    {a}
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>

                      {/* Price and action */}
                      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 px-4 py-3.5 md:w-56 md:flex-col md:items-stretch md:justify-center md:border-l md:border-t-0 md:px-5 md:py-5">
                        <div className="min-w-0">
                          <PriceDisplay
                            amountTzs={r.pricePerNight}
                            className="text-[22px] font-black leading-tight text-slate-900 tabular-nums"
                            noteClassName="text-xs font-normal text-slate-500 mt-0.5"
                          />
                          <div className="text-xs text-slate-500">per night, per room</div>
                          {r.discountLabel ? (
                            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#02665e]/10 px-2 py-0.5 text-[11px] font-semibold text-[#02665e]">
                              <Tags className="h-2.5 w-2.5" aria-hidden />
                              {r.discountLabel}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-center gap-1.5 md:mt-4">
                          <button
                            type="button"
                            onClick={reserve}
                            className="inline-flex h-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-[#02665e] px-6 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#014e47] active:scale-[0.98] md:w-full"
                          >
                            Pay now
                          </button>
                          <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-400">
                            <Lock className="h-2.5 w-2.5" aria-hidden />
                            Secure checkout
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            );
          })()}
        </div>
        {/* Guest reviews: the verdict on the left, the voices on the right */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                <MessageSquare className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="m-0 text-lg font-semibold leading-tight text-slate-900">Guest reviews</h2>
                <p className="m-0 mt-0.5 text-xs text-slate-500">What guests say after their stay</p>
              </div>
            </div>
            {!isOwner ? (
              <button
                type="button"
                onClick={() => setReviewFormOpen((v) => !v)}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#014e47]"
              >
                {reviewFormOpen ? "Close form" : "Write a review"}
              </button>
            ) : null}
          </div>

          {reviewsError ? (
            <div className="m-5 rounded-lg border border-solid border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{reviewsError}</div>
          ) : reviewsLoading ? (
            <div className="px-6 py-8 text-sm text-slate-500">Loading reviews...</div>
          ) : (() => {
            const list = reviewsData?.reviews ?? [];
            const avg = Number(reviewsData?.stats?.averageRating ?? 0);
            const total = Number(reviewsData?.stats?.totalReviews ?? list.length) || 0;
            // The average is out of 5
            const verdict = avg >= 4.5 ? "Wonderful" : avg >= 4 ? "Very good" : avg >= 3.5 ? "Good" : avg >= 3 ? "Pleasant" : avg > 0 ? "Fair" : "No ratings yet";
            const dist = [5, 4, 3, 2, 1].map((star) => ({ star, count: list.filter((r) => Math.round(Number(r.rating) || 0) === star).length }));
            const distMax = Math.max(1, ...dist.map((d) => d.count));
            const categories = [
              { key: "customerCare", label: "Customer care" },
              { key: "security", label: "Security" },
              { key: "reality", label: "As described" },
              { key: "comfort", label: "Comfort" },
            ].map((c) => ({ ...c, value: Number((reviewsData?.stats?.categoryAverages as any)?.[c.key] ?? 0) }));
            return (
              <div>
                {/* The verdict: one band, three columns */}
                <div className="grid grid-cols-1 border-0 border-b border-solid border-slate-100 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="flex items-center gap-4 px-5 py-5 sm:px-6">
                    <span className="text-[48px] font-black leading-none tabular-nums text-slate-900">{avg > 0 ? avg.toFixed(1) : "0.0"}</span>
                    <div>
                      <StarRow value={Math.round(avg)} />
                      <div className="mt-1 text-[14px] font-bold text-[#02665e]">{verdict}</div>
                      <div className="text-xs text-slate-500">
                        out of 5 · {total} {total === 1 ? "review" : "reviews"}
                      </div>
                    </div>
                  </div>

                  <div className="border-0 border-t border-solid border-slate-100 px-5 py-4 sm:px-6 md:border-l md:border-t-0">
                    <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Rating breakdown</div>
                    <div className="space-y-1">
                      {dist.map((d) => (
                        <div key={d.star} className="flex items-center gap-2 text-xs text-slate-600">
                          <span className="w-6 tabular-nums">{d.star}★</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <span className="block h-full rounded-full bg-amber-400" style={{ width: `${(d.count / distMax) * 100}%` }} />
                          </span>
                          <span className="w-5 text-right tabular-nums text-slate-400">{d.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-0 border-t border-solid border-slate-100 px-5 py-4 sm:px-6 md:border-l md:border-t-0">
                    <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">By category</div>
                    {categories.some((c) => c.value > 0) ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {categories.map((c) => (
                          <div key={c.key}>
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="truncate font-medium text-slate-700">{c.label}</span>
                              <span className="font-bold tabular-nums text-slate-900">{c.value > 0 ? c.value.toFixed(1) : "-"}</span>
                            </div>
                            <span className="block h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <span className="block h-full rounded-full bg-[#02665e]" style={{ width: `${Math.min(100, (c.value / 5) * 100)}%` }} />
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="m-0 text-xs leading-relaxed text-slate-500">
                        Category scores for customer care, security, accuracy and comfort appear as guests rate them.
                      </p>
                    )}
                  </div>
                </div>

                {isOwner ? (
                  <p className="m-0 border-0 border-b border-solid border-slate-100 bg-slate-50 px-5 py-2.5 text-xs text-slate-500 sm:px-6">
                    As the owner, you cannot review your own property. You can still book it like any other guest.
                  </p>
                ) : null}

                {/* The voices */}
                <div className="min-w-0 p-5 sm:p-6">
                  {reviewFormOpen && !isOwner ? (
                    <div className="mb-5 rounded-2xl border border-solid border-[#02665e]/25 bg-[#02665e]/[0.03] p-4 sm:p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[15px] font-bold text-slate-900">Share your stay</div>
                          <div className="mt-0.5 text-xs text-slate-500">If you are not logged in, we will ask you to log in first.</div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <StarPicker value={reviewRating} onChange={setReviewRating} />
                        {reviewRating > 0 ? (
                          <span className="text-sm font-semibold text-[#02665e]">
                            {reviewRating === 5 ? "Excellent" : reviewRating === 4 ? "Very good" : reviewRating === 3 ? "Good" : reviewRating === 2 ? "Fair" : "Poor"}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Tap a star to rate</span>
                        )}
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3">
                        <input
                          value={reviewTitle}
                          onChange={(e) => setReviewTitle(e.target.value)}
                          placeholder="Title (optional), e.g. Great location, friendly staff"
                          aria-label="Review title"
                          className="box-border h-11 w-full rounded-lg border border-solid border-slate-200 bg-white px-3 text-sm focus:border-[#02665e] focus:outline-none focus:ring-2 focus:ring-[#02665e]/20"
                        />
                        <div>
                          <textarea
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder="What did you enjoy, and what could be better?"
                            aria-label="Your review"
                            rows={4}
                            className="box-border w-full resize-y rounded-lg border border-solid border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed focus:border-[#02665e] focus:outline-none focus:ring-2 focus:ring-[#02665e]/20"
                            style={{ fontFamily: "inherit" }}
                          />
                          <div className="mt-1 text-right text-[11px] tabular-nums text-slate-400">{reviewComment.length} characters</div>
                        </div>
                      </div>

                      <div className="mt-3 border-0 border-t border-solid border-slate-200/70 pt-3">
                        <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Rate by category, optional</div>
                        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                          {[
                            { key: "customerCare" as const, label: "Customer care" },
                            { key: "security" as const, label: "Security" },
                            { key: "reality" as const, label: "As described" },
                            { key: "comfort" as const, label: "Comfort" },
                          ].map(({ key, label }) => (
                            <div key={key} className="flex items-center justify-between gap-3">
                              <span className="text-[13px] text-slate-700">{label}</span>
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setCategoryRatings((prev) => ({ ...prev, [key]: n }))}
                                    className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 transition-colors ${
                                      n <= categoryRatings[key] ? "text-amber-500" : "text-slate-300 hover:text-slate-400"
                                    }`}
                                    aria-label={`${n} star for ${label}`}
                                  >
                                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
                                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                                    </svg>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {reviewSubmitMsg ? (
                        <div
                          className={`mt-3 rounded-lg p-3 text-sm ${
                            reviewSubmitMsg.includes("Thanks") || reviewSubmitMsg.includes("submitted")
                              ? "border border-solid border-[#02665e]/25 bg-[#02665e]/5 text-[#02665e]"
                              : "border border-solid border-rose-200 bg-rose-50 text-rose-700"
                          }`}
                        >
                          {reviewSubmitMsg}
                        </div>
                      ) : null}

                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          disabled={reviewSubmitting || !reviewRating}
                          onClick={async () => {
                  setReviewSubmitMsg(null);
                  if (!property?.id) return;
                  if (!reviewRating) {
                    setReviewSubmitMsg("Please select a rating (1-5).");
                    setReviewSubmitMsg("Please select a rating (1-5).");
                    return;
                  }
                  setReviewSubmitting(true);
                  try {
                    const res = await fetch(`/api/property-reviews`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({
                        propertyId: property.id,
                        rating: reviewRating,
                        title: reviewTitle.trim() || null,
                        comment: reviewComment.trim() || null,
                        categoryRatings: {
                          customerCare: categoryRatings.customerCare > 0 ? categoryRatings.customerCare : null,
                          security: categoryRatings.security > 0 ? categoryRatings.security : null,
                          reality: categoryRatings.reality > 0 ? categoryRatings.reality : null,
                          comfort: categoryRatings.comfort > 0 ? categoryRatings.comfort : null,
                        },
                      }),
                    });
                    if (res.status === 401) {
                      setReviewSubmitMsg("Please log in to submit a review.");
                      router.push(`/login?next=${encodeURIComponent(`/public/properties/${property.slug}`)}`);
                      return;
                    }
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      setReviewSubmitMsg(json?.error || `Failed to submit review (${res.status})`);
                      return;
                    }
                    setReviewSubmitMsg("Thanks! Your review was submitted.");
                    setReviewRating(0);
                    setReviewTitle("");
                    setReviewComment("");
                    setCategoryRatings({
                      customerCare: 0,
                      security: 0,
                      reality: 0,
                      comfort: 0,
                    });
                    const r2 = await fetch(`/api/property-reviews/${property.id}`, { cache: "no-store" });
                    if (r2.ok) setReviewsData((await r2.json()) as ReviewsResponse);
                  } catch (e: any) {
                    setReviewSubmitMsg(e?.message || "Failed to submit review");
                  } finally {
                    setReviewSubmitting(false);
                  }
                          }}
                          className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border-0 bg-[#02665e] px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {reviewSubmitting ? "Submitting..." : "Submit review"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {list.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center">
                      <MessageSquare className="h-7 w-7 text-slate-300" aria-hidden />
                      <div className="mt-2 text-sm font-semibold text-slate-700">No reviews yet</div>
                      <div className="mt-1 text-xs text-slate-500">Stayed here? Be the first to share how it went.</div>
                    </div>
                  ) : (
                    <div className={`grid grid-cols-1 gap-3 ${list.length > 1 ? "lg:grid-cols-2" : ""}`}>
                      {list.slice(0, 20).map((r) => (
                        <ReviewCard key={r.id} review={r} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
        {/* House rules: four rules at a glance, then the host's own words */}
        <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm nols-entrance">
          <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                <Home className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="m-0 text-lg font-semibold leading-tight text-slate-900">House rules</h2>
                <p className="m-0 mt-0.5 text-xs text-slate-500">Read these before you book. They apply to every guest.</p>
              </div>
            </div>
          </div>

          {houseRules ? (() => {
            // "14:00 - 18:00" becomes a band on a 24 hour bar
            const toMinutes = (t?: string) => {
              const m = /(\d{1,2}):(\d{2})/.exec(t || "");
              return m ? Math.min(1440, Number(m[1]) * 60 + Number(m[2])) : null;
            };
            const windowOf = (v?: string) => {
              if (!v) return null;
              const times = v.match(/\d{1,2}:\d{2}/g) || [];
              if (times.length >= 2) {
                const from = toMinutes(times[0]);
                const to = toMinutes(times[1]);
                if (from !== null && to !== null && to > from) return { from, to };
              }
              if (times.length === 1) {
                const at = toMinutes(times[0]);
                if (at === null) return null;
                return /until/i.test(v) ? { from: Math.max(0, at - 60), to: at } : { from: at, to: Math.min(1440, at + 60) };
              }
              return null;
            };
            const inWin = windowOf(houseRules.checkIn);
            const outWin = windowOf(houseRules.checkOut);
            const pct = (m: number) => `${(m / 1440) * 100}%`;
            const petsKnown = houseRules.pets !== undefined;
            const smokingKnown = houseRules.smoking !== undefined;
            const petsOk = houseRules.pets === true;
            const smokingOk = houseRules.smoking === false; // smoking === true means not allowed
            const safety = [
              "Keep the property clean and tidy",
              "Return all keys and access cards at check-out",
              "Report any incident or damage straight away",
              "Respect quiet hours and the neighbours",
              "Follow the safety signs posted on site",
              ...(Array.isArray(houseRules.safetyMeasures) ? houseRules.safetyMeasures.map(String) : []),
            ];
            const Policy = ({
              label,
              known,
              ok,
              okText,
              noText,
              Icon,
              note,
            }: {
              label: string;
              known: boolean;
              ok: boolean;
              okText: string;
              noText: string;
              Icon: any;
              note?: string;
            }) => (
              <div className="flex h-full flex-col px-5 py-4 sm:px-6">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</div>
                <div className="mt-2.5 flex items-center gap-3">
                  <span
                    className={[
                      "inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full",
                      !known ? "bg-slate-100 text-slate-400" : ok ? "bg-[#02665e] text-white" : "bg-rose-50 text-rose-600",
                    ].join(" ")}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className={`text-[16px] font-bold leading-tight ${!known ? "text-slate-400" : ok ? "text-slate-900" : "text-rose-700"}`}>
                      {!known ? "Ask the host" : ok ? "Allowed" : "Not allowed"}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{!known ? "Not stated for this property" : ok ? okText : noText}</div>
                  </div>
                </div>
                {note ? <p className="m-0 mt-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-slate-600">{note}</p> : null}
              </div>
            );
            return (
              <>
                {/* Row one: the day, then the two yes or no rules */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="px-5 py-4 sm:px-6 md:col-span-2 lg:col-span-1">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Arrival and departure</div>
                    <div className="mt-2.5 grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-white">
                          <LogIn className="h-[18px] w-[18px]" aria-hidden />
                        </span>
                        <div className="min-w-0 leading-tight">
                          <div className="text-xs text-slate-500">Check-in</div>
                          <div className={`text-[15px] font-bold tabular-nums ${houseRules.checkIn ? "text-slate-900" : "text-slate-400"}`}>
                            {houseRules.checkIn || "Not specified"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-white">
                          <LogOut className="h-[18px] w-[18px]" aria-hidden />
                        </span>
                        <div className="min-w-0 leading-tight">
                          <div className="text-xs text-slate-500">Check-out</div>
                          <div className={`text-[15px] font-bold tabular-nums ${houseRules.checkOut ? "text-slate-900" : "text-slate-400"}`}>
                            {houseRules.checkOut || "Not specified"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {inWin || outWin ? (
                      <div className="mt-3.5" aria-hidden>
                        <div className="relative h-2.5 rounded-full bg-slate-100">
                          {outWin ? (
                            <span className="absolute inset-y-0 rounded-full bg-slate-800" style={{ left: pct(outWin.from), width: pct(Math.max(15, outWin.to - outWin.from)) }} />
                          ) : null}
                          {inWin ? (
                            <span className="absolute inset-y-0 rounded-full bg-[#02665e]" style={{ left: pct(inWin.from), width: pct(Math.max(15, inWin.to - inWin.from)) }} />
                          ) : null}
                          {[6, 12, 18].map((h) => (
                            <span key={h} className="absolute top-full mt-0.5 h-1 w-px bg-slate-300" style={{ left: pct(h * 60) }} />
                          ))}
                        </div>
                        <div className="relative mt-2 h-3 text-[10px] tabular-nums text-slate-400">
                          {[0, 6, 12, 18, 24].map((h) => (
                            <span
                              key={h}
                              className="absolute -translate-x-1/2"
                              style={{ left: pct(h * 60), transform: h === 0 ? "none" : h === 24 ? "translateX(-100%)" : undefined }}
                            >
                              {String(h).padStart(2, "0")}:00
                            </span>
                          ))}
                        </div>
                        <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-[#02665e]" /> Check-in window
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-slate-800" /> Check-out window
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="border-0 border-t border-solid border-slate-100 md:border-t lg:border-l lg:border-t-0">
                    <Policy
                      label="Pets"
                      known={petsKnown}
                      ok={petsOk}
                      okText="Pets are welcome to stay"
                      noText="Pets cannot stay in the rooms"
                      Icon={PawPrint}
                      note={houseRules.petsNote}
                    />
                  </div>
                  <div className="border-0 border-t border-solid border-slate-100 md:border-l lg:border-t-0">
                    <Policy
                      label="Smoking"
                      known={smokingKnown}
                      ok={smokingOk}
                      okText="Smoking is permitted"
                      noText="A smoke-free property"
                      Icon={smokingOk ? Cigarette : CigaretteOff}
                    />
                  </div>
                </div>

                {/* Row two: the host's own words when there are any, then the house basics */}
                <div className="border-0 border-t border-solid border-slate-100">
                  {houseRules.other ? (
                    <div className="border-0 border-b border-solid border-slate-100 px-5 py-4 sm:px-6">
                      <div className="mb-2 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#02665e]">
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                        From the host
                      </div>
                      <blockquote className="m-0 whitespace-pre-line rounded-xl border-0 border-l-[3px] border-solid border-[#02665e] bg-[#02665e]/[0.04] px-4 py-3 text-sm leading-relaxed text-slate-700">
                        {houseRules.other}
                      </blockquote>
                    </div>
                  ) : null}
                  <div className="px-5 py-4 sm:px-6">
                    <div className="mb-2.5 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#02665e]">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      Good to know
                    </div>
                    <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
                      {safety.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[13px] leading-snug text-slate-600">
                          <span className="mt-px inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
                            <Check className="h-2.5 w-2.5" aria-hidden />
                          </span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            );
          })() : (
            <div className="px-6 py-10 text-center">
              <div className="text-sm text-slate-400">House rules will be available soon. The owner is setting up the rules for this property.</div>
            </div>
          )}
        </div>
        {/* Location and what is around it: one card, map left, nearby places right */}
        {property.latitude && property.longitude && (() => {
          const lat = Number(property.latitude);
          const lng = Number(property.longitude);
          const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
          const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

          type Place = { name: string; type: string; ownership?: string; distanceKm: number | null; reachableBy: string[]; url?: string };
          const places: Place[] = nearbyFacilities
            .filter((f: any) => f && typeof f !== "string" && f.name)
            .map((f: any) => ({
              name: String(f.name),
              type: String(f.type || "Place"),
              ownership: f.ownership ? String(f.ownership) : undefined,
              distanceKm: typeof f.distanceKm === "number" && Number.isFinite(f.distanceKm) ? f.distanceKm : null,
              reachableBy: Array.isArray(f.reachableBy) ? f.reachableBy.map(String) : [],
              url: typeof f.url === "string" && /^https?:\/\//i.test(f.url) ? f.url : undefined,
            }))
            .sort((x: Place, y: Place) => (x.distanceKm ?? 9999) - (y.distanceKm ?? 9999));

          const kindOf = (t: string) => {
            const v = t.toLowerCase();
            if (/(hospital|clinic|polyclinic|pharmacy)/.test(v)) return "medical";
            if (/(airport|bus|petrol|road|station)/.test(v) && !/police/.test(v)) return "transport";
            return "public";
          };
          const iconFor = (t: string) => {
            const v = t.toLowerCase();
            if (v.includes("pharmacy")) return Pill;
            if (v.includes("hospital")) return Hospital;
            if (v.includes("clinic")) return Stethoscope;
            if (v.includes("airport")) return Plane;
            if (v.includes("petrol") || v.includes("fuel")) return Fuel;
            if (v.includes("bus")) return Bus;
            if (v.includes("road")) return Route;
            if (v.includes("police")) return Shield;
            if (v.includes("conference")) return Landmark;
            if (v.includes("stadium")) return Building2;
            return MapPin;
          };
          const modeIcon: Record<string, any> = { Walking: Footprints, Boda: Bike, "Public Transport": Bus, "Car/Taxi": Car };
          // A rough travel time from the modes the host listed, so distance means something
          const travel = (p: Place) => {
            const d = p.distanceKm;
            if (d === null || d <= 0) return null;
            const has = (m: string) => p.reachableBy.includes(m);
            if (has("Walking") && d <= 2.5) return `about ${Math.max(1, Math.round((d / 5) * 60))} min walk`;
            if (has("Car/Taxi")) return `about ${Math.max(2, Math.round((d / 30) * 60))} min by car`;
            if (has("Boda")) return `about ${Math.max(2, Math.round((d / 28) * 60))} min by boda`;
            if (has("Public Transport")) return `about ${Math.max(3, Math.round((d / 18) * 60))} min by bus`;
            if (has("Walking")) return `about ${Math.round((d / 5) * 60)} min walk`;
            return null;
          };
          const extras: Array<{ Icon: any; text: string }> = [];
          const seenExtra = new Set<string>();
          const pushExtra = (raw: string) => {
            const norm = normalizeNearby([raw]);
            if (!norm || !norm.length) return;
            const { Icon, title, detail } = norm[0];
            const text = `${title}${detail ? `: ${detail}` : ""}`;
            if (seenExtra.has(text.toLowerCase())) return;
            seenExtra.add(text.toLowerCase());
            extras.push({ Icon, text });
          };
          nearbyFacilities
            .filter((f: any) => typeof f === "string" || (f && !f.name))
            .forEach((f: any) => pushExtra(typeof f === "string" ? f : f?.label || String(f)));
          servicesByCategory.nearby.forEach((item: string) => pushExtra(item));

          return (
            <section className="mt-6 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
              {/* Header: where it is, and the two actions people take */}
              <div className="flex flex-col gap-3 border-0 border-b border-solid border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                    <MapPin className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 className="m-0 text-lg font-semibold text-slate-900">Location and surroundings</h2>
                    <p className="m-0 mt-0.5 truncate text-sm text-slate-500">{location || "Location on the map"}</p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline shadow-sm transition-colors hover:bg-[#014e47]"
                  >
                    <Navigation className="h-4 w-4" aria-hidden />
                    Directions
                  </a>
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-700 no-underline transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                  >
                    Open in Maps
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
                {/* Map */}
                <div className="p-4">
                  <div className="overflow-hidden rounded-xl border border-solid border-slate-200">
                    <PropertyMap latitude={property.latitude} longitude={property.longitude} propertyTitle={property.title} />
                  </div>
                </div>

                {/* What is nearby: category tiles filter a route that scrolls inside a
                    panel as tall as the map; a chevron glides to the next stop */}
                {(() => {
                  const kinds = [
                    { key: "all" as const, label: "All", Icon: Navigation, list: places },
                    { key: "medical" as const, label: "Medical", Icon: Hospital, list: places.filter((p) => kindOf(p.type) === "medical") },
                    { key: "transport" as const, label: "Transport", Icon: Plane, list: places.filter((p) => kindOf(p.type) === "transport") },
                    { key: "public" as const, label: "Public places", Icon: Landmark, list: places.filter((p) => kindOf(p.type) === "public") },
                  ].filter((k) => k.key === "all" || k.list.length > 0);
                  const active = kinds.find((k) => k.key === nearbyKind) || kinds[0]!;
                  const list = active.list;
                  const far = Math.max(1, ...places.map((x) => x.distanceKm ?? 0));
                  return (
                    <div className="p-4 pt-0 lg:pl-0 lg:pt-4">
                    <div className="relative flex flex-col overflow-hidden rounded-xl border border-solid border-white/10 bg-[#0a1110] p-4 text-white shadow-[0_18px_40px_-24px_rgba(0,0,0,0.6)] lg:h-[340px]" style={{ isolation: "isolate" }}>
                      <div
                        aria-hidden
                        className="pointer-events-none absolute -right-24 -top-24 -z-10 h-72 w-72 rounded-full"
                        style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.55), rgba(2,102,94,0))" }}
                      />
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]"
                        style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "18px 18px" }}
                      />

                      {/* Header */}
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#02665e] text-white">
                            <Navigation className="h-4 w-4" aria-hidden />
                          </span>
                          <h3 className="m-0 text-[16px] font-bold text-white">What is nearby</h3>
                        </div>
                        {places.length ? (
                          <span className="rounded-full border border-solid border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/75">
                            {places.length} {places.length === 1 ? "place" : "places"} · nearest first
                          </span>
                        ) : null}
                      </div>

                      {places.length ? (
                        <>
                          {/* Category tiles: the quick facts, and the filter */}
                          <div role="tablist" aria-label="Nearby categories" className="mb-3 grid flex-shrink-0 gap-2" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}>
                            {kinds.map((k) => {
                              const on = k.key === active.key;
                              const nearestKm = k.list.find((p) => p.distanceKm !== null)?.distanceKm ?? null;
                              return (
                                <button
                                  key={k.key}
                                  type="button"
                                  role="tab"
                                  aria-selected={on}
                                  onClick={() => setNearbyKind(k.key)}
                                  className={[
                                    "min-w-0 cursor-pointer rounded-xl border border-solid px-2.5 py-2 text-left transition-colors",
                                    on ? "border-[#02665e] bg-[#02665e]/35" : "border-white/10 bg-white/[0.05] hover:bg-white/[0.09]",
                                  ].join(" ")}
                                >
                                  <span className={`flex items-center gap-1.5 truncate text-[10px] font-bold uppercase tracking-[0.08em] ${on ? "text-white" : "text-[#5ec8bb]"}`}>
                                    <k.Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                                    <span className="truncate">{k.label}</span>
                                  </span>
                                  <span className="mt-1 flex items-baseline gap-1">
                                    <span className="text-[18px] font-extrabold leading-none tabular-nums text-white">{nearestKm ?? "-"}</span>
                                    {nearestKm !== null ? <span className="text-[10.5px] font-semibold text-white/55">km</span> : null}
                                  </span>
                                  <span className="mt-0.5 block truncate text-[10.5px] text-white/50">
                                    {k.key === "all" ? "nearest of all" : `${k.list.length} ${k.list.length === 1 ? "place" : "places"}`}
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          {/* The route, scrolling inside the panel */}
                          <div className="relative min-h-0 flex-1">
                            <div
                              ref={nearbyListRef}
                              onScroll={measureNearbyList}
                              className="h-full overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.18)_transparent]"
                            >
                              <ol className="relative m-0 flex list-none flex-col gap-2 p-0">
                                <span aria-hidden className="absolute bottom-6 left-[17px] top-6 border-0 border-l-2 border-dashed border-white/15" />
                                {list.map((p, i) => {
                                  const Icon = iconFor(p.type);
                                  const eta = travel(p);
                                  const pct = p.distanceKm !== null ? Math.max(6, Math.round((p.distanceKm / far) * 100)) : 0;
                                  return (
                                    <li key={`${p.name}-${i}`} className="relative flex items-center gap-3">
                                      <span className={`relative z-[1] inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ring-4 ring-[#0a1110] ${i === 0 ? "bg-[#02665e] text-white" : "bg-[#132422] text-[#5ec8bb]"}`}>
                                        <Icon className="h-4 w-4" aria-hidden />
                                      </span>
                                      <div className="min-w-0 flex-1 rounded-xl border border-solid border-white/[0.08] bg-white/[0.04] px-3 py-2 transition-colors hover:bg-white/[0.07]">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="flex min-w-0 items-center gap-1.5">
                                              <span className="truncate text-[13.5px] font-semibold leading-tight text-white" title={p.name}>{p.name}</span>
                                              {p.url ? (
                                                <a href={p.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-white/45 hover:text-white" aria-label={`More about ${p.name}`}>
                                                  <ExternalLink className="h-3 w-3" />
                                                </a>
                                              ) : null}
                                            </div>
                                            <div className="mt-0.5 truncate text-[11.5px] text-white/55">
                                              {p.type}{p.ownership ? ` · ${p.ownership === "Public/Government" ? "Public" : p.ownership}` : ""}
                                            </div>
                                          </div>
                                          <div className="flex-shrink-0 text-right leading-tight">
                                            {p.distanceKm !== null ? (
                                              <div className="text-[14.5px] font-bold tabular-nums text-white">
                                                {p.distanceKm}<span className="ml-0.5 text-[10.5px] font-semibold text-white/55">km</span>
                                              </div>
                                            ) : null}
                                            {eta ? <div className="mt-0.5 text-[10.5px] text-[#5ec8bb]">{eta}</div> : null}
                                          </div>
                                        </div>
                                        <div className="mt-1.5 flex items-center gap-2.5">
                                          {p.distanceKm !== null ? (
                                            <span className="block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                                              <span className="block h-full rounded-full bg-gradient-to-r from-[#02665e] to-[#5ec8bb]" style={{ width: `${pct}%` }} />
                                            </span>
                                          ) : (
                                            <span className="flex-1" />
                                          )}
                                          {p.reachableBy.length ? (
                                            <span className="inline-flex flex-shrink-0 items-center gap-1">
                                              {p.reachableBy.map((m) => {
                                                const M = modeIcon[m];
                                                return M ? (
                                                  <span key={m} title={m} aria-label={m} className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08] text-white/75">
                                                    <M className="h-3 w-3" />
                                                  </span>
                                                ) : null;
                                              })}
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ol>

                              {active.key === "all" && extras.length ? (
                                <div className="mt-3 border-0 border-t border-solid border-white/10 pt-3">
                                  <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-white/45">Also in the area</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {extras.slice(0, 12).map(({ Icon, text }) => (
                                      <span key={text} className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs text-white/80">
                                        <Icon className="h-3.5 w-3.5 text-[#5ec8bb]" aria-hidden />
                                        {text}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              <p className="m-0 mt-3 flex items-center gap-1.5 pb-1 text-[11px] text-white/40">
                                <MapPin className="h-3 w-3" aria-hidden />
                                Distances are shared by the host. Travel times are rough estimates.
                              </p>
                            </div>

                            {/* More below: a chevron that glides to the next stop */}
                            {nearbyHasMore ? (
                              <button
                                type="button"
                                onClick={() => nearbyListRef.current?.scrollBy({ top: 120, behavior: "smooth" })}
                                aria-label="Show more nearby places"
                                className="absolute bottom-1 right-2 z-[2] inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-solid border-white/25 bg-[#02665e] text-white shadow-[0_8px_20px_-8px_rgba(0,0,0,0.9)] transition-transform hover:translate-y-0.5"
                              >
                                <ChevronDown className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <p className="m-0 rounded-xl border border-solid border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white/65">
                          The host has not listed nearby places yet. Use Directions to explore the area.
                        </p>
                      )}
                    </div>
                    </div>
                  );
                })()}
              </div>
            </section>
          );
        })()}
        </div>
      {/* Lightbox: one photo, full screen, with a filmstrip */}
      {photoPortalReady && lightboxOpen && lightboxImages.length > 0 ? createPortal((
        <div
          className="fixed inset-0 z-[2147483647] flex flex-col bg-[#0b0f12] text-white"
          style={{ isolation: "isolate" }}
          role="dialog"
          aria-modal="true"
          aria-label="Photo gallery"
        >
          {/* Top bar */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-bold text-white sm:text-[15px]">{property.title}</div>
              <div className="mt-0.5 text-xs text-white/60">
                <span className="font-semibold text-white/85">{activeIdx + 1} / {lightboxImages.length}</span>
                {(() => {
                  const sec = photoSections.find((x) => x.idxs.includes(activeIdx));
                  return sec && photoSections.length > 1 ? <span> · {sec.label}</span> : null;
                })()}
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setLightboxOpen(false);
                  openAllPhotos();
                }}
                className="hidden h-10 cursor-pointer items-center gap-2 rounded-full border-0 bg-white/10 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/20 sm:inline-flex"
              >
                <LayoutGrid className="h-4 w-4" />
                All photos
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                onClick={closeLightbox}
                aria-label="Close photo gallery"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Stage: the photo fills the height; empty space closes */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-20"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeLightbox();
            }}
          >
            <div className="relative h-full w-full max-w-6xl">
              <PropertyGalleryImage
                src={lightboxImages[activeIdx]}
                alt={`${property.title} photo ${activeIdx + 1}`}
                sizes="(min-width: 1280px) 1150px, 100vw"
                className="object-contain"
                priority
              />
            </div>
            {lightboxImages.length > 1 ? (
              <>
                <button
                  type="button"
                  className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white transition-colors hover:bg-white/25 sm:left-5"
                  onClick={() => setActiveIdx((i) => (i <= 0 ? lightboxImages.length - 1 : i - 1))}
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white transition-colors hover:bg-white/25 sm:right-5"
                  onClick={() => setActiveIdx((i) => (i >= lightboxImages.length - 1 ? 0 : i + 1))}
                  aria-label="Next photo"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            ) : null}
          </div>

          {/* Filmstrip */}
          {lightboxImages.length > 1 ? (
            <div className="px-4 pb-4 pt-3 sm:px-6">
              <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {lightboxImages.map((src, i) => (
                  <button
                    key={`${src}-${i}`}
                    id={`lb-thumb-${i}`}
                    type="button"
                    onClick={() => setActiveIdx(i)}
                    aria-label={`View photo ${i + 1}`}
                    aria-current={i === activeIdx ? "true" : undefined}
                    className={[
                      "relative h-14 w-20 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg border-0 bg-white/5 p-0 transition-opacity sm:h-16 sm:w-24",
                      i === activeIdx ? "opacity-100 ring-2 ring-white ring-offset-2 ring-offset-[#0b0f12]" : "opacity-45 hover:opacity-90",
                    ].join(" ")}
                  >
                    <PropertyGalleryImage src={src} alt="" sizes="96px" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ), document.body) : null}
      {/* All photos: an editorial photo tour, the property first, then each room type */}
      {photoPortalReady && allPhotosOpen ? createPortal((
        <div
          className="fixed inset-0 z-[2147483647] bg-white"
          style={{ isolation: "isolate" }}
          role="dialog"
          aria-modal="true"
          aria-label="All photos"
        >
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
                  <div className="truncate text-base font-bold text-slate-950 sm:text-lg">{property.title}</div>
                  <div className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                    {lightboxImages.length.toLocaleString()} photos
                    {photoSections.length > 1 ? ` · ${photoSections.length} sections` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeAllPhotos}
                  className="inline-flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div id="photo-tour-scroll" className="flex-1 overflow-y-auto bg-white">
              {photoSections.length > 1 ? (
                <nav className="pt-chips" aria-label="Photo sections">
                  {photoSections.map((sec) => (
                    <button
                      key={sec.key}
                      type="button"
                      onClick={() => scrollToPhotoSection(sec.key)}
                      className={`pt-chip${activeTourKey === sec.key ? " is-active" : ""}`}
                    >
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
                          <PropertyGalleryImage src={lightboxImages[sec.idxs[0]]} alt="" sizes="56px" className="object-cover" />
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
                    const left = sec.idxs.slice(at);
                    if (left.length === 2) blocks.push({ kind: "pair", idxs: left, flip: false });
                    if (left.length === 1) blocks.push({ kind: "single", idxs: left, flip: false });

                    return (
                      <section key={sec.key} id={`photo-tour-${sec.key}`} data-tour-key={sec.key} className="pt-section">
                        <div className="pt-section-head">
                          <h3 className="pt-section-title">{sec.label}</h3>
                          <span className="pt-section-rule" aria-hidden />
                          <span className="pt-section-count">{sec.idxs.length} photos</span>
                        </div>
                        {blocks.map((block, bi) => (
                          <div
                            key={`${sec.key}-${bi}`}
                            className={`pt-block pt-${block.kind}${block.flip ? " is-flip" : ""}`}
                          >
                            {block.idxs.map((i, n) => {
                              const big = block.kind === "trio" ? n === 0 : block.kind === "single";
                              return (
                                <button
                                  key={`${sec.key}-${i}`}
                                  type="button"
                                  onClick={() => openFromGrid(i)}
                                  className="pt-tile"
                                  aria-label={`Open photo ${i + 1} of ${lightboxImages.length}`}
                                >
                                  <PropertyGalleryImage
                                    src={lightboxImages[i]}
                                    alt={`${property.title} photo ${i + 1}`}
                                    sizes={big ? "(min-width: 1024px) 700px, 100vw" : "(min-width: 1024px) 340px, 50vw"}
                                    className="object-cover"
                                  />
                                  <span className="pt-tile-num">{i + 1} / {lightboxImages.length}</span>
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
      {/* Room for the phone booking bar so it never covers the last section */}
      <div aria-hidden className="h-20 lg:hidden" />
    </main>
  );

}

function ReviewCard({ review }: { review: PropertyReview }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const comment = review.comment || "";
  const isLong = comment.length > 260;
  const name = review.user?.name || "Guest";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const date = new Date(review.createdAt);
  const dateLabel = isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <>
      <article className="flex flex-col rounded-2xl border border-solid border-slate-200 bg-white p-4 transition-shadow hover:shadow-md sm:p-5">
        <header className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-[13px] font-bold text-white">
            {initials || "G"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate text-[14.5px] font-bold text-slate-900">{name}</span>
              {review.isVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#02665e]/10 px-2 py-px text-[10.5px] font-bold text-[#02665e]">
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  Verified stay
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              <StarRow value={review.rating} />
              {dateLabel ? <span>{dateLabel}</span> : null}
            </div>
          </div>
        </header>

        {review.title ? <h3 className="m-0 mt-3 text-[15px] font-bold leading-snug text-slate-900">{review.title}</h3> : null}

        {comment ? (
          <div className="mt-1.5">
            <p
              className="m-0 whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700"
              style={isExpanded ? undefined : { display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            >
              {comment}
            </p>
            {isLong ? (
              <button
                type="button"
                onClick={() => (comment.length > 900 ? setShowModal(true) : setIsExpanded((v) => !v))}
                className="mt-1 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline"
              >
                {isExpanded ? "Show less" : "Read more"}
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            ) : null}
          </div>
        ) : null}

        {review.ownerResponse ? (
          <div className="mt-3 rounded-xl border-0 border-l-[3px] border-solid border-[#02665e] bg-[#02665e]/[0.04] px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#02665e]">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              Reply from the host
            </div>
            <p className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {review.ownerResponse}
            </p>
          </div>
        ) : null}
      </article>
      {showModal && <ReviewModal review={review} onClose={() => setShowModal(false)} />}
    </>
  );

}

function ReviewModal({ review, onClose }: { review: PropertyReview; onClose: () => void }) {
  useEffect(() => {
    // Prevent body scroll when modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        aria-hidden="true"
      />
      {/* Modal Card */}
      <div
        className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-3xl shadow-2xl overflow-hidden transform transition-all duration-300 scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-[#02665e] to-[#014e47] text-white p-6 flex items-start justify-between gap-4 z-10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="text-xl font-bold truncate">
                {review.user?.name || "Guest"}
              </div>
              {review.isVerified && (
                <span className="inline-flex items-center rounded-full bg-white/20 border border-solid border-white/30 px-2.5 py-1 text-[11px] font-semibold flex-shrink-0">
                  Verified stay
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-white/90">
              <StarRow value={review.rating} />
              <span>-</span>
              <span>{new Date(review.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-120px)] p-6">
          {/* Title */}
          {review.title && (
            <h2 className="text-2xl font-bold text-slate-900 mb-4">{review.title}</h2>
          )}
          {/* Comment */}
          {review.comment && (
            <div className="mb-6">
              <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-solid border-slate-200/80 p-6 shadow-inner">
                <p className="text-base text-slate-800 leading-relaxed whitespace-pre-wrap block font-normal">
                  {review.comment}
                </p>
              </div>
            </div>
          )}
          {/* Owner Response */}
          {review.ownerResponse && (
            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#02665e]/10 flex items-center justify-center">
                  <MessageSquare className="w-6 h-6 text-[#02665e]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900 mb-2">Owner response</div>
                  <div className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {review.ownerResponse}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

}

function StarRow({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          className={i < v ? "h-4 w-4 text-amber-500" : "h-4 w-4 text-slate-300"}
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      ))}
      <span className="sr-only">{v} out of 5</span>
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  return (
    <div className="inline-flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => {
        const n = i + 1;
        const active = n <= v;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={[
              "h-8 w-8 rounded-full border flex items-center justify-center",
              active ? "bg-amber-50 border-amber-200 text-amber-600" : "bg-white border-slate-200 text-slate-400",
              "hover:bg-slate-50",
            ].join(" ")}
            aria-label={`${n} star`}
            aria-pressed={active}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange(0)}
        className="ml-2 text-xs font-semibold text-slate-600 hover:underline"
        aria-label="Clear rating"
      >
        Clear
      </button>
    </div>
  );
}
// Icon mappings matching the owner's add page exactly

// Icon mappings are imported from shared source to ensure consistency with owner submissions

// DO NOT define custom icon mappings here - use the shared BATHROOM_ICONS and OTHER_AMENITIES_ICONS

function RoomAmenityChip({
  label,
  onTouchHint,

}: {
  label: string;
  activeHint: string | null;
  onTouchHint: (label: string) => void;

}) {
  // Use exact match from the owner's icon mappings first
  const Icon = BATHROOM_ICONS[label] || OTHER_AMENITIES_ICONS[label] || Tags;
  

  // Determine colors based on icon type
  const meta = (() => {
    // Check if it's a bathroom item - use same colors as other amenities
    if (BATHROOM_ICONS[label]) {
      return { Icon, bg: "bg-slate-50", border: "border-slate-200", icon: "text-slate-700" };
    }
    // Check if it's an other amenity
    if (OTHER_AMENITIES_ICONS[label]) {
      // Special colors for specific amenities
      if (label === "Free Wi-Fi") {
        return { Icon, bg: "bg-emerald-50", border: "border-emerald-200", icon: "text-emerald-700" };
    }
      if (label === "TV" || label === "Flat Screen TV") {
        return { Icon, bg: "bg-indigo-50", border: "border-indigo-200", icon: "text-indigo-700" };
    }
      if (label === "PS Station") {
        return { Icon, bg: "bg-purple-50", border: "border-purple-200", icon: "text-purple-700" };
      }
      if (label === "Air Conditioning") {
        return { Icon, bg: "bg-cyan-50", border: "border-cyan-200", icon: "text-cyan-700" };
    }
      if (label === "Mini Fridge") {
        return { Icon, bg: "bg-blue-50", border: "border-blue-200", icon: "text-blue-700" };
      }
      if (label === "Heating") {
        return { Icon, bg: "bg-orange-50", border: "border-orange-200", icon: "text-orange-700" };
    }
      if (label === "Couches") {
        return { Icon, bg: "bg-purple-50", border: "border-purple-200", icon: "text-purple-700" };
    }
      if (label === "Chair") {
        return { Icon, bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-700" };
      }
      // Default for other amenities
      return { Icon, bg: "bg-slate-50", border: "border-slate-200", icon: "text-slate-700" };
    }
    // Fallback for unknown amenities
    return { Icon: Tags, bg: "bg-slate-50", border: "border-slate-200", icon: "text-slate-700" };
  })();
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") onTouchHint(label);
      }}
      className={[
        "group relative inline-flex items-center justify-center rounded-full border",
        meta.bg,
        meta.border,
        "h-9 w-9",
        "shadow-sm shadow-transparent",
        "motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out",
        "hover:bg-white hover:border-slate-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-sm",
        "active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
      ].join(" ")}
      aria-label={label}
      title={label}
    >
      <Icon className={["w-5 h-5 transition-colors", meta.icon, "group-hover:text-[#02665e]"].join(" ")} aria-hidden />
    </button>
  );

}
