"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { 
  MapPin, 
  Star, 
  Wifi, 
  Car, 
  UtensilsCrossed, 
  Dumbbell, 
  Waves, 
  AirVent,
  CheckCircle2,
  XCircle,
  Edit,
  Save,
  X,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  BedDouble,
  Bath,
  Users,
  Phone,
  Mail,
  Beer,
  Thermometer,
  Package,
  Shield,
  Bandage,
  FireExtinguisher,
  ShoppingBag,
  Store,
  PartyPopper,
  Gamepad,
  WashingMachine,
  Share2,
  Lock,
  BadgeCheck,
  Ban,
  FileText,
  ImageIcon,
  Eye,
  DoorClosed,
  Tags,
  Building2,
  Calendar,
  Clock,
  PawPrint,
  CigaretteOff,
  AlertCircle,
} from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";
import apiClient from "@/lib/apiClient";
import { ownerPropertyRefOrId, useOwnerPropertyHref } from "@/lib/ownerPropertyRefs";
import { motion } from "framer-motion";
import NeighborhoodGuide from "./NeighborhoodGuide";
import TableRow from "./TableRow";
import PropertyEditModal from "./PropertyEditModal";
import PropertyPinEditor from "./admin/PropertyPinEditor";
import AdminPinMap from "./admin/AdminPinMap";
import { PropertyPhotoGrid } from "./PropertyPhotoGrid";
import { PropertyPreviewError, PropertyPreviewSkeleton } from "./PropertyPreviewSkeleton";
import PropertyAuditHistory from "./admin/PropertyAuditHistory";
import NearbyServices from "./NearbyServices";
import ServicesAndFacilities from "./ServicesAndFacilities";
import { PropertyVisualizationPreview } from "../app/(owner)/owner/properties/add/_components/PropertyVisualizationPreview";
import { parseFloorUses } from "../app/(owner)/owner/properties/add/_components/floorUses";
import { 
  getPropertyCommission, 
  calculatePriceWithCommission,
} from "../lib/priceUtils";
import { BATHROOM_ICONS, OTHER_AMENITIES_ICONS } from "../lib/amenityIcons";
import {
  fmtMoney,
  capWords,
  getBedDimensions,
  formatTimeRange,
  normalizeRoomsSpec,
} from "../lib/propertyUtils";
import type {
  PropertyPreviewProps,
  Property,
  ReviewsData,
  AuditHistoryItem,
  RoomSpec,
  RoomSpecRow,
  Review,
} from "../lib/types/property";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

function canUseNextImageForSrc(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("/")) return true;
  if (!src.startsWith("http://") && !src.startsWith("https://")) return false;
  try {
    const url = new URL(src);
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host === "res.cloudinary.com") return true;
    if (host === "img.youtube.com") return true;
    if (host === "api.mapbox.com") return true;
    if (host.endsWith(".mapbox.com")) return true;
    return false;
  } catch {
    return false;
  }
}

function shouldBypassNextImageOptimizer(src: string): boolean {
  if (!src) return false;
  if (!src.startsWith("http://") && !src.startsWith("https://")) return false;
  try {
    const host = new URL(src).hostname;
    return host === "res.cloudinary.com" || host.endsWith(".cloudinary.com");
  } catch {
    return src.includes("cloudinary");
  }
}

