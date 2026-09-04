"use client";
import { useEffect, useState, useCallback, useMemo, Fragment, type ComponentType, type ReactNode } from "react";
import { useRouter, useParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import TableRow from "@/components/TableRow";
import Chart from "@/components/Chart";
import DatePickerField from "@/components/DatePickerField";
import { 
  Mail, Phone, Calendar, Lock, CheckCircle, XCircle,
  ShoppingCart, DollarSign, ArrowLeft, Ban, UserCheck, 
  CreditCard, Eye, History, Activity, Clock, X, Coins, Home, Tag, MoreHorizontal,
  ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight,
  Map as MapIcon, Car, Users, Star, Bookmark, Filter, Search, FileText
} from "lucide-react";

// IMPORTANT: Use same-origin requests so Next.js can proxy via `rewrites()`.
// Hardcoding `http://localhost:4000` from the browser triggers CORS failures.
const api = apiClient;

type UserDetail = {
  id: number;
  name: string | null;
  displayName?: string;
  bookingGuestName?: string | null;
  identityNameSource?: "ACCOUNT" | "BOOKING" | "MISSING";
  email: string | null;
  phone: string | null;
  registrationStatus?: "COMPLETE" | "INCOMPLETE";
  registrationSource?: string;
  profileCompletedAt?: string | null;
  role: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  suspendedAt: string | null;
  isDisabled: boolean | null;
  _count: {
    bookings: number;
  };
};

type CustomerActivity = {
  type: string;
  id: number;
  reference?: string | null;
  title: string;
  status: string;
  amount?: number;
  currency?: string;
  rating?: number;
  createdAt: string;
  meta?: Record<string, string | number | null> | null;
};

/**
 * Activity taxonomy.
 *
 * GET /admin/users/:id returns one flat, time-ordered feed built from seven
 * different tables, so nothing in the payload tells an admin which product a
 * row belongs to. The maps below are what turn that feed into readable
 * sections: stays, tours, transport, group trips, and everything else.
 */
type ActivityTabKey = "transport" | "tours" | "groups" | "other";
// No "overview" tab: the profile header already carries the identity, role,
// registration, and verification state it used to repeat.
type ProfileTabKey = "stays" | ActivityTabKey | "behaviour" | "audit";

const AUDIT_PAGE_SIZE = 8;

/** Turns a stored audit payload into readable label/value pairs. */
function parseAuditDetails(details: unknown): { key: string; value: string }[] {
  if (details === null || details === undefined || details === "") return [];
  let parsed: unknown = details;
  if (typeof details === "string") {
    const trimmed = details.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return [{ key: "Note", value: trimmed }];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [{ key: "Note", value: trimmed }];
    }
  }
  if (typeof parsed !== "object" || parsed === null) return [{ key: "Note", value: String(parsed) }];
  return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
    key: prettyMetaLabel(key),
    value:
      value === null || value === undefined || value === ""
        ? "Not set"
        : String(value).replaceAll("_", " "),
  }));
}

function auditActionTone(action: string): string {
  const value = String(action || "").toUpperCase();
  if (/SUSPEND(?!ED)|DISABLE|REJECT|REVOKE|DELETE|BLOCK/.test(value) && !/UNSUSPEND/.test(value)) {
    return "bg-red-50 text-red-700";
  }
  if (/UNSUSPEND|ENABLE|APPROVE|VERIFY|RESTORE/.test(value)) return "bg-emerald-50 text-emerald-700";
  if (/RESET|CHANGE|UPDATE/.test(value)) return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

type BehaviourSeverity = "CLEAN" | "WATCH" | "ACTION";

type BehaviourFilters = {
  months: number;
  recentDays: number;
  products: string[];
  from: string;
  to: string;
};

const BEHAVIOUR_ALL_PRODUCTS = [
  { key: "stays", label: "Stays" },
  { key: "tours", label: "Tours" },
  { key: "transport", label: "Transport" },
  { key: "groups", label: "Group stays" },
];

const BEHAVIOUR_PERIOD_OPTIONS = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" },
  { months: 24, label: "24 months" },
];

const BEHAVIOUR_RECENT_OPTIONS = [30, 90, 180];

const BEHAVIOUR_DEFAULT_FILTERS: BehaviourFilters = {
  months: 12,
  recentDays: 90,
  products: BEHAVIOUR_ALL_PRODUCTS.map((product) => product.key),
  from: "",
  to: "",
};

type BehaviourResponse = {
  window: { from: string; to: string; recentDays: number };
  filters?: { months: number; recentDays: number; products: string[]; custom: boolean; isFiltered: boolean };
  engagement: {
    months: string[];
    series: { month: string; stays: number; tours: number; transport: number; groups: number; other: number; logins: number }[];
    joinedAt: string | null;
    lastActivityAt: string | null;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
    totalLogins: number;
    recentLogins: number;
    activeSessions: number;
  };
  preferences: {
    byProduct: { key: string; label: string; records: number; value: number }[];
    topDestinations: { name: string; count: number }[];
    savedProperties: number;
    tripEstimates: number;
    reviewsWritten: number;
    averageRating: number | null;
  };
  funnel: {
    byProduct: { key: string; label: string; created: number; paid: number; completed: number; canceled: number; abandoned: number }[];
    totals: { created: number; paid: number; canceled: number; abandoned: number };
    plannedNeverBooked: number;
  };
  sharing?: {
    referralCode: string;
    referralLink: string;
    referredBy: { id: number; name: string | null; email: string | null; role: string; codeUsed: string | null } | null;
    referredUsers: { id: number; name: string | null; email: string | null; role: string; registrationStatus: string | null; createdAt: string }[];
    referredCount: number;
    completedCount: number;
    earnings: { status: string; count: number; amount: number; currency: string }[];
    propertiesShared: number;
    shareFunnel?: {
      shared: number;
      opened: number;
      totalOpens: number;
      registered: number;
      booked: number;
      legacyShares: number;
    };
    shares?: {
      id: number;
      propertyTitle: string | null;
      channel: string | null;
      openCount: number;
      registeredUserId: number | null;
      bookingId: number | null;
      createdAt: string;
    }[];
    shareAttributionNote: string;
  };
  payments?: {
    attempts: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    channels: { key: string; label: string; attempts: number; succeeded: number; failed: number; pending: number; share: number; attemptShare: number }[];
    providers: { provider: string; attempts: number; succeeded: number }[];
    coverage: string;
  };
  conduct: {
    band: BehaviourSeverity;
    accountSuspended: boolean;
    signals: { key: string; label: string; value: string; detail: string; threshold: string; severity: BehaviourSeverity }[];
    restrictions: { id: number; referenceCode: string; scope: string; status: string; reason: string; appliedAt: string; resolvedAt: string | null }[];
  };
  coverage: { note: string };
};

/**
 * Per tab accent. Every class is written out in full because Tailwind scans for
 * literal strings: a built-up `bg-${accent}-50` would be purged from the build.
 * The hues match BEHAVIOUR_PRODUCT_COLORS so a product keeps one colour from the
 * tab bar through to the charts.
 */
const PROFILE_TAB_ACCENTS: Record<
  ProfileTabKey,
  { activePill: string; activeIcon: string; activeBadge: string; idleIcon: string; idleHover: string }
> = {
  stays: {
    activePill: "bg-blue-50 text-blue-800 ring-1 ring-blue-200",
    activeIcon: "text-blue-600",
    activeBadge: "bg-blue-100 text-blue-800",
    idleIcon: "text-blue-400",
    idleHover: "hover:bg-blue-50 hover:text-blue-800 hover:ring-1 hover:ring-blue-100",
  },
  tours: {
    activePill: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
    activeIcon: "text-violet-600",
    activeBadge: "bg-violet-100 text-violet-800",
    idleIcon: "text-violet-400",
    idleHover: "hover:bg-violet-50 hover:text-violet-800 hover:ring-1 hover:ring-violet-100",
  },
  transport: {
    activePill: "bg-orange-50 text-orange-800 ring-1 ring-orange-200",
    activeIcon: "text-orange-600",
    activeBadge: "bg-orange-100 text-orange-800",
    idleIcon: "text-orange-400",
    idleHover: "hover:bg-orange-50 hover:text-orange-800 hover:ring-1 hover:ring-orange-100",
  },
  groups: {
    activePill: "bg-teal-50 text-teal-800 ring-1 ring-teal-200",
    activeIcon: "text-teal-600",
    activeBadge: "bg-teal-100 text-teal-800",
    idleIcon: "text-teal-400",
    idleHover: "hover:bg-teal-50 hover:text-teal-800 hover:ring-1 hover:ring-teal-100",
  },
  other: {
    activePill: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
    activeIcon: "text-rose-600",
    activeBadge: "bg-rose-100 text-rose-800",
    idleIcon: "text-rose-400",
    idleHover: "hover:bg-rose-50 hover:text-rose-800 hover:ring-1 hover:ring-rose-100",
  },
  behaviour: {
    activePill: "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200",
    activeIcon: "text-indigo-600",
    activeBadge: "bg-indigo-100 text-indigo-800",
    idleIcon: "text-indigo-400",
    idleHover: "hover:bg-indigo-50 hover:text-indigo-800 hover:ring-1 hover:ring-indigo-100",
  },
  audit: {
    activePill: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
    activeIcon: "text-violet-600",
    activeBadge: "bg-violet-100 text-violet-800",
    idleIcon: "text-violet-400",
    idleHover: "hover:bg-violet-50 hover:text-violet-800 hover:ring-1 hover:ring-violet-100",
  },
};

/** Product colours are shared by the engagement chart, the mix chart, and the funnels. */
const BEHAVIOUR_PRODUCT_COLORS: Record<string, string> = {
  stays: "#2563eb",
  tours: "#059669",
  transport: "#d97706",
  groups: "#7c3aed",
  other: "#64748b",
};

const BEHAVIOUR_BAND_STYLE: Record<BehaviourSeverity, { label: string; box: string; dot: string; blurb: string }> = {
  CLEAN: {
    label: "Clean",
    box: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    dot: "bg-emerald-500",
    blurb: "No signal crossed its watch threshold.",
  },
  WATCH: {
    label: "Watch",
    box: "bg-amber-50 text-amber-900 ring-amber-200",
    dot: "bg-amber-500",
    blurb: "At least one signal crossed its watch threshold. Worth a look, not a suspension.",
  },
  ACTION: {
    label: "Action needed",
    box: "bg-red-50 text-red-900 ring-red-200",
    dot: "bg-red-500",
    blurb: "At least one signal crossed its action threshold, or the account is already restricted.",
  },
};

/** Payment method colours: mobile money is the default rail in Tanzania. */
/** Chart.js needs literal colours, not Tailwind class names. */
const PAYMENT_CHANNEL_HEX: Record<string, string> = {
  MNO: "#059669",
  CARD: "#2563eb",
  BANK: "#7c3aed",
  UNKNOWN: "#94a3b8",
};

const PAYMENT_CHANNEL_TONES: Record<
  string,
  { box: string; bar: string; icon_color: string; icon: ComponentType<{ className?: string }> }
> = {
  MNO: { box: "bg-emerald-50 ring-emerald-200", bar: "bg-emerald-500", icon_color: "text-emerald-600", icon: Phone },
  CARD: { box: "bg-blue-50 ring-blue-200", bar: "bg-blue-500", icon_color: "text-blue-600", icon: CreditCard },
  BANK: { box: "bg-violet-50 ring-violet-200", bar: "bg-violet-500", icon_color: "text-violet-600", icon: Coins },
  UNKNOWN: { box: "bg-slate-50 ring-slate-200", bar: "bg-slate-400", icon_color: "text-slate-500", icon: Coins },
};

const BEHAVIOUR_SIGNAL_TONES: Record<BehaviourSeverity, { box: string; chip: string; label: string }> = {
  ACTION: { box: "bg-red-50 ring-red-200", chip: "bg-red-100 text-red-800", label: "Action" },
  WATCH: { box: "bg-amber-50 ring-amber-200", chip: "bg-amber-100 text-amber-900", label: "Watch" },
  CLEAN: { box: "bg-white ring-slate-200", chip: "bg-emerald-100 text-emerald-800", label: "Clean" },
};

