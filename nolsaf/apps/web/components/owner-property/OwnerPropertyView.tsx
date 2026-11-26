"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BedDouble,
  Bath,
  Building2,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Eye,
  Images,
  LayoutGrid,
  Loader2,
  MapPin,
  Pencil,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { BATHROOM_ICONS, OTHER_AMENITIES_ICONS } from "@/lib/amenityIcons";
import { ownerPropertyRefOrId, useOwnerPropertyHref } from "@/lib/ownerPropertyRefs";
import { getPropertyCommission } from "@/lib/priceUtils";
import LongStayInspectionReport, { inspectionScore, type PublicInspectionReport } from "@/app/public/properties/[slug]/LongStayInspectionReport";
import OwnerLeaseTerms from "./OwnerLeaseTerms";
import { longStayHomeFeatures, OwnerLongStayAmenities, OwnerLongStayNearby } from "./OwnerLongStayAmenities";
import { OwnerPriceBreakdown } from "./OwnerPriceBreakdown";
import { discountedNightlyNet } from "@/lib/roomDiscount";
import { groupServices, serviceIcon } from "@/lib/propertyServiceGroups";

/**
 * The owner's view of a listing: laid out the way guests see it on the public
 * page, with the owner's tools around it (status, edit, availability, floor
 * plan, room prices), a listing health check and a readable activity log.
 */

type Room = {
  raw: any;
  name: string;
  count: number;
  price: number;
  discount: number | null;
  beds: string;
  description: string;
  amenities: string[];
  bathItems: string[];
  bathPrivate: "yes" | "no" | null;
  smoking: "yes" | "no" | null;
  images: string[];
};

type AuditRow = { action: string; actorRole: string; actorName: string; createdAt: string };