function FillImage({
  src,
  alt,
  className,
  sizes,
  priority,
  unoptimized,
}: {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  unoptimized?: boolean;
}) {
  if (canUseNextImageForSrc(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        className={className}
        sizes={sizes}
        priority={priority}
        unoptimized={Boolean(unoptimized) || shouldBypassNextImageOptimizer(src)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}

// Utility functions and types are now imported from lib/propertyUtils and lib/types/property

// Icon mappings matching the owner's add page exactly
// Icon mappings are imported from shared source to ensure consistency with owner submissions
// DO NOT define custom icon mappings here - use the shared BATHROOM_ICONS and OTHER_AMENITIES_ICONS

// Icon mappings are imported from shared source to ensure consistency with owner submissions

// RoomAmenityChip component matching public view - icon-only with hover tooltip
/** "14:00 – 22:00", "From 14:00" or "Until 22:00" (as the owner wizard saves a window) into its two ends. */
function splitTimeWindow(value: unknown): { from: string; to: string } {
  const s = String(value ?? "").trim();
  if (!s) return { from: "", to: "" };
  const from = s.match(/^from\s+(.+)$/i);
  if (from) return { from: from[1].trim(), to: "" };
  const until = s.match(/^(until|by)\s+(.+)$/i);
  if (until) return { from: "", to: until[2].trim() };
  const parts = s.split(/\s*[–—-]\s*|\s+to\s+/i).map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? { from: parts[0], to: parts[1] } : { from: s, to: "" };
}

/**
 * One shape for house rules, whichever way they were saved: the wizard's saved
 * keys (checkIn, checkOut, pets, smoking) or its working keys (checkInFrom,
 * checkInTo, petsAllowed, smokingNotAllowed). Unknown keys are kept.
 */
function normalizeHouseRules(raw: any): any {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const bool = (...values: unknown[]) => {
    for (const v of values) {
      if (typeof v === "boolean") return v;
      if (v === "true") return true;
      if (v === "false") return false;
    }
    return null;
  };
  const inWin = splitTimeWindow(raw.checkIn);
  const outWin = splitTimeWindow(raw.checkOut);
  return {
    ...raw,
    checkInFrom: String(raw.checkInFrom || inWin.from || ""),
    checkInTo: String(raw.checkInTo || inWin.to || ""),
    checkOutFrom: String(raw.checkOutFrom || outWin.from || ""),
    checkOutTo: String(raw.checkOutTo || outWin.to || ""),
    petsAllowed: bool(raw.petsAllowed, raw.pets),
    smokingNotAllowed: bool(raw.smokingNotAllowed, raw.smoking),
    other: String(raw.other || ""),
  };
}

/** A check-in or check-out window as a short phrase: "2:00 PM - 10:00 PM", "From 2:00 PM", "Until 10:00 AM". */
function windowPhrase(from: string, to: string, lead: "From" | "By"): string | null {
  // One time in the same 12-hour form a range uses ("14:00" -> "2:00 PM").
  const one = (t: string) => (/^\d{1,2}:\d{2}$/.test(t) ? String(formatTimeRange(t, t)).split(" - ")[0] : t);
  if (from && to) return formatTimeRange(from, to);
  if (from) return `${lead === "By" ? "By" : "From"} ${one(from)}`;
  if (to) return `${lead === "By" ? "By" : "Until"} ${one(to)}`;
  return null;
}

/** A long-stay amenity with its name written out: the tenant signs for exactly this list. */
function LabeledAmenity({ label }: { label: string }) {
  const Icon = BATHROOM_ICONS[label] || OTHER_AMENITIES_ICONS[label] || CheckCircle2;
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-md border border-solid border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] text-slate-700">
      <Icon className="h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
      <span className="truncate" title={label}>{label}</span>
    </li>
  );
}

/** Sentences that appear more than once, a sign the owner pasted the same text again. */
function repeatedSentences(text: string): number {
  const parts = text.split(/(?<=[.!?])\s+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 12);
  return parts.length - new Set(parts).size;
}

function comparableRoomText(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function uniqueRoomLabels(labels: string[]) {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = comparableRoomText(label);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function roomReviewEntries(rooms: RoomSpec[]) {
  const seen = new Map<string, number>();
  const entries = rooms.map((room) => ({
    code: [room?.code, room?.roomCode].find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim(),
    duplicate: false,
  }));

  rooms.forEach((room, index) => {
    const { code } = entries[index];
    if (!room) return;
    // Older rows have no code. Compare their full saved data, including floor allocation.
    const key = code ? `code:${comparableRoomText(code)}` : `spec:${JSON.stringify(room, (_field, value) => (
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, value[name]]))
        : value
    ))}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index);
    else {
      entries[first].duplicate = true;
      entries[index].duplicate = true;
    }
  });
  return entries;
}

function RoomReviewRow({ row: r, nightly }: {
  row: RoomSpecRow;
  nightly?: { currency?: string | null; code?: string; duplicate: boolean; listingDescription?: string; smoking?: string };
}) {
  const [open, setOpen] = useState(false);
  const description = r.description.trim();
  const repeatsListing = Boolean(nightly && description && comparableRoomText(description) === comparableRoomText(nightly.listingDescription));
  const repeats = description ? repeatedSentences(description) : 0;
  const long = description.length > 320;
  const bath = nightly ? uniqueRoomLabels(r.bathItems) : [...new Set(r.bathItems)];
  const amenities = nightly
    ? uniqueRoomLabels(r.amenities).filter((label) => !bath.some((item) => comparableRoomText(item) === comparableRoomText(label)))
    : [...new Set(r.amenities)];
  const bedDimensions = nightly ? getBedDimensions(r.bedsSummary) : null;
  const groups = [
    { key: "room", title: nightly ? "Room amenities" : "In the home", items: amenities },
    { key: "bath", title: "Bathroom", items: bath },
  ].filter((g) => g.items.length);
  return (
    <div className="grid gap-5 border-0 border-t border-solid border-slate-100 px-5 py-5 first:border-t-0 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <p className="m-0 flex flex-wrap items-center gap-2 break-words text-[15px] font-semibold text-slate-900">
          {r.roomType}
          {typeof r.roomsCount === "number" && r.roomsCount > (nightly ? 0 : 1) ? <span className="shrink-0 rounded-full border border-solid border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{nightly ? `${r.roomsCount} ${r.roomsCount === 1 ? "room" : "rooms"}` : `x${r.roomsCount}`}</span> : null}
        </p>
        {nightly?.code ? <p className="m-0 break-words text-[11px] text-slate-500">{nightly.code}</p> : null}
        {nightly ? (
          <div className="rounded-lg border border-solid border-[#02665e]/10 bg-[#02665e]/5 px-3 py-2.5">
            <p className="m-0 text-sm font-bold text-[#02665e]">
              {r.pricePerNight != null && r.pricePerNight > 0 ? <>{fmtMoney(r.pricePerNight, nightly.currency)} <span className="text-xs font-normal text-slate-600">per night</span></> : "Nightly rate missing"}
            </p>
            <p className="m-0 mt-1 text-xs text-slate-600">{r.discountLabel || "No discount"}</p>
          </div>
        ) : null}
        <dl className="m-0 space-y-2 rounded-lg bg-slate-50 p-3 text-[12.5px]">
          <div className="flex items-start gap-2">
            <BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <div>
              <dt className="text-[11px] font-semibold text-slate-500">Beds</dt>
              <dd className="m-0 text-slate-700">
                {r.bedsSummary === "—" ? "Not stated" : r.bedsSummary}
                {bedDimensions ? <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[11px] text-slate-500">
                  {bedDimensions.split(" • ").map((dimensions) => <li key={dimensions}>{dimensions}</li>)}
                </ul> : null}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-2"><Bath className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden /><div><dt className="text-[11px] font-semibold text-slate-500">Bathroom</dt><dd className="m-0 text-slate-700">{r.bathPrivate === "yes" ? "Private" : r.bathPrivate === "no" ? "Shared" : "Not stated"}</dd></div></div>
          {!nightly ? <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden /><div><dt className="text-[11px] font-semibold text-slate-500">Comes with</dt><dd className="m-0 text-slate-700">{amenities.length + bath.length} {amenities.length + bath.length === 1 ? "item" : "items"}</dd></div></div> : null}
        </dl>
      </div>
      <div className="min-w-0 space-y-4">
        {nightly?.duplicate ? (
          <p className="m-0 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {nightly.code ? "Another room entry uses this code." : "Another room entry has the same saved details."}
          </p>
        ) : null}
        <div>
          <p className="m-0 mb-1 text-[11.5px] font-semibold text-slate-500">Description</p>
          {repeatsListing ? <p className="m-0 text-[13px] text-slate-600">Matches the listing description in About this place.</p> : description ? (
            <>
              <p className={`m-0 whitespace-pre-line text-[13.5px] leading-6 text-slate-700 ${!open && long ? "line-clamp-4" : ""}`}>{description}</p>
              {long ? (
                <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline [font-family:inherit]">
                  {open ? "Show less" : "Read all"}
                </button>
              ) : null}
              {repeats > 0 ? (
                <p className="m-0 mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />The description repeats itself ({repeats} {repeats === 1 ? "sentence" : "sentences"} again). Ask the landlord to rewrite it before approving.
                </p>
              ) : null}
            </>
          ) : <p className="m-0 text-[13px] italic text-slate-400">No description</p>}
        </div>
        {groups.length ? groups.map((g) => (
          <div key={g.key}>
            <p className="m-0 mb-2 text-[11.5px] font-semibold text-slate-500">{g.title} <span className="font-normal text-slate-400">({g.items.length})</span></p>
            <ul className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 sm:grid-cols-3 xl:grid-cols-4">
              {g.items.map((a) => <LabeledAmenity key={a} label={a} />)}
            </ul>
          </div>
        )) : <p className="m-0 text-[13px] italic text-slate-400">No amenities ticked</p>}
        {nightly && r.policies.some((policy) => policy.text !== "—") ? (
          <div>
            <p className="m-0 mb-2 text-[11.5px] font-semibold text-slate-500">Room policies</p>
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12.5px] text-slate-700">
              {r.policies.map((policy) => <li key={policy.text} className="inline-flex items-center gap-1.5">
                {policy.Icon ? <policy.Icon className={`h-3.5 w-3.5 shrink-0 ${policy.iconColor || "text-slate-500"}`} aria-hidden /> : null}
                {policy.text === "Smoking" && nightly.smoking === "yes" ? "Smoking allowed" : policy.text === "Smoking" && nightly.smoking === "no" ? "Smoke-free" : policy.text}
              </li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RoomAmenityChip({ label }: { label: string }) {
  // Use exact match from the owner's icon mappings first
  const Icon = BATHROOM_ICONS[label] || OTHER_AMENITIES_ICONS[label] || Tags;
  
  // Determine colors based on icon type (matching public view logic)
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

// PropertyPreviewProps is now imported from lib/types/property

export default function PropertyPreview({ 
  propertyId, 
  mode = "public",
  onApproved,
  onRejected,
  onUpdated,
  onClose,
  rentalMode,
  reviewChecks,
  reviewPending,
  adminTop,
}: PropertyPreviewProps) {
  const [showChecks, setShowChecks] = useState(false);
  const ownerPropertyHref = useOwnerPropertyHref();
  const [property, setProperty] = useState<Property | null>(null);
  // A long stay rents the whole home by the month: no nightly price, no check-in times.
  const isLongStay = rentalMode === "LONG_STAY" || (property as any)?.rentalMode === "LONG_STAY";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState<null | { kind: "success" | "error" | "info"; title: string; body?: string }>(null);
  // Success toasts close themselves; errors stay until dismissed
  useEffect(() => {
    if (!adminNotice || adminNotice.kind === "error") return;
    const id = window.setTimeout(() => setAdminNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [adminNotice]);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Property> | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);
  const [rejectReasons, setRejectReasons] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [notifyOwnerOnSuspend, setNotifyOwnerOnSuspend] = useState(true);
  const [unsuspendReason, setUnsuspendReason] = useState("");
  const [showUnsuspendDialog, setShowUnsuspendDialog] = useState(false);
  const [displayPhotos, setDisplayPhotos] = useState<string[]>([]);
  const [showShareMenu, setShowShareMenu] = useState<boolean>(false);
  const [reviews, setReviews] = useState<ReviewsData | null>(null);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [systemCommission, setSystemCommission] = useState<number>(0);
  const [auditHistory, setAuditHistory] = useState<AuditHistoryItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showCoordinateDialog, setShowCoordinateDialog] = useState(false);
  const [coordinateLatitude, setCoordinateLatitude] = useState("");
  const [coordinateLongitude, setCoordinateLongitude] = useState("");
  const [coordinateReason, setCoordinateReason] = useState("");
  const [savingCoordinates, setSavingCoordinates] = useState(false);
  const [editingRoomIdx, setEditingRoomIdx] = useState<number | null>(null);
  const [roomPriceInput, setRoomPriceInput] = useState("");
  const [roomDiscountInput, setRoomDiscountInput] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);
  const [ownerAuditHistory, setOwnerAuditHistory] = useState<any[]>([]);
  const [ownerAuditLoading, setOwnerAuditLoading] = useState(false);

  // Parse houseRules - can be a JSON string or object. The owner wizard saves
  // { checkIn: "14:00 – 22:00", checkOut, pets, smoking, other }; older or
  // in-progress data may use { checkInFrom, checkInTo, petsAllowed,
  // smokingNotAllowed }. normalizeHouseRules gives this page both.
  const houseRules = useMemo(() => normalizeHouseRules((() => {
    // Prefer `property.houseRules` if present, otherwise fall back to `services.houseRules`
    const direct = (property as any)?.houseRules;
    if (direct) {
      if (typeof direct === 'string') {
        try {
          const parsed = JSON.parse(direct);
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
        } catch (e) {
          return null;
        }
      }
      if (typeof direct === 'object' && direct !== null && !Array.isArray(direct)) {
        return direct;
      }
    }

    // Fallback: `services.houseRules` (we persist house rules under services for now)
    const servicesRaw = (property as any)?.services;
    let servicesObj: any = null;
    try {
      if (typeof servicesRaw === "string" && servicesRaw.trim()) {
        servicesObj = JSON.parse(servicesRaw);
      } else if (servicesRaw && typeof servicesRaw === "object") {
        servicesObj = servicesRaw;
      }
    } catch {
      servicesObj = null;
    }
    const viaServices = servicesObj?.houseRules;
    if (!viaServices) return null;
    if (typeof viaServices === "string") {
      try {
        const parsed = JSON.parse(viaServices);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
      } catch (e) {
        return null;
      }
    }
    if (typeof viaServices === "object" && viaServices !== null && !Array.isArray(viaServices)) {
      return viaServices;
    }
    return null;
  })()), [property]);

  // formatTimeRange is now imported from lib/propertyUtils

  // Professional auto-fill template for suspension reason
  const SUSPENSION_REASON_TEMPLATE = `This property has been temporarily suspended due to a violation of our platform policies and terms of service. The suspension is effective immediately and the property has been removed from public search and booking availability. The property owner will be notified and provided with guidance on the steps required for reinstatement. The property will remain visible to administrators only until the issues have been resolved and the suspension is lifted.`;

  // Load system commission settings
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await api.get("/api/public/support/system-settings");
        if (mounted && response.data?.commissionPercent !== undefined) {
          const commission = Number(response.data.commissionPercent);
          setSystemCommission(isNaN(commission) ? 0 : commission);
        }
      } catch (e) {
        // Silently fail - will use 0 as default
      }
    };
    if (mode === "admin" || mode === "owner") {
      load();
    }
    return () => {
      mounted = false;
    };
  }, [mode]);

  async function loadProperty() {
    try {
      setLoading(true);
      setError(null);
      const endpoint = mode === "admin" 
        ? `/api/admin/properties/${propertyId}`
        : mode === "owner"
        ? `/api/owner/properties/${propertyId}`
        : `/public/properties/${propertyId}`;
      
      // Add cache-busting parameter to ensure fresh data
      const response = await api.get(endpoint, {
        params: { _t: Date.now() }
      });
      const data = mode === "admin" || mode === "owner" 
        ? response.data 
        : response.data?.item || response.data;
      
      setProperty(data);
      setEditData(data);
      // Initialize display photos array
      if (data.photos && Array.isArray(data.photos)) {
        setDisplayPhotos(data.photos);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load property");
      console.error("Load property error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // A different property starts from the skeleton, never from the last one's data.
    setProperty(null);
    loadProperty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  useEffect(() => {
    if (property && (mode === "public" || mode === "owner")) {
      loadReviews();
    }
    if (property && mode === "admin") {
      loadAuditHistory();
    }
    if (property && mode === "owner") {
      loadOwnerAuditHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property, mode]);



  async function loadReviews() {
    try {
      const response = await api.get(`/api/property-reviews/${propertyId}`);
      setReviews(response.data);
    } catch (err: any) {
      console.error("Load reviews error:", err);
      // Don't show error - reviews are optional
    }
  }

  async function loadAuditHistory() {
    try {
      setAuditLoading(true);
      const response = await api.get(`/api/admin/properties/${propertyId}/audit-history`);
      setAuditHistory(response.data || []);
    } catch (err: any) {
      console.error("Load audit history error:", err);
      setAuditHistory([]);
    } finally {
      setAuditLoading(false);
    }
  }

  // Close share menu when clicking outside
  useEffect(() => {
    if (showShareMenu) {
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.share-menu-container')) {
          setShowShareMenu(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showShareMenu]);


  function handleApprove() {
    setAdminNotice(null);
    setShowApproveDialog(true);
  }

  async function confirmApprove() {
    if (saving) return;
    setShowApproveDialog(false);
    try {
      setSaving(true);
      await api.post(`/api/admin/properties/${propertyId}/approve`, { note: "" });
      await loadProperty();
      await loadAuditHistory();
      onApproved?.();
      setAdminNotice({
        kind: "success",
        title: "Approved successfully",
        body: "This property is now visible to guests. You can still edit details or suspend it later if needed.",
      });
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to approve property";
      setAdminNotice({
        kind: "error",
        title: "Approval failed",
        body: typeof msg === "string" ? msg : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!rejectReasons.trim()) {
      alert("Please provide rejection reasons");
      return;
    }
    try {
      setSaving(true);
      // Split by comma and validate each reason is at least 2 characters (matching backend validation)
      const reasons = rejectReasons.split(",").map((s) => s.trim()).filter(Boolean);
      
      // Validate reasons meet backend requirements
      const invalidReasons = reasons.filter(r => r.length < 2 || r.length > 200);
      if (invalidReasons.length > 0) {
        alert(`Each reason must be between 2 and 200 characters. Invalid: ${invalidReasons.join(", ")}`);
        setSaving(false);
        return;
      }
      
      if (reasons.length === 0) {
        alert("Please provide at least one valid rejection reason");
        setSaving(false);
        return;
      }
      
      await api.post(`/api/admin/properties/${propertyId}/reject`, { reasons, note: "" });
      await loadProperty();
      await loadAuditHistory();
      setShowRejectDialog(false);
      setRejectReasons("");
      onRejected?.();
      alert("Property rejected successfully");
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to reject property";
      alert(typeof errorMessage === 'string' ? errorMessage : "Failed to reject property. Please check that each reason is at least 2 characters long.");
      console.error("Reject property error:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    try {
      setSaving(true);
      await api.patch(`/api/admin/properties/${propertyId}`, {
        title: editData?.title,
        description: editData?.description,
        basePrice: editData?.basePrice,
        currency: editData?.currency,
      });
      await loadProperty();
      await loadAuditHistory();
      setIsEditing(false);
      onUpdated?.();
      alert("Property updated successfully!");
    } catch (err: any) {
      alert(err?.response?.data?.error || "Failed to update property");
    } finally {
      setSaving(false);
    }
  }

  function openCoordinateEditor() {
    if (!property) return;
    const propertyLocation = property.location || {};
    const latitude = Number(property.latitude ?? (propertyLocation as any).latitude ?? (propertyLocation as any).lat);
    const longitude = Number(property.longitude ?? (propertyLocation as any).lng ?? propertyLocation.longitude);
    setCoordinateLatitude(Number.isFinite(latitude) ? latitude.toFixed(6) : "");
    setCoordinateLongitude(Number.isFinite(longitude) ? longitude.toFixed(6) : "");
    setCoordinateReason("");
    setShowCoordinateDialog(true);
  }

  async function handleCoordinateCorrection(next?: { latitude: number; longitude: number; reason: string }) {
    if (!next && (!coordinateLatitude.trim() || !coordinateLongitude.trim())) {
      setAdminNotice({ kind: "error", title: "Coordinates required", body: "Enter both latitude and longitude." });
      return;
    }
    // Values come straight from the pin editor when provided (state updates are async)
    const latitude = next ? next.latitude : Number(coordinateLatitude);
    const longitude = next ? next.longitude : Number(coordinateLongitude);
    const reason = (next ? next.reason : coordinateReason).trim();

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      setAdminNotice({ kind: "error", title: "Invalid latitude", body: "Latitude must be between -90 and 90." });
      return;
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setAdminNotice({ kind: "error", title: "Invalid longitude", body: "Longitude must be between -180 and 180." });
      return;
    }
    if (reason.length < 5 || reason.length > 500) {
      setAdminNotice({ kind: "error", title: "Reason required", body: "Explain the correction in 5 to 500 characters." });
      return;
    }

    try {
      setSavingCoordinates(true);
      await api.patch(`/api/admin/properties/${propertyId}`, {
        latitude,
        longitude,
        coordinateCorrectionReason: reason,
      });
      setShowCoordinateDialog(false);
      await loadProperty();
      await loadAuditHistory();
      setAdminNotice({ kind: "success", title: "Coordinates corrected", body: "The map and routing location now use the verified coordinates." });
      onUpdated?.();
    } catch (err: any) {
      setAdminNotice({
        kind: "error",
        title: "Coordinate update failed",
        body: err?.response?.data?.error || err?.message || "Please try again.",
      });
    } finally {
      setSavingCoordinates(false);
    }
  }

  async function handleOwnerSaveRoomPrice(roomIdx: number) {
    if (!property) return;
    const newPrice = Number(roomPriceInput);
    if (!Number.isFinite(newPrice) || newPrice <= 0) return;
    const newDiscount = Number(roomDiscountInput);
    try {
      setSavingPrice(true);
      const roomsSpec = Array.isArray((property as any).roomsSpec) ? [...(property as any).roomsSpec] : [];
      if (roomIdx >= 0 && roomIdx < roomsSpec.length) {
        roomsSpec[roomIdx] = {
          ...roomsSpec[roomIdx],
          pricePerNight: newPrice,
          discountPercent: Number.isFinite(newDiscount) && newDiscount > 0 ? newDiscount : null,
        };
      }
      const body: any = {
        title: property.title,
        type: property.type,
        description: property.description ?? "",
        totalBedrooms: property.totalBedrooms ?? 0,
        totalBathrooms: property.totalBathrooms ?? 0,
        maxGuests: property.maxGuests ?? 1,
        photos: property.photos ?? [],
        roomsSpec,
        services: property.services ?? [],
        basePrice: Number(property.basePrice) || 0,
        currency: property.currency || "TZS",
      };
      await api.put(`/api/owner/properties/${propertyId}`, body);
      await loadProperty();
      setEditingRoomIdx(null);
      onUpdated?.();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Failed to update room price");
    } finally {
      setSavingPrice(false);
    }
  }

  async function loadOwnerAuditHistory() {
    try {
      setOwnerAuditLoading(true);
      const response = await api.get(`/api/owner/properties/${propertyId}/audit-history`);
      setOwnerAuditHistory(response.data || []);
    } catch {
      setOwnerAuditHistory([]);
    } finally {
      setOwnerAuditLoading(false);
    }
  }

  async function handleSuspend() {
    if (!suspendReason.trim()) {
      setAdminNotice({
        kind: "error",
        title: "Suspension needs a reason",
        body: "Please provide a reason for suspending this property.",
      });
      return;
    }
    try {
      setSaving(true);
      const response = await api.post(`/api/admin/properties/${propertyId}/suspend`, {
        reason: suspendReason.trim(),
        notifyOwner: notifyOwnerOnSuspend
      });
      await loadProperty();
      await loadAuditHistory();
      setShowSuspendDialog(false);
      setSuspendReason("");
      setNotifyOwnerOnSuspend(true);
      onUpdated?.();
      setAdminNotice({
        kind: response.data?.emailDelivery?.sent === false ? "info" : "success",
        title: "Property suspended successfully",
        body: `The property has been removed from public view.${response.data?.referenceCode ? ` Reference: ${response.data.referenceCode}.` : ""} ${response.data?.emailDelivery?.sent === false ? "The email could not be delivered; the failure was recorded for follow-up." : "The owner notification email was sent."}`,
      });
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to suspend property";
      setAdminNotice({
        kind: "error",
        title: "Failed to suspend property",
        body: typeof msg === "string" ? msg : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleUnsuspend() {
    if (!unsuspendReason.trim()) {
      setAdminNotice({
        kind: "error",
        title: "Unsuspension needs a reason",
        body: "Please provide a reason for unsuspending this property.",
      });
      return;
    }
    try {
      setSaving(true);
      const response = await api.post(`/api/admin/properties/${propertyId}/unsuspend`, {
        reason: unsuspendReason.trim()
      });
      await loadProperty();
      await loadAuditHistory();
      setShowUnsuspendDialog(false);
      setUnsuspendReason("");
      onUpdated?.();
      setAdminNotice({
        kind: response.data?.emailDelivery?.sent === false ? "info" : "success",
        title: "Property unsuspended successfully",
        body: `The property is now visible to the public again.${response.data?.referenceCode ? ` Reference: ${response.data.referenceCode}.` : ""} ${response.data?.emailDelivery?.sent === false ? "The restoration email could not be delivered; the failure was recorded." : "The restoration email was sent."}`,
      });
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to unsuspend property";
      setAdminNotice({
        kind: "error",
        title: "Failed to unsuspend property",
        body: typeof msg === "string" ? msg : undefined,
      });
    } finally {
      setSaving(false);
    }
  }


  // Collect all images: property photos + room photos
  // Must be called before early returns to maintain consistent hook order
  const allImages = useMemo(() => {
    if (!property) return [];

    const isSafeNextImageSrc = (value: unknown): value is string => {
      if (typeof value !== "string") return false;
      const v = value.trim();
      if (!v) return false;
      if (v.startsWith("/")) return true;
      if (v.startsWith("http://") || v.startsWith("https://")) return true;
      if (v.startsWith("data:image/")) return true;
      return false;
    };

    const normalizePhotoList = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.filter(isSafeNextImageSrc);
      }

      if (typeof value === "string") {
        const raw = value.trim();
        if (!raw) return [];

        // Some APIs/DBs store arrays as JSON strings.
        if (raw.startsWith("[")) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              return parsed.filter(isSafeNextImageSrc);
            }
          } catch {
            // ignore
          }
        }

        return isSafeNextImageSrc(raw) ? [raw] : [];
      }

      return [];
    };

    const propertyPhotosRaw = displayPhotos.length > 0 ? displayPhotos : (property as any).photos;
    const propertyPhotos = normalizePhotoList(propertyPhotosRaw);
    const roomPhotos: string[] = [];
    
    // Collect photos from all rooms
    if (Array.isArray(property.roomsSpec)) {
      property.roomsSpec.forEach((room: RoomSpec) => {
        if (room?.photos && Array.isArray(room.photos)) {
          roomPhotos.push(...room.photos.filter(isSafeNextImageSrc));
        }
        if (room?.roomImages && Array.isArray(room.roomImages)) {
          roomPhotos.push(...room.roomImages.filter(isSafeNextImageSrc));
        }
      });
    }
    
    // Property photos first, then room photos, each picture once: rooms keep the
    // same files in both `photos` and `roomImages`, and some also sit in the
    // property's own list, which used to double the count and repeat tiles.
    const seen = new Set<string>();
    return [...propertyPhotos, ...roomPhotos].filter((src) => {
      const key = src.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPhotos, property?.photos, property?.roomsSpec]);

  // About this place - description handling
  // Must be called before early returns to maintain consistent hook order
  const about = useMemo(() => {
    const fallback = "No description provided yet.";
    const raw = String(property?.description || "").trim();
    const text = raw ? raw : fallback;
    const limit = 320;
    const hasMore = raw.length > limit;
    const collapsed = hasMore ? raw.slice(0, limit).trimEnd() + "…" : text;
    return { raw, text, hasMore, collapsed };
  }, [property?.description]);

  // Derive building info even when DB fields are missing (older properties)
  // Must be declared BEFORE early returns to maintain consistent hook order.
  const derivedBuilding = useMemo(() => {
    if (!property) return { type: "", floors: 1 };

    const roomsSpec: any[] = Array.isArray((property as any)?.roomsSpec) ? (property as any).roomsSpec : [];
    const layoutRaw = (property as any)?.layout;
    let layout: any = layoutRaw;
    if (typeof layoutRaw === "string" && layoutRaw.trim()) {
      try { layout = JSON.parse(layoutRaw); } catch { layout = null; }
    }

    // Prefer explicit totalFloors if present
    const explicitFloors = typeof (property as any)?.totalFloors === "number" && (property as any).totalFloors > 0
      ? (property as any).totalFloors
      : null;

    let floors: number | null = explicitFloors;

    // Try layout.floors length
    if (!floors && layout && Array.isArray(layout.floors) && layout.floors.length > 0) {
      floors = layout.floors.length;
    }

    // Try roomsSpec floorDistribution max key
    if (!floors && roomsSpec.length > 0) {
      let maxFloor = 0;
      for (const r of roomsSpec) {
        const fd = (r as any)?.floorDistribution;
        let obj: any = null;
        if (typeof fd === "string" && fd.trim()) {
          try { obj = JSON.parse(fd); } catch { obj = null; }
        } else if (fd && typeof fd === "object" && !Array.isArray(fd)) {
          obj = fd;
        }
        if (obj && typeof obj === "object") {
          for (const k of Object.keys(obj)) {
            const n = Number(k);
            if (Number.isFinite(n) && n > maxFloor) maxFloor = n;
          }
        }
      }
      if (maxFloor > 0) floors = maxFloor;
    }

    if (!floors) floors = 1;

    const explicitType = String((property as any)?.buildingType || "").trim();
    const type = explicitType ? explicitType : (floors > 1 ? "multi_storey" : "single_storey");

    return { type, floors };
  }, [property]);

  const effectiveBuildingType = String((property as any)?.buildingType || "").trim() || derivedBuilding.type;
  const effectiveTotalFloors =
    (typeof (property as any)?.totalFloors === "number" && (property as any).totalFloors > 0)
      ? (property as any).totalFloors
      : derivedBuilding.floors;

  // First load: a skeleton shaped like the page. Later reloads (after a save)
  // keep the page on screen and show a thin progress line instead.
  if (loading && !property) {
    return <PropertyPreviewSkeleton mode={mode} onClose={onClose} longStay={rentalMode === "LONG_STAY"} />;
  }

  if (error || !property) {
    return <PropertyPreviewError message={error || "Property not found"} onRetry={() => void loadProperty()} onClose={onClose} />;
  }

  const photos = allImages;
  const rooms: RoomSpec[] = property.roomsSpec || [];
  const servicesRaw = property.services;
  const location = property.location && Object.keys(property.location).length > 0
    ? property.location
    : {
        street: (property as any).street || '',
        apartment: (property as any).apartment || '',
        ward: (property as any).ward || '',
        district: (property as any).district || '',
        regionName: (property as any).regionName || '',
        city: (property as any).city || '',
        country: (property as any).country || '',
        zip: (property as any).zip || '',
        latitude: (property as any).latitude || null,
        longitude: (property as any).longitude || null,
      };
  // One source for the saved pin: some records keep it on the property, others inside `location`.
  // The map, the pin badge and the pin editor must all read the same value.
  const pinCoords = (() => {
    const loc: any = location || {};
    const pick = (...vals: unknown[]) => {
      for (const v of vals) {
        if (v === null || v === undefined || String(v).trim() === "") continue;
        const n = Number(v);
        if (Number.isFinite(n) && n !== 0) return n;
      }
      return null;
    };
    const lat = pick((property as any).latitude, loc.latitude, loc.lat);
    const lng = pick((property as any).longitude, loc.longitude, loc.lng);
    return lat !== null && lng !== null ? { lat, lng } : null;
  })();
  const status = property.status;
  const totalBedrooms = property.totalBedrooms;
  const totalBathrooms = property.totalBathrooms;
  const maxGuests = property.maxGuests;

  // Parse services - can be JSON string, array of strings, or object
  // Database stores services as JSON, which Prisma may return as string or already parsed object
  let parsedServices: any = servicesRaw;
  if (typeof servicesRaw === 'string' && servicesRaw.trim()) {
    try {
      parsedServices = JSON.parse(servicesRaw);
    } catch {
      // If parsing fails, treat as empty
      parsedServices = null;
    }
  }
  
  // Handle null/undefined
  if (!parsedServices) {
    parsedServices = {};
  }
  
  const servicesArray = Array.isArray(parsedServices) ? parsedServices : [];
  const servicesObj = typeof parsedServices === 'object' && parsedServices !== null && !Array.isArray(parsedServices) ? parsedServices : {};
  

  
  // Normalize boolean values - handle both true/false and "true"/"false" strings
  // Also handle undefined values (when service wasn't selected, it won't be in the object)
  const normalizeBoolean = (value: any): boolean => {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  };
  
  // Create normalized services object with proper boolean values
  // Check for both direct properties and properties that might be nested
  const normalizedServicesObj = {
    // Preserve all original properties
    ...servicesObj,
    // Normalize boolean services - if property doesn't exist, default to false
    breakfastIncluded: normalizeBoolean(servicesObj.breakfastIncluded),
    breakfastAvailable: normalizeBoolean(servicesObj.breakfastAvailable),
    restaurant: normalizeBoolean(servicesObj.restaurant),
    bar: normalizeBoolean(servicesObj.bar),
    pool: normalizeBoolean(servicesObj.pool),
    sauna: normalizeBoolean(servicesObj.sauna),
    laundry: normalizeBoolean(servicesObj.laundry),
    roomService: normalizeBoolean(servicesObj.roomService),
    privateChef: normalizeBoolean(servicesObj.privateChef),
    security24: normalizeBoolean(servicesObj.security24),
    firstAid: normalizeBoolean(servicesObj.firstAid),
    fireExtinguisher: normalizeBoolean(servicesObj.fireExtinguisher),
    onSiteShop: normalizeBoolean(servicesObj.onSiteShop),
    nearbyMall: normalizeBoolean(servicesObj.nearbyMall),
    socialHall: normalizeBoolean(servicesObj.socialHall),
    sportsGames: normalizeBoolean(servicesObj.sportsGames),
    gym: normalizeBoolean(servicesObj.gym),
    parking: servicesObj.parking || 'no',
    parkingPrice: servicesObj.parkingPrice || '',
    // Preserve tags and nearbyFacilities
    tags: servicesObj.tags || [],
    nearbyFacilities: servicesObj.nearbyFacilities || [],
  };
  
  // If services is an object with tags, use the tags array for amenities
  const effectiveServicesArray = normalizedServicesObj.tags && Array.isArray(normalizedServicesObj.tags) 
    ? normalizedServicesObj.tags 
    : servicesArray;
  
  // Always parse tags to ensure we have the latest values, even if some properties exist
  // This ensures we don't miss any services that might be in tags but not in individual properties
  if (effectiveServicesArray.length > 0) {
    // Parse tags to extract individual service properties
    const tags = effectiveServicesArray.map((t: string) => String(t).toLowerCase());
    
    // Parking - only set if not already set or if tags have more specific info
    if (!normalizedServicesObj.parking || normalizedServicesObj.parking === 'no') {
      if (tags.some((t: string) => t.includes('free parking'))) {
        normalizedServicesObj.parking = 'free';
      } else if (tags.some((t: string) => t.includes('paid parking'))) {
        normalizedServicesObj.parking = 'paid';
        // Try to extract parking price from tag
        const paidParkingTag = effectiveServicesArray.find((t: string) => t.toLowerCase().includes('paid parking'));
        if (paidParkingTag) {
          const priceMatch = paidParkingTag.match(/\(([^)]+)\)/);
          if (priceMatch) {
            normalizedServicesObj.parkingPrice = priceMatch[1].replace(/TZS/i, '').trim();
          }
        }
      }
    }
    
    // Other services - set to true if found in tags (even if already false, tags are source of truth)
    if (tags.some((t: string) => t.includes('breakfast included'))) normalizedServicesObj.breakfastIncluded = true;
    if (tags.some((t: string) => t.includes('breakfast available'))) normalizedServicesObj.breakfastAvailable = true;
    if (tags.some((t: string) => t.includes('restaurant'))) normalizedServicesObj.restaurant = true;
    if (tags.some((t: string) => t.includes('bar'))) normalizedServicesObj.bar = true;
    if (tags.some((t: string) => t.includes('pool'))) normalizedServicesObj.pool = true;
    if (tags.some((t: string) => t.includes('sauna'))) normalizedServicesObj.sauna = true;
    if (tags.some((t: string) => t.includes('laundry'))) normalizedServicesObj.laundry = true;
    if (tags.some((t: string) => t.includes('room service'))) normalizedServicesObj.roomService = true;
    if (tags.some((t: string) => t.includes('private chef'))) normalizedServicesObj.privateChef = true;
    if (tags.some((t: string) => t.includes('24h security') || t.includes('24-hour security'))) normalizedServicesObj.security24 = true;
    if (tags.some((t: string) => t.includes('first aid'))) normalizedServicesObj.firstAid = true;
    if (tags.some((t: string) => t.includes('fire extinguisher'))) normalizedServicesObj.fireExtinguisher = true;
    if (tags.some((t: string) => t.includes('on-site shop'))) normalizedServicesObj.onSiteShop = true;
    if (tags.some((t: string) => t.includes('nearby mall'))) normalizedServicesObj.nearbyMall = true;
    if (tags.some((t: string) => t.includes('social hall'))) normalizedServicesObj.socialHall = true;
    if (tags.some((t: string) => t.includes('sports') || t.includes('games'))) normalizedServicesObj.sportsGames = true;
    if (tags.some((t: string) => t.includes('gym'))) normalizedServicesObj.gym = true;
    

  }
  
  // Extract nearby facilities - check both services array (as JSON string) and services object
  // Use normalizedServicesObj which includes nearbyFacilities
  let nearbyFacilities: any[] = [];
  try {
    // First check normalized object (which preserves nearbyFacilities)
    if (normalizedServicesObj.nearbyFacilities && Array.isArray(normalizedServicesObj.nearbyFacilities)) {
      nearbyFacilities = normalizedServicesObj.nearbyFacilities;
    }
    // Fallback: Try to find nearbyFacilities in original services object
    else if (servicesObj.nearbyFacilities && Array.isArray(servicesObj.nearbyFacilities)) {
      nearbyFacilities = servicesObj.nearbyFacilities;
    }
    // Also check if it's stored as a JSON string in the services array
    const facilitiesStr = effectiveServicesArray.find((s: string) => s.includes('nearbyFacilities') || s.startsWith('['));
    if (facilitiesStr && nearbyFacilities.length === 0) {
      try {
        const parsed = JSON.parse(facilitiesStr);
        if (Array.isArray(parsed)) nearbyFacilities = parsed;
      } catch {}
    }
  } catch {}

  // Build comprehensive amenities list from services array/object
  const parseServiceLabel = (s: string) => {
    if (s.includes("Free parking")) return { key: "parking", label: "Free Parking", icon: Car, value: true };
    if (s.includes("Paid parking")) return { key: "parking", label: s, icon: Car, value: true };
    if (s.includes("Restaurant")) return { key: "restaurant", label: "Restaurant", icon: UtensilsCrossed, value: true };
    if (s.includes("Bar")) return { key: "bar", label: "Bar", icon: Beer, value: true };
    if (s.includes("Pool")) return { key: "pool", label: "Swimming Pool", icon: Waves, value: true };
    if (s.includes("Sauna")) return { key: "sauna", label: "Sauna", icon: Thermometer, value: true };
    if (s.includes("Laundry")) return { key: "laundry", label: "Laundry", icon: WashingMachine, value: true };
    if (s.includes("Room service")) return { key: "roomService", label: "Room Service", icon: Package, value: true };
    if (s.includes("24h security") || s.includes("24-hour security")) return { key: "security", label: "24/7 Security", icon: Shield, value: true };
    if (s.includes("First aid")) return { key: "firstAid", label: "First Aid", icon: Bandage, value: true };
    if (s.includes("Fire extinguisher")) return { key: "fireExtinguisher", label: "Fire Extinguisher", icon: FireExtinguisher, value: true };
    if (s.includes("On-site shop")) return { key: "onSiteShop", label: "On-site Shop", icon: ShoppingBag, value: true };
    if (s.includes("Nearby mall")) return { key: "nearbyMall", label: "Nearby Mall", icon: Store, value: true };
    if (s.includes("Social hall")) return { key: "socialHall", label: "Social Hall", icon: PartyPopper, value: true };
    if (s.includes("Sports") || s.includes("Sports & games")) return { key: "sports", label: "Sports & Games", icon: Gamepad, value: true };
    if (s.includes("Gym")) return { key: "gym", label: "Gym / Fitness Center", icon: Dumbbell, value: true };
    return null;
  };

  const amenities = effectiveServicesArray.map(parseServiceLabel).filter(Boolean) as Array<{ key: string; label: string; icon: any; value: boolean }>;
  
  // Add common amenities that might be in services object
  if (servicesObj.wifi || effectiveServicesArray.some((s: string) => s.toLowerCase().includes("wifi"))) {
    amenities.push({ key: "wifi", label: "Free WiFi", icon: Wifi, value: true });
  }
  if (servicesObj.ac || effectiveServicesArray.some((s: string) => s.toLowerCase().includes("air conditioning"))) {
    amenities.push({ key: "ac", label: "Air Conditioning", icon: AirVent, value: true });
  }

  // Review progress: what a complete listing has, plus the long-stay steps the page passes in.
  const listingChecks: Array<{ label: string; ok: boolean }> = [
    { label: "Title and property type", ok: Boolean(String(property.title || "").trim() && property.type) },
    { label: "At least 5 photos", ok: displayPhotos.length >= 5 },
    { label: "Description of 80 characters or more", ok: String((property as any).description || "").trim().length >= 80 },
    { label: isLongStay ? "The home's units described" : "Rooms and prices", ok: rooms.length > 0 },
    { label: "Map pin on the home", ok: Boolean(pinCoords && pinCoords.lat && pinCoords.lng) },
    { label: "Amenities listed", ok: amenities.length > 0 || effectiveServicesArray.length > 0 },
    ...(isLongStay ? [] : [{ label: "House rules set", ok: Boolean(houseRules && (houseRules.checkInFrom || houseRules.checkInTo || houseRules.checkOutFrom || houseRules.checkOutTo || houseRules.petsAllowed != null || houseRules.smokingNotAllowed != null || String(houseRules.other || "").trim())) }]),
  ];
  const progressChecks = [...listingChecks, ...(reviewChecks ?? [])];
  const progressDone = progressChecks.filter((c) => c.ok).length;
  const progressPct = progressChecks.length ? Math.round((progressDone / progressChecks.length) * 100) : 0;
  const progressTone = progressPct === 100 ? "#02665e" : progressPct >= 70 ? "#0d9488" : progressPct >= 40 ? "#d97706" : "#dc2626";

  return (
    <div className="w-full bg-white" aria-busy={loading || undefined}>
      <style>{`@keyframes pp-refresh { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } } @media (prefers-reduced-motion: reduce) { [style*="pp-refresh"] { animation: none !important; } }`}</style>
      {/* Reloading after a save: a thin line at the top, the page stays put */}
      {loading ? (
        <div className="fixed inset-x-0 top-0 z-[150] h-[3px] overflow-hidden bg-[#02665e]/15" role="progressbar" aria-label="Refreshing the property">
          <div className="h-full w-1/3 bg-[#02665e]" style={{ animation: "pp-refresh 1.1s ease-in-out infinite" }} />
        </div>
      ) : null}
      {/* Admin command bar: back, identity, and the actions that fit the current status */}
      {mode === "admin" && (() => {
        const btn =
          "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
        return (
          <div className="sticky top-0 z-30 border-0 border-b border-solid border-slate-200 bg-white/95 shadow-[0_4px_18px_-16px_rgba(15,23,42,0.35)] backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-3 py-3">
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Back to properties"
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              <div className="relative min-w-0 flex-1">
                <p className="m-0 truncate text-[14px] font-semibold text-slate-900">{property.title || "Property details"}</p>
                {/* Review progress toward 100%: click for what is left */}
                <button
                  type="button"
                  onClick={() => setShowChecks((v) => !v)}
                  aria-expanded={showChecks}
                  aria-label={`Review progress ${progressPct}%, ${progressChecks.length - progressDone} left`}
                  className="mt-1 flex w-full max-w-[420px] cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left [font-family:inherit]"
                >
                  <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                    {reviewPending ? (
                      <span className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-slate-300" style={{ animation: "pp-refresh 1.1s ease-in-out infinite" }} />
                    ) : (
                      <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: `${progressPct}%`, background: progressTone }} />
                    )}
                  </span>
                  {reviewPending ? (
                    <span className="shrink-0 text-[11.5px] font-semibold text-slate-400">Checking</span>
                  ) : (
                    <>
                      <span className="shrink-0 text-[12px] font-bold tabular-nums" style={{ color: progressTone }}>{progressPct}%</span>
                      <span className="hidden shrink-0 text-[11.5px] text-slate-500 sm:inline">
                        {progressPct === 100 ? "Ready" : `${progressChecks.length - progressDone} to go`}
                      </span>
                    </>
                  )}
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${showChecks ? "rotate-180" : ""}`} />
                </button>
                {showChecks ? (
                  <div className="absolute left-0 top-full z-40 mt-2 w-[min(380px,calc(100vw-2rem))] rounded-xl border border-solid border-slate-200 bg-white p-3 shadow-lg">
                    <p className="m-0 mb-2 flex items-center justify-between text-[12px] font-semibold text-slate-700">
                      Review progress
                      <span className="text-slate-500">{progressDone} of {progressChecks.length} done</span>
                    </p>
                    <ul className="m-0 list-none space-y-1.5 p-0">
                      {[...progressChecks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((c) => (
                        <li key={c.label} className="flex items-center gap-2 text-[12.5px]">
                          {c.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-solid border-amber-400" aria-hidden />}
                          <span className={c.ok ? "text-slate-500" : "font-semibold text-slate-800"}>{c.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowEditModal(true)}
                      className={`${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
                    >
                      <Edit className="h-4 w-4" /> Edit
                    </button>
                    {status === "PENDING" && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowRejectDialog(true)}
                          disabled={saving}
                          className={`${btn} border border-solid border-rose-200 bg-white text-rose-700 hover:bg-rose-50`}
                        >
                          <XCircle className="h-4 w-4" /> Reject
                        </button>
                        <button
                          type="button"
                          onClick={handleApprove}
                          disabled={saving}
                          className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}
                        >
                          <CheckCircle2 className="h-4 w-4" /> Approve
                        </button>
                      </>
                    )}
                    {status === "APPROVED" && (
                      <button
                        type="button"
                        onClick={() => setShowSuspendDialog(true)}
                        disabled={saving}
                        className={`${btn} border border-solid border-orange-200 bg-white text-orange-700 hover:bg-orange-50`}
                      >
                        <Ban className="h-4 w-4" /> Suspend
                      </button>
                    )}
                    {status === "SUSPENDED" && (
                      <button
                        type="button"
                        onClick={() => setShowUnsuspendDialog(true)}
                        disabled={saving}
                        className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}
                      >
                        <CheckCircle2 className="h-4 w-4" /> Unsuspend
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(false);
                        setEditData(property);
                      }}
                      className={`${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
                    >
                      <X className="h-4 w-4" /> Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={saving}
                      className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}
                    >
                      <Save className="h-4 w-4" /> {saving ? "Saving" : "Save"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Admin notice as a toast, so it never pushes the page down */}
      {mode === "admin" && adminNotice && typeof document !== "undefined"
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              className={`fixed right-4 top-4 z-[140] box-border flex w-[min(380px,calc(100vw-2rem))] items-start gap-3 rounded-xl bg-white px-4 py-3 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.45)] ring-1 ring-inset ${
                adminNotice.kind === "success" ? "ring-emerald-200" : adminNotice.kind === "error" ? "ring-rose-200" : "ring-slate-200"
              }`}
            >
              <span
                className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg ${
                  adminNotice.kind === "success" ? "bg-emerald-100 text-emerald-700" : adminNotice.kind === "error" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"
                }`}
              >
                {adminNotice.kind === "error" ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13.5px] font-semibold text-slate-900">{adminNotice.title}</p>
                {adminNotice.body ? <p className="m-0 mt-0.5 text-[12.5px] text-slate-600">{adminNotice.body}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => setAdminNotice(null)}
                aria-label="Dismiss message"
                className="flex h-7 w-7 flex-none items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>,
            document.body
          )
        : null}

      {/* Main Content Container (admin workspace already provides the page gutter) */}
      <div className={mode === "admin" ? "py-5" : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"}>
        {mode === "admin" && adminTop ? adminTop : null}
        {/* Identity: status, type, title, address and owner */}
        {(() => {
          const soften = (v: unknown) => {
            const s = String(v ?? "").trim();
            if (!s || s !== s.toUpperCase()) return s;
            return s
              .split(/\s+/)
              .map((w) => (w.length <= 3 ? w : w.charAt(0) + w.slice(1).toLowerCase().replace(/-(\w)/g, (_m, c: string) => ` ${c.toUpperCase()}`)))
              .join(" ");
          };
          const seen = new Set<string>();
          const addressText = [
            location.street ? `${soften(location.street)}${location.apartment ? `, ${location.apartment}` : ""}` : "",
            soften(location.ward),
            soften(location.district),
            soften(location.regionName),
            soften(location.city),
          ]
            .filter((p) => {
              const k = String(p).toLowerCase().replace(/[^a-z]/g, "");
              if (!k || seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .join(", ");
          const statusMeta: Record<string, { label: string; cls: string; dot: string }> = {
            APPROVED: { label: "Live", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
            PENDING: { label: "Pending review", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
            REJECTED: { label: "Rejected", cls: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
            SUSPENDED: { label: "Suspended", cls: "bg-orange-50 text-orange-700 ring-orange-200", dot: "bg-orange-500" },
            DRAFT: { label: "Draft", cls: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" },
          };
          const sm = statusMeta[String(status)] ?? { label: String(status || "Unknown"), cls: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" };
          const owner: any = (property as any).owner;
          const ownerName = owner ? String(owner.name || owner.fullName || owner.email || "Owner") : "";
          const initials = ownerName
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w: string) => w[0]?.toUpperCase())
            .join("");

          return (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {mode === "admin" && (
                    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-semibold ring-1 ring-inset ${sm.cls}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${sm.dot}`} aria-hidden />
                      {sm.label}
                    </span>
                  )}
                  {(property as any).type && (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-semibold capitalize text-slate-600">
                      {String((property as any).type).toLowerCase().replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                <h1 className="m-0 mt-2 break-words text-[26px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[32px]">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData?.title || ""}
                      onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                      className="box-border w-full rounded-lg border border-solid border-slate-300 px-3 py-2 text-[26px] font-bold sm:text-[30px]"
                      aria-label="Property title"
                      title="Property title"
                    />
                  ) : (
                    soften(property.title)
                  )}
                </h1>
                <p className="m-0 mt-2 flex min-w-0 items-center gap-1.5 text-[14px] text-slate-500">
                  <MapPin className="h-4 w-4 flex-none text-slate-400" />
                  <span className="truncate">{addressText || "No address on file"}</span>
                </p>
              </div>

              {mode === "admin" && owner && (
                <div className="box-border flex flex-none items-center gap-3 rounded-xl border border-solid border-slate-200 bg-white px-3.5 py-2.5 lg:min-w-[260px]">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#02665e]/10 text-[13px] font-bold text-[#02665e]">
                    {initials || "O"}
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Owner</p>
                    <p className="m-0 truncate text-[14px] font-semibold text-slate-900">{soften(ownerName)}</p>
                    {(owner.email || owner.phone) && (
                      <p className="m-0 truncate text-[12px] text-slate-500">{owner.phone || owner.email}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Gallery */}
        <div className="mt-6">
        {photos.length > 0 ? (
          <PropertyPhotoGrid
            photos={photos.slice(0, 48)}
            total={photos.length}
            title={property.title || "Property"}
            onOpenPhoto={(index) => { setSelectedImageIndex(index); setShowLightbox(true); }}
            onShowAll={() => { setSelectedImageIndex(0); setShowLightbox(true); }}
          />
        ) : (
          <div>
            {/* Photo layout preview (until Cloudinary / approved photos are available) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl overflow-hidden border border-solid border-slate-200">
                        <button
                type="button"
                          onClick={() => {
                  setSelectedImageIndex(0);
                  setShowLightbox(true);
                }}
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
                <div className="absolute left-4 bottom-4 inline-flex items-center gap-2 rounded-full bg-white/90 border border-solid border-white/70 px-3 py-1 text-xs font-semibold text-slate-900">
                  Approved photos • 0
              </div>
                          </button>
              <div className="grid grid-cols-2 md:grid-cols-1 gap-3 bg-white p-3">
                {Array.from({ length: 2 }).map((_, i) => (
                              <button
                    key={i}
                    type="button"
                                onClick={() => {
                      setSelectedImageIndex(0);
                      setShowLightbox(true);
                    }}
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
                    {i === 1 && (
                      <div className="absolute left-3 right-3 bottom-3 flex items-center justify-start">
                        <div
                          className="nls-blink inline-flex items-center gap-2 rounded-full bg-white/95 text-[#02665e] px-4 py-2 text-xs font-semibold shadow-sm ring-1 ring-black/5 whitespace-nowrap leading-none [animation-duration:1.8s]"
                        >
                          <Eye className="w-4 h-4 flex-shrink-0 text-[#02665e]" aria-hidden />
                          <span className="leading-none">View all photos</span>
                      </div>
                        </div>
                      )}
                          </button>
                ))}
                        </div>
                        </div>
                        </div>
                      )}
                    </div>
                  
        {/* Facts */}
        {(totalBedrooms || totalBathrooms || maxGuests) && (
          <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-solid border-slate-200 bg-white sm:grid-cols-4">
            {[
              { show: Boolean(maxGuests), Icon: Users, label: "Guests", value: maxGuests },
              { show: Boolean(totalBedrooms), Icon: BedDouble, label: "Bedrooms", value: totalBedrooms },
              { show: Boolean(totalBathrooms), Icon: Bath, label: "Bathrooms", value: totalBathrooms },
              { show: property.status === "APPROVED", Icon: BadgeCheck, label: "Status", value: "Verified" },
            ]
              .filter((f) => f.show)
              .map(({ Icon, label, value }, i) => (
                <div
                  key={label}
                  className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-0 border-l border-solid border-slate-100" : ""}`}
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11.5px] font-medium text-slate-500">{label}</span>
                    <span className="block text-[16px] font-bold leading-tight tabular-nums text-slate-900">{value}</span>
                  </span>
                </div>
              ))}
          </div>
        )}

      {/* Main Content */}
      <div className="mt-6">
        <div className="space-y-6">

            {/* Amenities - Match Public View */}
            {/* About this place: the owner's words, easy to read; admins and owners also see a quality check */}
            {(() => {
              const raw = about.raw;
              const words = raw ? raw.split(/\s+/).filter(Boolean).length : 0;
              const repeats = raw ? repeatedSentences(raw) : 0;
              const helperText = /tick only what is really there|everything the tenant gets for the whole lease|select only amenities guests can actually use/i.test(raw);
              const covers = [
                { label: "Where it is", ok: /\b(located|location|near|close to|minutes?|km|walk|street|road|area|town|city|beach|centre|center)\b/i.test(raw) },
                { label: "What stands out", ok: /\b(view|views|garden|pool|rooftop|terrace|balcony|quiet|spacious|modern|cosy|cozy|unique|special|best)\b/i.test(raw) },
                { label: "What is nearby", ok: /\b(restaurant|shop|shops|mall|market|airport|bus|park|museum|attraction|attractions|hospital|nearby|school|university)\b/i.test(raw) },
                { label: "Who it suits", ok: /\b(famil(y|ies)|business|couples?|travell?ers?|groups?|students?|guests?|tenants?|kids|children|professionals?)\b/i.test(raw) },
              ];
              const problems = (repeats > 0 ? 1 : 0) + (helperText ? 1 : 0);
              const quality = !raw
                ? { label: "Missing", cls: "bg-rose-50 text-rose-700 ring-rose-200" }
                : problems
                  ? { label: "Needs a rewrite", cls: "bg-rose-50 text-rose-700 ring-rose-200" }
                  : raw.length < 80
                    ? { label: "Too short", cls: "bg-amber-50 text-amber-800 ring-amber-200" }
                    : raw.length >= 300 && covers.filter((c) => c.ok).length >= 3
                      ? { label: "Strong", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" }
                      : { label: "Good", cls: "bg-teal-50 text-teal-800 ring-teal-200" };
              const reviewer = mode === "admin" || mode === "owner";
              return (
                <section className="border-b border-gray-200 pb-6">
                  <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]"><FileText className="h-5 w-5" aria-hidden /></span>
                        <div className="min-w-0">
                          <h2 className="m-0 text-lg font-semibold text-slate-900">About this place</h2>
                          <p className="m-0 text-[12.5px] text-slate-500">{isLongStay ? "In the landlord's own words" : "In the host's own words"}</p>
                        </div>
                      </div>
                      {reviewer ? (
                        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset ${quality.cls}`}>
                          {quality.label}{raw ? <span className="font-normal opacity-75">· {words} words</span> : null}
                        </span>
                      ) : null}
                    </div>

                    <div className="px-5 pb-5 pt-4 sm:px-6">
                      {raw ? (
                        <>
                          <p className={`m-0 max-w-[75ch] whitespace-pre-line text-[15px] leading-7 text-slate-700 ${!aboutExpanded && about.hasMore ? "line-clamp-4" : ""}`}>{raw}</p>
                          {about.hasMore ? (
                            <button type="button" onClick={() => setAboutExpanded((v) => !v)}
                              className="mt-2 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13.5px] font-semibold text-[#02665e] hover:underline [font-family:inherit]">
                              {aboutExpanded ? "Show less" : "Read the full description"}
                              <ChevronDown className={`h-4 w-4 transition-transform ${aboutExpanded ? "rotate-180" : ""}`} />
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <p className="m-0 text-[14px] italic text-slate-400">{reviewer ? "The owner has not written a description yet." : "No description provided yet."}</p>
                      )}
                    </div>

                    {reviewer && raw ? (
                      <div className="border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-5 py-3.5 sm:px-6">
                        {problems ? (
                          <ul className="m-0 mb-3 list-none space-y-1.5 p-0">
                            {helperText ? (
                              <li className="flex items-start gap-2 text-[12.5px] font-semibold text-rose-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />Contains the listing form&apos;s own help text, not the owner&apos;s words.</li>
                            ) : null}
                            {repeats > 0 ? (
                              <li className="flex items-start gap-2 text-[12.5px] font-semibold text-rose-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />Repeats itself: {repeats} {repeats === 1 ? "sentence appears" : "sentences appear"} more than once.</li>
                            ) : null}
                          </ul>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                          <span className="text-[11.5px] font-semibold text-slate-500">Covers</span>
                          {covers.map((c) => (
                            <span key={c.label} className={`inline-flex items-center gap-1.5 text-[12.5px] ${c.ok ? "text-slate-700" : "text-slate-400"}`}>
                              {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="h-3.5 w-3.5 rounded-full border-2 border-solid border-slate-300" aria-hidden />}
                              {c.label}
                            </span>
                          ))}
                          <span className="ml-auto text-[12px] text-slate-400">{raw.length.toLocaleString("en-US")} characters</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })()}


            {/* Services & Facilities - Simple List */}
            {(() => {
              // Check if there are any services to display using normalized values
              const hasServices = 
                (normalizedServicesObj.parking && normalizedServicesObj.parking !== 'no') ||
                normalizedServicesObj.breakfastIncluded ||
                normalizedServicesObj.breakfastAvailable ||
                normalizedServicesObj.restaurant ||
                normalizedServicesObj.bar ||
                normalizedServicesObj.pool ||
                normalizedServicesObj.sauna ||
                normalizedServicesObj.laundry ||
                normalizedServicesObj.roomService ||
                normalizedServicesObj.privateChef ||
                normalizedServicesObj.security24 ||
                normalizedServicesObj.firstAid ||
                normalizedServicesObj.fireExtinguisher ||
                normalizedServicesObj.onSiteShop ||
                normalizedServicesObj.nearbyMall ||
                normalizedServicesObj.socialHall ||
                normalizedServicesObj.sportsGames ||
                normalizedServicesObj.gym ||
                (Array.isArray(normalizedServicesObj.nearbyFacilities) && normalizedServicesObj.nearbyFacilities.length > 0) ||
                nearbyFacilities.length > 0 ||
                servicesArray.length > 0 ||
                (Array.isArray(normalizedServicesObj.tags) && normalizedServicesObj.tags.length > 0);
              
              {
              }
              
              return hasServices || nearbyFacilities.length > 0;
            })() && (
              <section className="border-b border-gray-200 pb-6">
                <ServicesAndFacilities
                  normalizedServicesObj={normalizedServicesObj}
                  effectiveServicesArray={effectiveServicesArray}
                  servicesArray={servicesArray}
                />

                {/* Nearby Services - Separate Section with Proper Spacing */}
                {nearbyFacilities.length > 0 && (
                  <div className="mt-6 border-0 border-t border-solid border-slate-200 pt-6">
                    <NearbyServices facilities={nearbyFacilities} maxInitialDisplay={6} />
                  </div>
                )}
              </section>
            )}

            {/* Building Structure Information - Admin/Owner Only */}
            {(mode === "admin" || mode === "owner") && (effectiveBuildingType || effectiveTotalFloors) && (
              <section className="border-b border-gray-200 pb-6">
                <div className="rounded-2xl border border-solid border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 p-5 sm:p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                      <Building2 className="w-5 h-5" aria-hidden />
                    </span>
                    <h2 className="text-lg font-semibold text-slate-900">Building Structure</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {effectiveBuildingType && (
                      <div className="rounded-lg border border-solid border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Building Type</div>
                        <div className="text-sm font-medium text-slate-900">
                          {effectiveBuildingType === "single_storey" ? "Single Storey" : 
                           effectiveBuildingType === "multi_storey" ? "Multi-Storey" : 
                           effectiveBuildingType === "separate_units" ? "Separate Units" : 
                           effectiveBuildingType}
                        </div>
                      </div>
                    )}
                    {typeof effectiveTotalFloors === "number" && effectiveTotalFloors > 0 && (
                      <div className="rounded-lg border border-solid border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Floors</div>
                        <div className="text-sm font-medium text-slate-900">{effectiveTotalFloors} {effectiveTotalFloors === 1 ? "Floor" : "Floors"}</div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Property Visualization - Floor Plan Preview - Admin/Owner Only */}
            {(mode === "admin" || mode === "owner") && rooms.length > 0 && effectiveBuildingType && (
              <section className="border-b border-gray-200 pb-6">
                <PropertyVisualizationPreview
                  title={property.title || "Property"}
                  buildingType={effectiveBuildingType}
                  totalFloors={effectiveTotalFloors || ""}
                  floorUses={parseFloorUses((property as any)?.services)}
                  showHeader={false}
                  rooms={rooms.map((room) => {
                    // Parse floorDistribution if it's a JSON string
                    let floorDist: Record<number, number> | undefined = undefined;
                    if (room.floorDistribution) {
                      if (typeof room.floorDistribution === "string") {
                        try {
                          const parsed = JSON.parse(room.floorDistribution);
                          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                            floorDist = parsed;
                          }
                        } catch {
                          // Invalid JSON, ignore
                        }
                      } else if (typeof room.floorDistribution === "object" && room.floorDistribution !== null && !Array.isArray(room.floorDistribution)) {
                        floorDist = room.floorDistribution as Record<number, number>;
                      }
                    }
                    
                    return {
                      roomType: room.roomType || room.name || room.label || "Room",
                      roomsCount: room.roomsCount || room.count || room.quantity || 0,
                      floorDistribution: floorDist,
                    };
                  })}
                />
              </section>
            )}

            {/* Admin uses the same room layout for both rental modes. */}
            {rooms.length > 0 && (isLongStay || mode === "admin") && (() => {
              const rows = normalizeRoomsSpec(rooms, property.currency ?? null, property.basePrice ?? null);
              if (!rows.length) return null;
              const nightlyRooms = isLongStay ? null : roomReviewEntries(rooms);
              return (
                <section className="border-b border-gray-200 pb-10">
                  <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]"><DoorClosed className="h-5 w-5" aria-hidden /></span>
                        <div>
                          <h2 className="m-0 text-lg font-semibold text-slate-900">{isLongStay ? "The home" : "Rooms & Pricing"}</h2>
                          {isLongStay ? <p className="m-0 text-[12.5px] text-slate-500">Let whole, by the month. Everything the tenant gets for the lease.</p> : null}
                        </div>
                      </div>
                    </div>
                    {rows.map((row, index) => (
                      <RoomReviewRow
                        key={`${row.roomType}-${index}`}
                        row={row}
                        nightly={nightlyRooms ? {
                          ...nightlyRooms[index],
                          currency: property.currency,
                          listingDescription: about.raw,
                          smoking: comparableRoomText(rooms[index]?.smoking),
                        } : undefined}
                      />
                    ))}
                  </div>
                </section>
              );
            })()}

            {rooms.length > 0 && !isLongStay && mode !== "admin" && (
              <section className="border-b border-gray-200 pb-10">
                <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
                            <div className="flex items-center gap-2">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                      <DoorClosed className="w-5 h-5" aria-hidden />
                    </span>
                    <h2 className="text-lg font-semibold text-slate-900">Rooms & Pricing</h2>
                            </div>
                  {(() => {
                    const rows = normalizeRoomsSpec(rooms, property.currency ?? null, property.basePrice ?? null);
                    if (!rows.length) return <p className="mt-2 text-sm text-slate-600">Room details coming soon.</p>;

                    return (
                      <div className="mt-4">
                        {/* Mobile: stacked rows */}
                        <div className="space-y-3 md:hidden">
                          {rows.map((r, idx) => (
                            <div key={`${r.roomType}-${idx}`} className="rounded-xl border border-solid border-slate-200 bg-white p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-900 truncate">
                                    <span className="inline-flex items-center gap-2">
                                      <DoorClosed className="w-4 h-4 text-slate-500" aria-hidden />
                                      <span className="truncate">{r.roomType}</span>
                                </span>
                                    {typeof r.roomsCount === "number" && r.roomsCount > 0 ? (
                                      <span className="ml-2 inline-flex items-center rounded-full bg-slate-50 border border-solid border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                        x{r.roomsCount}
                                      </span>
                                    ) : null}
                              </div>
                                  <div className="mt-1">
                                    <div className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                                      <BedDouble className="w-3.5 h-3.5 text-slate-500" aria-hidden />
                                      <span className="truncate">{r.bedsSummary}</span>
                                    </div>
                                    {getBedDimensions(r.bedsSummary) && (
                                      <div className="mt-1 text-[10px] text-slate-500 leading-tight">
                                        {getBedDimensions(r.bedsSummary)}
                                      </div>
                                    )}
                              </div>
                              </div>
                                <div className="text-right flex-shrink-0">
                                  <div className="text-sm font-bold text-slate-900">{fmtMoney(r.pricePerNight, property.currency)}</div>
                                  <div className="text-[11px] text-slate-500">per night</div>
                                  {r.discountLabel ? (
                                    <div className="mt-1 text-[11px] font-semibold text-emerald-700">{r.discountLabel}</div>
                                  ) : null}
                                </div>
                          </div>
                          
                              {r.description ? (
                                <div className="mt-3 p-3 bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-lg border border-solid border-slate-200/60">
                                  <p className="text-sm text-slate-800 leading-relaxed font-normal">
                                    {capWords(r.description, 180)}
                                  </p>
                                </div>
                              ) : null}

                              {r.amenities.length ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {r.amenities.slice(0, 6).map((a) => (
                                    <RoomAmenityChip key={a} label={a} />
                                ))}
                              </div>
                              ) : null}

                              {r.bathItems && r.bathItems.length > 0 ? (
                                <div className="mt-3">
                                  <div className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                      <Bath className="w-4 h-4 text-slate-600" />
                                      <span>Bathroom</span>
                                    </div>
                                    {r.bathPrivate && (r.bathPrivate === "yes" || r.bathPrivate === "no") && (
                                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold shrink-0 ${
                                        r.bathPrivate === "yes" 
                                          ? "bg-emerald-50 text-emerald-700 border border-solid border-emerald-200" 
                                          : "bg-blue-50 text-blue-700 border border-solid border-blue-200"
                                      }`}>
                                        {r.bathPrivate === "yes" ? (
                                          <>
                                            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                                            <span>Private</span>
                                          </>
                                        ) : (
                                          <>
                                            <Share2 className="w-3.5 h-3.5 flex-shrink-0" />
                                            <span>Shared</span>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {r.bathItems.map((item) => (
                                      <RoomAmenityChip key={item} label={item} />
                                    ))}
                                  </div>
                                </div>
                              ) : r.bathPrivate && (r.bathPrivate === "yes" || r.bathPrivate === "no") ? (
                                <div className="mt-3">
                                  <div className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                      <Bath className="w-4 h-4 text-slate-600" />
                                      <span>Bathroom</span>
                                    </div>
                                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold shrink-0 ${
                                      r.bathPrivate === "yes" 
                                        ? "bg-emerald-50 text-emerald-700 border border-solid border-emerald-200" 
                                        : "bg-blue-50 text-blue-700 border border-solid border-blue-200"
                                    }`}>
                                      {r.bathPrivate === "yes" ? (
                                        <>
                                          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                                          <span>Private</span>
                                        </>
                                      ) : (
                                        <>
                                          <Share2 className="w-3.5 h-3.5 flex-shrink-0" />
                                          <span>Shared</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ) : null}

                              <div className="mt-3">
                                <div className="text-[11px] font-semibold text-slate-700">Policies</div>
                                <ul className="mt-1 space-y-1 text-[12px] text-slate-700">
                                  {r.policies.slice(0, 4).map((p, i) => (
                                    <li key={i} className="break-words flex items-start gap-1.5">
                                      {p.Icon && (
                                        <p.Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${p.iconColor || "text-slate-600"}`} aria-hidden />
                                      )}
                                      <span className="break-words">{p.text}</span>
                                    </li>
                                  ))}
                                </ul>
                            </div>

                              {/* Owner: mobile edit price */}
                              {mode === "owner" && (
                                <div className="mt-3">
                                  {editingRoomIdx === idx ? (
                                    <div className="rounded-lg border border-solid border-[#02665e]/15 bg-[#02665e]/[0.02] p-3 space-y-2">
                                      {/* Price */}
                                      <div>
                                        <div className="text-[10px] font-medium text-slate-500 mb-1">Price/night</div>
                                        <div className="relative">
                                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">{property.currency || "TZS"}</span>
                                          <input
                                            type="number"
                                            value={roomPriceInput}
                                            onChange={(e) => setRoomPriceInput(e.target.value)}
                                            className="w-full h-9 pl-9 pr-3 text-sm font-bold text-[#02665e] rounded-lg bg-white border border-solid border-[#02665e]/20 focus:outline-none focus:border-[#02665e] focus:ring-1 focus:ring-[#02665e]/15 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            min={1}
                                            autoFocus
                                          />
                                        </div>
                                      </div>
                                      {/* Discount */}
                                      <div>
                                        <div className="text-[10px] font-medium text-slate-500 mb-1">Discount</div>
                                        <div className="relative">
                                          <input
                                            type="number"
                                            value={roomDiscountInput}
                                            onChange={(e) => setRoomDiscountInput(e.target.value)}
                                            className="w-full h-9 pl-3 pr-8 text-sm rounded-lg bg-white border border-solid border-slate-200 focus:outline-none focus:border-[#02665e] focus:ring-1 focus:ring-[#02665e]/15 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            min={0}
                                            max={100}
                                            placeholder="0"
                                          />
                                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 pointer-events-none">%</span>
                                        </div>
                                      </div>

                                      {/* Compact live preview */}
                                      {(() => {
                                        const p = Number(roomPriceInput);
                                        const d = Number(roomDiscountInput);
                                        if (p > 0 && d > 0 && d <= 100) {
                                          const discounted = Math.round(p - (p * d / 100));
                                          return (
                                            <div className="flex items-center gap-2 text-xs">
                                              <span className="text-slate-400 line-through">{fmtMoney(p, property.currency)}</span>
                                              <span className="font-bold text-[#02665e]">{fmtMoney(discounted, property.currency)}</span>
                                              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{d}% off</span>
                                            </div>
                                          );
                                        }
                                        return null;
                                      })()}

                                      {/* Actions row */}
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => handleOwnerSaveRoomPrice(idx)}
                                          disabled={savingPrice}
                                          className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#02665e] text-white text-xs font-semibold hover:bg-[#014e47] disabled:opacity-50 transition-colors"
                                        >
                                          <Save className="w-3 h-3" />
                                          {savingPrice ? "…" : "Save"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingRoomIdx(null)}
                                          className="h-8 px-2.5 rounded-lg text-slate-500 text-xs hover:bg-slate-100 transition-colors"
                                        >
                                          Cancel
                                        </button>
                                        <span className="ml-auto text-[10px] text-amber-600">Needs re-approval</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingRoomIdx(idx);
                                        setRoomPriceInput(String(r.pricePerNight ?? ""));
                                        const rawRoom = rooms[idx] as any;
                                        setRoomDiscountInput(String(rawRoom?.discountPercent ?? ""));
                                      }}
                                      className="w-full rounded-lg bg-[#02665e] text-white px-3 py-2 text-xs font-semibold hover:bg-[#014e47] transition-colors flex items-center justify-center gap-1.5"
                                    >
                                      <Edit className="w-3.5 h-3.5" />
                                      Edit pricing
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                                ))}
                              </div>

                        {/* Desktop: full-width table */}
                        <div className="hidden md:block">
                          <div className="rounded-xl border border-solid border-slate-200 overflow-hidden">
                            <table className="w-full table-fixed border-collapse">
                              <thead className="bg-slate-50 text-slate-700">
                                <tr>
                                  <th className="text-left text-sm font-semibold px-3 py-3 border-b border-r border-slate-200 w-[13%]">
                                    Room type
                                  </th>
                                  <th className="text-left text-sm font-semibold px-3 py-3 border-b border-r border-slate-200 w-[11%]">
                                    Bed Type &amp; Size
                                  </th>
                                  <th className="text-left text-sm font-semibold px-3 py-3 border-b border-r border-slate-200 w-[28%]">
                                    Description &amp; Amenities
                                  </th>
                                  <th className="text-left text-sm font-semibold px-3 py-3 border-b border-r border-slate-200 w-[14%]">
                                    Price &amp; Discounts
                                  </th>
                                  {mode !== "owner" && (
                                    <th className="text-left text-sm font-semibold px-3 py-3 border-b border-r border-slate-200 w-[11%]">Pay Now</th>
                                  )}
                                  {mode === "owner" && (
                                    <th className="text-left text-sm font-semibold px-3 py-3 border-b border-r border-slate-200 w-[11%]">Actions</th>
                                  )}
                                  <th className="text-left text-sm font-semibold px-3 py-3 border-b border-slate-200 w-[23%] min-w-[160px]">
                                    Policies
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="bg-white">
                                {rows.map((r, idx) => (
                                  <TableRow
                                    key={`${r.roomType}-${idx}`}
                                    className={[
                                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/40",
                                      "hover:bg-emerald-50/30 hover:shadow-none",
                                      "motion-safe:transition-colors motion-safe:duration-200",
                                    ].join(" ")}
                                  >
                                    <td className="align-top px-3 py-4 border-t border-slate-200">
                                      <div className="inline-flex items-start gap-2 text-base font-semibold text-slate-900 break-words">
                                        <DoorClosed className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" aria-hidden />
                                        <span>{r.roomType}</span>
                            </div>
                                      {typeof r.roomsCount === "number" && r.roomsCount > 0 ? (
                                        <div className="mt-1 inline-flex items-center rounded-full bg-slate-50 border border-solid border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                                          {r.roomsCount} rooms
                        </div>
                                      ) : null}
                                    </td>
                                    <td className="align-top px-3 py-4 border-t border-slate-200">
                                      <div>
                                        <div className="inline-flex items-start gap-2 text-base text-slate-800 break-words">
                                          <BedDouble className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" aria-hidden />
                                          <span>{r.bedsSummary}</span>
                                        </div>
                                        {getBedDimensions(r.bedsSummary) && (
                                          <div className="mt-1.5 text-xs text-slate-500 leading-tight">
                                            {getBedDimensions(r.bedsSummary)}
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                    <td className="align-top px-3 py-4 border-t border-slate-200">
                                      {r.description ? (
                                        <div className="p-3 bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-lg border border-solid border-slate-200/60">
                                          <p className="text-sm text-slate-800 leading-relaxed font-normal break-words">
                                            {capWords(r.description, 220)}
                                          </p>
                          </div>
                                      ) : (
                                        <div className="text-base text-slate-500">—</div>
                        )}
                                      {r.amenities.length ? (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {r.amenities.slice(0, 6).map((a) => (
                                            <RoomAmenityChip key={a} label={a} />
                                ))}
                      </div>
                                      ) : null}
                                      {r.bathItems && r.bathItems.length > 0 ? (
                                        <div className="mt-3 pt-3 border-t border-slate-100">
                                          <div className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2 flex-wrap">
                                            <div className="flex items-center gap-2">
                                              <Bath className="w-4 h-4 text-slate-600" />
                                              <span>Bathroom</span>
                                            </div>
                                            {r.bathPrivate && (r.bathPrivate === "yes" || r.bathPrivate === "no") && (
                                              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold shrink-0 ${
                                                r.bathPrivate === "yes" 
                                                  ? "bg-emerald-50 text-emerald-700 border border-solid border-emerald-200" 
                                                  : "bg-blue-50 text-blue-700 border border-solid border-blue-200"
                                              }`}>
                                                {r.bathPrivate === "yes" ? (
                                                  <>
                                                    <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                                                    <span>Private</span>
                                                  </>
                                                ) : (
                                                  <>
                                                    <Share2 className="w-3.5 h-3.5 flex-shrink-0" />
                                                    <span>Shared</span>
                                                  </>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                          <div className="flex flex-wrap gap-2">
                                            {r.bathItems.map((item) => (
                                              <RoomAmenityChip key={item} label={item} />
                                            ))}
                                          </div>
                                        </div>
                                      ) : r.bathPrivate && (r.bathPrivate === "yes" || r.bathPrivate === "no") ? (
                                        <div className="mt-3 pt-3 border-t border-slate-100">
                                          <div className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2 flex-wrap">
                                            <div className="flex items-center gap-2">
                                              <Bath className="w-4 h-4 text-slate-600" />
                                              <span>Bathroom</span>
                                            </div>
                                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold shrink-0 ${
                                              r.bathPrivate === "yes" 
                                                ? "bg-emerald-50 text-emerald-700 border border-solid border-emerald-200" 
                                                : "bg-blue-50 text-blue-700 border border-solid border-blue-200"
                                            }`}>
                                              {r.bathPrivate === "yes" ? (
                                                <>
                                                  <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                                                  <span>Private</span>
                                                </>
                                              ) : (
                                                <>
                                                  <Share2 className="w-3.5 h-3.5 flex-shrink-0" />
                                                  <span>Shared</span>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      ) : null}
                                    </td>
                                    <td className="align-top px-3 py-4 border-t border-slate-200">
                                      {mode === "owner" && editingRoomIdx === idx ? (
                                        <div className="space-y-2">
                                          <div>
                                            <label className="text-[10px] font-semibold text-slate-500 uppercase">Price/night</label>
                                            <input
                                              type="number"
                                              value={roomPriceInput}
                                              onChange={(e) => setRoomPriceInput(e.target.value)}
                                              className="w-full h-9 px-2 text-sm font-bold text-[#02665e] rounded-lg border border-solid border-[#02665e]/30 focus:outline-none focus:border-[#02665e] focus:ring-1 focus:ring-[#02665e]/20"
                                              min={1}
                                              autoFocus
                                            />
                                          </div>
                                          <div>
                                            <label className="text-[10px] font-semibold text-slate-500 uppercase">Discount %</label>
                                            <input
                                              type="number"
                                              value={roomDiscountInput}
                                              onChange={(e) => setRoomDiscountInput(e.target.value)}
                                              className="w-full h-9 px-2 text-sm rounded-lg border border-solid border-slate-200 focus:outline-none focus:border-[#02665e] focus:ring-1 focus:ring-[#02665e]/20"
                                              min={0}
                                              max={100}
                                              placeholder="0"
                                            />
                                          </div>
                                          {(() => {
                                            const p = Number(roomPriceInput);
                                            const d = Number(roomDiscountInput);
                                            if (p > 0 && d > 0 && d <= 100) {
                                              const discounted = Math.round(p - (p * d / 100));
                                              return (
                                                <div className="rounded-md bg-emerald-50 border border-solid border-emerald-200 px-2 py-1.5">
                                                  <div className="flex items-center justify-between text-[11px]">
                                                    <span className="text-slate-500 line-through">{fmtMoney(p, property.currency)}</span>
                                                    <span className="font-bold text-emerald-700">{fmtMoney(discounted, property.currency)}</span>
                                                  </div>
                                                  <div className="text-[10px] text-emerald-600 mt-0.5">{d}% off</div>
                                                </div>
                                              );
                                            }
                                            return null;
                                          })()}
                                          <div className="flex gap-1.5">
                                            <button
                                              type="button"
                                              onClick={() => handleOwnerSaveRoomPrice(idx)}
                                              disabled={savingPrice}
                                              className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-[#02665e] text-white text-xs font-semibold hover:bg-[#014e47] disabled:opacity-50"
                                            >
                                              <Save className="w-3 h-3" />
                                              {savingPrice ? "…" : "Save"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setEditingRoomIdx(null)}
                                              className="px-2 py-1.5 rounded-md text-slate-600 text-xs font-medium hover:bg-slate-100"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div>
                                          <div className="text-base font-bold text-[#02665e]">{fmtMoney(r.pricePerNight, property.currency)}</div>
                                          <div className="text-xs text-slate-500">per night</div>
                                          {r.discountLabel ? (
                                            <div className="mt-1 inline-flex items-center rounded-full bg-emerald-50 border border-solid border-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                                              {r.discountLabel}
                                            </div>
                                          ) : (
                                            <div className="mt-1 text-xs text-slate-500">No discounts</div>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td className="align-top px-3 py-4 border-t border-slate-200">
                                      {mode === "owner" ? (
                                        editingRoomIdx === idx ? (
                                          <div className="rounded-lg bg-amber-50 border border-solid border-amber-200 px-2 py-2 text-[10px] text-amber-800 leading-tight">
                                            Saving triggers re-approval
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingRoomIdx(idx);
                                              setRoomPriceInput(String(r.pricePerNight ?? ""));
                                              const rawRoom = rooms[idx] as any;
                                              setRoomDiscountInput(String(rawRoom?.discountPercent ?? ""));
                                            }}
                                            className="w-full rounded-md bg-white text-[#02665e] border border-solid border-[#02665e]/30 px-2.5 py-1.5 text-sm font-medium hover:bg-[#02665e]/5 transition-colors"
                                          >
                                            <Edit className="w-3.5 h-3.5 inline mr-1" />
                                            Edit price
                                          </button>
                                        )
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => alert("Pay Now / Booking flow is coming next (Phase 2).")}
                                            className="w-full rounded-md bg-[#02665e] text-white px-2.5 py-1.5 text-sm font-medium hover:bg-[#014e47] shadow-sm hover:shadow active:scale-[0.98] motion-safe:transition-all motion-safe:duration-200"
                                          >
                                            Pay now
                                          </button>
                                          <div className="mt-2 text-xs text-slate-500">Secure checkout (coming soon)</div>
                                        </>
                                      )}
                                    </td>
                                    <td className="align-top px-3 py-4 border-t border-slate-200">
                                      <ul className="space-y-1.5 text-sm text-slate-800">
                                        {r.policies.slice(0, 6).map((p, i) => (
                                          <li key={i} className="leading-relaxed break-words flex items-start gap-1.5">
                                            {p.Icon && (
                                              <p.Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${p.iconColor || "text-slate-600"}`} aria-hidden />
                                            )}
                                            <span className="break-words min-w-0">{p.text}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </td>
                                  </TableRow>
                                ))}
                              </tbody>
                            </table>
                        </div>
                    </div>
                      </div>
                    );
                  })()}
                </div>
              </section>
            )}

            {/* Admin/Owner Info Card - Moved here for full-width rooms table */}
            {(mode === "admin" || mode === "owner") && (
              <section className="border-b border-gray-200 pb-6">
                <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-6 motion-safe:transition-all motion-safe:duration-300 hover:shadow-md">
                  {/* Owner Quick Actions */}
                  {mode === "owner" && (
                    <div className="pb-6 border-b border-slate-200/60">
                      <div className="text-sm sm:text-base font-semibold text-slate-900 mb-4">Quick Actions</div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Link
                          href={`/owner/properties/add?id=${ownerPropertyRefOrId(propertyId)}`}
                          className="group flex items-center gap-3 p-4 rounded-xl bg-white border border-solid border-slate-200 hover:border-[#02665e]/30 hover:shadow-md transition-all duration-200 no-underline"
                        >
                          <div className="w-10 h-10 rounded-lg bg-[#02665e] flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Edit className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-900">Edit Property</div>
                            <div className="text-xs text-slate-500">Update details & pricing</div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-[#02665e] group-hover:translate-x-1 transition-transform" />
                        </Link>
                        <Link
                          href={ownerPropertyHref(propertyId, "/availability/manage")}
                          className="group flex items-center gap-3 p-4 rounded-xl bg-white border border-solid border-slate-200 hover:border-[#02665e]/30 hover:shadow-md transition-all duration-200 no-underline"
                        >
                          <div className="w-10 h-10 rounded-lg bg-[#02665e] flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Calendar className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-900">Manage Availability</div>
                            <div className="text-xs text-slate-500">Update room availability calendar</div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-[#02665e] group-hover:translate-x-1 transition-transform" />
                        </Link>
                        <Link
                          href={`/owner/bookings`}
                          className="group flex items-center gap-3 p-4 rounded-xl bg-white border border-solid border-slate-200 hover:border-[#02665e]/30 hover:shadow-md transition-all duration-200 no-underline"
                        >
                          <div className="w-10 h-10 rounded-lg bg-[#02665e] flex items-center justify-center group-hover:scale-110 transition-transform">
                            <BedDouble className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-900">View Bookings</div>
                            <div className="text-xs text-slate-500">Manage all bookings</div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-[#02665e] group-hover:translate-x-1 transition-transform" />
                        </Link>
                      </div>
                    </div>
                  )}
                  {!isLongStay && (property.basePrice !== null && property.basePrice !== undefined && property.basePrice > 0) && (
                    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-500">
                      <div className="text-sm sm:text-base text-slate-600 mb-2 font-medium">{mode === "admin" ? "Listing base rate with commission" : "Base Price"}</div>
                      <div className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[#02665e] motion-safe:transition-transform motion-safe:duration-200 hover:scale-[1.02]">
                              {(() => {
                                const basePrice = Number(property?.basePrice);
                                if (!basePrice || basePrice <= 0) return "—";
                                const commission = getPropertyCommission(property, systemCommission);
                                const finalPrice = calculatePriceWithCommission(basePrice, commission);
                                return new Intl.NumberFormat(undefined, {
                                  style: "currency",
                                  currency: property.currency || "TZS",
                                  maximumFractionDigits: 0,
                                }).format(finalPrice);
                              })()}
                            </div>
                  </div>
                )}
                  
                  {property.owner && (
                    <div className="pt-5 border-0 border-t border-solid border-slate-200/60">
                      {/* Owner: one compact row, name on the left, contacts on the right */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-solid border-slate-200 bg-slate-50/60 px-4 py-3">
                        <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[#02665e] text-[13px] font-bold text-white" aria-hidden>
                          {String(property.owner.name || "O").split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join("") || <Users className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-[11px] font-semibold text-slate-400">Owner</p>
                          <p className="m-0 flex items-center gap-1.5 truncate text-[14px] font-bold text-slate-900">
                            {property.owner.name || "Owner"}
                            <BadgeCheck className="h-4 w-4 flex-none text-emerald-600" aria-label="Verified host" />
                          </p>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          {property.owner.phone && (
                            <a href={`tel:${property.owner.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-2.5 text-[12.5px] font-semibold text-slate-700 no-underline hover:border-[#02665e]/40 hover:text-[#02665e]">
                              <Phone className="h-3.5 w-3.5 flex-none" />{property.owner.phone}
                            </a>
                          )}
                          {property.owner.email && (
                            <a href={`mailto:${property.owner.email}`} className="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-2.5 text-[12.5px] font-semibold text-slate-700 no-underline hover:border-[#02665e]/40 hover:text-[#02665e]">
                              <Mail className="h-3.5 w-3.5 flex-none" /><span className="truncate">{property.owner.email}</span>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
            )}

                  {property.lastSubmittedAt && (
                    <div className="pt-5 border-t border-slate-200 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:delay-200">
                      <div className="text-sm sm:text-base text-slate-600 mb-1.5 font-medium">Last Submitted</div>
                      <div className="text-sm sm:text-base font-medium text-slate-900">
                        {new Date(property.lastSubmittedAt).toLocaleString()}
                      </div>
                  </div>
                )}
                </div>
              </section>
            )}

            {/* House rules: the owner's rules first, missing ones flagged for admins, general guidelines last */}
            {/* Long stays carry living rules instead (shown in the long-stay review and written into the lease) */}
            {houseRules && !isLongStay && (() => {
              const checkIn = windowPhrase(houseRules.checkInFrom, houseRules.checkInTo, "From");
              const checkOut = windowPhrase(houseRules.checkOutFrom, houseRules.checkOutTo, "By");
              const pets = houseRules.petsAllowed;
              const smokingBanned = houseRules.smokingNotAllowed;
              const items = [
                { key: "in", label: "Check-in", Icon: Clock, value: checkIn, tone: "neutral" as const },
                { key: "out", label: "Check-out", Icon: Clock, value: checkOut, tone: "neutral" as const },
                {
                  key: "pets",
                  label: "Pets",
                  Icon: PawPrint,
                  value: pets === undefined || pets === null ? null : pets ? "Allowed" : "Not allowed",
                  hint: pets && houseRules.petsNote ? String(houseRules.petsNote) : "",
                  tone: pets === undefined || pets === null ? ("neutral" as const) : pets ? ("yes" as const) : ("no" as const),
                },
                {
                  key: "smoke",
                  label: "Smoking",
                  Icon: CigaretteOff,
                  value: smokingBanned === undefined || smokingBanned === null ? null : smokingBanned ? "Not allowed" : "Allowed",
                  tone: smokingBanned === undefined || smokingBanned === null ? ("neutral" as const) : smokingBanned ? ("no" as const) : ("yes" as const),
                },
              ];
              const missing = items.filter((i) => !i.value).length;
              // Guests only see rules the owner actually set
              const visible = mode === "admin" || mode === "owner" ? items : items.filter((i) => i.value);
              const other = String(houseRules.other || "").trim();

              return (
                <section className="pb-10">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="m-0 text-xl font-bold text-slate-900 sm:text-2xl">House rules</h2>
                    {(mode === "admin" || mode === "owner") && missing > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[12px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {missing} of 4 not set by the owner
                      </span>
                    )}
                  </div>

                  <div className="box-border overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
                    {visible.length > 0 && (
                      <div className="grid grid-cols-2 lg:grid-cols-4">
                        {visible.map(({ key, label, Icon, value, tone, hint }: any, i: number) => (
                          <div
                            key={key}
                            className={`flex items-start gap-3 px-4 py-3.5 ${i % 2 === 1 ? "border-0 border-l border-solid border-slate-100" : ""} ${
                              i >= 2 ? "border-0 border-t border-solid border-slate-100 lg:border-t-0" : ""
                            } ${i >= 1 ? "lg:border-0 lg:border-l lg:border-solid lg:border-slate-100" : ""}`}
                          >
                            <span
                              className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${
                                !value
                                  ? "bg-slate-100 text-slate-400"
                                  : tone === "yes"
                                    ? "bg-emerald-50 text-emerald-600"
                                    : tone === "no"
                                      ? "bg-rose-50 text-rose-600"
                                      : "bg-[#02665e]/10 text-[#02665e]"
                              }`}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[11.5px] font-medium text-slate-500">{label}</span>
                              {value ? (
                                <span
                                  className={`block text-[14.5px] font-semibold ${
                                    tone === "yes" ? "text-emerald-700" : tone === "no" ? "text-rose-700" : "text-slate-900"
                                  }`}
                                >
                                  {value}
                                </span>
                              ) : (
                                <span className="block text-[13.5px] font-medium italic text-slate-400">Not set</span>
                              )}
                              {hint && <span className="mt-0.5 block text-[12px] text-slate-500">{hint}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {other && (
                      <div className="border-0 border-t border-solid border-slate-100 px-4 py-3.5 sm:px-5">
                        <p className="m-0 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">From the owner</p>
                        <p className="m-0 mt-1 whitespace-pre-line text-[14px] leading-relaxed text-slate-700">{other}</p>
                      </div>
                    )}

                    <div className="border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-4 py-3.5 sm:px-5">
                      <p className="m-0 text-[11.5px] font-semibold text-slate-400">Applies to every NoLSAF stay</p>
                      <ul className="m-0 mt-2 grid list-none gap-x-6 gap-y-1.5 p-0 sm:grid-cols-2">
                        {[
                          "Keep the property clean and well maintained",
                          "Return all keys and access cards at checkout",
                          "Report any incidents or damage straight away",
                          "Respect quiet hours and neighbours",
                          "Follow all posted safety guidelines",
                        ].map((rule) => (
                          <li key={rule} className="flex items-start gap-2 text-[13px] text-slate-600">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-[#02665e]" />
                            {rule}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* Reviews Section */}
            {(mode === "public" || mode === "owner") && reviews && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="pb-8"
              >
                {/* Header with rating badge */}
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Guest Reviews</h2>
                  {reviews.stats && (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-solid border-amber-200">
                      <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                      <span className="text-lg font-bold text-gray-900">
                        {reviews.stats.averageRating.toFixed(1)}
                      </span>
                      <span className="text-sm text-gray-500">
                        ({reviews.stats.totalReviews})
                      </span>
                    </div>
                  )}
                </div>

                {/* Rating distribution - horizontal bars */}
                {reviews.stats && (
                  <div className="mb-6 space-y-2">
                    {[5, 4, 3, 2, 1].map((rating) => {
                      const count = reviews.stats.ratingDistribution[rating] || 0;
                      const pct = reviews.stats.totalReviews > 0 ? (count / reviews.stats.totalReviews) * 100 : 0;
                      return (
                        <div key={rating} className="flex items-center gap-3">
                          <div className="flex items-center gap-1 w-8 justify-end flex-shrink-0">
                            <span className="text-sm font-semibold text-slate-700">{rating}</span>
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          </div>
                          <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.5, delay: (5 - rating) * 0.08 }}
                              className="h-full bg-amber-400 rounded-full"
                            />
                          </div>
                          <span className="text-xs font-medium text-slate-400 w-6 text-right flex-shrink-0">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Review cards */}
                <div className="space-y-4">
                  {reviews.reviews.slice(0, 5).map((review: Review, idx: number) => (
                    <motion.div
                      key={review.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: idx * 0.08 }}
                      className="rounded-xl border border-solid border-slate-200 bg-white p-4 sm:p-5 hover:shadow-md transition-shadow duration-200"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-[#02665e] font-bold text-sm">
                            {review.user?.name?.charAt(0) || "G"}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-slate-900 truncate">
                            {review.user?.name || "Anonymous Guest"}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="flex items-center">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  className={`h-3.5 w-3.5 ${
                                    i < review.rating
                                      ? "fill-amber-400 text-amber-400"
                                      : "text-slate-200"
                                  }`}
                                />
                              ))}
                            </div>
                            {review.isVerified && (
                              <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold uppercase tracking-wide">
                                Verified
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-slate-400 flex-shrink-0">
                          {review.createdAt ? new Date(review.createdAt).toLocaleDateString() : 'N/A'}
                        </span>
                      </div>
                      {review.title && (
                        <h4 className="font-semibold text-sm text-slate-900 mb-1.5">{review.title}</h4>
                      )}
                      {review.comment && (
                        <p className="text-sm text-slate-600 leading-relaxed">{review.comment}</p>
                      )}
                      {review.ownerResponse && (
                        <div className="mt-3 p-3 bg-[#02665e]/5 rounded-lg border-l-3 border-[#02665e]">
                          <div className="text-xs font-bold text-[#02665e] uppercase tracking-wide mb-1">Owner Response</div>
                          <p className="text-sm text-slate-700">{review.ownerResponse}</p>
                          {review.ownerResponseAt && (
                            <div className="text-[10px] text-slate-400 mt-1.5">
                              {new Date(review.ownerResponseAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Neighborhood Guide */}
            {mode === "public" && location.regionName && (
              <NeighborhoodGuide location={location} />
            )}

            {/* Location: admins get the pin check card; guests and owners the map below */}
            {mode === "admin" ? (
              <section className="pb-8">
                <AdminPinMap
                  latitude={pinCoords?.lat ?? null}
                  longitude={pinCoords?.lng ?? null}
                  address={{ street: location.street, ward: location.ward, district: location.district, regionName: location.regionName, city: location.city }}
                  onFix={openCoordinateEditor}
                />
              </section>
            ) : (
            <section className="pb-8">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                    <MapPin className="h-5 w-5" aria-hidden />
                  </span>
                  <h2 className="m-0 text-lg font-semibold text-slate-900 sm:text-xl">Where you&apos;ll be</h2>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 shadow-sm">
                {(() => {
                  const lat = pinCoords?.lat ?? 0;
                  const lng = pinCoords?.lng ?? 0;
                  const hasCoords = lat !== 0 && lng !== 0;
                  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
                  if (hasCoords && mapboxToken) {
                    return (
                      <div className="relative aspect-[2/1] bg-slate-100 sm:aspect-[16/9]">
                        <Image
                          src={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+02665e(${lng},${lat})/${lng},${lat},14,0/900x450@2x?access_token=${encodeURIComponent(mapboxToken)}`}
                          alt=""
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    );
                  }
                  return (
                    <div className="relative flex aspect-[2/1] items-center justify-center bg-slate-50 sm:aspect-[16/9]">
                      <div className="text-center">
                        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#02665e]/10">
                          <MapPin className={hasCoords ? "h-5 w-5 text-[#02665e]" : "h-7 w-7 text-[#02665e]/40"} />
                        </div>
                        <p className="m-0 mt-0.5 text-xs text-slate-500">{hasCoords ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "No coordinates available"}</p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </section>
            )}

            {/* Audit history - Admin Only */}
            {mode === "admin" && (
              <PropertyAuditHistory
                events={auditHistory}
                loading={auditLoading}
                currentStatus={String(status || "UNKNOWN")}
              />
            )}
            {/* Owner Audit Trail */}
            {mode === "owner" && (
              <section className="border-b border-gray-200 pb-6">
                <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-5">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                      <FileText className="w-5 h-5" aria-hidden />
                    </span>
                    <h2 className="text-lg sm:text-xl font-semibold text-slate-900">Activity Log</h2>
                  </div>
                  {ownerAuditLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <LogoSpinner size="sm" ariaLabel="Loading activity" />
                      <span className="ml-2 text-sm text-gray-600">Loading…</span>
                    </div>
                  ) : ownerAuditHistory.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">No activity recorded yet</p>
                    </div>
                  ) : (
                    <div className="relative">
                      {/* Timeline line */}
                      <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />
                      <div className="space-y-0">
                        {ownerAuditHistory.map((a: any, i: number) => {
                          const actionMap: Record<string, { label: string; color: string; bg: string }> = {
                            PROPERTY_APPROVE: { label: "Approved for listing", color: "text-emerald-700", bg: "bg-emerald-100" },
                            PROPERTY_REJECT: { label: "Sent back for changes", color: "text-red-700", bg: "bg-red-100" },
                            PROPERTY_SUSPEND: { label: "Temporarily suspended", color: "text-orange-700", bg: "bg-orange-100" },
                            PROPERTY_UNSUSPEND: { label: "Restored", color: "text-blue-700", bg: "bg-blue-100" },
                            PROPERTY_UPDATE: { label: "Details updated", color: "text-slate-700", bg: "bg-slate-100" },
                            PROPERTY_SUBMIT: { label: "Submitted for review", color: "text-violet-700", bg: "bg-violet-100" },
                          };
                          const info = actionMap[a.action] || { label: a.action.replace(/PROPERTY_/g, "").replace(/_/g, " "), color: "text-slate-700", bg: "bg-slate-100" };
                          const dateStr = new Date(a.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                          const timeStr = new Date(a.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                          const actorLabel = a.actorName || (a.actorRole === "ADMIN" ? "NoLSAF Review" : "You");

                          return (
                            <div key={a.id || i} className="relative flex items-start gap-4 pl-1 py-3">
                              <div className={`relative z-10 w-7 h-7 rounded-full ${info.bg} flex items-center justify-center flex-shrink-0`}>
                                <div className={`w-2.5 h-2.5 rounded-full ${info.bg.replace("100", "500")}`} />
                              </div>
                              <div className="flex-1 min-w-0 -mt-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-sm font-semibold ${info.color}`}>{info.label}</span>
                                  <span className="text-xs text-slate-400">by {actorLabel}</span>
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">{dateStr} at {timeStr}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
                          </div>
                        </div>
                      </div>

      {/* Lightbox - Match Public View */}
      {showLightbox && photos.length > 0 ? createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Photo gallery"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLightbox(false);
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-4xl">
              <div className="flex items-center justify-between mb-3">
                <div className="text-white text-sm font-semibold truncate">{property.title || "Property"}</div>
            <button
                  type="button"
                  className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
              onClick={() => setShowLightbox(false)}
              aria-label="Close"
            >
                  <X className="w-5 h-5" />
            </button>
              </div>

              {/* Main image */}
              <div className="mx-auto w-full max-w-[720px]">
                <div className="relative rounded-2xl overflow-hidden bg-black h-[62vh] max-h-[520px] min-h-[320px]">
              <FillImage
                src={photos[selectedImageIndex]}
                alt=""
                className="object-contain"
                sizes="(min-width: 1024px) 720px, 100vw"
                priority
              />

                <button
                    type="button"
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                      setSelectedImageIndex((i) => (i <= 0 ? photos.length - 1 : i - 1));
                  }}
                    aria-label="Previous photo"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                      setSelectedImageIndex((i) => (i >= photos.length - 1 ? 0 : i + 1));
                  }}
                    aria-label="Next photo"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
                </div>
              </div>

              {/* Counter under photo */}
              <div className="mt-3 text-center text-white/90 text-sm font-semibold">
              {selectedImageIndex + 1} / {photos.length}
            </div>

              {/* Thumbnails strip */}
              <div className="mt-4 mx-auto w-full max-w-[920px] flex gap-2 overflow-x-auto pb-2 justify-center">
                {photos.map((src, i) => (
                  <button
                    key={`${src}-${i}`}
                    type="button"
                    className={[
                      "relative h-16 w-24 sm:h-20 sm:w-28 flex-shrink-0 rounded-xl overflow-hidden border",
                      i === selectedImageIndex ? "border-white" : "border-white/20",
                      "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
                      "motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.97]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                    ].join(" ")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedImageIndex(i);
                    }}
                    aria-label={`View photo ${i + 1}`}
                  >
                    <FillImage src={src} alt="" className="object-cover" sizes="120px" />
                  </button>
                ))}
          </div>
        </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* Approve Dialog */}
      {showApproveDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => {
            if (!saving) setShowApproveDialog(false);
          }}
        >
          <div
            className="bg-white rounded-xl p-4 sm:p-5 max-w-md w-full shadow-2xl my-auto max-h-[90vh] flex flex-col box-border overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Approve property"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex items-center justify-center h-10 w-10 rounded-full bg-emerald-100 flex-shrink-0">
                <CheckCircle2 className="h-5 w-5 text-emerald-700" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900">Approve this property?</h3>
                <p className="mt-1 text-xs sm:text-sm text-gray-600">
                  Are you sure you want to approve this property? It will become visible to guests.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  if (!saving) setShowApproveDialog(false);
                }}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowApproveDialog(false)}
                disabled={saving}
                className="order-2 sm:order-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-solid border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmApprove}
                disabled={saving}
                className="order-1 sm:order-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {saving ? "Approving..." : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Dialog */}
      {showRejectDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl p-4 sm:p-6 max-w-md w-full shadow-xl my-auto max-h-[90vh] flex flex-col">
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-3 sm:mb-4">Reject Property</h3>
            <p className="text-xs sm:text-sm text-gray-600 mb-3 sm:mb-4">Please provide reasons for rejection (comma-separated):</p>
            <textarea
              value={rejectReasons}
              onChange={(e) => setRejectReasons(e.target.value)}
              className="w-full px-3 py-2 border border-solid border-gray-300 rounded-lg mb-4 min-h-[100px] max-h-[200px] resize-y overflow-y-auto text-sm"
              placeholder="e.g., Insufficient photos, Missing location details, Quality issues"
            />
            <div className="flex flex-col sm:flex-row gap-2 justify-end mt-auto">
              <button
                onClick={() => {
                  setShowRejectDialog(false);
                  setRejectReasons("");
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-solid border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={saving || !rejectReasons.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Rejecting..." : "Reject Property"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend Dialog */}
      {showSuspendDialog && (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-xl p-4 sm:p-5 max-w-md w-full shadow-2xl my-auto max-h-[90vh] flex flex-col box-border overflow-hidden relative">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-3 flex-shrink-0">
              <div className="inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-orange-100 flex-shrink-0">
                <Ban className="h-4 w-4 sm:h-5 sm:w-5 text-orange-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">Suspend Property</h3>
                <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">Temporary removal from public view</p>
              </div>
            </div>
            
            {/* Warning Box */}
            <div className="bg-amber-50/80 border border-solid border-amber-200/60 rounded-lg p-2.5 sm:p-3 mb-3 flex-shrink-0">
              <p className="text-[11px] sm:text-xs text-amber-800 leading-relaxed">
                <strong className="font-semibold">Important:</strong> Suspending this property will remove it from public search and booking. 
                This is a temporary action to resolve disputes. The property will remain visible to admins only.
              </p>
            </div>

            {/* Content Area - Scrollable */}
            <div className="flex-1 min-h-0 overflow-y-auto mb-3 space-y-3">
              {/* Reason Textarea */}
              <div className="flex-shrink-0 min-w-0">
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5">
                  Suspension Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  onFocus={(e) => {
                    // Auto-fill with professional template if empty
                    if (!suspendReason.trim()) {
                      setSuspendReason(SUSPENSION_REASON_TEMPLATE);
                      // Set cursor at the end after auto-fill
                      setTimeout(() => {
                        e.target.setSelectionRange(e.target.value.length, e.target.value.length);
                      }, 0);
                    }
                  }}
                  className="w-full max-w-full min-w-0 px-3 py-2 border border-solid border-gray-300 rounded-lg min-h-[100px] max-h-[150px] resize-y overflow-y-auto text-xs sm:text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all box-border"
                  placeholder="Provide a detailed reason for suspending this property..."
                />
                <p className="text-[10px] sm:text-xs text-gray-500 mt-1.5">This reason will be stored in audit history and sent to the owner.</p>
              </div>

              {/* Checkbox */}
              <div className="flex-shrink-0">
                <label className="flex items-center gap-2 cursor-pointer min-w-0">
                  <input
                    type="checkbox"
                    checked={notifyOwnerOnSuspend}
                    onChange={(e) => setNotifyOwnerOnSuspend(e.target.checked)}
                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 flex-shrink-0 w-4 h-4"
                  />
                  <span className="text-xs sm:text-sm text-gray-700">Notify owner about this suspension</span>
                </label>
              </div>
            </div>

            {/* Action Buttons - Fixed at Bottom */}
            <div className="flex flex-col sm:flex-row gap-2 justify-end flex-shrink-0 pt-3 border-t border-gray-200 mt-auto">
              <button
                onClick={() => {
                  setShowSuspendDialog(false);
                  setSuspendReason("");
                  setNotifyOwnerOnSuspend(true);
                }}
                className="order-2 sm:order-1 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-solid border-gray-300 rounded-lg hover:bg-gray-50 transition-colors w-full sm:w-auto box-border"
              >
                Cancel
              </button>
              <button
                onClick={handleSuspend}
                disabled={saving || !suspendReason.trim()}
                className="order-1 sm:order-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full sm:w-auto box-border"
              >
                {saving ? "Suspending..." : "Confirm Suspension"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsuspend Dialog */}
      {showUnsuspendDialog && (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-xl p-4 sm:p-5 max-w-md w-full shadow-2xl my-auto max-h-[90vh] flex flex-col box-border overflow-hidden relative">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-3 flex-shrink-0">
              <div className="inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-blue-100 flex-shrink-0">
                <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">Unsuspend Property</h3>
                <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">Restore property to public view</p>
              </div>
            </div>
            
            {/* Warning Box */}
            <div className="bg-blue-50/80 border border-solid border-blue-200/60 rounded-lg p-2.5 sm:p-3 mb-3 flex-shrink-0">
              <p className="text-[11px] sm:text-xs text-blue-800 leading-relaxed">
                <strong className="font-semibold">Note:</strong> Unsuspending this property will restore it to public search and booking. 
                The property will be visible to all users and ready for bookings.
              </p>
            </div>

            {/* Content Area - Scrollable */}
            <div className="flex-1 min-h-0 overflow-y-auto mb-3">
              <div className="flex-shrink-0 min-w-0">
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5">
                  Unsuspension Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={unsuspendReason}
                  onChange={(e) => setUnsuspendReason(e.target.value)}
                  className="w-full max-w-full min-w-0 px-3 py-2 border border-solid border-gray-300 rounded-lg min-h-[100px] max-h-[150px] resize-y overflow-y-auto text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all box-border"
                  placeholder="Provide a detailed reason for unsuspending this property..."
                />
                <p className="text-[10px] sm:text-xs text-gray-500 mt-1.5">This reason will be stored in audit history.</p>
              </div>
            </div>

            {/* Action Buttons - Fixed at Bottom */}
            <div className="flex flex-col sm:flex-row gap-2 justify-end flex-shrink-0 pt-3 border-t border-gray-200 mt-auto">
              <button
                onClick={() => {
                  setShowUnsuspendDialog(false);
                  setUnsuspendReason("");
                }}
                className="order-2 sm:order-1 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-solid border-gray-300 rounded-lg hover:bg-gray-50 transition-colors w-full sm:w-auto box-border"
              >
                Cancel
              </button>
              <button
                onClick={handleUnsuspend}
                disabled={saving || !unsuspendReason.trim()}
                className="order-1 sm:order-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full sm:w-auto box-border"
              >
                {saving ? "Unsuspending..." : "Confirm Unsuspension"}
              </button>
            </div>
          </div>
        </div>
      )}

      <PropertyPinEditor
        open={showCoordinateDialog}
        onClose={() => !savingCoordinates && setShowCoordinateDialog(false)}
        propertyTitle={property?.title || "Property"}
        address={{
          street: (property as any)?.street ?? (property?.location as any)?.street,
          ward: (property as any)?.ward ?? (property?.location as any)?.ward,
          district: (property as any)?.district ?? (property?.location as any)?.district,
          regionName: (property as any)?.regionName ?? (property?.location as any)?.regionName,
          city: (property as any)?.city ?? (property?.location as any)?.city,
        }}
        latitude={pinCoords?.lat ?? null}
        longitude={pinCoords?.lng ?? null}
        saving={savingCoordinates}
        onSave={async ({ latitude, longitude, reason }) => {
          setCoordinateLatitude(String(latitude));
          setCoordinateLongitude(String(longitude));
          setCoordinateReason(reason);
          await handleCoordinateCorrection({ latitude, longitude, reason });
        }}
      />

      {/* Property Edit Modal */}
      {property && (
        <PropertyEditModal
          property={property}
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          onSave={async () => {
            // Force a complete reload by resetting property state first
            setProperty(null);
            setLoading(true);
            
            // Reload property data to get updated commission, discount rules, and room prices
            await loadProperty();
            
            // Also reload system commission in case it changed
            try {
              const response = await api.get("/api/public/support/system-settings");
              if (response.data?.commissionPercent !== undefined) {
                const commission = Number(response.data.commissionPercent);
                setSystemCommission(isNaN(commission) ? 0 : commission);
              }
            } catch (e) {
              // Silently fail
            }
            
            // Trigger parent's onUpdated callback to refresh the list
            onUpdated?.();
          }}
        />
      )}
    </div>
  );
}