function formatMonthLabel(month: string): string {
  const [year, monthPart] = month.split("-");
  const date = new Date(Number(year), Number(monthPart) - 1, 1);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function relativeDays(value: string | null): string {
  if (!value) return "Never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "Unknown";
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

const ACTIVITY_TYPE_META: Record<
  string,
  { label: string; icon: ComponentType<{ className?: string }> }
> = {
  ACCOMMODATION_BOOKING: { label: "Stay", icon: Home },
  TOUR_BOOKING: { label: "Tour", icon: MapIcon },
  TRANSPORT_BOOKING: { label: "Transport", icon: Car },
  GROUP_BOOKING: { label: "Group stay", icon: Users },
  PROPERTY_REVIEW: { label: "Review", icon: Star },
  SAVED_PROPERTY: { label: "Saved property", icon: Bookmark },
  CANCELLATION_REQUEST: { label: "Cancellation", icon: XCircle },
};

/** Which activity types feed each product tab. */
const ACTIVITY_TAB_TYPES: Record<ActivityTabKey, string[]> = {
  transport: ["TRANSPORT_BOOKING"],
  tours: ["TOUR_BOOKING"],
  groups: ["GROUP_BOOKING"],
  other: ["PROPERTY_REVIEW", "SAVED_PROPERTY", "CANCELLATION_REQUEST"],
};

const ACTIVITY_TAB_EMPTY: Record<ActivityTabKey, { title: string; hint: string; icon: ComponentType<{ className?: string }> }> = {
  transport: { title: "No transport bookings", hint: "Rides, transfers, and intercity trips will appear here.", icon: Car },
  tours: { title: "No tour bookings", hint: "Tours and safari packages booked by this customer will appear here.", icon: MapIcon },
  groups: { title: "No group stays", hint: "Group stays and group travel requests will appear here.", icon: Users },
  other: { title: "No other activity", hint: "Reviews, saved properties, and cancellation requests will appear here.", icon: MoreHorizontal },
};

const ACTIVITY_PAGE_SIZE = 6;

/** Header tint for the record card, matching each product's tab colour. */
const ACTIVITY_DETAIL_ACCENTS: Record<string, { header: string; tile: string; eyebrow: string }> = {
  ACCOMMODATION_BOOKING: { header: "bg-blue-50", tile: "bg-blue-100 text-blue-700", eyebrow: "text-blue-700" },
  TOUR_BOOKING: { header: "bg-emerald-50", tile: "bg-emerald-100 text-emerald-700", eyebrow: "text-emerald-700" },
  TRANSPORT_BOOKING: { header: "bg-amber-50", tile: "bg-amber-100 text-amber-700", eyebrow: "text-amber-800" },
  GROUP_BOOKING: { header: "bg-purple-50", tile: "bg-purple-100 text-purple-700", eyebrow: "text-purple-700" },
  PROPERTY_REVIEW: { header: "bg-rose-50", tile: "bg-rose-100 text-rose-700", eyebrow: "text-rose-700" },
  SAVED_PROPERTY: { header: "bg-rose-50", tile: "bg-rose-100 text-rose-700", eyebrow: "text-rose-700" },
  CANCELLATION_REQUEST: { header: "bg-rose-50", tile: "bg-rose-100 text-rose-700", eyebrow: "text-rose-700" },
  DEFAULT: { header: "bg-slate-50", tile: "bg-slate-100 text-slate-700", eyebrow: "text-slate-600" },
};

/**
 * A record only gets an Open link where a real Admin detail route exists.
 * Tours, transport, and group stays have no per-record Admin page yet, so the
 * eye button opens the detail panel on this page instead.
 */
function activityRecordHref(item: CustomerActivity): string | null {
  if (item.type === "ACCOMMODATION_BOOKING") return `/admin/bookings/${item.id}`;
  if (item.type === "CANCELLATION_REQUEST") return `/admin/cancellations/${item.id}`;
  return null;
}

function activityTypeLabel(type: string): string {
  return ACTIVITY_TYPE_META[type]?.label ?? String(type || "Activity").replaceAll("_", " ");
}

/**
 * Every status used to render emerald, so a payment-pending trip read as
 * healthy at a glance. Tone now follows meaning.
 */
function activityStatusTone(status?: string): string {
  const value = String(status || "").toUpperCase();
  if (!value) return "bg-gray-100 text-gray-600";
  if (/CANCEL|FAIL|REJECT|DECLIN|HIDDEN|EXPIRE|REFUND|DISPUT/.test(value)) return "bg-red-50 text-red-700";
  if (/PENDING|AWAIT|REQUEST|PROCESS|HOLD|UNPAID|DRAFT/.test(value)) return "bg-amber-50 text-amber-800";
  if (/CONFIRM|PAID|COMPLET|CHECKED_OUT|PUBLISH|APPROV|SUCCESS|RECOVERED|SETTLED/.test(value)) return "bg-emerald-50 text-emerald-700";
  return "bg-sky-50 text-sky-700";
}

function formatActivityDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function metaText(item: CustomerActivity, key: string): string {
  const value = item.meta?.[key];
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value);
}

function metaDate(item: CustomerActivity, key: string): string {
  const value = item.meta?.[key];
  if (!value) return "Not scheduled";
  return formatActivityDate(String(value));
}

/** "fromRegion" reads as "From region" in the detail panel. */
function prettyMetaLabel(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Colour and formatting per detail field. The dot carries the meaning: the two
 * ends of a journey read as green for pickup and red for dropoff, the driver
 * block is blue, dispatch is indigo, and the ride itself is amber.
 */
function metaFieldStyle(key: string): { dot: string; mono?: boolean; wrap?: boolean } {
  switch (key) {
    // `wrap` keeps a field in its own column and lets the text run onto a second
    // line, instead of claiming the full width the moment it grows long. Pickup
    // and dropoff belong side by side however long the place names are.
    case "pickup":
      return { dot: "bg-emerald-500", wrap: true };
    case "dropoff":
      return { dot: "bg-red-500", wrap: true };
    case "pickupCoordinates":
      return { dot: "bg-emerald-300", mono: true };
    case "dropoffCoordinates":
      return { dot: "bg-red-300", mono: true };
    case "destinationProperty":
    case "propertyId":
    case "location":
      return { dot: "bg-purple-400", wrap: true };
    case "driver":
      return { dot: "bg-blue-500", wrap: true };
    case "driverPhone":
      return { dot: "bg-blue-300" };
    case "assignedVia":
      return { dot: "bg-indigo-500", wrap: true };
    case "assignedAt":
      return { dot: "bg-indigo-300" };
    case "vehicleType":
      return { dot: "bg-amber-500" };
    case "passengers":
    case "headcount":
      return { dot: "bg-amber-300" };
    case "scheduledDate":
    case "checkIn":
    case "checkOut":
      return { dot: "bg-violet-500" };
    case "paymentStatus":
      return { dot: "bg-rose-400" };
    case "guestName":
    case "destination":
      return { dot: "bg-sky-400", wrap: true };
    default:
      return { dot: "bg-slate-300" };
  }
}

function prettyMetaValue(value: string | number | null): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="font-normal italic text-gray-400">Not set</span>;
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatActivityDate(text);
  // Enum values arrive shouting ("PREMIUM", "NATIONAL_ID"). Codes and
  // coordinates contain digits or dashes, so they are left untouched.
  if (/^[A-Z][A-Z_ ]{1,}$/.test(text)) return sentenceCaseStatus(text);
  return text;
}

function activityCodeLabel(type: string): string {
  if (type === "ACCOMMODATION_BOOKING") return "Booking code";
  if (type === "TOUR_BOOKING") return "Tour code";
  if (type === "TRANSPORT_BOOKING") return "Trip code";
  if (type === "GROUP_BOOKING") return "Group stay code";
  if (type === "CANCELLATION_REQUEST") return "Booking code";
  return "Reference code";
}

function activityUsesCode(type: string): boolean {
  return [
    "ACCOMMODATION_BOOKING",
    "TOUR_BOOKING",
    "TRANSPORT_BOOKING",
    "GROUP_BOOKING",
    "CANCELLATION_REQUEST",
  ].includes(type);
}

/**
 * Column definitions per product tab. Every tab leads with the record ID and
 * ends with an Open action, matching the Stays table so all five tabs read the
 * same way.
 */
/**
 * Page-wide advanced filters.
 *
 * Applied to the raw `bookings` and `activities` arrays before anything else
 * reads them, so every tab, every count, and every paginator inherits the same
 * scope automatically. The Behaviour tab additionally forwards the date range to
 * its own endpoint, because that panel aggregates server-side.
 */
type ProfileFilters = {
  from: string;
  to: string;
  statuses: string[];
  minAmount: string;
  maxAmount: string;
  search: string;
};

const PROFILE_FILTERS_DEFAULT: ProfileFilters = {
  from: "",
  to: "",
  statuses: [],
  minAmount: "",
  maxAmount: "",
  search: "",
};

function profileFiltersActive(filters: ProfileFilters): boolean {
  return Boolean(
    filters.from ||
      filters.to ||
      filters.statuses.length ||
      filters.minAmount ||
      filters.maxAmount ||
      filters.search.trim(),
  );
}

function withinDateRange(value: string | Date, filters: ProfileFilters): boolean {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return true;
  if (filters.from) {
    const start = new Date(`${filters.from}T00:00:00`).getTime();
    if (Number.isFinite(start) && time < start) return false;
  }
  if (filters.to) {
    const end = new Date(`${filters.to}T23:59:59.999`).getTime();
    if (Number.isFinite(end) && time > end) return false;
  }
  return true;
}

function withinAmountRange(amount: number | undefined, filters: ProfileFilters): boolean {
  const min = filters.minAmount ? Number(filters.minAmount) : null;
  const max = filters.maxAmount ? Number(filters.maxAmount) : null;
  if (min === null && max === null) return true;
  const value = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  if (min !== null && Number.isFinite(min) && value < min) return false;
  if (max !== null && Number.isFinite(max) && value > max) return false;
  return true;
}

function matchesSearch(fields: (string | number | null | undefined)[], term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field !== null && field !== undefined && String(field).toLowerCase().includes(needle));
}

function normalizeStatus(value: unknown): string {
  return String(value || "").toUpperCase();
}