const TZ = "Africa/Dar_es_Salaam";
/** "HOTEL" / "GUEST_HOUSE" / "luxury" -> "Hotel" / "Guest house" / "Luxury". */
const typeLabel = (v: unknown) => {
  const s = String(v ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

/**
 * Names typed in capitals read normally: "SHERATON HOTEL" -> "Sheraton Hotel".
 * Mixed-case words (NoLSAF) and real abbreviations keep their casing.
 */
const titleCase = (v: unknown) =>
  String(v ?? "")
    .split(/(\s+)/)
    .map((w) => {
      if (!/[A-Za-z]/.test(w) || w !== w.toUpperCase() || ["CBD", "VIP", "BNB", "B&B", "UN"].includes(w)) return w;
      const lower = w.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");

/** Same threshold as the API price guardrail (lib/priceGuardrails.ts LARGE_CHANGE_PERCENT). */
const LARGE_PRICE_CHANGE = 40;
const money = (n: number, currency = "TZS") => `${currency === "TZS" ? "TSh" : currency} ${Math.round(n).toLocaleString("en-US")}`;
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** Older descriptions were saved HTML-escaped more than once ("&amp;amp;#x27;"). Undo it for display. */
function decodeText(value: unknown): string {
  let text = String(value ?? "");
  for (let i = 0; i < 6; i += 1) {
    const next = text.replace(/&amp;/gi, "&");
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function parseJson<T>(value: any, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function bedsSummary(beds: any): string {
  if (!beds) return "";
  if (typeof beds === "string") return beds;
  const parts = Object.entries(beds as Record<string, number>)
    .filter(([, n]) => Number(n) > 0)
    .map(([kind, n]) => `${n} ${kind}`);
  return parts.join(", ");
}

function normalizeRooms(spec: any): Room[] {
  const list = parseJson<any[]>(spec, []);
  if (!Array.isArray(list)) return [];
  return list.map((r) => ({
    raw: r,
    name: String(r.roomType || r.name || r.label || "Room"),
    count: Number(r.roomsCount || r.count || r.quantity || 0),
    price: Number(r.pricePerNight || r.price || 0),
    discount: Number(r.discountPercent) > 0 ? Number(r.discountPercent) : null,
    beds: bedsSummary(r.beds) || String(r.bedsSummary || ""),
    description: decodeText(r.roomDescription || r.description || ""),
    amenities: Array.isArray(r.otherAmenities) ? r.otherAmenities : Array.isArray(r.amenities) ? r.amenities : [],
    bathItems: Array.isArray(r.bathItems) ? r.bathItems : [],
    bathPrivate: r.bathPrivate === "yes" || r.bathPrivate === "no" ? r.bathPrivate : null,
    smoking: r.smoking === "yes" || r.smoking === "no" ? r.smoking : null,
    images: Array.isArray(r.roomImages) ? r.roomImages.filter(Boolean) : [],
  }));
}

function serviceTags(services: any): string[] {
  const parsed = parseJson<any>(services, []);
  const tags = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tags) ? parsed.tags : [];
  return [...new Set(tags.map((t: any) => String(t).trim()).filter(Boolean))] as string[];
}

/** Activity codes in plain words. */
const ACTION_LABELS: Record<string, string> = {
  PROPERTY_CREATE: "Listing created",
  PROPERTY_UPDATE: "Details updated",
  PROPERTY_SUBMIT: "Sent for review",
  PROPERTY_APPROVE: "Approved for listing",
  PROPERTY_REJECT: "Changes requested",
  PROPERTY_SUSPEND: "Suspended",
  PROPERTY_UNSUSPEND: "Back online",
  COORDINATES_UPDATE: "Map location updated",
  PROPERTY_COORDINATES_UPDATE: "Map location updated by NoLSAF",
  PROPERTY_ROOM_PRICE_SET: "Room price changed",
  PROPERTY_CURRENCY_SET: "Currency set",
  CURRENCY_SET: "Currency set",
  NRMS_NIGHT_AUDIT_TIME_UPDATED: "Night Audit time changed",
  LAYOUT_REGENERATED: "Floor plan rebuilt",
};
function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const STATUS_META: Record<string, { label: string; tone: string; note: string }> = {
  APPROVED: { label: "Live", tone: "bg-[#5eead4]/15 text-[#5eead4] ring-[#5eead4]/30", note: "Guests can find and book this property." },
  PENDING: { label: "Awaiting approval", tone: "bg-amber-400/15 text-amber-200 ring-amber-300/30", note: "NoLSAF is reviewing it." },
  DRAFT: { label: "Draft", tone: "bg-white/10 text-white/70 ring-white/15", note: "Only you can see it." },
  REJECTED: { label: "Needs changes", tone: "bg-rose-400/15 text-rose-200 ring-rose-300/30", note: "Fix the points raised, then submit again." },
  SUSPENDED: { label: "Suspended", tone: "bg-rose-400/15 text-rose-200 ring-rose-300/30", note: "Hidden from guests. Contact NoLSAF." },
};

export default function OwnerPropertyView({ propertyId, slug, onBack, onUpdated }: { propertyId: number; slug?: string | null; onBack: () => void; onUpdated?: () => void }) {
  const href = useOwnerPropertyHref();
  const router = useRouter();
  const [editWarning, setEditWarning] = useState(false);
  const [property, setProperty] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [showAllAudit, setShowAllAudit] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [gallery, setGallery] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [discountInput, setDiscountInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Pricing control: a large change is confirmed with a reason (server rule, mirrored here).
  const [reasonInput, setReasonInput] = useState("");
  // Room cards keep description and amenities short until the owner opens them.
  const [openRoom, setOpenRoom] = useState<Record<number, boolean>>({});
  const [systemCommission, setSystemCommission] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/api/owner/properties/${propertyId}`);
      setProperty(r.data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.error || "This property could not be loaded.");
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
    apiClient.get<AuditRow[]>(`/api/owner/properties/${propertyId}/audit-history`)
      .then((r) => setAudit(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAudit([]));
  }, [load, propertyId]);

  useEffect(() => {
    let active = true;
    apiClient.get("/api/public/support/system-settings")
      .then((response) => {
        const settings = response.data?.data ?? response.data;
        const percent = Number(settings?.commissionPercent);
        if (active && Number.isFinite(percent) && percent >= 0 && percent <= 100) setSystemCommission(percent);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (gallery === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setGallery(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gallery]);

  const rooms = useMemo(() => normalizeRooms(property?.roomsSpec), [property?.roomsSpec]);
  const amenities = useMemo(() => serviceTags(property?.services), [property?.services]);
  const photos = useMemo(() => {
    const own = [
      ...(Array.isArray(property?.photos) ? property.photos : []),
      ...(Array.isArray(property?.images) ? property.images.map((img: any) => img?.url) : []),
    ].filter(Boolean) as string[];
    const roomShots = rooms.flatMap((room) => room.images);
    return [...new Set([...own, ...roomShots])];
  }, [property?.photos, property?.images, rooms]);
  const description = decodeText(property?.description);

  // Collapse runs of the same action (three "Currency set" in a minute read as one line).
  const auditRows = useMemo(() => {
    const rows: Array<AuditRow & { times: number }> = [];
    for (const row of audit ?? []) {
      const last = rows[rows.length - 1];
      if (last && last.action === row.action && last.actorName === row.actorName && Math.abs(new Date(last.createdAt).getTime() - new Date(row.createdAt).getTime()) < 60 * 60 * 1000) last.times += 1;
      else rows.push({ ...row, times: 1 });
    }
    return rows;
  }, [audit]);

  if (error) {
    return (
      <div className="w-full min-w-0 px-3 pb-12 sm:px-5 lg:px-6">
        <div className="rounded-lg border border-solid border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          {error}
          <button type="button" onClick={onBack} className="ml-2 border-0 bg-transparent font-semibold text-rose-900 underline">Back to My properties</button>
        </div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="w-full min-w-0 space-y-4 px-3 pb-12 sm:px-5 lg:px-6" aria-busy="true" aria-label="Loading property">
        <div className="h-36 rounded-lg bg-[#012a26]" />
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]"><div className="h-80 rounded-lg bg-slate-100" /><div className="grid gap-2"><div className="rounded-lg bg-slate-100" /><div className="rounded-lg bg-slate-100" /></div></div>
      </div>
    );
  }

  const status = String(property.status || "").toUpperCase();
  const statusMeta = STATUS_META[status] ?? { label: status.toLowerCase(), tone: "bg-white/10 text-white/70 ring-white/15", note: "" };
  const isLongStay = property.rentalMode === "LONG_STAY";
  const terms = isLongStay ? property.longStay : null;
  const rawServices = parseJson<Record<string, unknown> | string[]>(property.services, {});
  const serviceDetails = rawServices && !Array.isArray(rawServices) ? rawServices : {};
  const unitAmenities = isLongStay ? rooms.flatMap((room) => [...room.amenities, ...room.bathItems]) : [];
  const longStayFeatures = isLongStay ? longStayHomeFeatures(serviceDetails, amenities, unitAmenities, terms?.utilities?.security) : null;
  const amenityCount = longStayFeatures?.count ?? amenities.length;
  const hasUtilityTerms = Object.values(terms?.utilities ?? {}).some((value) => value === "INCLUDED" || value === "TENANT");
  const availability = property.longStayAvailability;
  const inspection = property.longStayInspection as (PublicInspectionReport & {
    inspector?: { name: string | null; code: string } | null;
  }) | undefined;
  const score = inspection?.status === "PASSED" ? inspectionScore(inspection.checks).score : null;
  const monthlyRent = Number(terms?.monthlyRent) || 0;
  const currency = (isLongStay ? terms?.currency : property.currency) || "TZS";
  const months = (count: number | null | undefined) => count == null ? "Not set" : `${count} month${count === 1 ? "" : "s"}`;
  const furnishing = ({ FURNISHED: "Furnished", SEMI: "Semi-furnished", UNFURNISHED: "Unfurnished" } as Record<string, string>)[terms?.furnished] || "Not set";
  const moveIn = availability?.reserved ? "Reserved"
    : availability?.availableNow ? "Available now"
    : availability?.availableFrom ? new Date(`${availability.availableFrom}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : availability ? "Currently let" : "Not set";
  const commissionServices = parseJson<Record<string, unknown>>(property.services, {});
  const customCommission = Number(commissionServices.commissionPercent);
  const hasCustomCommission = commissionServices.commissionPercent != null && Number.isFinite(customCommission) && customCommission >= 0 && customCommission <= 100;
  const commissionPercent = systemCommission === null && !hasCustomCommission
    ? null
    : getPropertyCommission({ services: commissionServices }, systemCommission ?? 0);
  // "KICHANGANI, TEMEKE, DAR-ES-SALAAM" -> "Kichangani, Temeke, Dar es Salaam"; repeated parts once.
  const placeCase = (v: unknown) => {
    const s = String(v ?? "").trim();
    if (!s) return "";
    return s
      .replace(/([A-Za-z])-(?=[A-Za-z])/g, "$1 ")
      .split(/\s+/)
      .map((w, i) => {
        const lower = w.toLowerCase();
        if (i > 0 && ["es", "wa", "ya", "na", "la"].includes(lower)) return lower;
        if (["CBD", "VIP", "UN"].includes(w)) return w; // real abbreviations keep their capitals
        return w === w.toUpperCase() ? lower.charAt(0).toUpperCase() + lower.slice(1) : w;
      })
      .join(" ");
  };
  const location = [property.street, property.ward, property.district, property.regionName || property.city]
    .map(placeCase)
    .filter((part, i, all) => part && all.findIndex((x) => x.toLowerCase() === part.toLowerCase()) === i)
    .join(", ");
  // Coordinates may arrive as numbers or numeric strings; anything else is "no pin".
  const lat = parseFloat(String(property.latitude ?? ""));
  const lng = parseFloat(String(property.longitude ?? ""));
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const totalRooms = rooms.reduce((sum, room) => sum + (room.count || 0), 0);
  const priced = rooms.filter((room) => room.price > 0);
  const fromPrice = priced.length ? Math.min(...priced.map((room) => room.price)) : Number(property.basePrice) || 0;
  const editHref = `/owner/properties/add?id=${ownerPropertyRefOrId(property.id)}`;

  const health = [
    { ok: photos.length >= 5, label: "At least 5 photos", detail: `${photos.length} photo${photos.length === 1 ? "" : "s"}` },
    { ok: description.length >= 150, label: "A full description", detail: description.length ? `${description.length} characters` : "None yet" },
    { ok: hasPin, label: "Map pin set", detail: hasPin ? (isLongStay ? "Tenants can find the home" : "Guests can find you") : "Not set" },
    isLongStay
      ? { ok: monthlyRent > 0, label: "Monthly rent set", detail: monthlyRent > 0 ? `${money(monthlyRent, currency)} per month` : "Set the rent for the whole home" }
      : { ok: rooms.length > 0 ? priced.length === rooms.length : fromPrice > 0, label: rooms.length > 0 ? "Every room priced" : "Nightly rate set", detail: rooms.length > 0 ? `${priced.length} of ${rooms.length} room types` : fromPrice > 0 ? `${money(fromPrice, currency)} per night` : "Set a nightly rate" },
    ...(isLongStay ? [{ ok: Boolean(terms?.minTermMonths && terms?.upfrontMonths), label: "Lease terms set", detail: terms?.minTermMonths ? `${months(terms.minTermMonths)} minimum` : "Add minimum term and upfront rent" }] : []),
    { ok: amenityCount >= 5, label: "Amenities listed", detail: `${amenityCount} listed` },
  ];
  const healthScore = Math.round((health.filter((h) => h.ok).length / health.length) * 100);

  const startEdit = (index: number) => {
    setEditing(index);
    setPriceInput(String(rooms[index].price || ""));
    setDiscountInput(rooms[index].discount ? String(rooms[index].discount) : "");
    setReasonInput("");
    setSaveError(null);
  };

  /** Signed % change from the room's current price, or null when there is no current price. */
  const changeFor = (index: number) => {
    const current = rooms[index]?.price || 0;
    const next = Number(priceInput);
    if (!(current > 0) || !Number.isFinite(next) || next <= 0) return null;
    return Math.round(((next - current) / current) * 1000) / 10;
  };

  // Only this room's price changes; the listing stays live (PATCH /room-price).
  const savePrice = async (index: number) => {
    const price = Number(priceInput);
    if (!Number.isFinite(price) || price <= 0) { setSaveError("Enter a price above zero."); return; }
    const discount = Number(discountInput);
    const pct = changeFor(index);
    const large = pct != null && Math.abs(pct) > LARGE_PRICE_CHANGE;
    if (large && reasonInput.trim().length < 5) {
      setSaveError("This is a big change. Add a short reason so guests and NoLSAF understand it.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.patch(`/api/owner/properties/${property.id}/room-price`, {
        roomIndex: index,
        pricePerNight: price,
        discountPercent: Number.isFinite(discount) && discount > 0 ? discount : null,
        ...(large ? { confirmLargeChange: true, reason: reasonInput.trim() } : {}),
      });
      await load();
      setEditing(null);
      onUpdated?.();
    } catch (e: any) {
      setSaveError(e?.response?.data?.error || "The price could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  // The full editor sends a live listing back to review, so say so first.
  const openEditor = () => {
    if (status === "APPROVED") setEditWarning(true);
    else router.push(editHref);
  };

  const card = "rounded-lg border border-solid border-slate-200 bg-white";

  return (
    <div id="owner-property-view" className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <style>{`:where(#owner-property-view, #owner-property-view *) { box-sizing: border-box; }`}</style>

      {/* Owner band */}
      <header className="overflow-hidden rounded-lg bg-[#012a26] text-white">
        <div className="px-5 pb-5 pt-5 sm:px-7">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-white/60 transition hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden /> My properties
          </button>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${statusMeta.tone}`}>{isLongStay && status === "APPROVED" ? "Approved" : statusMeta.label}</span>
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">{isLongStay ? "Long stay · Whole home" : "Nightly stay"}</span>
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/75">{typeLabel(property.type)}</span>
                {property.hotelStar ? <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200"><Star className="h-3 w-3 fill-current" aria-hidden />{typeLabel(property.hotelStar)}</span> : null}
              </div>
              <h1 className="m-0 mt-2 text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[32px]" title={property.title}>{titleCase(property.title)}</h1>
              <p className="m-0 mt-1 flex items-center gap-1.5 text-sm text-white/60"><MapPin className="h-4 w-4 shrink-0" aria-hidden />{location || "Location not set"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {slug && status === "APPROVED" ? (
                <a href={`/public/properties/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-md border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white no-underline transition hover:bg-white/[0.12]">
                  <Eye className="h-4 w-4" aria-hidden /> {isLongStay ? "View public listing" : "View as guest"} <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden />
                </a>
              ) : null}
              <Link href={isLongStay ? "/owner/long-stays" : href(property.id, "/availability")} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white no-underline transition hover:bg-white/[0.12]">
                <CalendarDays className="h-4 w-4" aria-hidden /> {isLongStay ? "Manage long stays" : "Availability"}
              </Link>
              <button type="button" onClick={openEditor} className="inline-flex h-10 items-center gap-1.5 rounded-md border-0 bg-[#5eead4] px-4 text-sm font-bold text-[#012a26] transition hover:bg-[#8ff3e1]">
                <Pencil className="h-4 w-4" aria-hidden /> Edit property
              </button>
            </div>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-white/10 bg-white/10 sm:grid-cols-5">
          {(isLongStay ? [
            { label: "Monthly rent", value: monthlyRent > 0 ? money(monthlyRent, currency) : "Not set", hint: "whole home" },
            { label: "Minimum lease", value: months(terms?.minTermMonths), hint: "lease length" },
            { label: "Bedrooms", value: property.totalBedrooms ?? "Not set", hint: furnishing },
            { label: "Bathrooms", value: property.totalBathrooms ?? "Not set", hint: "in total" },
            { label: "Move-in", value: moveIn, hint: "tenancy availability" },
          ] : [
            { label: "From", value: fromPrice > 0 ? `${money(fromPrice, currency)}` : "Not set", hint: "per night" },
            { label: "Guests", value: property.maxGuests ?? "0", hint: "maximum" },
            { label: "Rooms", value: totalRooms || property.totalBedrooms || 0, hint: `${rooms.length} room type${rooms.length === 1 ? "" : "s"}` },
            { label: "Bathrooms", value: property.totalBathrooms ?? 0, hint: "in total" },
            { label: "Listing health", value: `${healthScore}%`, hint: healthScore === 100 ? "complete" : "see checklist" },
          ]).map((fact) => (
            <div key={fact.label} className="bg-[#012a26] px-5 py-3.5 sm:px-6">
              <dt className="text-[12px] font-medium text-white/55">{fact.label}</dt>
              <dd className="m-0 mt-1 text-lg font-extrabold tabular-nums text-white">{fact.value}</dd>
              <p className="m-0 text-[11px] text-white/45">{fact.hint}</p>
            </div>
          ))}
        </dl>
        {isLongStay && (
          <a href="#long-stay-inspection" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-0 border-t border-solid border-white/15 px-5 py-3 text-sm text-white no-underline hover:bg-white/10 sm:px-6">
            <ShieldCheck className="h-4 w-4 text-[#5eead4]" aria-hidden />
            <span className="font-semibold">{score === null ? "View home inspection" : `Inspection score ${score}/100`}</span>
            {inspection?.visitedOn && inspection.inspector && <span className="text-white/65">Inspected by {inspection.inspector.name || inspection.inspector.code}</span>}
          </a>
        )}
      </header>

      {/* Gallery, as guests see it */}
      {photos.length > 0 ? (
        <section aria-label="Photos" className="relative grid gap-2 overflow-hidden rounded-lg sm:grid-cols-[2fr_1fr_1fr] sm:grid-rows-2" style={{ height: "min(56vw, 440px)" }}>
          {photos.slice(0, 5).map((src, index) => (
            <button
              key={src}
              type="button"
              onClick={() => setGallery(index)}
              className={`group relative overflow-hidden border-0 bg-slate-100 p-0 ${index === 0 ? "sm:row-span-2" : "hidden sm:block"}`}
              aria-label={`Open photo ${index + 1}`}
            >
              <img src={src} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
            </button>
          ))}
          <button type="button" onClick={() => setGallery(0)} className="absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-white/95 px-3 text-xs font-bold text-slate-900 shadow-md transition hover:bg-white">
            <Images className="h-4 w-4" aria-hidden /> All {photos.length} photos
          </button>
        </section>
      ) : (
        <section className="grid h-56 place-items-center rounded-lg border border-dashed border-slate-300 bg-white text-center">
          <div>
            <Images className="mx-auto h-6 w-6 text-slate-400" aria-hidden />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-700">No photos yet</p>
            <button type="button" onClick={openEditor} className="border-0 bg-transparent p-0 mt-2 inline-block text-xs font-bold text-[#02665e]">Add photos</button>
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* About */}
          <section className={`${card} p-5 sm:p-6`}>
            <h2 className="m-0 text-lg font-bold text-slate-900">{isLongStay ? "About this home" : "About this place"}</h2>
            {description ? (
              <>
                <p className={`m-0 mt-3 whitespace-pre-line text-sm leading-7 text-slate-700 ${aboutOpen ? "" : "line-clamp-5"}`}>{description}</p>
                {description.length > 420 && (
                  <button type="button" onClick={() => setAboutOpen((v) => !v)} className="mt-2 border-0 bg-transparent p-0 text-sm font-bold text-[#02665e] underline underline-offset-2">
                    {aboutOpen ? "Show less" : "Read more"}
                  </button>
                )}
              </>
            ) : (
              <p className="m-0 mt-3 text-sm text-slate-500">No description yet. {isLongStay ? "Tell prospective tenants what it’s like to live here." : "Tell guests what makes the place special."} <button type="button" onClick={openEditor} className="border-0 bg-transparent p-0 font-semibold text-[#02665e]">Write one</button></p>
            )}
          </section>

          {longStayFeatures ? <OwnerLongStayAmenities features={longStayFeatures} hasUtilityTerms={hasUtilityTerms} /> : (
          <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            <div className="flex items-baseline justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3 sm:px-5">
              <h2 className="m-0 text-base font-bold text-slate-900">What this place offers</h2>
              <span className="text-xs text-slate-500">{amenities.length} listed</span>
            </div>
            {amenities.length ? (
              /* One row per group: label on the left, compact chips on the right */
              <dl className="m-0 divide-y divide-slate-100">
                {groupServices(amenities).map((group) => (
                  <div key={group.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start sm:px-5">
                    <dt className={`flex items-center gap-1.5 pt-1 text-xs font-semibold ${group.key === "included" ? "text-emerald-700" : group.key === "safety" ? "text-rose-700" : "text-slate-500"}`}>
                      {group.key === "included" ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                      {group.title}
                      <span className="font-normal text-slate-400">{group.items.length}</span>
                    </dt>
                    <dd className="m-0 flex flex-wrap gap-1.5">
                      {group.items.map((item) => {
                        const Icon = serviceIcon(item.full);
                        return (
                          <span key={item.full} title={item.full}
                            className={`inline-flex items-center gap-1.5 rounded-md border border-solid px-2 py-1 text-[12.5px] ${
                              group.key === "included" ? "border-emerald-200 bg-emerald-50/70 font-medium text-emerald-900" : "border-slate-200 bg-white text-slate-700"
                            }`}>
                            <Icon className={`h-3.5 w-3.5 flex-none ${group.key === "included" ? "text-emerald-700" : group.key === "safety" ? "text-rose-600" : "text-[#02665e]"}`} aria-hidden />
                            {item.label}
                          </span>
                        );
                      })}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="m-0 px-4 py-4 text-sm text-slate-500 sm:px-5">No amenities listed yet.</p>
            )}
          </section>

          )}

          {isLongStay ? (
            <>
              {terms ? <OwnerLeaseTerms terms={terms} furnishing={furnishing} /> : (
                <section className={`${card} p-4 sm:p-6`}>
                  <h2 className="m-0 text-lg font-bold text-slate-900">Lease terms</h2>
                  <p className="m-0 mt-2 text-sm text-slate-600">Add monthly terms in the property editor.</p>
                </section>
              )}
              <LongStayInspectionReport report={inspection} inspector={inspection?.inspector} />
            </>
          ) : (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <h2 className="m-0 text-lg font-bold text-slate-900">Rooms and prices</h2>
              <span className="text-xs text-slate-500">{totalRooms} rooms in {rooms.length} type{rooms.length === 1 ? "" : "s"}</span>
            </div>
            {rooms.length === 0 ? (
              <p className={`${card} m-0 p-5 text-sm text-slate-500`}>No rooms added yet. <button type="button" onClick={openEditor} className="border-0 bg-transparent p-0 font-semibold text-[#02665e]">Add rooms</button></p>
            ) : rooms.map((room, index) => (
              <article key={`${room.name}-${index}`} className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
                {/* Head: what the room is, and its price with the action next to it */}
                <div className="grid grid-cols-1 gap-3 border-0 border-b border-solid border-slate-100 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:p-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><BedDouble className="h-4 w-4" aria-hidden /></span>
                      <h3 className="m-0 text-base font-bold text-slate-900">{room.name}</h3>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{room.count} room{room.count === 1 ? "" : "s"}</span>
                    </div>
                    <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      {room.beds ? <span className="inline-flex items-center gap-1"><BedDouble className="h-3.5 w-3.5" aria-hidden />{room.beds}</span> : null}
                      {room.bathPrivate ? <span className="inline-flex items-center gap-1"><Bath className="h-3.5 w-3.5" aria-hidden />{room.bathPrivate === "yes" ? "Private bathroom" : "Shared bathroom"}</span> : null}
                      {room.smoking ? <span>{room.smoking === "yes" ? "Smoking allowed" : "No smoking"}</span> : null}
                    </p>
                  </div>

                  {/* Price panel */}
                  <div className="flex items-center justify-between gap-4 rounded-md border border-solid border-slate-200 bg-slate-50 px-3 py-2 sm:min-w-[220px]">
                    <div className="min-w-0">
                      {room.price > 0 ? (
                        <>
                          <p className="m-0 text-[17px] font-extrabold tabular-nums text-[#02665e]">{money(room.price, currency)}</p>
                          <p className="m-0 text-[11px] text-slate-500">
                            per night
                            {room.discount ? <span className="ml-1.5 rounded bg-emerald-100 px-1 py-px font-semibold text-emerald-800">{room.discount}% off</span> : null}
                          </p>
                          {room.discount ? (
                            <p className="m-0 mt-0.5 text-[11px] text-slate-600">
                              With the discount you receive <span className="font-semibold tabular-nums text-slate-900">{money(discountedNightlyNet(room.price, room.discount), currency)}</span>
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="m-0 text-sm font-semibold text-amber-700">No price yet</p>
                      )}
                    </div>
                    {editing === index ? null : (
                      <button type="button" onClick={() => startEdit(index)}
                        className="inline-flex h-8 flex-none items-center gap-1.5 rounded-md border border-solid border-[#02665e]/30 bg-white px-2.5 text-xs font-semibold text-[#02665e] transition-colors hover:bg-[#02665e] hover:text-white">
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> {room.price > 0 ? "Edit price" : "Set price"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Price editor, opened from the price panel */}
                {editing === index ? (
                  <div className="border-0 border-b border-solid border-slate-100 bg-slate-50/70 p-4 sm:p-5">
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-end">
                      <label className="block text-xs font-medium text-slate-600">
                        Price per night ({currency})
                        <input value={priceInput} onChange={(e) => setPriceInput(e.target.value.replace(/[^\d.]/g, ""))} inputMode="numeric" autoFocus
                          className="mt-1 box-border h-10 w-full rounded-md border border-solid border-slate-300 bg-white px-3 text-sm font-bold tabular-nums text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                      </label>
                      <label className="block text-xs font-medium text-slate-600">
                        Discount %
                        <input value={discountInput} onChange={(e) => setDiscountInput(e.target.value.replace(/[^\d.]/g, ""))} inputMode="numeric" placeholder="0"
                          className="mt-1 box-border h-10 w-full rounded-md border border-solid border-slate-300 bg-white px-3 text-sm tabular-nums text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                      </label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setEditing(null)} disabled={saving} className="h-10 flex-1 rounded-md border border-solid border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:flex-none">Cancel</button>
                        <button type="button" onClick={() => void savePrice(index)} disabled={saving} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-4 text-xs font-semibold text-white hover:bg-[#014d47] disabled:opacity-60 sm:flex-none">
                          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                        </button>
                      </div>
                    </div>
                    {(() => {
                      const pct = changeFor(index);
                      if (pct == null || pct === 0) return null;
                      const large = Math.abs(pct) > LARGE_PRICE_CHANGE;
                      return (
                        <div className={`mt-2.5 rounded-md border border-solid px-3 py-2 ${large ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
                          <p className={`m-0 text-xs font-semibold ${large ? "text-amber-900" : "text-slate-600"}`}>
                            {pct > 0 ? "+" : ""}{pct}% compared with the current {(room.price || 0).toLocaleString("en-US")} {currency}
                            {large ? ". A change this big needs a short reason." : ""}
                          </p>
                          {large ? (
                            <input value={reasonInput} onChange={(e) => setReasonInput(e.target.value)} maxLength={300}
                              placeholder={pct > 0 ? "For example: December high season" : "For example: low season offer"}
                              aria-label="Reason for the price change"
                              className="mt-1.5 box-border h-9 w-full rounded-md border border-solid border-amber-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#02665e]" />
                          ) : null}
                        </div>
                      );
                    })()}
                    {saveError ? <p role="alert" className="m-0 mt-2 text-xs font-semibold text-rose-700">{saveError}</p> : null}
                    <OwnerPriceBreakdown rate={Number(priceInput)} commissionPercent={commissionPercent} currency={currency} />
                    <p className="m-0 mt-2 text-[11px] text-slate-500">Saves straight away and the listing stays live.</p>
                  </div>
                ) : null}

                {/* Body: description and amenities, kept short until asked */}
                {room.description || room.amenities.length > 0 || room.bathItems.length > 0 ? (
                  <div className="space-y-3 p-4 sm:p-5">
                    {room.description ? (
                      <div>
                        <p className={`m-0 text-sm leading-6 text-slate-600 ${openRoom[index] ? "" : "line-clamp-2"}`}>{room.description}</p>
                      </div>
                    ) : null}
                    {(() => {
                      const groups = [
                        { key: "room", title: "In the room", items: room.amenities, icons: OTHER_AMENITIES_ICONS, fallback: Sparkles },
                        { key: "bath", title: "Bathroom", items: room.bathItems, icons: BATHROOM_ICONS, fallback: Bath },
                      ].filter((g) => g.items.length > 0);
                      const open = !!openRoom[index];
                      const LIMIT = 6;
                      const hidden = groups.reduce((n, g) => n + Math.max(0, g.items.length - LIMIT), 0);
                      const longText = (room.description || "").length > 140;
                      return (
                        <>
                          {groups.map((g) => (
                            <div key={g.key}>
                              <p className="m-0 mb-1.5 text-[11px] font-semibold text-slate-500">{g.title} <span className="font-normal text-slate-400">{g.items.length}</span></p>
                              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                                {(open ? g.items : g.items.slice(0, LIMIT)).map((item) => {
                                  const Icon = (g.icons as Record<string, any>)[item] ?? g.fallback;
                                  return (
                                    <li key={`${g.key}-${item}`} className="inline-flex items-center gap-1.5 rounded-md border border-solid border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700">
                                      <Icon className="h-3.5 w-3.5 text-slate-500" aria-hidden />{item}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                          {hidden > 0 || longText ? (
                            <button type="button" onClick={() => setOpenRoom((s) => ({ ...s, [index]: !open }))} aria-expanded={open}
                              className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs font-semibold text-[#02665e] hover:underline">
                              {open ? "Show less" : hidden > 0 ? `Show all (${hidden} more)` : "Read more"}
                            </button>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                ) : null}
              </article>
            ))}
          </section>

          )}

          {/* Location */}
          <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            <div className="border-0 border-b border-solid border-slate-100 px-4 py-3 sm:px-5">
              <h2 className="m-0 text-base font-bold text-slate-900">{isLongStay ? "Home location" : "Where guests will be"}</h2>
              <p className="m-0 mt-0.5 flex items-start gap-1.5 text-sm text-slate-600">
                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" aria-hidden />
                {location || "Location not set"}
              </p>
            </div>
            {hasPin ? (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"><Check className="h-4 w-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-semibold text-slate-900">Map pin set</p>
                  <p className="m-0 font-mono text-xs tabular-nums text-slate-500">{lat.toFixed(5)}, {lng.toFixed(5)}</p>
                </div>
                <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 no-underline hover:bg-slate-50">
                  Open in Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 bg-amber-50/60 px-4 py-3 sm:px-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-amber-100 text-amber-800"><CircleAlert className="h-4 w-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-semibold text-amber-900">No map pin yet</p>
                  <p className="m-0 text-xs text-amber-800">The listing has no map pin.</p>
                </div>
                <button type="button" onClick={openEditor} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-amber-300 bg-white px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-50">
                  <MapPin className="h-3.5 w-3.5" aria-hidden /> Set the pin
                </button>
              </div>
            )}
            {isLongStay && <OwnerLongStayNearby services={serviceDetails} tags={[...amenities, ...unitAmenities]} />}
          </section>
        </div>

        {/* Owner side column */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-24">
          <section className={`${card} p-5`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 text-base font-bold text-slate-900">Listing health</h2>
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${healthScore === 100 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{healthScore}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${healthScore === 100 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${healthScore}%` }} />
            </div>
            <ul className="m-0 mt-4 list-none space-y-2.5 p-0">
              {health.map((item) => (
                <li key={item.label} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${item.ok ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {item.ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${item.ok ? "text-slate-900" : "text-slate-600"}`}>{item.label}</span>
                    <span className="block text-xs text-slate-500">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {healthScore < 100 && <button type="button" onClick={openEditor} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border-0 bg-[#012a26] text-xs font-bold text-white hover:bg-[#033a34]"><Pencil className="h-3.5 w-3.5" aria-hidden /> Improve the listing</button>}
          </section>

          <section className={`${card} p-5`}>
            <h2 className="m-0 text-base font-bold text-slate-900">Status</h2>
            <p className="m-0 mt-1 flex items-center gap-1.5 text-sm text-slate-600"><ShieldCheck className="h-4 w-4 text-[#02665e]" aria-hidden />{isLongStay && status === "APPROVED" ? "The home is approved for public listing. Inspection and availability determine whether tenants can reserve." : statusMeta.note}</p>
            <dl className="m-0 mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-2"><dt className="text-slate-500">Listed since</dt><dd className="m-0 font-semibold text-slate-800">{property.createdAt ? new Date(property.createdAt).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }) : "Not recorded"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-500">Last updated</dt><dd className="m-0 font-semibold text-slate-800">{property.updatedAt ? fmtWhen(property.updatedAt) : "Not recorded"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-500">Building</dt><dd className="m-0 font-semibold text-slate-800">{property.totalFloors ? `${property.totalFloors} floor${Number(property.totalFloors) === 1 ? "" : "s"}` : property.buildingType ? String(property.buildingType).replace(/_/g, " ") : "Not set"}</dd></div>
            </dl>
            {!isLongStay && <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href={href(property.id, "/layout")} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-solid border-slate-200 bg-white text-xs font-bold text-slate-700 no-underline hover:bg-slate-50"><LayoutGrid className="h-3.5 w-3.5" aria-hidden /> Floor plan</Link>
              <Link href={href(property.id, "/availability")} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-solid border-slate-200 bg-white text-xs font-bold text-slate-700 no-underline hover:bg-slate-50"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> Availability</Link>
            </div>}
          </section>

          <section className={`${card} p-5`}>
            <h2 className="m-0 text-base font-bold text-slate-900">Activity</h2>
            {audit === null ? (
              <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-slate-50" />)}</div>
            ) : auditRows.length === 0 ? (
              <p className="m-0 mt-2 text-xs text-slate-500">No activity recorded yet.</p>
            ) : (
              <>
                <ol className="m-0 mt-3 list-none space-y-0 p-0">
                  {(showAllAudit ? auditRows : auditRows.slice(0, 6)).map((row, index, list) => {
                    const highlight = row.action === "PROPERTY_APPROVE" || /APPROV/.test(row.action);
                    return (
                      <li key={`${row.action}-${row.createdAt}-${index}`} className="relative flex gap-3 pb-3 last:pb-0">
                        {index < list.length - 1 && <span className="absolute left-[7px] top-4 h-[calc(100%-8px)] w-px bg-slate-200" aria-hidden />}
                        <span className={`relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-solid border-white ${highlight ? "bg-emerald-500" : "bg-slate-300"}`} style={{ boxShadow: "0 0 0 1px #e2e8f0" }} />
                        <span className="min-w-0">
                          <span className={`block text-sm font-semibold ${highlight ? "text-emerald-700" : "text-slate-800"}`}>
                            {actionLabel(row.action)}{row.times > 1 ? <span className="ml-1 text-xs font-normal text-slate-400">×{row.times}</span> : null}
                          </span>
                          <span className="block text-[11px] text-slate-500">{row.actorName} · {fmtWhen(row.createdAt)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                {auditRows.length > 6 && (
                  <button type="button" onClick={() => setShowAllAudit((v) => !v)} className="mt-3 border-0 bg-transparent p-0 text-xs font-bold text-[#02665e]">
                    {showAllAudit ? "Show less" : `Show all ${auditRows.length}`}
                  </button>
                )}
              </>
            )}
            <p className="m-0 mt-3 flex items-center gap-1 text-[11px] text-slate-400"><Clock3 className="h-3 w-3" aria-hidden /> Times in EAT</p>
          </section>
        </aside>
      </div>

      {editWarning && (
        <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-5" role="presentation" onClick={() => setEditWarning(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="edit-warning-title" onClick={(e) => e.stopPropagation()} className="w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-lg">
            <div className="px-5 pb-4 pt-5">
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-amber-50 text-amber-700"><CircleAlert className="h-5 w-5" aria-hidden /></span>
              <h2 id="edit-warning-title" className="m-0 mt-3 text-lg font-bold text-slate-900">Saving changes takes the listing offline</h2>
              <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
                Your property is live. If you save changes in the editor, it goes back to Draft and guests cannot book it until you submit it again and NoLSAF approves the changes, usually within 1 to 2 business days.
              </p>
              <ul className="m-0 mt-3 list-none space-y-1.5 p-0 text-xs text-slate-600">
                <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />Room prices and discounts can be changed here without going offline.</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />Existing bookings are kept while the listing is in review.</li>
              </ul>
            </div>
            <div className="flex flex-col-reverse gap-2 border-0 border-t border-solid border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setEditWarning(false)} className="h-10 rounded-md border border-solid border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Keep it live</button>
              <button type="button" onClick={() => router.push(editHref)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border-0 bg-[#012a26] px-4 text-sm font-bold text-white hover:bg-[#033a34]">
                <Pencil className="h-4 w-4" aria-hidden /> Open the editor
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Full gallery */}
      {gallery !== null && (
        <div className="fixed inset-0 z-[10000] overflow-y-auto bg-slate-950/90 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="All photos" onClick={() => setGallery(null)}>
          <div className="mx-auto max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between text-white">
              <p className="m-0 flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4" aria-hidden />{property.title} · {photos.length} photos</p>
              <button type="button" onClick={() => setGallery(null)} aria-label="Close photos" className="grid h-10 w-10 place-items-center rounded-full border-0 bg-white/10 text-white hover:bg-white/20"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {photos.map((src, index) => (
                <img key={src} src={src} alt={`Photo ${index + 1}`} className={`w-full rounded-lg object-cover ${index === gallery ? "ring-4 ring-[#5eead4]" : ""}`} />
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="m-0 flex items-center justify-center gap-1.5 text-[11px] text-slate-400"><Users className="h-3 w-3" aria-hidden /> This is your owner view. {isLongStay ? "Prospective tenants see the public rental listing." : "Guests see the public booking listing."}</p>
    </div>
  );
}
