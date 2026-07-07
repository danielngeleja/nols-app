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

} from "lucide-react";

import LogoSpinner from "@/components/LogoSpinner";

import DatePicker from "../../../../components/ui/DatePicker";

import { PropertyVisualizationPreview } from "@/app/(owner)/owner/properties/add/_components/PropertyVisualizationPreview";

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
    <Image
      src={imageSrc}
      alt={alt}
      fill
      className={className}
      sizes={sizes}
      priority={priority}
      unoptimized={bypassNextOptimizer}
    />
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
      <Image src={src} alt={alt} width={32} height={32} className="h-[28px] w-[28px] object-contain" />
    </span>
  );

}

function PaymentModePill({ mode }: { mode: string }) {
  const m = String(mode || "").trim();
  const key = m.toLowerCase();
  const baseCls = [
    "group w-full inline-flex items-center gap-2 rounded-xl border px-3 py-2",
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
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full border border-white/10" />
        <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full border border-white/10" />
        <div className="absolute -bottom-16 -left-16 w-52 h-52 rounded-full border border-white/10" />
        <div className="absolute bottom-6 left-6 w-24 h-24 rounded-full border border-white/10" />
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
        className="absolute top-2 left-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow backdrop-blur-sm transition hover:bg-white"
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
        "group w-full inline-flex items-center gap-2 rounded-xl border px-3 py-2",
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
  return [p.city, p.district, p.regionName, p.country].filter(Boolean).join(", ");

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

}: {
  propertyId: number;
  onAvailability?: (data: any | null) => void;
  onDatesChange?: (checkIn: string, checkOut: string) => void;
  refreshSignal?: number;
  dates?: { checkIn: string; checkOut: string };

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
  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-white shadow-sm flex items-center justify-between"
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
                  <div className="absolute z-50 top-full left-0 mt-2 bg-white rounded-xl border-2 border-slate-200 shadow-xl">
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
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-white shadow-sm flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <div className="absolute z-50 top-full left-0 mt-2 bg-white rounded-xl border-2 border-slate-200 shadow-xl">
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
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {/* Availability Results */}
        {availability && !error && (
          <div className="mt-4 overflow-hidden rounded-3xl border border-[#02665e]/20 bg-white shadow-[0_16px_40px_rgba(2,102,94,0.18)]">
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
                    <div className="rounded-3xl border border-[#02665e]/15 bg-white p-4 shadow-[0_4px_16px_rgba(2,102,94,0.08)]">
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
                    <div className="rounded-3xl border border-[#02665e]/15 overflow-hidden bg-white">
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
                <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
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
  initialCheckIn,
  initialCheckOut,
  onClose,
  router,
}: {
  roomType: string;
  floor: number;
  propertyId: number;
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
  const bookUrl = `/public/booking/confirm?property=${propertyId}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`;

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
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-3">
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
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 py-3.5 text-sm font-semibold hover:bg-slate-50 active:scale-[0.98] transition-all"
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
  // Currency display context — presentation only, never affects charges.
  const [property, setProperty] = useState<PublicPropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewsData, setReviewsData] = useState<ReviewsResponse | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(0);
  const [reviewTitle, setReviewTitle] = useState<string>("");
  const [reviewComment, setReviewComment] = useState<string>("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitMsg, setReviewSubmitMsg] = useState<string | null>(null);
  const [showAllNearbyServices, setShowAllNearbyServices] = useState(false);
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
  const [roomQuickView, setRoomQuickView] = useState<null | { roomType: string; floor: number }>(null);
  const [, setAvailabilityData] = useState<any | null>(null);
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [allPhotosOpen, lightboxOpen]);
  useEffect(() => {
    if (!roomAmenityHint) return;
    const t = window.setTimeout(() => setRoomAmenityHint(null), 1200);
    return () => window.clearTimeout(t);
  }, [roomAmenityHint]);
  const openFromGrid = (idx: number) => {
    // Close grid first, then open lightbox to keep UX clean.
    setAllPhotosShown(false);
    setAllPhotosOpen(false);
    setActiveIdx(Math.max(0, Math.min(idx, lightboxImages.length - 1)));
    requestAnimationFrame(() => setLightboxOpen(true));
  };
  if (loading) {
    return (
      <main className="min-h-screen bg-white text-slate-900 header-offset">
        <div className="public-container py-8">
          <div className="h-8 w-28 bg-slate-100 animate-pulse rounded" />
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="aspect-[16/9] bg-slate-100 animate-pulse rounded-2xl" />
              <div className="mt-4 h-6 w-2/3 bg-slate-100 animate-pulse rounded" />
              <div className="mt-2 h-4 w-1/2 bg-slate-100 animate-pulse rounded" />
            </div>
            <div className="rounded-2xl border border-slate-200 p-5">
              <div className="h-6 w-1/2 bg-slate-100 animate-pulse rounded" />
              <div className="mt-3 h-10 bg-slate-100 animate-pulse rounded-xl" />
            </div>
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
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6">
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
        <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white border border-slate-100 shadow-[0_4px_24px_rgba(2,102,94,0.10)]">
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
                          className="absolute right-0 top-full mt-2 w-56 max-w-none rounded-2xl border border-slate-200/60 bg-white/95 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 z-50 overflow-hidden transform transition-all duration-200 origin-top-right"
                          style={{ maxWidth: "none" }}
                        >
                          <div className="p-3 grid gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              const url = window.location.href;
                              navigator.clipboard.writeText(url).then(() => {
                                setCopyLinkSuccess(true);
                                setTimeout(() => setCopyLinkSuccess(false), 2000);
                              });
                              setShowShareMenu(false);
                              if (property?.id && isFavorite) {
                                try {
                                  await fetch(`/api/customer/saved-properties/${property.id}/share`, {
                                    method: "POST",
                                    credentials: "include",
                                  });
                                } catch (e) { /* Silently fail */ }
                              }
                            }}
                            className="group w-full flex items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm font-medium text-slate-800 transition-colors duration-200 hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
                          >
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-black/5">
                              <Copy className={`w-4 h-4 flex-shrink-0 transition-colors duration-200 ${copyLinkSuccess ? "text-[#02665e]" : "text-slate-600"}`} />
                            </span>
                            <span className={copyLinkSuccess ? "font-semibold text-[#02665e]" : ""}>{copyLinkSuccess ? "Link copied!" : "Copy link"}</span>
                          </button>
                          <a
                            href={`mailto:?subject=${encodeURIComponent(property.title)}&body=${encodeURIComponent(window.location.href)}`}
                            onClick={async () => {
                              setShowShareMenu(false);
                              if (property?.id && isFavorite) {
                                try {
                                  await fetch(`/api/customer/saved-properties/${property.id}/share`, { method: "POST", credentials: "include" });
                                } catch (e) { /* Silently fail */ }
                              }
                            }}
                            className="group w-full flex items-center gap-3 rounded-xl border border-amber-200/60 bg-amber-50/70 px-3 py-2.5 text-sm font-medium text-amber-900 transition-colors duration-200 hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 no-underline"
                          >
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-amber-900/10">
                              <Mail className="w-4 h-4 flex-shrink-0 text-amber-700 transition-colors duration-200" />
                            </span>
                            <span>Email</span>
                          </a>
                          <a
                            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`}
                            target="_blank" rel="noopener noreferrer"
                            onClick={async () => {
                              setShowShareMenu(false);
                              if (property?.id && isFavorite) {
                                try {
                                  await fetch(`/api/customer/saved-properties/${property.id}/share`, { method: "POST", credentials: "include" });
                                } catch (e) { /* Silently fail */ }
                              }
                            }}
                            className="group w-full flex items-center gap-3 rounded-xl border border-blue-200/60 bg-blue-50/70 px-3 py-2.5 text-sm font-medium text-blue-900 transition-colors duration-200 hover:bg-blue-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 no-underline"
                          >
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-blue-900/10">
                              <Facebook className="w-4 h-4 flex-shrink-0 text-blue-700 transition-colors duration-200" />
                            </span>
                            <span>Facebook</span>
                          </a>
                          <a
                            href={`https://wa.me/?text=${encodeURIComponent(`${property.title} - ${window.location.href}`)}`}
                            target="_blank" rel="noopener noreferrer"
                            onClick={async () => {
                              setShowShareMenu(false);
                              if (property?.id && isFavorite) {
                                try {
                                  await fetch(`/api/customer/saved-properties/${property.id}/share`, { method: "POST", credentials: "include" });
                                } catch (e) { /* Silently fail */ }
                              }
                            }}
                            className="group w-full flex items-center gap-3 rounded-xl border border-emerald-200/60 bg-emerald-50/70 px-3 py-2.5 text-sm font-medium text-emerald-900 transition-colors duration-200 hover:bg-emerald-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 no-underline"
                          >
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-emerald-900/10">
                              <MessageSquare className="w-4 h-4 flex-shrink-0 text-emerald-700 transition-colors duration-200" />
                            </span>
                            <span>WhatsApp</span>
                          </a>
                          <a
                            href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(property.title)}`}
                            target="_blank" rel="noopener noreferrer"
                            onClick={async () => {
                              setShowShareMenu(false);
                              if (property?.id && isFavorite) {
                                try {
                                  await fetch(`/api/customer/saved-properties/${property.id}/share`, { method: "POST", credentials: "include" });
                                } catch (e) { /* Silently fail */ }
                              }
                            }}
                            className="group w-full flex items-center gap-3 rounded-xl border border-sky-200/60 bg-sky-50/70 px-3 py-2.5 text-sm font-medium text-sky-900 transition-colors duration-200 hover:bg-sky-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 no-underline"
                          >
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-sky-900/10">
                              <Twitter className="w-4 h-4 flex-shrink-0 text-sky-700 transition-colors duration-200" />
                            </span>
                            <span>Twitter</span>
                          </a>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {/* Title + location */}
              <div className="mb-5">
                <p className="text-[10px] sm:text-xs font-bold tracking-[0.20em] uppercase mb-2" style={{ color: '#02665e' }}>
                  Property
                </p>
                <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight leading-[1.1] text-slate-900">
                  {property.title}
                </h1>
                {location && (
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                    <span className="text-sm font-medium text-slate-500 truncate">{location}</span>
                  </div>
                )}
              </div>
              {/* Verified by NoLSAF strip */}
              <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(2,102,94,0.05)', border: '1px solid rgba(2,102,94,0.12)' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="inline-flex h-7 w-7 items-center justify-center rounded-full flex-shrink-0" style={{ background: 'linear-gradient(135deg,#10b981,#059669)', boxShadow: '0 3px 8px rgba(16,185,129,0.30)' }}>
                    <CheckCircle className="w-4 h-4 text-white" strokeWidth={2.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 leading-tight">Verified by NoLSAF</p>
                    <p className="text-[11px] mt-0.5 text-slate-500 leading-relaxed">
                      Physical site visit . location &amp; documentation review
                    </p>
                  </div>
                </div>
                <Link
                  href="/verification-policy"
                  className="flex-shrink-0 text-[11px] font-semibold whitespace-nowrap no-underline hover:underline"
                  style={{ color: '#02665e' }}
                >
                  Learn more
                </Link>
              </div>
            </div>
          </div>
        </div>
        {/* Gallery */}
        <div className="mt-6">
          {hero ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl overflow-hidden border border-slate-200">
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl overflow-hidden border border-slate-200">
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
                    <div className="h-14 w-14 rounded-2xl bg-white/85 border border-slate-200 shadow-sm flex items-center justify-center">
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
            {/* Facts */}
            <div className="flex items-stretch rounded-xl bg-[#02665e] overflow-hidden divide-x divide-white/10 shadow-sm">
              <div className="relative flex items-center gap-2.5 px-4 py-3 flex-1 min-w-0 overflow-hidden">
                <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(135deg,rgba(255,255,255,0.13) 0px,rgba(255,255,255,0.13) 1.5px,transparent 1.5px,transparent 10px)" }} />
                <Users className="w-4 h-4 text-white/80 shrink-0 relative" />
                <div className="relative">
                  <div className="text-sm font-bold text-white leading-none tabular-nums">{property.maxGuests ?? "-"}</div>
                  <div className="text-[11px] text-white/60 mt-0.5">Guests</div>
                </div>
              </div>
              <div className="relative flex items-center gap-2.5 px-4 py-3 flex-1 min-w-0 overflow-hidden">
                <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(135deg,rgba(255,255,255,0.13) 0px,rgba(255,255,255,0.13) 1.5px,transparent 1.5px,transparent 10px)" }} />
                <BedDouble className="w-4 h-4 text-white/80 shrink-0 relative" />
                <div className="relative">
                  <div className="text-sm font-bold text-white leading-none tabular-nums">{property.totalBedrooms ?? "-"}</div>
                  <div className="text-[11px] text-white/60 mt-0.5">Bedrooms</div>
                </div>
              </div>
              <div className="relative flex items-center gap-2.5 px-4 py-3 flex-1 min-w-0 overflow-hidden">
                <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(135deg,rgba(255,255,255,0.13) 0px,rgba(255,255,255,0.13) 1.5px,transparent 1.5px,transparent 10px)" }} />
                <Bath className="w-4 h-4 text-white/80 shrink-0 relative" />
                <div className="relative">
                  <div className="text-sm font-bold text-white leading-none tabular-nums">{property.totalBathrooms ?? "-"}</div>
                  <div className="text-[11px] text-white/60 mt-0.5">Bathrooms</div>
                </div>
              </div>
              <div className="relative flex items-center gap-2.5 px-4 py-3 flex-1 min-w-0 overflow-hidden bg-white/10">
                <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(135deg,rgba(255,255,255,0.13) 0px,rgba(255,255,255,0.13) 1.5px,transparent 1.5px,transparent 10px)" }} />
                <ShieldCheck className="w-4 h-4 text-white/80 shrink-0 relative" />
                <div className="relative">
                  <div className="text-sm font-bold text-white leading-none">Verified</div>
                  <div className="text-[11px] text-white/60 mt-0.5">listing</div>
                </div>
              </div>
            </div>
            {/* Description */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                      aria-label={aboutExpanded ? "Show less" : "Read more"}
                    >
                      {aboutExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="p-5 sm:p-6">
                <div className="relative rounded-xl border border-slate-100 bg-white px-4 py-4">
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
            <div className="overflow-hidden rounded-2xl border border-[#02665e]/15 bg-white shadow-sm">
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
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#02665e]/20 bg-white text-[#02665e] shadow-sm hover:bg-[#02665e]/5"
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
                    className="flex items-center gap-4 rounded-2xl border border-[#02665e]/20 bg-[#02665e]/5 px-4 py-4 text-slate-950 no-underline transition hover:border-[#02665e]/30 hover:bg-[#02665e]/10"
                  >
                    <span className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-[#02665e]/20 bg-white text-[#02665e]">
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
                    className="mt-5 inline-flex items-center gap-2 rounded-xl border border-[#02665e]/20 bg-white px-4 py-2 text-sm font-semibold text-[#02665e] no-underline hover:bg-[#02665e]/5"
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
            {/* Payment Methods (mobile/tablet only; on large screens it sits in the right column) */}
            <div className="lg:hidden rounded-2xl border border-slate-200 bg-white p-5">
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
            {/* Payment Methods (large screens: right column, touches the right layout frame) */}
            <div className="hidden lg:block rounded-2xl border border-slate-200 bg-white p-5">
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
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm text-slate-600">Starting from</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                <PriceDisplay
                  amountTzs={finalBasePrice}
                  noteClassName="text-xs font-normal text-slate-500 mt-0.5"
                />
              </div>
              <div className="text-xs text-slate-500">per night</div>
              <button
                type="button"
                onClick={() => { const params = new URLSearchParams({ property: String(property.id) }); if (selectedDates.checkIn) params.set('checkIn', selectedDates.checkIn); if (selectedDates.checkOut) params.set('checkOut', selectedDates.checkOut); router.push(`/public/booking/confirm?${params.toString()}`); }}
                className="mt-4 w-full rounded-xl bg-[#02665e] text-white py-3 text-sm font-semibold hover:bg-[#014e47] transition-colors"
              >
                Request booking
              </button>
              <div className="mt-3 text-xs text-slate-600 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5" />
                <span className="italic">Secure your booking with NoLSAF-supported payment methods.</span>
              </div>
              {servicesByCategory.included.length > 0 || servicesByCategory.available.length > 0 ? (
                <div className="mt-5 rounded-2xl bg-slate-50/80 p-3 ring-1 ring-slate-200">
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
        {/* Availability Checker */}
        <PropertyAvailabilityChecker
          propertyId={property.id}
          onAvailability={(data) => setAvailabilityData(data)}
          onDatesChange={(checkIn, checkOut) => setSelectedDates({ checkIn, checkOut })}
          refreshSignal={availabilityRefreshTick}
          dates={selectedDates}
        />
        {/* Building visualization (owner-declared) */}
        {property.roomsSpec && property.roomsSpec.length > 0 && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0 bg-[#02665e]/10 border border-[#02665e]/15">
                  <Building2 className="w-[18px] h-[18px] text-[#02665e]" aria-hidden />
                </div>
                <div>
                  <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#02665e]">Property Structure</p>
                  <h2 className="text-sm font-bold text-slate-800 leading-tight">Building Layout</h2>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                Owner-declared
              </span>
            </div>
            {/* Content */}
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
                    showHeader={false}
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
            initialCheckIn={selectedDates.checkIn}
            initialCheckOut={selectedDates.checkOut}
            onClose={() => setRoomQuickView(null)}
            router={router}
          />
        )}
        {/* Rooms (full-width on large screens; no horizontal scroll) */}
        <div id="roomsSection" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
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
                  return (
                    <motion.div
                      key={r.roomType + '-' + idx}
                      transition={{ duration: 0.42, delay: idx * 0.07, ease: [0.2, 0.8, 0.2, 1] }}
                      className="group relative flex rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-300"
                    >
                      {/* Room index number */}
                      <div className="flex-shrink-0 w-10 flex items-start justify-center pt-5 select-none" aria-hidden>
                        <span className="text-2xl font-black text-slate-200 tabular-nums leading-none">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </div>
                      {/* Main content */}
                      <div className="flex-1 min-w-0 flex flex-col md:flex-row gap-0">
                        {/* Info block */}
                        <div className="flex-1 min-w-0 p-4 sm:p-5">
                          {/* Room type + count */}
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 text-base sm:text-lg font-bold text-slate-900">
                              <DoorClosed className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden />
                              {r.roomType}
                            </span>
                            {typeof r.roomsCount === 'number' && r.roomsCount > 0 && (
                              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 bg-slate-50 text-slate-700 ring-slate-200/60">
                                {r.roomsCount} {r.roomsCount === 1 ? 'room' : 'rooms'}
                              </span>
                            )}
                          </div>
                          {/* Bed type + dimensions */}
                          <div className="mt-2 flex items-start gap-1.5">
                            <BedDouble className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" aria-hidden />
                            <div>
                              <span className="text-sm text-slate-700">{r.bedsSummary}</span>
                              {getBedDimensions(r.bedsSummary) && (
                                <div className="text-xs text-slate-500 mt-0.5">{getBedDimensions(r.bedsSummary)}</div>
                              )}
                            </div>
                          </div>
                          {/* Description */}
                          {r.description ? (
                            <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
                              <p className="text-sm text-slate-700 leading-relaxed">{capWords(r.description, 220)}</p>
                            </div>
                          ) : null}
                          {/* Room amenities */}
                          {r.amenities.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {r.amenities.slice(0, 8).map((a) => (
                                <RoomAmenityChip key={a} label={a} activeHint={roomAmenityHint} onTouchHint={(label) => setRoomAmenityHint(label)} />
                              ))}
                            </div>
                          )}
                          {/* Bathroom */}
                          {(r.bathItems && r.bathItems.length > 0) ? (
                            <div className="mt-4 pt-3 border-t border-slate-100">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                                  <Bath className="w-3.5 h-3.5 text-slate-500" />
                                  Bathroom amenities
                                </div>
                                {r.bathPrivate === 'yes' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Lock className="w-3 h-3" /> Private
                                  </span>
                                )}
                                {r.bathPrivate === 'no' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                    <Share2 className="w-3 h-3" /> Shared
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {r.bathItems.map((item) => (
                                  <RoomAmenityChip key={item} label={item} activeHint={roomAmenityHint} onTouchHint={(label) => setRoomAmenityHint(label)} />
                                ))}
                              </div>
                            </div>
                          ) : r.bathPrivate === 'yes' || r.bathPrivate === 'no' ? (
                            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                              <Bath className="w-3.5 h-3.5 text-slate-500" />
                              {r.bathPrivate === 'yes' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <Lock className="w-3 h-3" /> Private bathroom
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  <Share2 className="w-3 h-3" /> Shared bathroom
                                </span>
                              )}
                            </div>
                          ) : null}
                          {/* Policies row */}
                          {r.policies.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                              {r.policies.slice(0, 4).map((pol, i) => (
                                <div key={i} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                                  {pol.Icon && <pol.Icon className={`w-3.5 h-3.5 flex-shrink-0 ${pol.iconColor || 'text-slate-500'}`} aria-hidden />}
                                  <span>{pol.text}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* CTA strip: row on mobile, col on desktop */}
                        <div className="flex-shrink-0 w-full md:w-52 flex flex-row items-center gap-3 md:flex-col md:items-stretch md:justify-between md:border-l border-t md:border-t-0 border-slate-100 px-4 py-3 md:p-5">
                          <div className="flex-1 min-w-0">
                            <PriceDisplay
                              amountTzs={r.pricePerNight}
                              className="text-base md:text-xl font-black text-slate-900 tabular-nums leading-tight"
                              noteClassName="text-xs font-normal text-slate-500 mt-0.5"
                            />
                            <div className="text-xs text-slate-500">per night</div>
                            {r.discountLabel ? (<div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><Tags className="w-2.5 h-2.5" aria-hidden />{r.discountLabel}</div>) : (<div className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-400">No discount</div>)}
                          </div>
                          <div className="flex-shrink-0 flex flex-col items-center gap-1">
                            <button type="button" onClick={() => { const params = new URLSearchParams({ property: String(property.id) }); if (r.roomCode) { params.set('roomCode', r.roomCode); } else { const roomIndex = rows.findIndex((row) => row === r); if (roomIndex >= 0) params.set('roomIndex', String(roomIndex)); } router.push(`/public/booking/confirm?${params.toString()}`); }} className="inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-[#02665e] to-[#014e47] px-5 py-2 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:shadow-md hover:from-[#027a70] hover:to-[#02665e] active:scale-[0.97] md:w-full">Pay now</button>
                            <span className="text-center text-[10px] text-slate-400">Secure checkout</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            );
          })()}
        </div>
        {/* Reviews (bottom section) */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
              <MessageSquare className="w-5 h-5" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold text-slate-900">Guest reviews</h2>
              </div>
          {reviewsError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {reviewsError}
            </div>
          ) : reviewsLoading ? (
            <div className="mt-4 text-sm text-slate-600">Loading reviews...</div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                {(() => {
                  const avgRating = Number(reviewsData?.stats?.averageRating ?? 0);
                  const totalReviews = reviewsData?.stats?.totalReviews ?? 0;
                  const ratingPercent = (avgRating / 5) * 100;
                  const getRatingLabel = (rating: number) => {
                    if (rating >= 9) return "Wonderful";
                    if (rating >= 8) return "Very good";
                    if (rating >= 7) return "Good";
                    if (rating >= 6) return "Pleasant";
                    return "Fair";
                  };
                  return (
                    <>
                      <div className="inline-flex items-center justify-center rounded-lg bg-[#02665e] text-white px-3 py-1.5 min-w-[3rem]">
                        <span className="text-lg font-bold">{avgRating > 0 ? avgRating.toFixed(1) : "0.0"}</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          {avgRating > 0 && (
                            <span className="font-medium">{getRatingLabel(avgRating)}</span>
                          )}
                          <span className="text-slate-500"> - </span>
                          <span>{totalReviews} {totalReviews === 1 ? 'review' : 'reviews'}</span>
                        </div>
                        <div className="mt-2 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-[#02665e] rounded-full transition-all duration-300 rating-bar`}
                            data-rating-width={ratingPercent}
                          ></div>
                        </div>
                      </div>
                    </>
                  );
                })()}
          </div>
              {/* Categories */}
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Categories:</h3>
                <div className="grid grid-cols-2 gap-4">
                  {(() => {
                    const categories = [
                      { key: "customerCare", label: "Customer care" },
                      { key: "security", label: "Security" },
                      { key: "reality", label: "Reality" },
                      { key: "comfort", label: "Comfort" },
                    ];
                    return categories.map(({ key, label }) => {
                      const categoryRating = reviewsData?.stats?.categoryAverages?.[key] ?? 0;
                      const ratingPercent = (categoryRating / 5) * 100;
                      const barColor = categoryRating >= 8 ? "bg-emerald-500" : categoryRating >= 6 ? "bg-[#02665e]" : "bg-slate-400";
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-700 mb-1.5">{label}</div>
                            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${barColor} rounded-full transition-all duration-300 rating-bar-width`}
                                data-rating-width={ratingPercent}
                              />
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-slate-900 min-w-[2.5rem] text-right">
                            {categoryRating > 0 ? categoryRating.toFixed(1) : "0.0"}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
              {!reviewsLoading && (reviewsData?.reviews?.length ?? 0) === 0 && (
                <div className="mt-4 text-sm text-slate-600">
                  No reviews yet. Be the first to leave a review.
                </div>
              )}
            </>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
            {(reviewsData?.reviews ?? []).slice(0, 20).map((r) => (
              <ReviewCard key={r.id} review={r} />
            ))}
          </div>
          {/* Leave a review */}
          {!isOwner ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-sm font-semibold text-slate-900">Leave a review</div>
            <div className="mt-1 text-xs text-slate-600">You can rate and comment. If you're not logged in, we'll ask you to log in first.</div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Rating</label>
                <div className="flex items-center gap-3">
              <StarPicker value={reviewRating} onChange={setReviewRating} />
                  {reviewRating > 0 && (
                    <span className="text-sm text-slate-600">
                      {reviewRating === 5 ? "Excellent" : reviewRating === 4 ? "Very good" : reviewRating === 3 ? "Good" : reviewRating === 2 ? "Fair" : "Poor"}
                    </span>
                  )}
                </div>
            </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Title <span className="text-slate-400 font-normal">(optional)</span>
                </label>
              <input
                value={reviewTitle}
                onChange={(e) => setReviewTitle(e.target.value)}
                  placeholder="Give your review a title"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-colors"
              />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Your review</label>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Share details about your experience..."
                rows={4}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] resize-y transition-colors"
              />
            </div>
              {/* Category Ratings */}
              <div className="pt-2 border-t border-slate-200">
                <label className="block text-sm font-semibold text-slate-900 mb-4">Rate by category</label>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: "customerCare" as const, label: "Customer care" },
                    { key: "security" as const, label: "Security" },
                    { key: "reality" as const, label: "Reality" },
                    { key: "comfort" as const, label: "Comfort" },
                  ].map(({ key, label }) => (
                    <div key={key} className="space-y-2">
                      <div className="text-xs font-medium text-slate-700">{label}</div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden relative">
                          <div
                            className="h-full bg-[#02665e] rounded-full transition-all duration-200 category-rating-bar"
                            data-width={categoryRatings[key]}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setCategoryRatings((prev) => ({ ...prev, [key]: n }))}
                              className={`w-5 h-5 rounded border flex items-center justify-center text-xs transition-colors ${
                                n <= categoryRatings[key]
                                  ? "bg-amber-50 border-amber-300 text-amber-600"
                                  : "bg-white border-slate-200 text-slate-300 hover:border-slate-300"
                              }`}
                              aria-label={`${n} star for ${label}`}
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                              </svg>
                            </button>
                          ))}
                        </div>
                        <span className="text-xs font-semibold text-slate-700 min-w-[2rem] text-right">
                          {categoryRatings[key] > 0 ? categoryRatings[key].toFixed(1) : "0.0"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {reviewSubmitMsg && (
                <div className={`rounded-lg p-3 text-sm ${
                  reviewSubmitMsg.includes("Thanks") || reviewSubmitMsg.includes("submitted")
                    ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                    : "bg-rose-50 border border-rose-200 text-rose-700"
                }`}>
                  {reviewSubmitMsg}
                </div>
              )}
              <div className="pt-2">
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
                  className="w-full rounded-lg bg-[#02665e] text-white px-4 py-2.5 text-sm font-semibold hover:bg-[#014e47] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow"
              >
                {reviewSubmitting ? "Submitting..." : "Submit review"}
                {reviewSubmitting ? "Submitting..." : "Submit review"}
              </button>
            </div>
          </div>
          </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-900">Leave a review</div>
              <div className="mt-2 text-xs text-slate-600">
                As the property owner, you cannot leave reviews on your own property. However, you can still book this property like any other user.
              </div>
            </div>
          )}
        </div>
        {/* House Rules Section */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm nols-entrance overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center gap-3 px-5 sm:px-6 py-4 bg-gradient-to-r from-[#02665e]/5 to-transparent border-b border-slate-100">
            <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
              <Home className="w-5 h-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">House Rules</h2>
              <p className="text-xs text-slate-400 mt-0.5">Review before you book</p>
            </div>
          </div>
          {houseRules ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-0">
              {/* Column 1: Check-in & Check-out */}
              <div className="p-4 sm:p-6 border-r border-b md:border-b-0 border-slate-100">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#02665e]/10">
                    <Clock className="w-3.5 h-3.5 text-[#02665e]" />
                  </span>
                  <h3 className="text-[11px] font-bold text-[#02665e] uppercase tracking-widest">Check-in & Check-out</h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-[#02665e] flex items-center justify-center shadow-sm">
                      <LogIn className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">Check-in</div>
                      <div className="text-sm font-semibold text-slate-800 mt-0.5">
                        {houseRules.checkIn ? houseRules.checkIn : <span className="text-slate-400 font-normal text-xs">Not specified</span>}
                      </div>
                    </div>
                  </div>
                  <div className="pl-[18px]">
                    <div className="w-px h-4 border-l-2 border-dashed border-[#02665e]/20" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-rose-500 flex items-center justify-center shadow-sm">
                      <LogOut className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">Check-out</div>
                      <div className="text-sm font-semibold text-slate-800 mt-0.5">
                        {houseRules.checkOut ? houseRules.checkOut : <span className="text-slate-400 font-normal text-xs">Not specified</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Column 2: Policies */}
              <div className="p-4 sm:p-6 border-b md:border-b-0 md:border-r border-slate-100">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#02665e]/10">
                    <Users className="w-3.5 h-3.5 text-[#02665e]" />
                  </span>
                  <h3 className="text-[11px] font-bold text-[#02665e] uppercase tracking-widest">Policies</h3>
                </div>
                <div className="space-y-3">
                  {houseRules.pets !== undefined ? (
                    <div className="flex items-start gap-3">
                      <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full shadow-sm ${houseRules.pets ? 'bg-[#02665e]' : 'bg-rose-500'}`}>
                        {houseRules.pets ? <CheckCircle2 className="w-4 h-4 text-white" /> : <X className="w-4 h-4 text-white" />}
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-slate-700">Pets {houseRules.pets ? 'Allowed' : 'Not Allowed'}</div>
                        {houseRules.petsNote && <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{houseRules.petsNote}</div>}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-200">
                        <X className="w-4 h-4 text-slate-400" />
                      </span>
                      <div className="text-sm text-slate-400">Pets policy not specified</div>
                    </div>
                  )}
                  {houseRules.smoking !== undefined && (
                    <div className="flex items-start gap-3">
                      <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full shadow-sm mt-0.5 ${!houseRules.smoking ? 'bg-[#02665e]' : 'bg-rose-500'}`}>
                        {houseRules.smoking ? <CigaretteOff className="w-4 h-4 text-white" /> : <CheckCircle2 className="w-4 h-4 text-white" />}
                      </span>
                      <div className="text-sm font-semibold text-slate-700">Smoking {houseRules.smoking ? 'Not Allowed' : 'Allowed'}</div>
                    </div>
                  )}
                </div>
              </div>
              {/* Column 3: Safety Measures - spans 2 cols on small */}
              <div className="col-span-2 md:col-span-1 p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#02665e]/10">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#02665e]" />
                  </span>
                  <h3 className="text-[11px] font-bold text-[#02665e] uppercase tracking-widest">Safety Measures</h3>
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-2">
                  {[
                    "Keep property clean and well-maintained",
                    "Return all keys and access cards upon checkout",
                    "Report any incidents or damages immediately",
                    "Respect quiet hours and neighbors",
                    "Follow all posted safety guidelines",
                    ...(houseRules.safetyMeasures && Array.isArray(houseRules.safetyMeasures) ? houseRules.safetyMeasures : [])
                  ].map((measure: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] shadow-sm mt-0.5">
                        <CheckCircle2 className="w-3 h-3 text-white" />
                      </span>
                      <span className="text-sm text-slate-600 leading-relaxed">{measure}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="px-6 py-10 text-center">
              <div className="text-sm text-slate-400 italic">House rules will be available soon. The owner is setting up the rules for this property.</div>
            </div>
          )}
        </div>
        {/* Location & Map - Two column layout */}
        {property.latitude && property.longitude && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Nearby Services - Left Column (below map on mobile) */}
            <div className="space-y-6 order-2 lg:order-1">
                {/* Nearby Services - Detailed Cards */}
              {(() => {
                // Filter to only detailed facilities (with name)
                const detailedFacilities = nearbyFacilities.filter((f: any) => typeof f !== 'string' && f.name);
                

                if (detailedFacilities.length === 0) return null;
                

                // Show 2 by default, all when expanded
                const displayCount = showAllNearbyServices ? detailedFacilities.length : 2;
                const facilitiesToShow = detailedFacilities.slice(0, displayCount);
                const hasMore = detailedFacilities.length > 2;
                

                return (
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                        <MapPin className="w-5 h-5" aria-hidden />
                      </span>
                      <h2 className="text-lg font-semibold text-slate-900">Nearby Services</h2>
                    </div>
                    

                    <div className="space-y-3">
                      {facilitiesToShow.map((facility: any, idx: number) => {
                      

                      // Get icon based on facility type
                      const getFacilityIcon = (type: string) => {
                        const t = (type || "").toLowerCase();
                        if (t.includes("hospital") || t.includes("clinic") || t.includes("pharmacy") || t.includes("polyclinic")) {
                          return { Icon: Hospital, color: "text-rose-600", bgColor: "bg-rose-50" };
                        }
                        if (t.includes("petrol") || t.includes("fuel") || t.includes("gas")) {
                          return { Icon: Fuel, color: "text-orange-600", bgColor: "bg-orange-50" };
                        }
                        if (t.includes("airport")) {
                          return { Icon: Plane, color: "text-blue-600", bgColor: "bg-blue-50" };
                        }
                        if (t.includes("bus") || t.includes("station")) {
                          return { Icon: Bus, color: "text-amber-700", bgColor: "bg-amber-50" };
                        }
                        if (t.includes("road") || t.includes("main road")) {
                          return { Icon: Route, color: "text-slate-700", bgColor: "bg-slate-50" };
                        }
                        if (t.includes("police")) {
                          return { Icon: Shield, color: "text-indigo-600", bgColor: "bg-indigo-50" };
                        }
                        if (t.includes("conference") || t.includes("center") || t.includes("centre")) {
                          return { Icon: MapPin, color: "text-emerald-600", bgColor: "bg-emerald-50" };
                        }
                        return { Icon: MapPin, color: "text-[#02665e]", bgColor: "bg-[#02665e]/10" };
                      };
                      

                      const facilityIcon = getFacilityIcon(facility.type || "");
                      const Icon = facilityIcon.Icon;
                      

                      return (
                        <div 

                          key={idx} 

                          className="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all duration-300 ease-out hover:border-[#02665e]/30 hover:shadow-lg hover:shadow-[#02665e]/5 hover:-translate-y-0.5"
                        >
                          <div className="flex items-start gap-4">
                            {/* Icon - Enhanced with better styling */}
                            <div className={`flex-shrink-0 w-12 h-12 rounded-xl ${facilityIcon.bgColor} flex items-center justify-center shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:shadow-md`}>
                              <Icon className={`h-6 w-6 ${facilityIcon.color} transition-transform duration-300 group-hover:scale-110`} />
                            </div>
                            

                            {/* Content */}
                            <div className="flex-1 min-w-0 space-y-3">
                              {/* Name */}
                              {facility.name && (
                                <div className="font-bold text-slate-900 text-base leading-snug tracking-tight">{facility.name}</div>
                              )}
                              

                              {/* Tags Row - Enhanced styling */}
                              <div className="flex flex-wrap items-center gap-2">
                                {facility.type && (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-100/80 shadow-sm">
                                    {facility.type}
                                  </span>
                                )}
                                {facility.ownership && (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200/80 shadow-sm">
                                    {facility.ownership}
                                  </span>
                                )}
                              </div>
                              

                              {/* Distance & Link Row - Better spacing and styling */}
                              <div className="flex flex-wrap items-center gap-4 text-xs">
                                {typeof facility.distanceKm === 'number' && (
                                  <div className="inline-flex items-center gap-1.5 text-slate-700 font-semibold">
                                    <MapPin className="h-4 w-4 text-rose-500 flex-shrink-0" />
                                    <span>{facility.distanceKm} km</span>
                                  </div>
                                )}
                                {facility.url && (
                                  <a 

                                    href={facility.url} 

                                    target="_blank" 

                                    rel="noopener noreferrer" 

                                    className="inline-flex items-center gap-1.5 text-[#02665e] hover:text-[#014e47] font-semibold transition-all duration-200 hover:underline underline-offset-2"
                                  >
                                    <ExternalLink className="h-4 w-4 flex-shrink-0" />
                                    <span>Link</span>
                                  </a>
                                )}
                              </div>
                              

                              {/* Transportation - Enhanced with better visual separation */}
                              {Array.isArray(facility.reachableBy) && facility.reachableBy.length > 0 && (
                                <div className="pt-2.5 border-t border-slate-100/80">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-slate-500 font-semibold">Reachable by:</span>
                                    {facility.reachableBy.map((mode: string, mIdx: number) => (
                                      <span 

                                        key={mIdx} 

                                        className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-50 text-slate-700 text-xs font-medium border border-slate-200/60 shadow-sm transition-colors duration-200 group-hover:border-slate-300"
                                      >
                                        {mode}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                          

                          {/* Subtle accent line on hover */}
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-[#02665e]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        </div>
                      );
                      })}
                    </div>
                    

                    {/* Show More/Less Button */}
                    {hasMore && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => setShowAllNearbyServices(!showAllNearbyServices)}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 font-semibold text-sm transition-all duration-200 border border-slate-200 hover:border-slate-300"
                        >
                          {showAllNearbyServices ? (
                            <>
                              <span>Show less</span>
                              <ChevronUp className="h-4 w-4" />
                            </>
                          ) : (
                            <>
                              <span>Show more</span>
                              <ChevronDown className="h-4 w-4" />
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Simple Nearby Places (string format) */}
              {nearbyFacilities.length > 0 && nearbyFacilities.some((f: any) => typeof f === 'string' || (!f.name && f)) && (
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                      <MapPin className="w-5 h-5" aria-hidden />
                    </span>
                    <h2 className="text-lg font-semibold text-slate-900">Nearby Places</h2>
                  </div>
                  <div className="space-y-2">
                    {nearbyFacilities
                      .filter((f: any) => typeof f === 'string' || !f.name)
                      .slice(0, 8)
                      .map((facility: any, idx: number) => {
                        const facilityStr = typeof facility === 'string' ? facility : (facility?.label || String(facility));
                        const normalized = normalizeNearby([facilityStr]);
                        if (!normalized || normalized.length === 0) return null;
                        const item = normalized[0];
                        const { Icon, colorClass, title, detail } = item;
                        return (
                          <div key={idx} className="flex items-center gap-2 text-sm text-slate-700">
                            <Icon className={`w-4 h-4 ${colorClass} flex-shrink-0`} />
                            <span>{title}{detail ? `: ${detail}` : ''}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
              

              {/* Nearby Facilities (from services) */}
              {servicesByCategory.nearby.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                      <MapPin className="w-5 h-5" aria-hidden />
                    </span>
                    <h2 className="text-lg font-semibold text-slate-900">Nearby Facilities</h2>
                  </div>
                  <div className="space-y-2">
                    {servicesByCategory.nearby.slice(0, 6).map((item: string, idx: number) => {
                      const normalized = normalizeNearby([item]);
                      if (!normalized || normalized.length === 0) return null;
                      const { Icon, colorClass, title, detail } = normalized[0];
                      return (
                        <div key={idx} className="flex items-center gap-2 text-sm text-slate-700">
                          <Icon className={`w-4 h-4 ${colorClass} flex-shrink-0`} />
                          <span>{title}{detail ? `: ${detail}` : ''}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>
              {/* Interactive Map - Right Column (first on mobile) */}
              <div className="space-y-4 order-1 lg:order-2">
                {/* Location Header - Map Title */}
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                      <MapPin className="w-5 h-5" aria-hidden />
                    </span>
                    <h2 className="text-lg font-semibold text-slate-900">Location</h2>
                  </div>
                  <div className="text-sm text-slate-600">{location || "-"}</div>
                </div>
                {/* Map */}
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <PropertyMap 

                    latitude={property.latitude} 

                    longitude={property.longitude}
                    propertyTitle={property.title}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      {/* Lightbox */}
      {photoPortalReady && lightboxOpen && lightboxImages.length > 0 ? createPortal((
        <div
          className="fixed inset-0 z-[2147483647] bg-slate-950/92 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Photo gallery"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLightbox();
          }}
        >
          <div className="absolute inset-x-0 top-0 z-[2147483647] px-4 py-4">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold uppercase tracking-wide text-white">{property.title}</div>
                <div className="mt-0.5 text-xs text-white/65">{activeIdx + 1} of {lightboxImages.length} photos</div>
              </div>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/12 text-white shadow-lg backdrop-blur-md hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                onClick={closeLightbox}
                aria-label="Close photo gallery"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center px-3 pb-4 pt-24 sm:p-6 sm:pt-24">
            <div className="w-full max-w-6xl">
              <div className="mx-auto w-full max-w-4xl">
                <div className="relative h-[58vh] min-h-[300px] max-h-[620px] overflow-hidden rounded-2xl bg-slate-900 shadow-2xl ring-1 ring-white/10 sm:h-[64vh]">
                  <div className="absolute inset-0 scale-110 opacity-35 blur-2xl">
                    <PropertyGalleryImage src={lightboxImages[activeIdx]} alt="" sizes="100vw" className="object-cover" />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-black/5 to-black/25" />
                  <div className="relative h-full w-full">
                    <PropertyGalleryImage src={lightboxImages[activeIdx]} alt={`${property.title} photo ${activeIdx + 1}`} sizes="(min-width: 1024px) 900px, 100vw" className="object-contain" priority />
                  </div>
                  <button
                    type="button"
                    className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/35 text-white shadow-lg backdrop-blur-md hover:bg-black/55"
                    onClick={() => setActiveIdx((i) => (i <= 0 ? lightboxImages.length - 1 : i - 1))}
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/35 text-white shadow-lg backdrop-blur-md hover:bg-black/55"
                    onClick={() => setActiveIdx((i) => (i >= lightboxImages.length - 1 ? 0 : i + 1))}
                    aria-label="Next photo"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
              {/* Counter under photo (centered, like your sample) */}
              <div className="mt-3 text-center text-white/90 text-sm font-semibold">
                {activeIdx + 1} / {lightboxImages.length}
              </div>
              {/* Thumbnails strip */}
              <div className="mx-auto mt-4 flex w-full max-w-4xl gap-2 overflow-x-auto rounded-2xl bg-white/8 p-2 backdrop-blur-md sm:justify-center">
                {lightboxImages.map((src, i) => (
                  <button
                    key={`${src}-${i}`}
                    type="button"
                    className={[
                      "relative h-16 w-24 flex-shrink-0 overflow-hidden rounded-xl border bg-white/10 sm:h-20 sm:w-28",
                      i === activeIdx ? "border-white ring-2 ring-white/35" : "border-white/15 opacity-75",
                      "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
                      "motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.97]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                    ].join(" ")}
                    onClick={() => setActiveIdx(i)}
                    aria-label={`View photo ${i + 1}`}
                  >
                    <PropertyGalleryImage src={src} alt={`thumb ${i + 1}`} sizes="120px" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ), document.body) : null}
      {/* All photos (masonry/grid) */}
      {photoPortalReady && allPhotosOpen ? createPortal((
        <div
          className="fixed inset-0 z-[2147483647] bg-white"
          role="dialog"
          aria-modal="true"
          aria-label="All photos"
        >
          <div
            className={[
              "relative h-dvh w-full overflow-hidden bg-white",
              "flex flex-col",
              "transition-all duration-200 ease-out motion-reduce:transition-none",
              allPhotosShown ? "opacity-100" : "opacity-0",
            ].join(" ")}
          >
            {/* Sticky top bar (always visible) */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
              <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-base font-bold text-slate-950 sm:text-lg">All photos</div>
                  <div className="mt-1 text-xs text-slate-500 sm:text-sm">{lightboxImages.length.toLocaleString()} photos</div>
                </div>
                <button
                  type="button"
                  onClick={closeAllPhotos}
                  className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 sm:h-10 sm:w-10"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-y-auto bg-white">
              <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
                <div
                  className={[
                    "grid grid-cols-2 gap-2 sm:gap-3",
                    "transition-transform duration-200 ease-out motion-reduce:transition-none",
                    allPhotosShown ? "translate-y-0" : "translate-y-1",
                  ].join(" ")}
                >
                  {lightboxImages.map((src, i) => {
                    const isFeature = i % 3 === 0;
                    return (
                      <button
                        key={`${src}-${i}`}
                        type="button"
                        onClick={() => openFromGrid(i)}
                        className={[
                          "group relative w-full",
                          isFeature ? "col-span-2" : "",
                          "overflow-hidden rounded-xl bg-slate-100",
                          "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
                          "motion-safe:active:scale-[0.99]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                        ].join(" ")}
                        aria-label={`Open photo ${i + 1}`}
                      >
                        <div className={["relative w-full bg-slate-100", isFeature ? "aspect-[16/10]" : "aspect-[4/3]"].join(" ")}>
                          <PropertyGalleryImage
                            src={src}
                            alt={`${property.title} photo ${i + 1}`}
                            sizes={isFeature ? "(min-width: 1024px) 896px, 100vw" : "(min-width: 1024px) 440px, 50vw"}
                            className="object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
                          <div className="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                            {i + 1} / {lightboxImages.length}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </main>
  );

}

function ReviewCard({ review }: { review: PropertyReview }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const MAX_PREVIEW_LENGTH = 200;
  const comment = review.comment || "";
  const isLongComment = comment.length > MAX_PREVIEW_LENGTH;
  const previewText = isLongComment ? comment.slice(0, MAX_PREVIEW_LENGTH) + "..." : comment;
  return (
    <>
      <div className="group relative bg-white rounded-2xl border border-slate-200/60 hover:border-[#02665e]/40 hover:shadow-xl transition-all duration-300 overflow-hidden shadow-sm">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-2.5">
                <div className="text-lg font-bold text-slate-900 truncate">
                  {review.user?.name || "Guest"}
                </div>
                {review.isVerified && (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 text-[10px] font-bold text-emerald-700 flex-shrink-0 tracking-wide">
                    Verified
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5 text-xs text-slate-500">
                <div className="flex items-center">
                  <StarRow value={review.rating} />
                </div>
                <span className="text-slate-300">-</span>
                <span className="font-medium">{new Date(review.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
          {/* Title */}
          {review.title && (
            <div className="mb-4">
              <h3 className="text-base font-bold text-slate-900 leading-tight">{review.title}</h3>
            </div>
          )}
          {/* Comment */}
          {comment && (
            <div className="mb-4">
              <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-slate-200/80 p-5 shadow-inner">
                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap block font-normal">
                  {isExpanded ? comment : previewText}
                </p>
              </div>
              {isLongComment && !isExpanded && (
                <button
                  onClick={() => {
                    if (comment.length > 500) {
                      setShowModal(true);
                    } else {
                      setIsExpanded(true);
                    }
                  }}
                  className="mt-4 px-5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-sm font-semibold text-[#02665e] hover:bg-slate-50 hover:border-[#02665e]/40 hover:shadow-md transition-all duration-200 inline-flex items-center gap-2 active:scale-[0.98]"
                >
                  <span>Show more</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              )}
              {isLongComment && isExpanded && (
                <button
                  onClick={() => setIsExpanded(false)}
                  className="mt-4 px-5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-sm font-semibold text-[#02665e] hover:bg-slate-50 hover:border-[#02665e]/40 hover:shadow-md transition-all duration-200 inline-flex items-center gap-2 active:scale-[0.98]"
                >
                  <span>Show less</span>
                  <ChevronUp className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {/* Owner Response */}
          {review.ownerResponse && (
            <div className="mt-5 pt-5 border-t border-slate-200/60">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-[#02665e]/10 to-[#02665e]/5 border border-[#02665e]/20 flex items-center justify-center shadow-sm">
                  <MessageSquare className="w-5 h-5 text-[#02665e]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">Owner response</div>
                  <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap line-clamp-3">
                    {review.ownerResponse}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Expanded Modal for Very Long Reviews */}
      {showModal && (
        <ReviewModal review={review} onClose={() => setShowModal(false)} />
      )}
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
                <span className="inline-flex items-center rounded-full bg-white/20 border border-white/30 px-2.5 py-1 text-[11px] font-semibold flex-shrink-0">
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
              <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-slate-200/80 p-6 shadow-inner">
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