/** "PAYMENT_PENDING" reads as "Payment pending" rather than shouting. */
function sentenceCaseStatus(status: string): string {
  const text = String(status || "").replaceAll("_", " ").toLowerCase().trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Orders status chips by meaning rather than alphabet, so the row reads as
 * settled, then in flight, then waiting, then failed. The families match
 * activityStatusTone, which is what colours each chip.
 */
function statusToneRank(status: string): number {
  const value = normalizeStatus(status);
  if (/CONFIRM|PAID|COMPLET|CHECKED_OUT|PUBLISH|APPROV|SUCCESS|RECOVERED|SETTLED/.test(value)) return 0;
  if (/PENDING|AWAIT|REQUEST|PROCESS|HOLD|UNPAID|DRAFT/.test(value)) return 2;
  if (/CANCEL|FAIL|REJECT|DECLIN|HIDDEN|EXPIRE|REFUND|DISPUT/.test(value)) return 3;
  return 1;
}

type ActivityColumn = {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  align?: "left" | "right";
  render: (item: CustomerActivity) => ReactNode;
};

function activityIdCell(item: CustomerActivity): ReactNode {
  return (
    <span className="inline-flex rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-bold tracking-wide text-slate-800">
      {item.id}
    </span>
  );
}

function activityCodeCell(item: CustomerActivity): ReactNode {
  const code = String(item.reference || "").trim();
  if (!code) return <span className="text-xs font-medium italic text-slate-400">Not assigned</span>;
  return <span className="font-mono text-xs font-bold tracking-wide text-emerald-700">{code}</span>;
}

function transportRouteLabel(item: CustomerActivity): string {
  const title = String(item.title || "").trim();
  if (!title || /^transport booking\s*#?\d+$/i.test(title)) return "Route not provided";
  return title;
}

function propertyTypeTone(type?: string | null): string {
  const value = String(type || "").toUpperCase();
  if (value.includes("HOTEL")) return "bg-blue-50 text-blue-700 ring-blue-100";
  if (value.includes("APARTMENT")) return "bg-violet-50 text-violet-700 ring-violet-100";
  if (value.includes("LODGE") || value.includes("CAMP")) return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (value.includes("VILLA") || value.includes("RESORT")) return "bg-amber-50 text-amber-700 ring-amber-100";
  if (value.includes("HOSTEL") || value.includes("GUEST")) return "bg-cyan-50 text-cyan-700 ring-cyan-100";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function activityAmountCell(item: CustomerActivity): ReactNode {
  if (typeof item.amount !== "number" || item.amount <= 0) {
    return <span className="text-sm italic text-gray-400">No charge</span>;
  }
  return (
    <span className="font-bold tabular-nums text-gray-900">
      {item.amount.toLocaleString()} {item.currency || "TZS"}
    </span>
  );
}

function activityStatusCell(item: CustomerActivity): ReactNode {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${activityStatusTone(item.status)}`}>
      {String(item.status || "RECORDED").replaceAll("_", " ")}
    </span>
  );
}

const ACTIVITY_TAB_COLUMNS: Record<ActivityTabKey, ActivityColumn[]> = {
  transport: [
    { key: "id", label: "ID", icon: Tag, render: activityIdCell },
    { key: "tripCode", label: "Trip code", icon: Tag, render: activityCodeCell },
    {
      key: "route",
      label: "Pickup and dropoff",
      icon: Car,
      // A ride is the pickup point the passenger chose and the dropoff, which is
      // usually a registered property. Region fields are often null, so they are
      // never the headline here.
      render: (item) => {
        const pickup = item.meta?.pickup ? String(item.meta.pickup) : null;
        const dropoff = item.meta?.dropoff ? String(item.meta.dropoff) : null;
        if (!pickup && !dropoff) {
          return (
            <div>
              <div className="font-semibold text-gray-900">{transportRouteLabel(item)}</div>
              <div className="mt-1 text-sm text-gray-600">Booked {formatActivityDate(item.createdAt)}</div>
            </div>
          );
        }
        return (
          <div className="max-w-sm">
            <div className="flex items-start gap-2">
              <span className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate text-sm font-semibold text-gray-900">{pickup || "Pickup not recorded"}</span>
            </div>
            <div className="mt-1 flex items-start gap-2">
              <span className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
              <span className="truncate text-sm font-semibold text-gray-900">{dropoff || "Dropoff not recorded"}</span>
            </div>
          </div>
        );
      },
    },
    {
      key: "vehicle",
      label: "Vehicle",
      render: (item) => <span className="text-sm text-gray-700">{metaText(item, "vehicleType")}</span>,
    },
    {
      key: "driver",
      label: "Driver",
      icon: UserCheck,
      // Assignment happens by auto dispatch or by an approved claim, so the row
      // shows both who is driving and how they got the ride.
      render: (item) => {
        const driver = item.meta?.driver ? String(item.meta.driver) : null;
        const assigned = Boolean(driver) && driver !== "Not assigned yet";
        if (!assigned) {
          return <span className="text-sm italic text-gray-400">Not assigned</span>;
        }
        return (
          <div>
            <div className="text-sm font-semibold text-gray-900">{driver}</div>
            <div className="mt-0.5 text-xs text-gray-500">{metaText(item, "assignedVia")}</div>
          </div>
        );
      },
    },
    {
      key: "scheduled",
      label: "Scheduled",
      icon: Calendar,
      render: (item) => <span className="text-sm font-semibold text-gray-900">{metaDate(item, "scheduledDate")}</span>,
    },
    { key: "amount", label: "Amount", icon: Coins, align: "right", render: activityAmountCell },
    { key: "status", label: "Status", icon: Tag, render: activityStatusCell },
  ],
  tours: [
    { key: "id", label: "ID", icon: Tag, render: activityIdCell },
    { key: "tourCode", label: "Tour code", icon: Tag, render: activityCodeCell },
    {
      key: "tour",
      label: "Tour",
      icon: MapIcon,
      render: (item) => (
        <div>
          <div className="font-semibold text-gray-900">{item.title}</div>
          <div className="mt-1 text-sm text-gray-600">Booked {formatActivityDate(item.createdAt)}</div>
        </div>
      ),
    },
    {
      key: "destination",
      label: "Destination",
      render: (item) => <span className="text-sm text-gray-700">{metaText(item, "destination")}</span>,
    },
    {
      key: "guest",
      label: "Guest",
      render: (item) => <span className="text-sm text-gray-700">{metaText(item, "guestName")}</span>,
    },
    { key: "amount", label: "Amount", icon: Coins, align: "right", render: activityAmountCell },
    {
      key: "status",
      label: "Status",
      icon: Tag,
      render: (item) => (
        <div>
          {activityStatusCell(item)}
          {item.meta?.paymentStatus && (
            <div className="mt-1.5 text-xs text-gray-500">Payment: {String(item.meta.paymentStatus).replaceAll("_", " ")}</div>
          )}
        </div>
      ),
    },
  ],
  groups: [
    { key: "id", label: "ID", icon: Tag, render: activityIdCell },
    { key: "groupStayCode", label: "Group stay code", icon: Tag, render: activityCodeCell },
    {
      key: "trip",
      label: "Trip",
      icon: Users,
      render: (item) => (
        <div>
          <div className="font-semibold text-gray-900">{item.title}</div>
          <div className="mt-1 text-sm text-gray-600">Requested {formatActivityDate(item.createdAt)}</div>
        </div>
      ),
    },
    {
      key: "groupType",
      label: "Group type",
      render: (item) => <span className="text-sm text-gray-700">{metaText(item, "groupType")}</span>,
    },
    {
      key: "headcount",
      label: "Guests",
      render: (item) => <span className="text-sm font-semibold tabular-nums text-gray-900">{metaText(item, "headcount")}</span>,
    },
    { key: "amount", label: "Amount", icon: Coins, align: "right", render: activityAmountCell },
    { key: "status", label: "Status", icon: Tag, render: activityStatusCell },
  ],
  other: [
    { key: "id", label: "ID", icon: Tag, render: activityIdCell },
    {
      key: "item",
      label: "Item",
      icon: MoreHorizontal,
      render: (item) => (
        <div className="max-w-xs">
          <div className="truncate font-semibold text-gray-900">{item.title}</div>
          <div className="mt-1 text-sm text-gray-600">{formatActivityDate(item.createdAt)}</div>
        </div>
      ),
    },
    {
      key: "type",
      label: "Type",
      render: (item) => (
        <span className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
          {activityTypeLabel(item.type)}
        </span>
      ),
    },
    {
      key: "detail",
      label: "Detail",
      render: (item) => {
        if (typeof item.rating === "number") {
          return <span className="text-sm font-bold text-amber-600">{item.rating}/5 rating</span>;
        }
        if (item.type === "SAVED_PROPERTY") {
          return <span className="text-sm text-gray-700">{item.meta?.sharedAt ? "Saved and shared" : "Saved only"}</span>;
        }
        if (item.type === "CANCELLATION_REQUEST") {
          return <span className="block max-w-xs truncate text-sm text-gray-700">{metaText(item, "reason")}</span>;
        }
        return <span className="text-sm italic text-gray-400">No detail</span>;
      },
    },
    { key: "status", label: "Status", icon: Tag, render: activityStatusCell },
  ],
};

type Booking = {
  id: number;
  status: string;
  checkIn: string;
  checkOut: string;
  totalAmount: number;
  guestName: string | null;
  guestPhone: string | null;
  roomCode: string | null;
  createdAt: string;
  property: {
    id: number;
    title: string;
    type: string | null;
    regionName: string | null;
    city: string | null;
    district: string | null;
  };
  code: {
    id: number;
    status: string;
    codeVisible: string | null;
  } | null;
};

/** Every hat this account wears. User.role is one column and cannot say that
 *  a customer also tends a bar at one property and sells as a partner. */
type UserRole = {
  source: "ACCOUNT" | "NRMS_STAFF" | "SALES_PARTNER" | "TRAVEL_AGENCY" | "TOUR_OPERATOR" | "PROPERTY_OWNER" | "MERCHANT_ADMIN";
  code: string;
  label: string;
  scope: string | null;
  status: string;
  active: boolean;
  /** True when the role sits alongside User.role rather than replacing it.
   *  Becoming a tour operator or travel agency changes the account role, so
   *  those are not things a customer "also holds". */
  additive: boolean;
  since: string | null;
  detail: string | null;
};

type UserRoleSummary = {
  accountRole: string;
  roles: UserRole[];
  activeCount: number;
  additiveCount: number;
  hasAdditionalRoles: boolean;
  badges: string[];
};

type UserDetailResponse = {
  user?: UserDetail | null;
  roles?: UserRoleSummary | null;
  bookings?: Booking[];
  activities?: CustomerActivity[];
  activityCounts?: Record<string, number>;
  stats?: {
    booking: {
      total: number;
      confirmed: number;
      checkedIn: number;
      checkedOut: number;
      canceled: number;
    };
    activity?: {
      totalRecords: number;
      settled: number;
      canceled: number;
      valueTzs: number;
      byCurrency: { currency: string; amount: number; records: number; convertedAmount: number; convertedTzs: number; unconvertedAmount: number }[];
      unconvertedCurrencies: string[];
      byProduct: { key: string; label: string; records: number }[];
    };
    revenue: {
      total: number;
      invoiceCount: number;
    };
    lastBooking: {
      id: number;
      createdAt: string;
      status: string;
    } | null;
  };
};

type BookingSortKey = "property" | "propertyType" | "region" | "district" | "checkInOut" | "amount" | "status" | "code";

export default function AdminUserDetailPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const userId = Number(idParam);
  const isValidUserId = Number.isFinite(userId) && userId > 0;
  const router = useRouter();
  const [data, setData] = useState<UserDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [tab, setTab] = useState<ProfileTabKey>("stays");
  const [auditHistory, setAuditHistory] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [showUnsuspendForm, setShowUnsuspendForm] = useState(false);
  const [unsuspendNotification, setUnsuspendNotification] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [bookingPage, setBookingPage] = useState(1);
  const bookingPageSize = 6;
  const [bookingSortBy, setBookingSortBy] = useState<BookingSortKey>("checkInOut");
  const [bookingSortDir, setBookingSortDir] = useState<"asc" | "desc">("desc");
  const [activityPage, setActivityPage] = useState(1);
  const [activityDetail, setActivityDetail] = useState<CustomerActivity | null>(null);
  const [behaviour, setBehaviour] = useState<BehaviourResponse | null>(null);
  const [behaviourLoading, setBehaviourLoading] = useState(false);
  const [behaviourError, setBehaviourError] = useState<string | null>(null);
  // Draft holds what the admin is editing; applied is what produced the data on
  // screen, so the numbers never drift from the filter chips describing them.
  const [behaviourDraft, setBehaviourDraft] = useState<BehaviourFilters>(BEHAVIOUR_DEFAULT_FILTERS);
  const [behaviourApplied, setBehaviourApplied] = useState<BehaviourFilters>(BEHAVIOUR_DEFAULT_FILTERS);
  const [behaviourFiltersOpen, setBehaviourFiltersOpen] = useState(false);
  // Clean signals are collapsed by default so the ones that need attention are
  // not buried among six that do not.
  const [showCleanSignals, setShowCleanSignals] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState(false);

  const [profileFilters, setProfileFilters] = useState<ProfileFilters>(PROFILE_FILTERS_DEFAULT);
  const [profileFiltersOpen, setProfileFiltersOpen] = useState(false);

  const allBookings = useMemo(() => data?.bookings ?? [], [data]);
  const allActivities = useMemo(() => data?.activities ?? [], [data]);
  const filtersActive = profileFiltersActive(profileFilters);

  // Every status the customer actually has, so the picker never offers a value
  // that would return nothing.
  const statusOptions = useMemo(() => {
    const seen = new Set<string>();
    allBookings.forEach((booking) => seen.add(normalizeStatus(booking.status)));
    allActivities.forEach((item) => seen.add(normalizeStatus(item.status)));
    seen.delete("");
    return [...seen].sort(
      (a, b) => statusToneRank(a) - statusToneRank(b) || a.localeCompare(b),
    );
  }, [allBookings, allActivities]);

  // Filtering happens here, once, before anything downstream reads the arrays.
  const bookings = useMemo(() => {
    if (!filtersActive) return allBookings;
    return allBookings.filter(
      (booking) =>
        withinDateRange(booking.createdAt, profileFilters) &&
        (profileFilters.statuses.length === 0 || profileFilters.statuses.includes(normalizeStatus(booking.status))) &&
        withinAmountRange(Number(booking.totalAmount), profileFilters) &&
        matchesSearch(
          [booking.property?.title, booking.code?.codeVisible, booking.guestName, `#${booking.id}`],
          profileFilters.search,
        ),
    );
  }, [allBookings, profileFilters, filtersActive]);

  const activities = useMemo(() => {
    if (!filtersActive) return allActivities;
    return allActivities.filter(
      (item) =>
        withinDateRange(item.createdAt, profileFilters) &&
        (profileFilters.statuses.length === 0 || profileFilters.statuses.includes(normalizeStatus(item.status))) &&
        withinAmountRange(item.amount, profileFilters) &&
        matchesSearch(
          [item.title, item.reference, activityTypeLabel(item.type), `#${item.id}`],
          profileFilters.search,
        ),
    );
  }, [allActivities, profileFilters, filtersActive]);

  const allActivityByTab = useMemo(() => {
    const buckets: Record<ActivityTabKey, number> = { transport: 0, tours: 0, groups: 0, other: 0 };
    for (const item of allActivities) {
      const key = (Object.keys(ACTIVITY_TAB_TYPES) as ActivityTabKey[]).find((tabKey) =>
        ACTIVITY_TAB_TYPES[tabKey].includes(item.type),
      );
      if (key) buckets[key] += 1;
    }
    return buckets;
  }, [allActivities]);

  // One bucket per product tab, newest first (the API already sorts the feed).
  const activityByTab = useMemo(() => {
    const buckets: Record<ActivityTabKey, CustomerActivity[]> = {
      transport: [],
      tours: [],
      groups: [],
      other: [],
    };
    for (const item of activities) {
      const key = (Object.keys(ACTIVITY_TAB_TYPES) as ActivityTabKey[]).find((tabKey) =>
        ACTIVITY_TAB_TYPES[tabKey].includes(item.type),
      );
      if (key) buckets[key].push(item);
    }
    return buckets;
  }, [activities]);

  const activeActivityTab: ActivityTabKey | null =
    tab === "transport" || tab === "tours" || tab === "groups" || tab === "other" ? tab : null;

  const activeActivityItems = useMemo(
    () => (activeActivityTab ? activityByTab[activeActivityTab] : []),
    [activeActivityTab, activityByTab],
  );
  const activityTotalPages = Math.max(1, Math.ceil(activeActivityItems.length / ACTIVITY_PAGE_SIZE));
  const pagedActivities = useMemo(
    () =>
      activeActivityItems.slice(
        (activityPage - 1) * ACTIVITY_PAGE_SIZE,
        activityPage * ACTIVITY_PAGE_SIZE,
      ),
    [activeActivityItems, activityPage],
  );

  // Each tab paginates independently, so reset when the tab changes.
  useEffect(() => {
    setActivityPage(1);
  }, [tab]);

  // Escape closes the record card, the behaviour every modal is expected to have.
  useEffect(() => {
    if (!activityDetail) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivityDetail(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activityDetail]);

  // A narrowed result set must not leave the reader stranded on a page that no
  // longer exists.
  useEffect(() => {
    setActivityPage(1);
    setBookingPage(1);
  }, [profileFilters]);

  // Behaviour aggregates server-side, so the page date range has to travel to
  // its endpoint rather than being applied to an array.
  useEffect(() => {
    if (tab !== "behaviour") return;
    if (behaviourApplied.from === profileFilters.from && behaviourApplied.to === profileFilters.to) return;
    loadBehaviour({ ...behaviourApplied, from: profileFilters.from, to: profileFilters.to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profileFilters.from, profileFilters.to]);

  const sortedBookings = useMemo(() => {
    const next = [...bookings];
    const readValue = (booking: Booking): string | number => {
      switch (bookingSortBy) {
        case "property":
          return String(booking.property?.title || "").toLowerCase();
        case "propertyType":
          return String(booking.property?.type || "").toLowerCase();
        case "region":
          return String(booking.property?.regionName || "").toLowerCase();
        case "district":
          return String(booking.property?.district || "").toLowerCase();
        case "checkInOut":
          return booking.checkIn ? new Date(booking.checkIn).getTime() : 0;
        case "amount":
          return Number(booking.totalAmount || 0);
        case "status":
          return String(booking.status || "").toLowerCase();
        case "code":
          return String(booking.code?.codeVisible || booking.code?.status || "").toLowerCase();
        default:
          return "";
      }
    };

    next.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return bookingSortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return bookingSortDir === "asc" ? cmp : -cmp;
    });

    return next;
  }, [bookings, bookingSortBy, bookingSortDir]);

  const bookingTotalPages = Math.max(1, Math.ceil(sortedBookings.length / bookingPageSize));
  const safeBookingPage = Math.min(bookingPage, bookingTotalPages);
  const bookingStartIndex = (safeBookingPage - 1) * bookingPageSize;
  const pagedBookings = sortedBookings.slice(bookingStartIndex, bookingStartIndex + bookingPageSize);

  function handleBookingSort(field: BookingSortKey) {
    if (bookingSortBy === field) {
      setBookingSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setBookingSortBy(field);
    setBookingSortDir(field === "checkInOut" || field === "amount" ? "desc" : "asc");
  }

  function renderBookingSortIcon(field: BookingSortKey) {
    if (bookingSortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return bookingSortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-emerald-600" />
      : <ChevronDown className="h-3.5 w-3.5 text-emerald-600" />;
  }

  useEffect(() => {
    setBookingPage(1);
  }, [tab, bookingSortBy, bookingSortDir, data?.bookings?.length]);

  const load = useCallback(async () => {
    if (!isValidUserId) return;
    setLoading(true);
    try {
      const r = await api.get<UserDetailResponse>(`/api/admin/users/${userId}`);
      setData(r.data);
      setLoadError(null);
    } catch (err: any) {
      console.error("Failed to load user details:", err);
      const serverData = err?.response?.data;
      const stage = typeof serverData?.stage === "string" ? serverData.stage : null;
      const message = typeof serverData?.message === "string" ? serverData.message : null;
      const errorText =
        stage || message
          ? `Server error${stage ? ` (${stage})` : ""}${message ? `: ${message}` : ""}`
          : (typeof serverData?.error === "string" ? serverData.error : null);
      setLoadError(errorText || "Failed to load user details");
      if (err?.response?.status === 404) {
        alert("User not found");
        router.push("/admin/users/list");
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]); // router is stable, don't include in deps

  // The behaviour aggregate is heavier than the profile payload, so it loads
  // once, the first time the tab is opened.
  const loadBehaviour = useCallback(async (filters: BehaviourFilters) => {
    if (!isValidUserId) return;
    try {
      setBehaviourLoading(true);
      setBehaviourError(null);
      const params = new URLSearchParams();
      params.set("recentDays", String(filters.recentDays));
      if (filters.from || filters.to) {
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
      } else {
        params.set("months", String(filters.months));
      }
      if (filters.products.length && filters.products.length < BEHAVIOUR_ALL_PRODUCTS.length) {
        params.set("products", filters.products.join(","));
      }
      const r = await api.get<BehaviourResponse>(`/api/admin/users/${userId}/behaviour?${params.toString()}`);
      setBehaviour(r.data);
      setBehaviourApplied(filters);
    } catch (err: any) {
      console.error("Failed to load behaviour:", err);
      setBehaviourError(err?.response?.data?.error || "Could not load behaviour data.");
    } finally {
      setBehaviourLoading(false);
    }
  }, [userId, isValidUserId]);

  useEffect(() => {
    if (tab === "behaviour" && !behaviour && !behaviourLoading && !behaviourError) {
      loadBehaviour(BEHAVIOUR_DEFAULT_FILTERS);
    }
  }, [tab, behaviour, behaviourLoading, behaviourError, loadBehaviour]);

  const loadAuditHistory = useCallback(async () => {
    if (!isValidUserId) return;
    try {
      setAuditLoading(true);
      const r = await api.get<any>(`/api/admin/audits?targetId=${userId}`);
      const raw: any = r.data;
      const next =
        Array.isArray(raw)
          ? raw
          : (
              (Array.isArray(raw?.items) && raw.items) ||
              (Array.isArray(raw?.data) && raw.data) ||
              (Array.isArray(raw?.data?.items) && raw.data.items) ||
              []
            );
      setAuditHistory(next);
    } catch (err: any) {
      console.error("Failed to load audit history:", err);
      setAuditHistory([]);
    } finally {
      setAuditLoading(false);
    }
  }, [userId, isValidUserId]);

  useEffect(() => {
    if (isValidUserId) {
      load();
      loadAuditHistory();
    } else {
      setLoading(false);
    }
  }, [load, loadAuditHistory, isValidUserId]);

  async function handleSuspendSubmit() {
    if (!suspendReason.trim()) {
      setSuccessMessage(null);
      alert("Please provide a reason for suspension. This action will be logged.");
      return;
    }
    
    setActionLoading(true);
    try {
      await api.post(`/api/admin/users/${userId}/suspend`, { 
        reason: suspendReason.trim()
      });
      setSuspendReason("");
      setShowSuspendForm(false);
      await load();
      await loadAuditHistory();
      setSuccessMessage("User suspended successfully. The user can no longer access their account.");
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      console.error("Failed to suspend user:", err);
      setSuccessMessage(null);
      alert(err?.response?.data?.error || "Failed to suspend user");
    } finally {
      setActionLoading(false);
    }
  }

  function handleSuspendClick() {
    setShowSuspendForm(true);
    setSuspendReason("");
  }

  function cancelSuspend() {
    setShowSuspendForm(false);
    setSuspendReason("");
  }

  async function handleUnsuspendSubmit() {
    if (!unsuspendNotification.trim()) {
      setSuccessMessage(null);
      alert("Please provide a notification message for the user. This will be logged in the audit history.");
      return;
    }
    
    setActionLoading(true);
    try {
      await api.post(`/api/admin/users/${userId}/unsuspend`, { 
        notification: unsuspendNotification.trim()
      });
      setUnsuspendNotification("");
      setShowUnsuspendForm(false);
      await load();
      await loadAuditHistory();
      setSuccessMessage("User unsuspended successfully. The user can now access their account again.");
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      console.error("Failed to unsuspend user:", err);
      setSuccessMessage(null);
      alert(err?.response?.data?.error || "Failed to unsuspend user");
    } finally {
      setActionLoading(false);
    }
  }

  function handleUnsuspendClick() {
    setShowUnsuspendForm(true);
    setUnsuspendNotification("");
  }

  function cancelUnsuspend() {
    setShowUnsuspendForm(false);
    setUnsuspendNotification("");
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-emerald-600"></div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <div className="text-center">
          <p className="m-0 text-gray-500">{loadError || "Failed to load user data"}</p>
          <Link href="/admin/users/list" className="text-emerald-600 hover:text-emerald-700 mt-4 inline-block">
            ← Back to users list
          </Link>
        </div>
      </div>
    );
  }

  const user = data.user ?? null;
  const stats =
    data.stats ??
    ({
      booking: {
        total: 0,
        confirmed: 0,
        checkedIn: 0,
        checkedOut: 0,
        canceled: 0,
      },
      revenue: {
        total: 0,
        invoiceCount: 0,
      },
      lastBooking: null,
    } satisfies NonNullable<UserDetailResponse["stats"]>);

  if (!user) {
    return (
      <div className="p-6">
        <div className="text-center">
          <p className="m-0 text-gray-500">User not found (or invalid response)</p>
          <Link href="/admin/users/list" className="text-emerald-600 hover:text-emerald-700 mt-4 inline-block">
            ← Back to users list
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-w-0 overflow-x-clip bg-gray-50">
      <div className="mx-auto box-border w-full max-w-[1440px] min-w-0 px-3 py-3 sm:px-4 sm:py-4 lg:px-5 xl:px-6">
        {/* Success Message Card */}
        {successMessage && (
          <div className="mb-4 flex animate-in items-start gap-3 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 p-4 shadow-sm slide-in-from-top-2">
            <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-emerald-500 flex items-center justify-center">
              <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm sm:text-base font-bold text-emerald-900 mb-1">Success!</h4>
              <p className="m-0 text-xs text-emerald-800 sm:text-sm">{successMessage}</p>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="flex-shrink-0 p-1.5 hover:bg-emerald-100 rounded-lg transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-700" />
            </button>
          </div>
        )}

        {/* Clean responsive profile summary */}
        {/* ring-* and inset shadows rather than border-*: preflight is disabled in
            this app, so a bare `border` sets no border-style and draws nothing,
            which left the buttons and dividers here invisible. */}
        <div className="mb-4 min-w-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex min-w-0 flex-col gap-3 px-4 py-4 xl:flex-row xl:items-center xl:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/admin/users/list" className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white text-slate-500 no-underline ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900 hover:ring-slate-300" title="Back to users list">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              {/* The avatar ring doubles as the account state light: emerald when
                  the account is healthy, red once it is suspended or disabled. */}
              <div
                className={`inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold ring-2 ${
                  user.suspendedAt || user.isDisabled
                    ? "bg-red-50 text-red-700 ring-red-200"
                    : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                }`}
              >
                {(user.displayName || user.name || `U${user.id}`).split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="m-0 truncate text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{user.displayName || user.name || `User #${user.id}`}</h1>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{sentenceCaseStatus(user.role)}</span>
                  {user.registrationStatus === "INCOMPLETE" && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">Incomplete profile</span>}
                  {(user.suspendedAt || user.isDisabled) && <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-red-200"><Ban className="h-3 w-3" />Suspended</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                    ID #{user.id}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    Customer since {new Date(user.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap xl:flex-nowrap xl:justify-end">
              {user.phone && <a href={`tel:${user.phone}`} className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-xl bg-white px-3.5 text-xs font-semibold text-slate-700 no-underline ring-1 ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300 sm:min-w-[80px]"><Phone className="h-3.5 w-3.5 text-emerald-600" />Call</a>}
              {user.email && <a href={`mailto:${user.email}`} className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-xl bg-white px-3.5 text-xs font-semibold text-slate-700 no-underline ring-1 ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300 sm:min-w-[80px]"><Mail className="h-3.5 w-3.5 text-blue-600" />Email</a>}
              {/* A printable record of everything this customer has used and
                  paid for, for the case where they come back disputing it. */}
              <Link href={`/admin/users/${userId}/statement`} className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-xl bg-white px-3.5 text-xs font-semibold text-slate-700 no-underline ring-1 ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300 sm:min-w-[80px]"><FileText className="h-3.5 w-3.5 text-violet-600" />Statement</Link>
              {user.suspendedAt ? (
                <button onClick={handleUnsuspendClick} disabled={actionLoading} className="col-span-2 inline-flex h-9 appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-emerald-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50 sm:col-span-1"><UserCheck className="h-3.5 w-3.5" />Unsuspend</button>
              ) : (
                <button onClick={handleSuspendClick} disabled={actionLoading} className="col-span-2 inline-flex h-9 appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-red-50 px-4 text-xs font-bold text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 hover:ring-red-300 disabled:opacity-50 sm:col-span-1"><Ban className="h-3.5 w-3.5" />Suspend</button>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap gap-2 bg-slate-50/70 p-2.5 shadow-[inset_0_1px_0_#e2e8f0] sm:p-3">
            <div className="box-border flex w-full min-w-0 items-center gap-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200/80 sm:w-[calc(50%_-_0.25rem)] xl:w-[calc(25%_-_0.375rem)]">
              <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Mail className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">Email</p><p className="m-0 break-all text-sm font-semibold leading-5 text-slate-900">{user.email || "Not provided"}</p></div>
            </div>
            <div className="box-border flex w-full min-w-0 items-center gap-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200/80 sm:w-[calc(50%_-_0.25rem)] xl:w-[calc(25%_-_0.375rem)]">
              <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Phone className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">Phone</p><p className="m-0 break-words text-sm font-semibold leading-5 text-slate-900">{user.phone || "Not provided"}</p></div>
            </div>
            <div className="box-border flex w-full min-w-0 items-center gap-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200/80 sm:w-[calc(50%_-_0.25rem)] xl:w-[calc(25%_-_0.375rem)]">
              <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Calendar className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">Joined</p><p className="m-0 text-sm font-semibold leading-5 text-slate-900">{new Date(user.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {new Date(user.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div>
            </div>
            <div className="box-border flex w-full min-w-0 items-center gap-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200/80 sm:w-[calc(50%_-_0.25rem)] xl:w-[calc(25%_-_0.375rem)]">
              <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Activity className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">Registration</p><p className="m-0 text-sm font-semibold capitalize leading-5 text-slate-900">{String(user.registrationSource || "Unknown").replaceAll("_", " ").toLowerCase()}</p></div>
            </div>
          </div>

          {/* Always rendered: an account with nothing verified is exactly the one
              an admin needs to see the row for. */}
          {(
            <div className="flex flex-wrap items-center gap-2 bg-white px-4 py-2.5 shadow-[inset_0_1px_0_#f1f5f9] sm:px-5">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Verification</span>
              {/* Unverified is worth showing too: a missing chip is easy to miss,
                  a grey "not verified" chip is not. */}
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${user.emailVerifiedAt ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"}`}>
                {user.emailVerifiedAt ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                Email {user.emailVerifiedAt ? "verified" : "not verified"}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${user.phoneVerifiedAt ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"}`}>
                {user.phoneVerifiedAt ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                Phone {user.phoneVerifiedAt ? "verified" : "not verified"}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${user.twoFactorEnabled ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200" : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"}`}>
                <Lock className="h-3.5 w-3.5" />
                2FA {user.twoFactorEnabled ? "enabled" : "off"}
              </span>
              {user.isDisabled && <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700"><XCircle className="h-3.5 w-3.5" />Disabled</span>}
            </div>
          )}

          {/* Roles beyond the account role. One person is often several things
              at once: a customer who also tends a bar and sells as a partner.
              Reading User.role alone hides all of it. */}
          {data?.roles && data.roles.hasAdditionalRoles ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 bg-white px-4 py-2.5 shadow-[inset_0_1px_0_#f1f5f9] sm:px-5">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Also holds</span>
              {data.roles.roles
                .filter((r) => r.additive)
                .map((r, i) => (
                  <span
                    key={`${r.source}-${r.code}-${i}`}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      r.active
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"
                    }`}
                    title={[
                      r.scope,
                      r.detail,
                      r.active ? null : `Status: ${sentenceCaseStatus(r.status)}`,
                      r.since ? `Since ${new Date(r.since).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : null,
                    ].filter(Boolean).join(" · ")}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${r.active ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
                    {r.label}
                    {r.scope ? <span className="font-normal opacity-70">{r.scope}</span> : null}
                    {/* A pending invite is a role on record, not a role in use. */}
                    {r.active ? null : <span className="font-normal opacity-70">({sentenceCaseStatus(r.status)})</span>}
                  </span>
                ))}
            </div>
          ) : null}
        </div>

        {/* Suspend Form */}
        {showSuspendForm && (
          <div className="w-full bg-white rounded-xl border border-red-200 shadow-sm p-3 sm:p-4 md:p-6 mb-4 sm:mb-6 box-border">
            <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <div className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <Ban className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4 text-red-600" />
              </div>
              <h3 className="text-sm sm:text-base md:text-lg font-semibold text-gray-900">Suspend User</h3>
            </div>
            <div className="space-y-2.5 sm:space-y-3 md:space-y-4">
              <div className="w-full">
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-1.5 md:mb-2">
                  Reason for Suspension <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="w-full min-h-[70px] sm:min-h-[80px] md:min-h-[100px] px-2.5 sm:px-3 md:px-4 py-2 sm:py-2.5 md:py-3 text-xs sm:text-sm md:text-base border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all resize-none box-border"
                  placeholder="Enter the reason for suspending this user. This will be logged in the audit history."
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-2.5 md:gap-3">
                <button
                  onClick={handleSuspendSubmit}
                  disabled={actionLoading || !suspendReason.trim()}
                  className="w-full sm:w-auto sm:flex-initial px-3 sm:px-4 md:px-5 py-2 sm:py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm md:text-base font-medium shadow-sm hover:shadow-md whitespace-nowrap"
                >
                  {actionLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 sm:h-4 sm:w-4 border-2 border-white border-t-transparent flex-shrink-0"></div>
                      <span>Suspending...</span>
                    </>
                  ) : (
                    "Confirm Suspend"
                  )}
                </button>
                <button
                  onClick={cancelSuspend}
                  disabled={actionLoading}
                  className="w-full sm:w-auto sm:flex-initial px-3 sm:px-4 md:px-5 py-2 sm:py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm md:text-base font-medium whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Unsuspend Form */}
        {showUnsuspendForm && (
          <div className="w-full bg-white rounded-xl border border-emerald-200 shadow-sm p-3 sm:p-4 md:p-6 mb-4 sm:mb-6 box-border">
            <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <div className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <UserCheck className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4 text-emerald-600" />
              </div>
              <h3 className="text-sm sm:text-base md:text-lg font-semibold text-gray-900">Unsuspend User</h3>
            </div>
            <div className="space-y-2.5 sm:space-y-3 md:space-y-4">
              <div className="w-full">
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-1.5 md:mb-2">
                  Notification Message <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="w-full min-h-[70px] sm:min-h-[80px] md:min-h-[100px] px-2.5 sm:px-3 md:px-4 py-2 sm:py-2.5 md:py-3 text-xs sm:text-sm md:text-base border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none box-border"
                  placeholder="Enter a notification message for the user. This will be logged in the audit history."
                  value={unsuspendNotification}
                  onChange={(e) => setUnsuspendNotification(e.target.value)}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-2.5 md:gap-3">
                <button
                  onClick={handleUnsuspendSubmit}
                  disabled={actionLoading || !unsuspendNotification.trim()}
                  className="w-full sm:w-auto sm:flex-initial px-3 sm:px-4 md:px-5 py-2 sm:py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm md:text-base font-medium shadow-sm hover:shadow-md whitespace-nowrap"
                >
                  {actionLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 sm:h-4 sm:w-4 border-2 border-white border-t-transparent flex-shrink-0"></div>
                      <span>Unsuspending...</span>
                    </>
                  ) : (
                    "Confirm Unsuspend"
                  )}
                </button>
                <button
                  onClick={cancelUnsuspend}
                  disabled={actionLoading}
                  className="w-full sm:w-auto sm:flex-initial px-3 sm:px-4 md:px-5 py-2 sm:py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm md:text-base font-medium whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Unified account metrics across every product, not just stays. */}
        {(() => {
          const activityStats = stats.activity;
          const productBreakdown = (activityStats?.byProduct || []).filter((entry) => entry.records > 0);
          const foreign = (activityStats?.byCurrency || []).filter((entry) => entry.currency !== "TZS");
          // Only amounts that are not already folded into the TZS figure get
          // their own line, so a currency is never counted twice on the tile.
          const excludedForeign = foreign.filter((entry) => entry.unconvertedAmount > 0);
          const totalValue = activityStats ? activityStats.valueTzs : stats.revenue.total;

          const tile = "box-border flex w-full min-w-0 items-center gap-3 rounded-xl bg-white px-3.5 py-3 shadow-sm ring-1 ring-slate-200 sm:w-[calc(50%_-_0.25rem)] lg:w-[calc(25%_-_0.375rem)]";
          const label = "m-0 text-[10px] font-bold uppercase tracking-wider text-slate-400";
          // Toned down from text-2xl/font-black: at that weight four tiles in a
          // row shouted over the rest of the page.
          const figure = "m-0 text-xl font-bold leading-7 tracking-tight text-slate-900";
          const note = "m-0 truncate text-[11px] leading-4 text-slate-500";

          return (
            <div className="mb-4 flex min-w-0 flex-wrap gap-2">
              <div className={tile}>
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ShoppingCart className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className={label}>Total activity</p>
                  <p className={figure}>{activityStats?.totalRecords ?? stats.booking.total}</p>
                  {/* The per-service split is the tab bar directly below, so
                      repeating it here only truncated it. This says what the
                      tabs cannot: how many streams were actually used, and
                      when the account was last active. */}
                  <p className={note}>
                    {productBreakdown.length
                      ? `${productBreakdown.length} of 4 services used`
                      : "No service used yet"}
                    {stats.lastBooking?.createdAt
                      ? ` · last ${new Date(stats.lastBooking.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
                      : ""}
                  </p>
                </div>
              </div>

              <div className={tile}>
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><CheckCircle className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className={label}>Confirmed</p>
                  <p className={figure}>{activityStats?.settled ?? stats.booking.confirmed}</p>
                  <p className={note}>
                    {activityStats
                      ? [
                          `${activityStats.canceled} canceled`,
                          // Everything that is neither settled nor canceled is
                          // still open. Leaving it out made the numbers look
                          // like they did not add up.
                          activityStats.totalRecords - activityStats.settled - activityStats.canceled > 0
                            ? `${activityStats.totalRecords - activityStats.settled - activityStats.canceled} still open`
                            : null,
                        ].filter(Boolean).join(" · ")
                      : "Ready or completed stays"}
                  </p>
                </div>
              </div>

              <div className={tile}>
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><DollarSign className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className={label}>Total value</p>
                  <p className={figure}>
                    {totalValue.toLocaleString()}
                    <span className="ml-1 text-[11px] font-semibold text-slate-500">TZS</span>
                  </p>
                  {/* Currencies are listed, never summed together. Only amounts
                      that are not already inside the TZS figure get their own
                      line, so nothing is counted twice. The tooltip carries the
                      reason so the tile itself stays plain. */}
                  {excludedForeign.length > 0 ? (
                    excludedForeign.map((entry) => (
                      <p
                        key={entry.currency}
                        className="m-0 truncate text-sm font-semibold leading-5 text-slate-700"
                        title={`${entry.unconvertedAmount.toLocaleString()} ${entry.currency} recorded separately from the TZS total`}
                      >
                        {entry.unconvertedAmount.toLocaleString()}
                        <span className="ml-1 text-[11px] font-semibold text-slate-500">{entry.currency}</span>
                      </p>
                    ))
                  ) : (
                    <p className={note}>All products, money of record</p>
                  )}
                </div>
              </div>

              <div className={tile}>
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><CreditCard className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className={label}>Invoices</p>
                  <p className={figure}>{stats.revenue.invoiceCount}</p>
                  <p className={note}>Documents issued</p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Tabs */}
        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* One row of product tabs. Every customer-facing stream this profile
              knows about gets its own tab, so there is no combined feed. */}
          <div className="bg-white p-2 shadow-[inset_0_-1px_0_#e2e8f0]">
            <div className="flex min-w-0 flex-wrap gap-1 rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200">
              {([
                { key: "stays", label: "Stays", count: bookings.length, total: allBookings.length, icon: Home },
                { key: "tours", label: "Tours", count: activityByTab.tours.length, total: allActivityByTab.tours, icon: MapIcon },
                { key: "transport", label: "Transport", count: activityByTab.transport.length, total: allActivityByTab.transport, icon: Car },
                { key: "groups", label: "Group Stays", count: activityByTab.groups.length, total: allActivityByTab.groups, icon: Users },
                { key: "other", label: "Other Activities", count: activityByTab.other.length, total: allActivityByTab.other, icon: MoreHorizontal },
                { key: "behaviour", label: "Behaviour", count: null, total: null, icon: Activity },
                { key: "audit", label: "Audit", count: auditHistory.length, total: null, icon: History },
              ] as { key: ProfileTabKey; label: string; count: number | null; total: number | null; icon: ComponentType<{ className?: string }> }[]).map((entry) => {
                const active = tab === entry.key;
                const TabIcon = entry.icon;
                const accent = PROFILE_TAB_ACCENTS[entry.key];
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setTab(entry.key)}
                    aria-current={active ? "page" : undefined}
                    // appearance-none, border-0, and an explicit background are
                    // required, not redundant: Tailwind preflight is disabled, so
                    // a <button> with no background class falls back to the UA
                    // grey buttonface and renders as a solid block.
                    className={`inline-flex flex-1 appearance-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border-0 px-3 py-2 text-xs font-bold transition-all duration-150 sm:px-4 ${
                      active
                        ? `${accent.activePill} shadow-sm`
                        : `bg-transparent text-slate-500 ${accent.idleHover} hover:shadow-sm`
                    }`}
                  >
                    <TabIcon className={`h-3.5 w-3.5 ${active ? accent.activeIcon : accent.idleIcon}`} />
                    {entry.label}
                    {entry.count !== null && (
                      <span
                        title={
                          filtersActive && entry.total !== null
                            ? `${entry.count} of ${entry.total} match the current filters`
                            : undefined
                        }
                        className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                          active ? accent.activeBadge : "bg-slate-200/80 text-slate-600"
                        }`}
                      >
                        {entry.count}
                        {filtersActive && entry.total !== null && entry.total !== entry.count && (
                          <span className="font-medium opacity-60">/{entry.total}</span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Page-wide advanced filters. These narrow the arrays every tab reads
              from, so Stays, Transports, Tours, Group Stays, and Other Activities
              all answer the same question at once. Behaviour receives the date
              range through its own endpoint. */}
          <div className="bg-white px-2 pb-2">
            <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-700">
                    <Filter className="h-3.5 w-3.5 text-slate-400" />
                    Advanced filters
                  </span>
                  {!filtersActive && (
                    <span className="text-[11px] text-slate-500">Showing everything on record</span>
                  )}
                  {filtersActive && (
                    <>
                      {(profileFilters.from || profileFilters.to) && (
                        <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-800">
                          {profileFilters.from || "start"} to {profileFilters.to || "today"}
                        </span>
                      )}
                      {profileFilters.statuses.length > 0 && (
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${activityStatusTone(profileFilters.statuses[0])}`}
                        >
                          {sentenceCaseStatus(profileFilters.statuses[0])}
                        </span>
                      )}
                      {(profileFilters.minAmount || profileFilters.maxAmount) && (
                        <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-800">
                          {profileFilters.minAmount || "0"} to {profileFilters.maxAmount || "any"} TZS
                        </span>
                      )}
                      {profileFilters.search.trim() && (
                        <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-800">
                          &quot;{profileFilters.search.trim()}&quot;
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {filtersActive && (
                    <button
                      type="button"
                      onClick={() => setProfileFilters(PROFILE_FILTERS_DEFAULT)}
                      className="appearance-none rounded-lg border-0 bg-transparent px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                    >
                      Clear all
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setProfileFiltersOpen((open) => !open)}
                    className="inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                  >
                    {profileFiltersOpen ? "Hide" : "Open"}
                    {profileFiltersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {profileFiltersOpen && (
                <div id="admin-user-filters" className="px-3 pb-3 pt-3 shadow-[inset_0_1px_0_#e2e8f0]">
                  {/* Tailwind preflight is disabled in this app, so nothing sets
                      border-box. Without this, a w-full input plus padding and a
                      ring renders wider than its grid column and overflows. */}
                  <style>{`#admin-user-filters, #admin-user-filters * { box-sizing: border-box; }`}</style>

                  <div className="grid grid-cols-12 gap-3">
                    {/* Search */}
                    <div className="col-span-12 min-w-0 lg:col-span-4">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Search
                      </div>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={profileFilters.search}
                          onChange={(event) => setProfileFilters((current) => ({ ...current, search: event.target.value }))}
                          placeholder="Reference, title, or ID"
                          className="h-10 w-full rounded-xl border-0 bg-white pl-9 pr-8 text-sm text-slate-800 shadow-sm ring-1 ring-slate-200 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-300"
                        />
                        {profileFilters.search && (
                          <button
                            type="button"
                            aria-label="Clear search"
                            onClick={() => setProfileFilters((current) => ({ ...current, search: "" }))}
                            className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 appearance-none items-center justify-center rounded border-0 bg-transparent text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Date range */}
                    <div className="col-span-12 min-w-0 sm:col-span-7 lg:col-span-5">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Date range
                      </div>
                      {/* The trigger label is nowrap, so the fields need a floor
                          to sit above. Without it flex-1 shrinks them past their
                          own text and the date spills over the "to". */}
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-[132px] flex-1">
                          <DatePickerField
                            label="From"
                            size="sm"
                            widthClassName="w-full"
                            value={profileFilters.from}
                            max={profileFilters.to || undefined}
                            onChangeAction={(next) => setProfileFilters((current) => ({ ...current, from: next }))}
                          />
                        </div>
                        <span className="flex-shrink-0 px-0.5 text-xs text-slate-400">to</span>
                        <div className="min-w-[132px] flex-1">
                          <DatePickerField
                            label="To"
                            size="sm"
                            widthClassName="w-full"
                            value={profileFilters.to}
                            min={profileFilters.from || undefined}
                            onChangeAction={(next) => setProfileFilters((current) => ({ ...current, to: next }))}
                          />
                        </div>
                        {(profileFilters.from || profileFilters.to) && (
                          <button
                            type="button"
                            aria-label="Clear date range"
                            onClick={() => setProfileFilters((current) => ({ ...current, from: "", to: "" }))}
                            className="inline-flex h-8 w-8 flex-shrink-0 appearance-none items-center justify-center rounded-lg border-0 bg-transparent text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Amount range. Text inputs with a numeric keypad rather than
                        type=number, so no browser spinners crowd the field. */}
                    <div className="col-span-12 min-w-0 sm:col-span-5 lg:col-span-3">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Amount (TZS)
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label="Minimum amount"
                          placeholder="Min"
                          value={profileFilters.minAmount}
                          onChange={(event) =>
                            setProfileFilters((current) => ({ ...current, minAmount: event.target.value.replace(/[^0-9]/g, "") }))
                          }
                          className="h-10 w-full min-w-0 rounded-xl border-0 bg-white px-3 text-sm tabular-nums text-slate-800 shadow-sm ring-1 ring-slate-200 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-300"
                        />
                        <span className="flex-shrink-0 text-xs text-slate-400">to</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label="Maximum amount"
                          placeholder="Max"
                          value={profileFilters.maxAmount}
                          onChange={(event) =>
                            setProfileFilters((current) => ({ ...current, maxAmount: event.target.value.replace(/[^0-9]/g, "") }))
                          }
                          className="h-10 w-full min-w-0 rounded-xl border-0 bg-white px-3 text-sm tabular-nums text-slate-800 shadow-sm ring-1 ring-slate-200 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>
                    </div>
                  </div>

                  {statusOptions.length > 0 && (
                    <div className="mt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          Status <span className="font-medium normal-case text-slate-400">(one at a time)</span>
                        </div>
                        {profileFilters.statuses.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setProfileFilters((current) => ({ ...current, statuses: [] }))}
                            className="appearance-none rounded border-0 bg-transparent text-[11px] font-bold text-slate-500 transition hover:text-slate-800"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      {/* Single select: picking another status replaces the current
                          one rather than widening the filter, so the result set is
                          always one answerable question. */}
                      <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                        {statusOptions.map((status) => {
                          const active = profileFilters.statuses.includes(status);
                          return (
                            <button
                              key={status}
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                setProfileFilters((current) => ({
                                  ...current,
                                  statuses: active ? [] : [status],
                                }))
                              }
                              className={`inline-flex appearance-none items-center gap-1 rounded-full border-0 px-3 py-1 text-xs font-semibold transition ${activityStatusTone(status)} ${
                                active
                                  ? "shadow-sm ring-2 ring-current"
                                  : "opacity-70 hover:opacity-100 hover:shadow-sm"
                              }`}
                            >
                              {active && <CheckCircle className="h-3 w-3" />}
                              {sentenceCaseStatus(status)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="mt-4 text-[11px] text-slate-500">
                    Filters apply to every tab at once. Tab counts show matches against the total, and the Behaviour tab
                    reloads its charts for the selected date range.
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="p-3 sm:p-4">
            {activeActivityTab && (() => {
              const columns = ACTIVITY_TAB_COLUMNS[activeActivityTab];
              const empty = ACTIVITY_TAB_EMPTY[activeActivityTab];
              const EmptyIcon = empty.icon;
              return (
                <div>
                  {activeActivityItems.length === 0 ? (
                    <div className="text-center py-16">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                        <EmptyIcon className="h-8 w-8 text-gray-400" />
                      </div>
                      <p className="m-0 mb-1 text-base font-semibold text-gray-700">
                        {filtersActive && allActivityByTab[activeActivityTab] > 0
                          ? "Nothing matches these filters"
                          : empty.title}
                      </p>
                      <p className="m-0 text-sm text-gray-500">
                        {filtersActive && allActivityByTab[activeActivityTab] > 0
                          ? `${allActivityByTab[activeActivityTab]} records exist outside the current filters.`
                          : empty.hint}
                      </p>
                      {filtersActive && allActivityByTab[activeActivityTab] > 0 && (
                        <button
                          type="button"
                          onClick={() => setProfileFilters(PROFILE_FILTERS_DEFAULT)}
                          className="mt-3 appearance-none rounded-lg border-0 bg-white px-4 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Mobile: card list */}
                      <div className="md:hidden space-y-3">
                        {pagedActivities.map((item) => (
                          <div key={`${item.type}-${item.id}`} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-gray-900">{item.title}</div>
                                <div className="mt-1 font-mono text-xs font-semibold tracking-wide text-gray-500">
                                  ID {item.id}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setActivityDetail(item)}
                                aria-label="Open record"
                                title="Open"
                                className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm transition-colors hover:bg-emerald-700"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                              {columns.filter((column) => column.key !== "id").map((column) => (
                                <div key={column.key} className="rounded-lg bg-gray-50 p-3">
                                  <div className="text-[11px] font-semibold text-gray-600">{column.label}</div>
                                  <div className="mt-1 text-xs">{column.render(item)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Desktop: same table shape as Stays */}
                      <div className="hidden min-w-0 overflow-x-auto md:block">
                        <div className="min-w-[1080px] overflow-hidden rounded-lg border-y border-r border-slate-200 bg-white">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-gray-50/90 backdrop-blur">
                              <tr>
                                {columns.map((column) => {
                                  const ColumnIcon = column.icon;
                                  return (
                                    <th
                                      key={column.key}
                                      className={`whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold tracking-wide text-gray-600 shadow-[inset_0_-1px_0_#e5e7eb] ${
                                        column.align === "right" ? "text-right" : "text-left"
                                      }`}
                                    >
                                      <span className="inline-flex items-center gap-2">
                                        {ColumnIcon && <ColumnIcon className="h-3.5 w-3.5" />}
                                        {column.label}
                                      </span>
                                    </th>
                                  );
                                })}
                                <th className="whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-semibold tracking-wide text-gray-600 shadow-[inset_0_-1px_0_#e5e7eb]">
                                  <span className="inline-flex items-center justify-end gap-2">
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                    Actions
                                  </span>
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                              {pagedActivities.map((item) => (
                                <TableRow
                                  key={`${item.type}-${item.id}`}
                                  hover={false}
                                  onDoubleClick={() => setActivityDetail(item)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") setActivityDetail(item);
                                  }}
                                  tabIndex={0}
                                  title="Double-click to open record"
                                  className="group cursor-pointer outline-none transition-colors duration-150 even:bg-slate-50/40 hover:bg-emerald-50/80 focus-visible:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                                >
                                  {columns.map((column) => (
                                    <td
                                      key={column.key}
                                      className={`px-4 py-3 align-middle ${column.align === "right" ? "text-right" : ""}`}
                                    >
                                      {column.render(item)}
                                    </td>
                                  ))}
                                  <td className="px-4 py-3 text-right">
                                    <button
                                      type="button"
                                      onClick={() => setActivityDetail(item)}
                                      aria-label="Open record"
                                      title="Open"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-emerald-600 text-white shadow-sm transition duration-150 hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                                    >
                                      <Eye className="h-4 w-4" />
                                    </button>
                                  </td>
                                </TableRow>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {activityTotalPages > 1 && (
                        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm text-gray-500">
                            Showing {(activityPage - 1) * ACTIVITY_PAGE_SIZE + 1} to{" "}
                            {Math.min(activityPage * ACTIVITY_PAGE_SIZE, activeActivityItems.length)} of{" "}
                            {activeActivityItems.length}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setActivityPage((page) => Math.max(1, page - 1))}
                              disabled={activityPage === 1}
                              className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Previous
                            </button>
                            <span className="text-sm font-semibold text-gray-700">
                              Page {activityPage} of {activityTotalPages}
                            </span>
                            <button
                              type="button"
                              onClick={() => setActivityPage((page) => Math.min(activityTotalPages, page + 1))}
                              disabled={activityPage >= activityTotalPages}
                              className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {tab === "audit" && (() => {
              const totalPages = Math.max(1, Math.ceil(auditHistory.length / AUDIT_PAGE_SIZE));
              const safePage = Math.min(auditPage, totalPages);
              const startIndex = (safePage - 1) * AUDIT_PAGE_SIZE;
              const rows = auditHistory.slice(startIndex, startIndex + AUDIT_PAGE_SIZE);
              return (
                <div>
                  {auditLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-violet-600" />
                    </div>
                  ) : auditHistory.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                        <History className="h-8 w-8 text-slate-400" />
                      </div>
                      <p className="m-0 mb-1 text-base font-semibold text-slate-700">No audit history</p>
                      <p className="m-0 text-sm text-slate-500">
                        Suspensions, reinstatements, 2FA resets, and document decisions on this account will appear here.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Mobile: card list */}
                      <div className="space-y-3 md:hidden">
                        {rows.map((entry: any, index: number) => (
                          <div key={entry.id || `${startIndex}-${index}`} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                            <div className="flex items-start justify-between gap-3">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${auditActionTone(entry.action)}`}>
                                {sentenceCaseStatus(entry.action || "Unknown action")}
                              </span>
                              <span className="flex-shrink-0 text-xs text-slate-500">
                                {formatActivityDate(entry.createdAt)}
                              </span>
                            </div>
                            {parseAuditDetails(entry.details).length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {parseAuditDetails(entry.details).map((detail) => (
                                  <span key={detail.key} className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                                    <span className="font-semibold text-slate-500">{detail.key}:</span> {detail.value}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="mt-3 text-xs text-slate-500">
                              {entry.admin?.name || entry.admin?.email || (entry.adminId ? `Admin #${entry.adminId}` : "System")}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Desktop: table, same shape as the other tabs */}
                      <div className="-mx-6 hidden overflow-x-auto px-6 md:block">
                        <div className="min-w-[860px] rounded-xl bg-white ring-1 ring-slate-200">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50/90">
                              <tr>
                                <th className="whitespace-nowrap px-6 py-3 text-left text-[11px] font-semibold tracking-wide text-slate-600 shadow-[inset_0_-1px_0_#e2e8f0]">
                                  <span className="inline-flex items-center gap-2">
                                    <Activity className="h-3.5 w-3.5" />
                                    Action
                                  </span>
                                </th>
                                <th className="px-6 py-3 text-left text-[11px] font-semibold tracking-wide text-slate-600 shadow-[inset_0_-1px_0_#e2e8f0]">
                                  <span className="inline-flex items-center gap-2">
                                    <Tag className="h-3.5 w-3.5" />
                                    Details
                                  </span>
                                </th>
                                <th className="whitespace-nowrap px-6 py-3 text-left text-[11px] font-semibold tracking-wide text-slate-600 shadow-[inset_0_-1px_0_#e2e8f0]">
                                  <span className="inline-flex items-center gap-2">
                                    <UserCheck className="h-3.5 w-3.5" />
                                    Performed by
                                  </span>
                                </th>
                                <th className="whitespace-nowrap px-6 py-3 text-right text-[11px] font-semibold tracking-wide text-slate-600 shadow-[inset_0_-1px_0_#e2e8f0]">
                                  <span className="inline-flex items-center justify-end gap-2">
                                    <Clock className="h-3.5 w-3.5" />
                                    When
                                  </span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((entry: any, index: number) => {
                                const details = parseAuditDetails(entry.details);
                                return (
                                  <TableRow
                                    key={entry.id || `${startIndex}-${index}`}
                                    className="odd:bg-white even:bg-slate-50/70 hover:bg-violet-50/40"
                                  >
                                    <td className="whitespace-nowrap px-6 py-4 align-top">
                                      <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${auditActionTone(entry.action)}`}>
                                        {sentenceCaseStatus(entry.action || "Unknown action")}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 align-top">
                                      {details.length === 0 ? (
                                        <span className="text-sm italic text-slate-400">No details recorded</span>
                                      ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                          {details.map((detail) => (
                                            <span
                                              key={detail.key}
                                              className="inline-flex items-baseline gap-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200"
                                            >
                                              <span className="font-semibold text-slate-500">{detail.key}</span>
                                              {detail.value}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 align-top text-sm text-slate-700">
                                      {entry.admin?.name || entry.admin?.email || (entry.adminId ? `Admin #${entry.adminId}` : "System")}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 align-top text-right text-sm text-slate-600">
                                      {formatActivityDate(entry.createdAt)}
                                    </td>
                                  </TableRow>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {totalPages > 1 && (
                        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm text-slate-500">
                            Showing {startIndex + 1} to {Math.min(startIndex + AUDIT_PAGE_SIZE, auditHistory.length)} of{" "}
                            {auditHistory.length}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setAuditPage((page) => Math.max(1, page - 1))}
                              disabled={safePage === 1}
                              className="appearance-none rounded-lg border-0 bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Previous
                            </button>
                            <span className="text-sm font-semibold text-slate-700">
                              Page {safePage} of {totalPages}
                            </span>
                            <button
                              type="button"
                              onClick={() => setAuditPage((page) => Math.min(totalPages, page + 1))}
                              disabled={safePage >= totalPages}
                              className="appearance-none rounded-lg border-0 bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
            {tab === "behaviour" && (
              <div className="space-y-6">
                {/* Advanced filtering. Scopes every panel below, including the
                    conduct rates, so a reconciliation view never mixes a filtered
                    chart with whole-account signals. */}
                {(() => {
                  const applied = behaviourApplied;
                  // The page-wide date range is the single source of truth for
                  // dates. Mirroring it into the draft keeps this panel from
                  // fighting the filter bar above over the same value.
                  const pageRangeActive = Boolean(profileFilters.from || profileFilters.to);
                  const draft = { ...behaviourDraft, from: profileFilters.from, to: profileFilters.to };
                  const usingCustomRange = pageRangeActive;
                  const allProducts = BEHAVIOUR_ALL_PRODUCTS.map((product) => product.key);
                  const scoped = applied.products.length < allProducts.length;
                  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
                  const isDefault = JSON.stringify(applied) === JSON.stringify(BEHAVIOUR_DEFAULT_FILTERS);

                  const toggleProduct = (key: string) => {
                    setBehaviourDraft((current) => {
                      const next = current.products.includes(key)
                        ? current.products.filter((value) => value !== key)
                        : [...current.products, key];
                      // Never allow an empty selection: it would return an empty
                      // page with no way to tell "no data" from "nothing selected".
                      return { ...current, products: next.length ? next : current.products };
                    });
                  };

                  return (
                    <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-700">
                            <Filter className="h-3.5 w-3.5 text-slate-400" />
                            Filters
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                            {usingCustomRange || applied.from || applied.to
                              ? `${applied.from || "start"} to ${applied.to || "today"}`
                              : `Last ${applied.months} months`}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                            Signals {applied.recentDays}d
                          </span>
                          {scoped && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900">
                              {applied.products.length} of {allProducts.length} products
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!isDefault && (
                            <button
                              type="button"
                              onClick={() => {
                                setBehaviourDraft(BEHAVIOUR_DEFAULT_FILTERS);
                                loadBehaviour(BEHAVIOUR_DEFAULT_FILTERS);
                              }}
                              className="appearance-none rounded-lg border-0 bg-transparent px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                            >
                              Reset
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setBehaviourFiltersOpen((open) => !open)}
                            className="inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
                          >
                            {behaviourFiltersOpen ? "Hide" : "Advanced"}
                            {behaviourFiltersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>

                      {behaviourFiltersOpen && (
                        <div id="admin-behaviour-filters" className="px-4 pb-4 pt-4 shadow-[inset_0_1px_0_#e2e8f0]">
                          {/* Preflight is disabled, so nothing sets border-box and
                              padded full-width controls would overflow their column. */}
                          <style>{`#admin-behaviour-filters, #admin-behaviour-filters * { box-sizing: border-box; }`}</style>

                          <div className="grid gap-4 lg:grid-cols-3">
                            {/* Period */}
                            <div className="min-w-0 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Period</div>
                              {pageRangeActive ? (
                                <div className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                                  Using the page date range
                                  <div className="mt-0.5 text-[11px] font-medium text-slate-400">
                                    Clear it above to pick a period here.
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {BEHAVIOUR_PERIOD_OPTIONS.map((option) => {
                                    const active = draft.months === option.months;
                                    return (
                                      <button
                                        key={option.months}
                                        type="button"
                                        onClick={() => setBehaviourDraft((current) => ({ ...current, months: option.months }))}
                                        className={`appearance-none rounded-lg border-0 px-3 py-1.5 text-xs font-semibold transition ${
                                          active
                                            ? "bg-indigo-600 text-white shadow-sm"
                                            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-800"
                                        }`}
                                      >
                                        {option.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Products */}
                            <div className="min-w-0 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Products</div>
                                <button
                                  type="button"
                                  onClick={() => setBehaviourDraft((current) => ({ ...current, products: allProducts }))}
                                  disabled={draft.products.length === allProducts.length}
                                  className="appearance-none rounded border-0 bg-transparent text-[11px] font-bold text-slate-500 transition hover:text-slate-800 disabled:cursor-not-allowed disabled:text-slate-300"
                                >
                                  All
                                </button>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {BEHAVIOUR_ALL_PRODUCTS.map((product) => {
                                  const active = draft.products.includes(product.key);
                                  return (
                                    <button
                                      key={product.key}
                                      type="button"
                                      aria-pressed={active}
                                      onClick={() => toggleProduct(product.key)}
                                      className={`inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 px-3 py-1.5 text-xs font-semibold transition ${
                                        active
                                          ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-300"
                                          : "bg-white/40 text-slate-400 ring-1 ring-slate-200 hover:bg-white hover:text-slate-600"
                                      }`}
                                    >
                                      <span
                                        className="inline-block h-2 w-2 rounded-full"
                                        style={{
                                          backgroundColor: active
                                            ? BEHAVIOUR_PRODUCT_COLORS[product.key] || "#94a3b8"
                                            : "#cbd5e1",
                                        }}
                                      />
                                      {product.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Conduct signal window */}
                            <div className="min-w-0 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                Conduct signals
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {BEHAVIOUR_RECENT_OPTIONS.map((days) => {
                                  const active = draft.recentDays === days;
                                  return (
                                    <button
                                      key={days}
                                      type="button"
                                      onClick={() => setBehaviourDraft((current) => ({ ...current, recentDays: days }))}
                                      className={`appearance-none rounded-lg border-0 px-3 py-1.5 text-xs font-semibold transition ${
                                        active
                                          ? "bg-indigo-600 text-white shadow-sm"
                                          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-800"
                                      }`}
                                    >
                                      {days} days
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <p className="m-0 max-w-md text-[11px] leading-relaxed text-slate-500">
                              These scope every panel below, including the conduct rates, so a narrowed view is not the
                              whole account.
                            </p>
                            <div className="flex items-center gap-2">
                              {dirty && (
                                <button
                                  type="button"
                                  onClick={() => setBehaviourDraft(applied)}
                                  className="appearance-none rounded-lg border-0 bg-transparent px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                >
                                  Discard
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={!dirty || behaviourLoading}
                                onClick={() => loadBehaviour(draft)}
                                className="inline-flex appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                              >
                                {behaviourLoading ? "Applying" : dirty ? "Apply filters" : "Filters applied"}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {behaviourLoading && (
                  <div className="space-y-4">
                    <div className="h-20 animate-pulse rounded-2xl bg-gray-100" />
                    <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
                    <div className="h-48 animate-pulse rounded-2xl bg-gray-100" />
                  </div>
                )}

                {behaviourError && !behaviourLoading && (
                  <div className="rounded-2xl bg-red-50 px-6 py-8 text-center ring-1 ring-red-200">
                    <p className="text-sm font-semibold text-red-800">{behaviourError}</p>
                    <button
                      type="button"
                      onClick={() => { setBehaviourError(null); loadBehaviour(behaviourApplied); }}
                      className="mt-3 rounded-lg bg-white px-4 py-2 text-xs font-bold text-gray-700 ring-1 ring-gray-200 transition hover:bg-gray-100"
                    >
                      Try again
                    </button>
                  </div>
                )}

                {behaviour && !behaviourLoading && (() => {
                  const engagement = behaviour.engagement;
                  const labels = engagement.series.map((point) => formatMonthLabel(point.month));
                  const band = BEHAVIOUR_BAND_STYLE[behaviour.conduct.band];
                  const mix = behaviour.preferences.byProduct.filter((product) => product.records > 0);
                  const totalRecords = mix.reduce((total, product) => total + product.records, 0);
                  const totalValue = mix.reduce((total, product) => total + product.value, 0);
                  const funnelRows = behaviour.funnel.byProduct.filter((row) => row.created > 0);
                  const topDestinationMax = Math.max(1, ...behaviour.preferences.topDestinations.map((d) => d.count));

                  return (
                    <>
                      {/* Conduct band. Stated plainly, with the reason, because
                          admins suspend accounts from this page. */}
                      <div className={`rounded-2xl px-6 py-5 ring-1 ${band.box}`}>
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <span className={`inline-block h-3 w-3 rounded-full ${band.dot}`} />
                            <div>
                              <div className="text-lg font-bold">{band.label}</div>
                              <div className="mt-0.5 text-sm opacity-90">{band.blurb}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {behaviour.filters?.isFiltered && (
                              <span className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold">
                                Filtered view, not the whole account
                              </span>
                            )}
                            {behaviour.conduct.accountSuspended && (
                              <span className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold uppercase tracking-wide">
                                Account restricted
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Engagement summary */}
                      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last activity</div>
                          <div className="mt-2 text-xl font-bold text-gray-900">{relativeDays(engagement.lastActivityAt)}</div>
                        </div>
                        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last login</div>
                          <div className="mt-2 text-xl font-bold text-gray-900">{relativeDays(engagement.lastLoginAt)}</div>
                        </div>
                        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Logins ({behaviour.window.recentDays}d)
                          </div>
                          <div className="mt-2 text-xl font-bold text-gray-900">{engagement.recentLogins}</div>
                          <div className="mt-1 text-xs text-gray-500">{engagement.totalLogins} all time</div>
                        </div>
                        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Active sessions</div>
                          <div className="mt-2 text-xl font-bold text-gray-900">{engagement.activeSessions}</div>
                        </div>
                      </div>

                      {/* Engagement over time */}
                      <div className="grid gap-6 lg:grid-cols-3">
                        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 lg:col-span-2">
                          <h3 className="text-sm font-bold text-gray-900">Engagement over time</h3>
                          <p className="mt-1 text-xs text-gray-500">Records created each month, by product.</p>
                          <div className="mt-4 h-64">
                            <Chart
                              type="bar"
                              data={{
                                labels,
                                datasets: [
                                  { label: "Stays", data: engagement.series.map((p) => p.stays), backgroundColor: BEHAVIOUR_PRODUCT_COLORS.stays },
                                  { label: "Tours", data: engagement.series.map((p) => p.tours), backgroundColor: BEHAVIOUR_PRODUCT_COLORS.tours },
                                  { label: "Transport", data: engagement.series.map((p) => p.transport), backgroundColor: BEHAVIOUR_PRODUCT_COLORS.transport },
                                  { label: "Group stays", data: engagement.series.map((p) => p.groups), backgroundColor: BEHAVIOUR_PRODUCT_COLORS.groups },
                                  { label: "Other", data: engagement.series.map((p) => p.other), backgroundColor: BEHAVIOUR_PRODUCT_COLORS.other },
                                ],
                              }}
                              options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                scales: {
                                  x: { stacked: true, grid: { display: false } },
                                  y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
                                },
                                plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } },
                              }}
                            />
                          </div>
                        </section>

                        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
                          <h3 className="text-sm font-bold text-gray-900">Logins</h3>
                          <p className="mt-1 text-xs text-gray-500">Sign ins per month.</p>
                          <div className="mt-4 h-64">
                            <Chart
                              type="line"
                              data={{
                                labels,
                                datasets: [
                                  {
                                    label: "Logins",
                                    data: engagement.series.map((p) => p.logins),
                                    borderColor: "#0f172a",
                                    backgroundColor: "rgba(15,23,42,0.08)",
                                    fill: true,
                                    tension: 0.3,
                                    pointRadius: 2,
                                  },
                                ],
                              }}
                              options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
                                plugins: { legend: { display: false } },
                              }}
                            />
                          </div>
                        </section>
                      </div>

                      {/* What they like */}
                      <div className="grid gap-6 lg:grid-cols-2">
                        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
                          <h3 className="text-sm font-bold text-gray-900">Product mix</h3>
                          <p className="mt-1 text-xs text-gray-500">Share of records against share of value.</p>
                          {mix.length === 0 ? (
                            <p className="mt-6 text-sm text-gray-500">No bookings on record yet.</p>
                          ) : (
                            <>
                              <div className="mt-4 h-48">
                                <Chart
                                  type="doughnut"
                                  data={{
                                    labels: mix.map((product) => product.label),
                                    datasets: [
                                      {
                                        data: mix.map((product) => product.records),
                                        backgroundColor: mix.map((product) => BEHAVIOUR_PRODUCT_COLORS[product.key] || "#94a3b8"),
                                        borderWidth: 0,
                                      },
                                    ],
                                  }}
                                  options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    cutout: "62%",
                                    plugins: { legend: { position: "right", labels: { boxWidth: 10, usePointStyle: true } } },
                                  }}
                                />
                              </div>
                              <div className="mt-5 flex flex-col gap-px bg-gray-100">
                                {mix.map((product) => {
                                  const recordShare = totalRecords ? Math.round((product.records / totalRecords) * 100) : 0;
                                  const valueShare = totalValue ? Math.round((product.value / totalValue) * 100) : 0;
                                  return (
                                    <div key={product.key} className="flex items-center justify-between gap-3 bg-white py-2.5">
                                      <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                        <span
                                          className="inline-block h-2.5 w-2.5 rounded-full"
                                          style={{ backgroundColor: BEHAVIOUR_PRODUCT_COLORS[product.key] || "#94a3b8" }}
                                        />
                                        {product.label}
                                      </span>
                                      <span className="text-xs text-gray-600">
                                        {recordShare}% of records
                                        <span className="mx-1.5 text-gray-300">|</span>
                                        {valueShare}% of value
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </section>

                        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
                          <h3 className="text-sm font-bold text-gray-900">Where they go</h3>
                          <p className="mt-1 text-xs text-gray-500">Destinations across bookings and saved properties.</p>
                          {behaviour.preferences.topDestinations.length === 0 ? (
                            <p className="mt-6 text-sm text-gray-500">No destination recorded yet.</p>
                          ) : (
                            <div className="mt-4 space-y-3">
                              {behaviour.preferences.topDestinations.map((destination) => (
                                <div key={destination.name}>
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="font-semibold text-gray-900">{destination.name}</span>
                                    <span className="tabular-nums text-gray-500">{destination.count}</span>
                                  </div>
                                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                                    <div
                                      className="h-full rounded-full bg-emerald-500"
                                      style={{ width: `${Math.round((destination.count / topDestinationMax) * 100)}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="mt-6 grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="text-[11px] font-semibold text-gray-600">Saved properties</div>
                              <div className="mt-1 text-lg font-bold text-gray-900">{behaviour.preferences.savedProperties}</div>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="text-[11px] font-semibold text-gray-600">Trips planned</div>
                              <div className="mt-1 text-lg font-bold text-gray-900">{behaviour.preferences.tripEstimates}</div>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="text-[11px] font-semibold text-gray-600">Reviews written</div>
                              <div className="mt-1 text-lg font-bold text-gray-900">{behaviour.preferences.reviewsWritten}</div>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="text-[11px] font-semibold text-gray-600">Average rating given</div>
                              <div className="mt-1 text-lg font-bold text-gray-900">
                                {behaviour.preferences.averageRating === null ? "n/a" : `${behaviour.preferences.averageRating}/5`}
                              </div>
                            </div>
                          </div>
                        </section>
                      </div>

                      {/* Drop-off */}
                      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-bold text-gray-900">Where they drop off</h3>
                            <p className="mt-1 text-xs text-gray-500">Created records against what was paid, abandoned, or canceled.</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
                            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />Paid</span>
                            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />Abandoned</span>
                            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-400" />Canceled</span>
                          </div>
                        </div>

                        {funnelRows.length === 0 ? (
                          <p className="mt-6 text-sm text-gray-500">Nothing booked yet, so there is no funnel to show.</p>
                        ) : (
                          <div className="mt-5 space-y-5">
                            {funnelRows.map((row) => {
                              const pct = (part: number) => `${Math.round((part / row.created) * 100)}%`;
                              return (
                                <div key={row.key}>
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-semibold text-gray-900">{row.label}</span>
                                    <span className="text-xs text-gray-500">{row.created} created</span>
                                  </div>
                                  <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
                                    <div className="h-full bg-emerald-500" style={{ width: pct(row.paid) }} title={`${row.paid} paid`} />
                                    <div className="h-full bg-amber-400" style={{ width: pct(row.abandoned) }} title={`${row.abandoned} abandoned`} />
                                    <div className="h-full bg-red-400" style={{ width: pct(row.canceled) }} title={`${row.canceled} canceled`} />
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
                                    <span>Paid <strong className="text-gray-900">{row.paid}</strong></span>
                                    <span>Abandoned <strong className="text-gray-900">{row.abandoned}</strong></span>
                                    <span>Canceled <strong className="text-gray-900">{row.canceled}</strong></span>
                                    <span>Completed <strong className="text-gray-900">{row.completed}</strong></span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {behaviour.funnel.plannedNeverBooked > 0 && (
                          <p className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900">
                            Planned {behaviour.preferences.tripEstimates} trips with the cost estimator but booked far fewer. That is
                            intent the platform did not convert.
                          </p>
                        )}
                      </section>

                      {/* Sharing and referrals. Two pipelines, each drawn as a
                          connected run of steps rather than loose stat cards, so
                          it is obvious where people fall out. */}
                      {behaviour.sharing && (() => {
                        const sharing = behaviour.sharing;
                        const funnel = sharing.shareFunnel;

                        const inviteSteps = [
                          { key: "registered", label: "Registered", value: sharing.referredCount },
                          { key: "completed", label: "Completed profile", value: sharing.completedCount },
                        ];
                        const shareSteps = funnel
                          ? [
                              { key: "shared", label: "Shared", value: funnel.shared },
                              { key: "opened", label: "Opened", value: funnel.opened },
                              { key: "registered", label: "Registered", value: funnel.registered },
                              { key: "booked", label: "Booked", value: funnel.booked },
                            ]
                          : [];

                        const track = (
                          steps: { key: string; label: string; value: number }[],
                          tones: string[],
                        ) => (
                          <div className="flex min-w-0 flex-wrap items-stretch gap-1.5">
                            {steps.map((step, index) => {
                              const first = steps[0]?.value || 0;
                              const rate = index > 0 && first > 0 ? Math.round((step.value / first) * 100) : null;
                              return (
                                <Fragment key={step.key}>
                                  {index > 0 && (
                                    <div className="flex items-center px-0.5 text-slate-300">
                                      <ChevronRight className="h-4 w-4" />
                                    </div>
                                  )}
                                  <div className={`min-w-[104px] flex-1 rounded-xl px-3 py-2.5 ring-1 ${tones[index] || tones[tones.length - 1]}`}>
                                    <div className="text-xl font-black tabular-nums leading-6">{step.value}</div>
                                    <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide opacity-70">{step.label}</div>
                                    {rate !== null && (
                                      <div className="mt-0.5 text-[10px] font-semibold opacity-60">{rate}% of shared</div>
                                    )}
                                  </div>
                                </Fragment>
                              );
                            })}
                          </div>
                        );

                        return (
                          <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                            <div className="flex flex-wrap items-start justify-between gap-3 bg-slate-50 px-6 py-4">
                              <div className="min-w-0">
                                <h3 className="m-0 text-sm font-bold text-slate-900">Sharing and referrals</h3>
                                <p className="m-0 mt-1 text-xs text-slate-500">
                                  {sharing.referredBy ? (
                                    <>
                                      Brought in by{" "}
                                      <Link href={`/admin/users/${sharing.referredBy.id}`} className="font-semibold text-emerald-700 no-underline hover:underline">
                                        {sharing.referredBy.name || sharing.referredBy.email || `User #${sharing.referredBy.id}`}
                                      </Link>
                                      {sharing.referredBy.codeUsed ? ` using ${sharing.referredBy.codeUsed}` : ""}
                                    </>
                                  ) : (
                                    "Joined directly, not through anyone's link."
                                  )}
                                </p>
                              </div>
                              {/* The code is the thing support reads back to a
                                  customer, so it is copyable, not decorative. */}
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(sharing.referralLink || sharing.referralCode).then(
                                    () => {
                                      setCopiedReferral(true);
                                      window.setTimeout(() => setCopiedReferral(false), 1600);
                                    },
                                    () => {},
                                  );
                                }}
                                title={sharing.referralLink || sharing.referralCode}
                                className="inline-flex flex-shrink-0 appearance-none items-center gap-2 rounded-xl border-0 bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-100 hover:ring-slate-300"
                              >
                                {sharing.referralCode}
                                {copiedReferral ? (
                                  <span className="font-sans text-[11px] font-bold text-emerald-700">Copied</span>
                                ) : (
                                  <Eye className="h-3.5 w-3.5 text-slate-400" />
                                )}
                              </button>
                            </div>

                            <div className="space-y-5 px-6 py-5">
                              <div>
                                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                  Invite link
                                </div>
                                {track(inviteSteps, [
                                  "bg-emerald-50 ring-emerald-200 text-emerald-900",
                                  "bg-emerald-50/60 ring-emerald-100 text-emerald-900",
                                ])}
                              </div>

                              {shareSteps.length > 0 && (
                                <div>
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                      Property shares
                                    </span>
                                    {funnel && funnel.legacyShares > 0 && (
                                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                        {funnel.legacyShares} untracked legacy
                                      </span>
                                    )}
                                  </div>
                                  {track(shareSteps, [
                                    "bg-slate-50 ring-slate-200 text-slate-900",
                                    "bg-sky-50 ring-sky-200 text-sky-900",
                                    "bg-emerald-50 ring-emerald-200 text-emerald-900",
                                    "bg-violet-50 ring-violet-200 text-violet-900",
                                  ])}
                                  {funnel && funnel.totalOpens > funnel.opened && (
                                    <p className="m-0 mt-2 text-[11px] text-slate-500">
                                      {funnel.totalOpens} opens in total across {funnel.opened} links.
                                    </p>
                                  )}
                                </div>
                              )}

                              {sharing.referredUsers.length > 0 && (
                                <div>
                                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                    Who joined through them
                                  </div>
                                  <div className="flex flex-col gap-px bg-slate-100">
                                    {sharing.referredUsers.slice(0, 6).map((referred) => (
                                      <Link
                                        key={referred.id}
                                        href={`/admin/users/${referred.id}`}
                                        className="flex flex-wrap items-center justify-between gap-3 bg-white px-1 py-2.5 no-underline transition hover:bg-slate-50"
                                      >
                                        <div className="min-w-0">
                                          <div className="truncate text-sm font-semibold text-slate-900">
                                            {referred.name || referred.email || `User #${referred.id}`}
                                          </div>
                                          <div className="mt-0.5 text-[11px] text-slate-500">
                                            Joined {formatActivityDate(referred.createdAt)}
                                          </div>
                                        </div>
                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${activityStatusTone(referred.registrationStatus || "")}`}>
                                          {sentenceCaseStatus(referred.registrationStatus || "Unknown")}
                                        </span>
                                      </Link>
                                    ))}
                                  </div>
                                  {sharing.referredUsers.length > 6 && (
                                    <p className="m-0 mt-2 text-[11px] text-slate-500">
                                      Showing 6 of {sharing.referredUsers.length}.
                                    </p>
                                  )}
                                </div>
                              )}

                              {sharing.earnings.length > 0 && (
                                <div>
                                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                    Referral earnings
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {sharing.earnings.map((earning) => (
                                      <span key={earning.status} className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                                        {sentenceCaseStatus(earning.status)}
                                        <span className="tabular-nums text-slate-500">
                                          {earning.amount.toLocaleString()} {earning.currency}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            <p className="m-0 bg-slate-50 px-6 py-3 text-[11px] leading-4 text-slate-400 shadow-[inset_0_1px_0_#e2e8f0]">
                              {sharing.shareAttributionNote}
                            </p>
                          </section>
                        );
                      })()}
                      {/* How they pay */}
                      {behaviour.payments && behaviour.payments.attempts > 0 && (() => {
                        const payments = behaviour.payments;
                        const channels = payments.channels;
                        // When nothing has ever succeeded, share of successes is
                        // zero for every method and describes nothing. Attempts
                        // still say which rail this customer reaches for.
                        const measuringAttempts = payments.succeeded === 0;
                        const rateTone =
                          payments.successRate === null
                            ? "text-slate-500"
                            : payments.successRate >= 70
                            ? "text-emerald-700"
                            : payments.successRate >= 40
                            ? "text-amber-700"
                            : "text-red-700";

                        return (
                          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h3 className="m-0 text-sm font-bold text-slate-900">How they pay</h3>
                                <p className="m-0 mt-1 text-xs text-slate-500">
                                  {measuringAttempts
                                    ? `Which method they reach for, across ${payments.attempts} attempts. None have succeeded yet.`
                                    : `Share of successful payments by method, across ${payments.attempts} attempts.`}
                                </p>
                              </div>
                              <div className="text-right">
                                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Success rate</div>
                                <div className={`text-2xl font-black tabular-nums ${rateTone}`}>
                                  {payments.successRate === null ? "n/a" : `${payments.successRate}%`}
                                </div>
                                <div className="mt-0.5 text-[11px] text-slate-500">
                                  {payments.succeeded} paid, {payments.failed} failed
                                </div>
                              </div>
                            </div>

                            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
                              {/* Method mix */}
                              <div className="min-w-0">
                                <div className="h-[180px]">
                                  <Chart
                                    type="doughnut"
                                    data={{
                                      labels: channels.map((channel) => channel.label),
                                      datasets: [
                                        {
                                          data: channels.map((channel) => channel.attempts),
                                          backgroundColor: channels.map(
                                            (channel) => PAYMENT_CHANNEL_HEX[channel.key] || PAYMENT_CHANNEL_HEX.UNKNOWN,
                                          ),
                                          borderWidth: 0,
                                        },
                                      ],
                                    }}
                                    options={{
                                      responsive: true,
                                      maintainAspectRatio: false,
                                      cutout: "64%",
                                      plugins: { legend: { display: false } },
                                    }}
                                  />
                                </div>
                                <p className="m-0 mt-2 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                  Attempts by method
                                </p>
                              </div>

                              {/* Outcome per method. A stacked bar reads honestly
                                  even at a zero success rate, because the bar is
                                  full of the outcome that actually happened. */}
                              <div className="min-w-0 space-y-4">
                                {channels.map((channel) => {
                                  const tone = PAYMENT_CHANNEL_TONES[channel.key] || PAYMENT_CHANNEL_TONES.UNKNOWN;
                                  const ChannelIcon = tone.icon;
                                  const pct = (part: number) =>
                                    channel.attempts > 0 ? `${(part / channel.attempts) * 100}%` : "0%";
                                  return (
                                    <div key={channel.key} className="min-w-0">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-800">
                                          <ChannelIcon className={`h-4 w-4 flex-shrink-0 ${tone.icon_color}`} />
                                          {channel.label}
                                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                            {measuringAttempts ? channel.attemptShare : channel.share}% of{" "}
                                            {measuringAttempts ? "attempts" : "payments"}
                                          </span>
                                        </span>
                                        <span className="text-[11px] tabular-nums text-slate-500">
                                          {channel.attempts} attempts
                                        </span>
                                      </div>
                                      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                                        <div className="h-full bg-emerald-500" style={{ width: pct(channel.succeeded) }} title={`${channel.succeeded} paid`} />
                                        <div className="h-full bg-red-400" style={{ width: pct(channel.failed) }} title={`${channel.failed} failed`} />
                                        <div className="h-full bg-amber-300" style={{ width: pct(channel.pending) }} title={`${channel.pending} unresolved`} />
                                      </div>
                                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                        <span>Paid <strong className="tabular-nums text-slate-800">{channel.succeeded}</strong></span>
                                        <span>Failed <strong className="tabular-nums text-slate-800">{channel.failed}</strong></span>
                                        <span>Unresolved <strong className="tabular-nums text-slate-800">{channel.pending}</strong></span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {payments.providers.length > 0 && (
                              <div className="mt-5">
                                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Providers used</div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {payments.providers.map((provider) => (
                                    <span key={provider.provider} className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                                      {sentenceCaseStatus(provider.provider)}
                                      <span className="tabular-nums text-slate-500">{provider.succeeded}/{provider.attempts}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <p className="m-0 mt-4 text-[11px] text-slate-400">{payments.coverage}</p>
                          </section>
                        );
                      })()}

                      {/* Conduct signals */}
                      {(() => {
                        const signals = behaviour.conduct.signals;
                        const flagged = signals.filter((signal) => signal.severity !== "CLEAN")
                          .sort((a, b) => (a.severity === "ACTION" ? -1 : 1) - (b.severity === "ACTION" ? -1 : 1));
                        const clean = signals.filter((signal) => signal.severity === "CLEAN");
                        const actionCount = signals.filter((signal) => signal.severity === "ACTION").length;
                        const watchCount = signals.filter((signal) => signal.severity === "WATCH").length;

                        const signalCard = (signal: BehaviourResponse["conduct"]["signals"][number]) => {
                          const tone = BEHAVIOUR_SIGNAL_TONES[signal.severity];
                          return (
                            <div key={signal.key} className={`min-w-0 rounded-xl p-4 ring-1 ${tone.box}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-bold text-slate-900">{signal.label}</div>
                                  <div className="mt-0.5 text-xs text-slate-600">{signal.detail}</div>
                                </div>
                                <div className="flex-shrink-0 text-right">
                                  <div className="text-xl font-black tabular-nums text-slate-900">{signal.value}</div>
                                  <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>
                                    {tone.label}
                                  </span>
                                </div>
                              </div>
                              <div className="mt-2.5 text-[11px] leading-4 text-slate-400">{signal.threshold}</div>
                            </div>
                          );
                        };

                        return (
                          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h3 className="m-0 text-sm font-bold text-slate-900">Conduct signals</h3>
                                <p className="m-0 mt-1 text-xs text-slate-500">
                                  Every signal shows the threshold that set its colour, so nothing here is a black box.
                                </p>
                              </div>
                              {/* The count strip answers "how bad is it" before any
                                  individual signal has to be read. */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${actionCount > 0 ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-slate-50 text-slate-400 ring-1 ring-slate-200"}`}>
                                  {actionCount} action
                                </span>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${watchCount > 0 ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" : "bg-slate-50 text-slate-400 ring-1 ring-slate-200"}`}>
                                  {watchCount} watch
                                </span>
                                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                                  {clean.length} clean
                                </span>
                              </div>
                            </div>

                            {flagged.length > 0 ? (
                              <div className="mt-5 grid gap-3 sm:grid-cols-2">{flagged.map(signalCard)}</div>
                            ) : (
                              <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">
                                Nothing crossed a threshold. Every signal is within its normal range.
                              </div>
                            )}

                            {clean.length > 0 && (
                              <div className="mt-4">
                                <button
                                  type="button"
                                  onClick={() => setShowCleanSignals((open) => !open)}
                                  className="inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                                >
                                  {showCleanSignals ? "Hide" : "Show"} {clean.length} clean signals
                                  {showCleanSignals ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </button>
                                {showCleanSignals && (
                                  <div className="mt-3 grid gap-3 sm:grid-cols-2">{clean.map(signalCard)}</div>
                                )}
                              </div>
                            )}

                            {behaviour.conduct.restrictions.length > 0 && (
                              <div className="mt-6">
                                <h4 className="m-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">Restriction cases</h4>
                                <div className="mt-3 space-y-2">
                                  {behaviour.conduct.restrictions.map((restriction) => (
                                    <div key={restriction.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                                      <div className="min-w-0">
                                        <div className="font-mono text-[11px] text-slate-500">{restriction.referenceCode}</div>
                                        <div className="mt-1 text-sm font-semibold text-slate-900">{restriction.reason}</div>
                                        <div className="mt-1 text-xs text-slate-500">
                                          {sentenceCaseStatus(restriction.scope)} &middot; applied {formatActivityDate(restriction.appliedAt)}
                                        </div>
                                      </div>
                                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${activityStatusTone(restriction.status)}`}>
                                        {sentenceCaseStatus(restriction.status)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </section>
                        );
                      })()}

                      <p className="text-xs leading-relaxed text-gray-500">{behaviour.coverage.note}</p>
                    </>
                  );
                })()}
              </div>
            )}
            {tab === "stays" && (
              <div>
                {bookings.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                      <ShoppingCart className="h-8 w-8 text-gray-400" />
                    </div>
                    <p className="m-0 mb-1 text-base font-semibold text-gray-700">
                      {filtersActive && allBookings.length > 0 ? "No stays match these filters" : "No stays found"}
                    </p>
                    <p className="m-0 text-sm text-gray-500">
                      {filtersActive && allBookings.length > 0
                        ? `${allBookings.length} stays exist outside the current filters.`
                        : "This user hasn't booked any accommodation yet."}
                    </p>
                    {filtersActive && allBookings.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setProfileFilters(PROFILE_FILTERS_DEFAULT)}
                        className="mt-3 appearance-none rounded-lg border-0 bg-white px-4 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Mobile: card list */}
                    <div className="md:hidden space-y-3">
                      {pagedBookings.map((booking) => (
                        <div key={booking.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-900 truncate">
                                {booking.property?.title || "Property not found"}
                              </div>
                              <div className="mt-1 font-mono text-xs font-bold text-slate-500">ID {booking.id}</div>
                            </div>
                            <Link
                              href={`/admin/bookings/${booking.id}`}
                              aria-label="View booking"
                              title="View"
                              className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm transition-colors hover:bg-emerald-700 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="text-[11px] font-semibold text-gray-600">Property type</div>
                              <div className="mt-1">
                                {booking.property?.type ? <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${propertyTypeTone(booking.property.type)}`}>{booking.property.type}</span> : <span className="text-xs italic text-gray-400">Not provided</span>}
                              </div>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="text-[11px] font-semibold text-gray-600">Region</div>
                              <div className="mt-1">{booking.property?.regionName ? <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-sky-100">{booking.property.regionName}</span> : <span className="text-xs italic text-gray-400">Not provided</span>}</div>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="text-[11px] font-semibold text-gray-600">District</div>
                              <div className="mt-1">{booking.property?.district ? <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 ring-1 ring-violet-100">{booking.property.district}</span> : <span className="text-xs italic text-gray-400">Not provided</span>}</div>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-600">
                                <Calendar className="h-3.5 w-3.5" />
                                Check In/Out
                              </div>
                              <div className="mt-1 text-xs font-semibold text-gray-900">
                                {new Date(booking.checkIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </div>
                              <div className="text-xs text-gray-600">
                                to {new Date(booking.checkOut).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </div>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3 text-right">
                              <div className="flex items-center justify-end gap-2 text-[11px] font-semibold text-gray-600">
                                <Coins className="h-3.5 w-3.5" />
                                Amount
                              </div>
                              <div className="mt-1 text-xs font-bold text-gray-900">
                                {Number(booking.totalAmount).toLocaleString()} TZS
                              </div>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-600">
                                <Tag className="h-3.5 w-3.5" />
                                Status
                              </div>
                              <div className="mt-2">
                                <span
                                  className={`inline-flex px-3 py-1 text-[11px] font-bold rounded-full ${
                                    booking.status === "CONFIRMED"
                                      ? "bg-blue-100 text-blue-800"
                                      : booking.status === "CHECKED_IN"
                                      ? "bg-emerald-100 text-emerald-800"
                                      : booking.status === "CHECKED_OUT"
                                      ? "bg-purple-100 text-purple-800"
                                      : booking.status === "CANCELED"
                                      ? "bg-red-100 text-red-800"
                                      : "bg-gray-100 text-gray-800"
                                  }`}
                                >
                                  {booking.status.replace(/_/g, ' ')}
                                </span>
                              </div>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-600">
                                <Home className="h-3.5 w-3.5" />
                                Booking code
                              </div>
                              <div className="mt-1">
                                {booking.code ? (
                                  <>
                                    <div className="inline-flex rounded-md bg-white px-2 py-1 text-xs font-mono font-semibold text-gray-900 ring-1 ring-gray-200">
                                      {booking.code.codeVisible || "N/A"}
                                    </div>
                                    <div className="mt-1 text-[11px] text-gray-500">{booking.code.status}</div>
                                  </>
                                ) : (
                                  <span className="text-xs text-gray-400 italic">No code</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop: table */}
                    <div className="hidden min-w-0 overflow-x-auto md:block">
                      <div className="min-w-[1320px] overflow-hidden rounded-lg border-y border-r border-slate-200 bg-white">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 z-10 bg-gray-50/90 backdrop-blur">
                            <tr>
                              <th className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-gray-600">
                                <span className="inline-flex items-center gap-2"><Tag className="h-3.5 w-3.5" />ID</span>
                              </th>
                              <th className="border-b border-gray-200 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-gray-600">
                                <button type="button" onClick={() => handleBookingSort("property")} className="inline-flex items-center gap-2 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-800">
                                  <Home className="h-3.5 w-3.5 text-emerald-600" />
                                  Property name
                                  {renderBookingSortIcon("property")}
                                </button>
                              </th>
                              <th className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-gray-600">
                                <button type="button" onClick={() => handleBookingSort("propertyType")} className="m-0 inline-flex appearance-none items-center gap-2 border-0 bg-transparent p-0 hover:text-gray-800">
                                  <Tag className="h-3.5 w-3.5 text-blue-600" />Property type {renderBookingSortIcon("propertyType")}
                                </button>
                              </th>
                              <th className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-gray-600">
                                <button type="button" onClick={() => handleBookingSort("region")} className="m-0 inline-flex appearance-none items-center gap-2 border-0 bg-transparent p-0 hover:text-gray-800">
                                  <MapIcon className="h-3.5 w-3.5 text-sky-600" />Region {renderBookingSortIcon("region")}
                                </button>
                              </th>
                              <th className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-gray-600">
                                <button type="button" onClick={() => handleBookingSort("district")} className="m-0 inline-flex appearance-none items-center gap-2 border-0 bg-transparent p-0 hover:text-gray-800">
                                  <MapIcon className="h-3.5 w-3.5 text-violet-600" />District {renderBookingSortIcon("district")}
                                </button>
                              </th>
                              <th className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-gray-600">
                                <button type="button" onClick={() => handleBookingSort("checkInOut")} className="inline-flex items-center gap-2 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-800">
                                  <Calendar className="h-3.5 w-3.5" />
                                  Check In/Out
                                  {renderBookingSortIcon("checkInOut")}
                                </button>
                              </th>
                              <th className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-right text-[11px] font-semibold tracking-wide text-gray-600">
                                <button type="button" onClick={() => handleBookingSort("amount")} className="inline-flex items-center justify-end gap-2 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-800 ml-auto">
                                  <Coins className="h-3.5 w-3.5" />
                                  Amount
                                  {renderBookingSortIcon("amount")}
                                </button>
                              </th>
                              <th className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-gray-600">
                                <button type="button" onClick={() => handleBookingSort("status")} className="inline-flex items-center gap-2 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-800">
                                  <Tag className="h-3.5 w-3.5" />
                                  Status
                                  {renderBookingSortIcon("status")}
                                </button>
                              </th>
                              <th className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-gray-600">
                                <button type="button" onClick={() => handleBookingSort("code")} className="inline-flex items-center gap-2 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-800">
                                  <Home className="h-3.5 w-3.5" />
                                  Booking code
                                  {renderBookingSortIcon("code")}
                                </button>
                              </th>
                              <th className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-right text-[11px] font-semibold tracking-wide text-gray-600">
                                <span className="inline-flex items-center justify-end gap-2">
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                  Actions
                                </span>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {pagedBookings.map((booking) => (
                              <TableRow
                                key={booking.id}
                                hover={false}
                                onDoubleClick={() => router.push(`/admin/bookings/${booking.id}`)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") router.push(`/admin/bookings/${booking.id}`);
                                }}
                                tabIndex={0}
                                title="Double-click to open booking"
                                className="group cursor-pointer outline-none transition-colors duration-150 even:bg-slate-50/40 hover:bg-emerald-50/80 focus-visible:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                              >
                                <td className="px-4 py-3">
                                  <span className="inline-flex rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-bold tracking-wide text-slate-800">{booking.id}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2 font-semibold text-gray-900"><span className="h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500" />{booking.property?.title || "Property not found"}</div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700">
                                  {booking.property?.type ? <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${propertyTypeTone(booking.property.type)}`}>{booking.property.type}</span> : <span className="italic text-gray-400">Not provided</span>}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700">
                                  {booking.property?.regionName ? <span className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-100">{booking.property.regionName}</span> : <span className="italic text-gray-400">Not provided</span>}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700">
                                  {booking.property?.district ? <span className="inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700 ring-1 ring-violet-100">{booking.property.district}</span> : <span className="italic text-gray-400">Not provided</span>}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="text-sm font-semibold text-gray-900">
                                    {new Date(booking.checkIn).toLocaleDateString('en-US', { 
                                      month: 'short', 
                                      day: 'numeric',
                                      year: 'numeric'
                                    })}
                                  </div>
                                  <div className="text-sm text-gray-600 mt-1">
                                    to {new Date(booking.checkOut).toLocaleDateString('en-US', { 
                                      month: 'short', 
                                      day: 'numeric',
                                      year: 'numeric'
                                    })}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="font-bold text-gray-900">
                                    {Number(booking.totalAmount).toLocaleString()} TZS
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`inline-flex px-3 py-1.5 text-xs font-bold rounded-full ${
                                      booking.status === "CONFIRMED"
                                        ? "bg-blue-100 text-blue-800"
                                        : booking.status === "CHECKED_IN"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : booking.status === "CHECKED_OUT"
                                        ? "bg-purple-100 text-purple-800"
                                        : booking.status === "CANCELED"
                                        ? "bg-red-100 text-red-800"
                                        : "bg-gray-100 text-gray-800"
                                    }`}
                                  >
                                    {booking.status.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  {booking.code ? (
                                    <div>
                                      <div className="text-sm font-mono font-semibold text-gray-900 bg-gray-50 px-2 py-1 rounded">
                                        {booking.code.codeVisible || "N/A"}
                                      </div>
                                      <div className="text-xs text-gray-500 mt-1">{booking.code.status}</div>
                                    </div>
                                  ) : (
                                    <span className="text-sm text-gray-400 italic">No code</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <Link
                                    href={`/admin/bookings/${booking.id}`}
                                    aria-label="View booking"
                                    title="View"
                                    className="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-emerald-600 text-white no-underline shadow-sm transition duration-150 hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                                  >
                                    <Eye className="h-4 w-4" />
                                    <span className="sr-only">View</span>
                                    <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-semibold text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100">
                                      View
                                    </span>
                                  </Link>
                                </td>
                              </TableRow>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
                      <div className="text-xs text-gray-500">
                        Showing {sortedBookings.length === 0 ? 0 : bookingStartIndex + 1}-{Math.min(bookingStartIndex + bookingPageSize, sortedBookings.length)} of {sortedBookings.length}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setBookingPage((p) => Math.max(1, p - 1))}
                          disabled={safeBookingPage <= 1}
                          className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                        >
                          Previous
                        </button>
                        <span className="text-xs font-semibold text-gray-600">Page {safeBookingPage} of {bookingTotalPages}</span>
                        <button
                          type="button"
                          onClick={() => setBookingPage((p) => Math.min(bookingTotalPages, p + 1))}
                          disabled={safeBookingPage >= bookingTotalPages}
                          className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Record detail panel. Tours, transport, and group stays have no
          per-record Admin page yet, so Open shows the full record here and
          links out only where a real Admin route exists. */}
      {activityDetail && (() => {
        const accent = ACTIVITY_DETAIL_ACCENTS[activityDetail.type] || ACTIVITY_DETAIL_ACCENTS.DEFAULT;
        const DetailIcon = ACTIVITY_TYPE_META[activityDetail.type]?.icon ?? Activity;
        const href = activityRecordHref(activityDetail);
        const entries = Object.entries(activityDetail.meta || {});
        const hasAmount = typeof activityDetail.amount === "number" && activityDetail.amount > 0;

        return (
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={activityDetail.title}
          >
            <div
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
              onClick={() => setActivityDetail(null)}
            />

            <div
              id="record-detail-card"
              className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              {/* Preflight is disabled, so nothing sets border-box: without this a
                  padded full-width row inside the card overflows it. */}
              <style>{`#record-detail-card, #record-detail-card * { box-sizing: border-box; }`}</style>

              {/* Header */}
              <div className={`flex items-start justify-between gap-4 px-6 py-5 ${accent.header}`}>
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${accent.tile}`}>
                    <DetailIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className={`text-[11px] font-bold uppercase tracking-wide ${accent.eyebrow}`}>
                      {activityTypeLabel(activityDetail.type)}
                    </div>
                    <h3 className="m-0 mt-0.5 truncate text-lg font-bold text-slate-900">{activityDetail.title}</h3>
                    <div className="mt-1 font-mono text-xs text-slate-500">#{activityDetail.id}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActivityDetail(null)}
                  aria-label="Close record"
                  className="inline-flex h-9 w-9 flex-shrink-0 appearance-none items-center justify-center rounded-lg border-0 bg-white/80 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {/* Headline facts first, so the answer is visible without reading
                    the whole list. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Status</div>
                    <div className="mt-2">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${activityStatusTone(activityDetail.status)}`}>
                        {sentenceCaseStatus(activityDetail.status || "Recorded")}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      {typeof activityDetail.rating === "number" ? "Rating" : "Amount"}
                    </div>
                    <div className="mt-2 text-base font-bold tabular-nums text-slate-900">
                      {typeof activityDetail.rating === "number" ? (
                        <span className="text-amber-600">{activityDetail.rating}/5</span>
                      ) : hasAmount ? (
                        <>
                          {activityDetail.amount?.toLocaleString()}{" "}
                          <span className="text-xs font-semibold text-slate-500">{activityDetail.currency || "TZS"}</span>
                        </>
                      ) : (
                        <span className="text-sm font-medium italic text-slate-400">No charge</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Recorded</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {formatActivityDate(activityDetail.createdAt)}
                    </div>
                  </div>
                </div>

                {activityDetail.reference && activityUsesCode(activityDetail.type) && (
                  <div className="mt-6 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      {activityCodeLabel(activityDetail.type)}
                    </div>
                    {/* break-all keeps a long generated code inside the card
                        instead of pushing the layout sideways. */}
                    <div className="mt-1.5 break-all font-mono text-sm font-semibold text-slate-900">
                      {activityDetail.reference}
                    </div>
                  </div>
                )}

                {entries.length > 0 && (
                  <div className="mt-6">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Record details</div>
                    {/* Self-contained tiles rather than one grid over a tinted
                        background: a full-width row used to leave a grey block
                        beside its shorter neighbour. */}
                    <dl className="m-0 mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {entries.map(([key, value]) => {
                        const style = metaFieldStyle(key);
                        const text = value === null || value === undefined || value === "" ? "" : String(value);
                        const isEmpty = text === "";
                        // Only unbreakable identifiers earn a full-width tile.
                        // Place names and person names wrap in place instead.
                        const isLong = !style.wrap && text.length > 24;
                        return (
                          <div
                            key={key}
                            className={`min-w-0 rounded-xl px-3.5 py-3 ring-1 ${
                              isEmpty ? "bg-slate-50/60 ring-slate-100" : "bg-white ring-slate-200"
                            } ${isLong ? "sm:col-span-2" : ""}`}
                          >
                            <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              <span className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${isEmpty ? "bg-slate-200" : style.dot}`} />
                              {prettyMetaLabel(key)}
                            </dt>
                            <dd
                              className={`m-0 mt-1.5 break-words text-sm font-semibold text-slate-900 ${
                                style.mono || isLong ? "break-all font-mono text-xs" : ""
                              }`}
                            >
                              {isEmpty ? (
                                <span className="font-sans text-xs font-medium italic text-slate-400">Not recorded</span>
                              ) : (
                                prettyMetaValue(value as string | number | null)
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-6 py-4 shadow-[inset_0_1px_0_#e2e8f0]">
                <p className="m-0 text-[11px] text-slate-500">
                  {href
                    ? "Opens the full record in its own Admin page."
                    : "This product has no separate Admin page yet, so everything on record is shown here."}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActivityDetail(null)}
                    className="appearance-none rounded-lg border-0 bg-white px-4 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                  >
                    Close
                  </button>
                  {href && (
                    <Link
                      href={href}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white no-underline shadow-sm transition hover:bg-emerald-700"
                    >
                      <Eye className="h-4 w-4" />
                      Open full record
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
