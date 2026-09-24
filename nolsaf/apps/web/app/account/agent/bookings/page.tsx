"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { ArrowLeft, CalendarDays, ClipboardList, CheckCircle2, Activity, Eye, Info, ArrowUpDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Wallet2, UserCheck, ShieldCheck, BadgeCheck, HandCoins, Flag, Star, type LucideIcon } from "lucide-react";
import TableRow from "@/components/TableRow";
import TableScroller from "@/components/TableScroller";
import { publishRailCounts } from "@/lib/agentRailSignals";

const api = apiClient;

function BookingStatusBadge({ status }: { status?: string }) {
  const s = String(status || "").toUpperCase();
  if (!s) return <span className="text-xs text-slate-400">—</span>;
  const cfg: Record<string, { label: string; cls: string }> = {
    PENDING_PAYMENT: { label: "Pending Payment", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    PAID:            { label: "Paid",            cls: "bg-blue-50 text-blue-700 border-blue-200" },
    CONFIRMED:       { label: "Confirmed",       cls: "bg-teal-50 text-teal-700 border-teal-200" },
    COMPLETED:       { label: "Completed",       cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    CANCELED:        { label: "Cancelled",       cls: "bg-red-50 text-red-600 border-red-200" },
    CANCELLED:       { label: "Cancelled",       cls: "bg-red-50 text-red-600 border-red-200" },
    REFUNDED:        { label: "Refunded",        cls: "bg-slate-100 text-slate-600 border-slate-200" },
    PENDING:         { label: "Pending",         cls: "bg-amber-50 text-amber-700 border-amber-200" },
    IN_PROGRESS:     { label: "In Progress",     cls: "bg-orange-50 text-orange-700 border-orange-200" },
    ASSIGNED:        { label: "Assigned",        cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  };
  const { label, cls } = cfg[s] ?? { label: s.replace(/_/g, " "), cls: "bg-slate-100 text-slate-600 border-slate-200" };
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

type BookingItem = {
  id: string | number;
  title?: string;
  description?: string | null;
  plannedActivities?: string | null;
  packageSnapshot?: any;
  metadata?: any;
  activityChecks?: Record<string, string>;
  checklistLocked?: boolean;
  checklistLockedAt?: string | null;
  status?: string;
  paymentStatus?: string;
  createdAt?: string;
  updatedAt?: string;
  tripDate?: string;
  amountPaid?: number;
  currency?: string;
  tripType?: string;
  paidAt?: string | null;
  confirmedAt?: string | null;
  payoutStatus?: string | null;
  payoutRequestedAt?: string | null;
  payoutApprovedAt?: string | null;
  payoutPaidAt?: string | null;
  pickupValidatedAt?: string | null;
  rating?: number | null;
  challenges?: string | null;
  completedAt?: string | null;
  /** "TOUR_BOOKING" for TourBooking records; absent/undefined for PlanRequest assignments */
  source?: "TOUR_BOOKING";
  bookingCode?: string | null;
  airportDeparture?: string | null;
  requester?: {
    fullName?: string;
    nationality?: string;
    travelerCount?: number;
  };
};

type BucketKey = "new" | "confirmed" | "progress" | "completed" | "cancelled" | "other";
type MainBucketKey = "new" | "confirmed" | "progress" | "completed";
const PAGE_SIZE = 10;
const CONGRATS_VISIBLE_MS = 20_000;
type SortKey =
  | "bookingBy"
  | "bookingCode"
  | "airportDeparture"
  | "nationality"
  | "typeOfPackage"
  | "status"
  | "dateOfTrip"
  | "amountPaid"
  | "dateConfirmed"
  | "completedAt"
  | "tripRating"
  | "challenge";
type SortDir = "asc" | "desc";

// --- Activity helpers ---

type ActivityPeriod = "Morning" | "Afternoon" | "Evening" | "Anytime";
type ActivityEntry = { id: string; label: string; period: ActivityPeriod; timeLabel?: string };
type ActivityDayGroup = { day: number; label: string; title?: string; description?: string; items: ActivityEntry[] };

function slugifyActivityLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function detectActivityPeriod(label: string): ActivityPeriod {
  const s = label.toUpperCase();
  if (s.includes("MORNING") || s.includes("BREAKFAST") || s.includes("SUNRISE")) return "Morning";
  if (s.includes("AFTERNOON") || s.includes("LUNCH") || s.includes("NOON")) return "Afternoon";
  if (s.includes("EVENING") || s.includes("DINNER") || s.includes("SUNSET") || s.includes("NIGHT") || s.includes("CAMPFIRE")) return "Evening";
  return "Anytime";
}

function parseTimedActivity(line: string): { timeLabel?: string; label: string } | null {
  const cleaned = String(line || "").trim();
  if (!cleaned) return null;

  const range = cleaned.match(/^([01]?\d:[0-5]\d)\s*[-–]\s*([01]?\d:[0-5]\d)\s*[:\-]?\s*(.+)$/i);
  if (range) {
    const timeLabel = `${range[1]} - ${range[2]}`;
    const label = String(range[3] || "").trim();
    if (!label) return null;
    return { timeLabel, label };
  }

  const startOnly = cleaned.match(/^([01]?\d|2[0-3]):([0-5]\d)\s*[:\-]?\s*(.+)$/i);
  if (startOnly) {
    const label = String(startOnly[3] || "").trim();
    if (!label) return null;
    return { timeLabel: `${startOnly[1]}:${startOnly[2]}`, label };
  }

  return null;
}

function parseStructuredActivity(value: unknown): { timeLabel?: string; label: string } | null {
  if (typeof value === "string") {
    const timed = parseTimedActivity(value);
    if (timed) return timed;
    const label = value.trim();
    return label ? { label } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const row = value as Record<string, unknown>;
  const start = String(row.time || row.startTime || row.from || "").trim();
  const end = String(row.endTime || row.to || "").trim();
  const label = String(row.label || row.activity || row.name || row.title || row.description || "").trim();
  if (!label) return null;

  return {
    label,
    timeLabel: start && end ? `${start} - ${end}` : (start || undefined),
  };
}

function structuredPlanFromBooking(booking: BookingItem): ActivityDayGroup[] {
  const pkg = (booking.packageSnapshot as any) || null;
  const md = (booking.metadata as any) || null;

  const candidates: unknown[] = [
    md?.agreedPlan?.itinerary,
    md?.confirmedPlan?.itinerary,
    md?.servicePlan?.itinerary,
    md?.agentPlan?.itinerary,
    md?.itinerary,
    pkg?.itinerary,
    pkg?.package?.itinerary,
    pkg?.selectedPackage?.itinerary,
    pkg?.details?.itinerary,
    pkg?.dayByDay?.itinerary,
    pkg?.timeline,
  ];

  const itinerary = candidates.find((v) => Array.isArray(v) && v.length > 0);
  if (!Array.isArray(itinerary) || itinerary.length === 0) return [];

  const groups: ActivityDayGroup[] = itinerary
    .map((dayRaw, index) => {
      if (!dayRaw || typeof dayRaw !== "object" || Array.isArray(dayRaw)) return null;
      const day = dayRaw as Record<string, unknown>;
      const dayNum = Number(day.day);
      const resolvedDay = Number.isFinite(dayNum) && dayNum > 0 ? dayNum : (index + 1);

      const itemsRaw: unknown[] = [
        ...(Array.isArray(day.timeline) ? day.timeline : []),
        ...(Array.isArray(day.events) ? day.events : []),
        ...(Array.isArray(day.activities) ? day.activities : []),
      ];

      const items = itemsRaw
        .map((it, itemIndex) => {
          const parsed = parseStructuredActivity(it);
          if (!parsed) return null;
          return {
            id: `d${resolvedDay}-${itemIndex + 1}-${slugifyActivityLabel(parsed.timeLabel ? `${parsed.timeLabel}-${parsed.label}` : parsed.label) || "activity"}`,
            label: parsed.label,
            period: detectActivityPeriod(parsed.label),
            timeLabel: parsed.timeLabel,
          } as ActivityEntry;
        })
        .filter(Boolean) as ActivityEntry[];

      if (items.length === 0) return null;
      return {
        day: resolvedDay,
        label: `Day ${resolvedDay}`,
        title: String(day.title || day.name || "").trim() || undefined,
        description: String(day.description || day.notes || "").trim() || undefined,
        items,
      } as ActivityDayGroup;
    })
    .filter((g): g is ActivityDayGroup => !!g)
    .sort((a, b) => a.day - b.day);

  return groups;
}

function getActivityPlan(booking: BookingItem): ActivityDayGroup[] {
  const structured = structuredPlanFromBooking(booking);
  if (structured.length > 0) return structured;

  const groups = new Map<number, { title?: string; descriptionLines: string[]; items: Array<{ timeLabel?: string; label: string }> }>();
  const activitySource = booking.plannedActivities || booking.description || "";

  if (activitySource) {
    const rawLines = activitySource
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let currentDay = 1;
    for (const rawLine of rawLines) {
      const line = rawLine.replace(/^[\-*•]+\s*/, "").trim();
      if (!line) continue;

      const dayMatch = line.match(/^DAY\s*(\d+)\s*:?(.*)$/i);
      if (dayMatch) {
        const parsedDay = Number(dayMatch[1]);
        if (Number.isFinite(parsedDay) && parsedDay > 0) currentDay = parsedDay;
        const rest = String(dayMatch[2] || "").trim();
        const bucket = groups.get(currentDay) || { title: "", descriptionLines: [], items: [] };
        if (rest) {
          const timed = parseTimedActivity(rest);
          if (timed) {
            bucket.items.push(timed);
          } else if (!bucket.title) {
            bucket.title = rest;
          } else {
            bucket.descriptionLines.push(rest);
          }
        }
        groups.set(currentDay, bucket);
        continue;
      }

      const bucket = groups.get(currentDay) || { title: "", descriptionLines: [], items: [] };
      const timed = parseTimedActivity(line);
      if (timed) {
        bucket.items.push(timed);
        groups.set(currentDay, bucket);
        continue;
      }

      const lineSplits = line
        .split(/[;,|]/)
        .map((x) => x.trim())
        .filter((x) => x.length > 2 && x.length < 180);

      if (lineSplits.length > 1) {
        lineSplits.forEach((segment) => {
          const segTimed = parseTimedActivity(segment);
          if (segTimed) bucket.items.push(segTimed);
          else bucket.items.push({ label: segment });
        });
      } else if (lineSplits.length === 1) {
        const single = lineSplits[0];
        if (!bucket.title && single.length <= 90 && !bucket.items.length) {
          bucket.title = single;
        } else if (!bucket.items.length && single.length > 60) {
          bucket.descriptionLines.push(single);
        } else {
          bucket.items.push({ label: single });
        }
      }

      groups.set(currentDay, bucket);
    }
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([day, group]) => ({
      day,
      label: `Day ${day}`,
      title: group.title ? group.title : undefined,
      description: group.descriptionLines.length > 0 ? group.descriptionLines.join(" ") : undefined,
      items: group.items.map((item, index) => ({
        id: `d${day}-${index + 1}-${slugifyActivityLabel(item.timeLabel ? `${item.timeLabel}-${item.label}` : item.label) || "activity"}`,
        label: item.label,
        period: detectActivityPeriod(item.label),
        timeLabel: item.timeLabel,
      })),
    }))
    .filter((g) => g.items.length > 0);
}

function formatMilestoneTime(iso?: string | null): string {
  if (!iso) return "Pending";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Pending";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function isRevenueVerified(paymentStatus?: string | null): boolean {
  const s = String(paymentStatus || "").toUpperCase();
  return s === "VERIFIED" || s === "APPROVED" || s === "DISBURSED";
}

type CheckpointKey = "booked" | "paid" | "validated" | "verified" | "approved" | "disbursed" | "completed" | "rated";

function checkpointTheme(key: CheckpointKey) {
  switch (key) {
    case "booked":
      return { dot: "border-cyan-600 bg-cyan-600", badge: "bg-cyan-600 text-white", card: "border-cyan-200 bg-cyan-50/70" };
    case "paid":
      return { dot: "border-blue-600 bg-blue-600", badge: "bg-blue-600 text-white", card: "border-blue-200 bg-blue-50/70" };
    case "validated":
      return { dot: "border-teal-600 bg-teal-600", badge: "bg-teal-600 text-white", card: "border-teal-200 bg-teal-50/70" };
    case "verified":
      return { dot: "border-violet-600 bg-violet-600", badge: "bg-violet-600 text-white", card: "border-violet-200 bg-violet-50/70" };
    case "approved":
      return { dot: "border-fuchsia-600 bg-fuchsia-600", badge: "bg-fuchsia-600 text-white", card: "border-fuchsia-200 bg-fuchsia-50/70" };
    case "disbursed":
      return { dot: "border-emerald-600 bg-emerald-600", badge: "bg-emerald-600 text-white", card: "border-emerald-200 bg-emerald-50/70" };
    case "completed":
      return { dot: "border-lime-600 bg-lime-600", badge: "bg-lime-600 text-white", card: "border-lime-200 bg-lime-50/70" };
    case "rated":
      return { dot: "border-amber-500 bg-amber-500", badge: "bg-amber-500 text-white", card: "border-amber-200 bg-amber-50/70" };
    default:
      return { dot: "border-slate-300 bg-slate-300", badge: "bg-slate-300 text-slate-700", card: "border-slate-200 bg-slate-50/80" };
  }
}

function checkpointRailLabel(key: CheckpointKey): string {
  switch (key) {
    case "booked": return "Booking";
    case "paid": return "Payment";
    case "validated": return "Agent";
    case "verified": return "Verify";
    case "approved": return "Approve";
    case "disbursed": return "Disburse";
    case "completed": return "Task";
    case "rated": return "Trip";
    default: return "Stage";
  }
}

function checkpointIcon(key: CheckpointKey) {
  switch (key) {
    case "booked": return <ClipboardList className="h-3.5 w-3.5" />;
    case "paid": return <Wallet2 className="h-3.5 w-3.5" />;
    case "validated": return <UserCheck className="h-3.5 w-3.5" />;
    case "verified": return <ShieldCheck className="h-3.5 w-3.5" />;
    case "approved": return <BadgeCheck className="h-3.5 w-3.5" />;
    case "disbursed": return <HandCoins className="h-3.5 w-3.5" />;
    case "completed": return <Flag className="h-3.5 w-3.5" />;
    case "rated": return <Star className="h-3.5 w-3.5" />;
    default: return <CheckCircle2 className="h-3.5 w-3.5" />;
  }
}

function bucketForStatus(
  status?: string,
  pickupValidatedAt?: string | null,
  completedAt?: string | null,
  checklistLocked?: boolean,
  checklistLockedAt?: string | null,
): BucketKey {
  const s = String(status || "").toUpperCase();
  if (checklistLocked || checklistLockedAt || completedAt) return "completed";
  if (s.includes("COMPLETE") || s.includes("DONE") || s.includes("CLOSED")) return "completed";
  if (s.includes("CANCEL") || s.includes("REJECT") || s.includes("REFUND")) return "cancelled";
  // A validated pickup means the trip is actively in progress regardless of status label
  if (pickupValidatedAt) return "progress";
  if (s.includes("PROGRESS") || s.includes("ONGOING") || s.includes("ACTIVE")) return "progress";
  if (s === "PAID" || s.includes("CONFIRM") || s.includes("ACCEPT")) return "confirmed";
  if (!s || s.includes("NEW") || s.includes("PENDING") || s.includes("ASSIGN") || s === "PENDING_PAYMENT") return "new";
  return "other";
}

function bucketLabel(key: BucketKey) {
  switch (key) {
    case "new":
      return "New";
    case "confirmed":
      return "Confirmed";
    case "progress":
      return "In Progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Other";
  }
}

const MAIN_BUCKETS: MainBucketKey[] = ["new", "confirmed", "progress", "completed"];

// The stage lives in the URL so the sidebar can deep link straight into a stage
// and a shared link reopens the same one.
const STAGE_PARAM = "stage";

function parseStage(value: string | null): MainBucketKey {
  const key = String(value || "").toLowerCase();
  return (MAIN_BUCKETS as string[]).includes(key) ? (key as MainBucketKey) : "new";
}

function bucketIconComponent(key: MainBucketKey): LucideIcon {
  switch (key) {
    case "new":
      return ClipboardList;
    case "confirmed":
      return UserCheck;
    case "progress":
      return Activity;
    default:
      return CheckCircle2;
  }
}

function bucketIcon(key: MainBucketKey) {
  const Icon = bucketIconComponent(key);
  return <Icon className="h-4 w-4" />;
}

function tabClasses(key: MainBucketKey, isActive: boolean) {
  if (key === "new") {
    return isActive
      ? "flex items-center justify-between rounded-full border px-3 py-2 text-left text-sm font-bold shadow-sm"
      : "flex items-center justify-between rounded-full border px-3 py-2 text-left text-sm font-semibold transition-all hover:bg-white/10";
  }
  if (key === "confirmed") {
    return isActive
      ? "flex items-center justify-between rounded-full border px-3 py-2 text-left text-sm font-bold shadow-sm"
      : "flex items-center justify-between rounded-full border px-3 py-2 text-left text-sm font-semibold transition-all hover:bg-white/10";
  }
  if (key === "progress") {
    return isActive
      ? "flex items-center justify-between rounded-full border px-3 py-2 text-left text-sm font-bold shadow-sm"
      : "flex items-center justify-between rounded-full border px-3 py-2 text-left text-sm font-semibold transition-all hover:bg-white/10";
  }
  return isActive
    ? "flex items-center justify-between rounded-full border px-3 py-2 text-left text-sm font-bold shadow-sm"
    : "flex items-center justify-between rounded-full border px-3 py-2 text-left text-sm font-semibold transition-all hover:bg-white/10";
}

function tabCountPillClasses(key: MainBucketKey, isActive: boolean) {
  if (key === "new") {
    return isActive
      ? "rounded-full bg-sky-300 px-2 py-0.5 text-xs font-extrabold text-sky-900"
      : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600";
  }
  if (key === "confirmed") {
    return isActive
      ? "rounded-full bg-violet-300 px-2 py-0.5 text-xs font-extrabold text-violet-900"
      : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600";
  }
  if (key === "progress") {
    return isActive
      ? "rounded-full bg-amber-300 px-2 py-0.5 text-xs font-extrabold text-amber-900"
      : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600";
  }
  return isActive
    ? "rounded-full bg-emerald-300 px-2 py-0.5 text-xs font-extrabold text-emerald-900"
    : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600";
}

function StageEmptyState({
  Icon,
  title,
  description,
}: {
  Icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="px-4 py-8">
      <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-300 px-6 py-12 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-400">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <p className="m-0 mt-1 text-sm font-bold text-neutral-800">{title}</p>
        <p className="m-0 text-xs text-neutral-500">{description}</p>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  tone = "slate",
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  tone?: "slate" | "emerald";
}) {
  const active = sortKey === column;
  // NRMS table headers read as quiet metadata until sorted, then take the
  // emerald accent so the sorted column is obvious at a glance.
  const colorClass = active
    ? "text-emerald-700"
    : tone === "emerald"
    ? "text-emerald-700/70 hover:text-emerald-700"
    : "text-neutral-400 hover:text-emerald-700";

  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={`inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-[0.1em] shadow-none outline-none transition-colors focus-visible:underline ${colorClass}`}
      title={`Sort by ${label}`}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      {active ? (
        sortDir === "asc" ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />
      )}
    </button>
  );
}

export default function AgentBookingsPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BookingItem[]>([]);
  const [agentName, setAgentName] = useState("Operator");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stageParam = searchParams.get(STAGE_PARAM);
  const activeTab = parseStage(stageParam);

  // Tab clicks and sidebar links both go through the URL, so there is a single
  // source of truth for which stage is open.
  const setActiveTab = useCallback(
    (key: MainBucketKey) => {
      const next = new URLSearchParams(searchParams.toString());
      if (key === "new") next.delete(STAGE_PARAM);
      else next.set(STAGE_PARAM, key);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );
  const [sortKey, setSortKey] = useState<SortKey>("dateOfTrip");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRoadmapKey, setExpandedRoadmapKey] = useState<string | null>(null);
  // checkedActivities: key = `{bookingId}__{activityId}`, value = ISO timestamp
  const [checkedActivities, setCheckedActivities] = useState<Record<string, string>>({});
  const [congratsExpiresAt, setCongratsExpiresAt] = useState<Record<string, number>>({});
  const congratsTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const isBookingChecklistLocked = useCallback((booking: BookingItem) => {
    if (booking.checklistLocked || booking.checklistLockedAt) return true;
    const bookingId = String(booking.id);
    const all = getActivityPlan(booking).flatMap((group) => group.items);
    return all.length > 0 && all.every((item) => !!checkedActivities[`${bookingId}__${item.id}`]);
  }, [checkedActivities]);

  useEffect(() => {
    setCheckedActivities((prev) => {
      const tourBookings = items.filter((i) => i.source === "TOUR_BOOKING");
      if (tourBookings.length === 0) return prev;

      const serverChecks: Record<string, string> = {};
      const tourPrefixes = new Set<string>();
      for (const booking of tourBookings) {
        const bid = String(booking.id);
        tourPrefixes.add(`${bid}__`);
        const checks = booking.activityChecks || {};
        for (const [activityId, checkedAt] of Object.entries(checks)) {
          if (!checkedAt) continue;
          serverChecks[`${bid}__${activityId}`] = checkedAt;
        }
      }

      const preservedLocal = Object.fromEntries(
        Object.entries(prev).filter(([k]) => !Array.from(tourPrefixes).some((prefix) => k.startsWith(prefix)))
      );

      return { ...preservedLocal, ...serverChecks };
    });
  }, [items]);

  useEffect(() => {
    const now = Date.now();
    const additions: Record<string, number> = {};

    for (const booking of items) {
      const bid = String(booking.id);
      if (Object.prototype.hasOwnProperty.call(congratsExpiresAt, bid)) continue;

      const locked = Boolean(booking.checklistLocked || booking.checklistLockedAt);
      if (!locked) continue;

      const lockedAtMs = booking.checklistLockedAt ? new Date(booking.checklistLockedAt).getTime() : NaN;
      const baseMs = Number.isFinite(lockedAtMs) ? lockedAtMs : now;
      const expiresAt = baseMs + CONGRATS_VISIBLE_MS;
      additions[bid] = expiresAt > now ? expiresAt : 0;
    }

    if (Object.keys(additions).length === 0) return;

    setCongratsExpiresAt((prev) => ({
      ...prev,
      ...additions,
    }));
  }, [items, congratsExpiresAt]);

  useEffect(() => {
    const now = Date.now();
    for (const [bid, expiresAt] of Object.entries(congratsExpiresAt)) {
      if (expiresAt <= now) continue;
      if (congratsTimersRef.current[bid]) continue;
      const delay = Math.max(0, expiresAt - now);
      congratsTimersRef.current[bid] = setTimeout(() => {
        setCongratsExpiresAt((prev) => {
          if (!Object.prototype.hasOwnProperty.call(prev, bid) || prev[bid] === 0) return prev;
          return { ...prev, [bid]: 0 };
        });
        delete congratsTimersRef.current[bid];
      }, delay);
    }
  }, [congratsExpiresAt]);

  useEffect(() => {
    const timers = congratsTimersRef.current;
    return () => {
      for (const timer of Object.values(timers)) {
        clearTimeout(timer);
      }
    };
  }, []);

  const toggleActivity = useCallback(async (booking: BookingItem, activityId: string, locked = false) => {
    if (locked || isBookingChecklistLocked(booking)) {
      setError("Today's tasks are fully completed and locked. Get ready for the next day.");
      return;
    }

    const bookingId = String(booking.id);
    const totalActivities = getActivityPlan(booking).flatMap((group) => group.items).length;
    const key = `${bookingId}__${activityId}`;
    const wasChecked = !!checkedActivities[key];

    // Optimistic UI update.
    setCheckedActivities((prev) => {
      const next = { ...prev };
      if (wasChecked) delete next[key];
      else next[key] = new Date().toISOString();
      return next;
    });

    if (booking.source !== "TOUR_BOOKING") return;

    try {
      const res = await api.post(`/api/agent/tour-bookings/${encodeURIComponent(bookingId)}/activity-checks`, {
        activityId,
        checked: !wasChecked,
        totalActivities,
      });

      const checks = (res as any)?.data?.activityChecks as Record<string, string> | undefined;
      const serverLocked = Boolean((res as any)?.data?.locked);
      const serverLockedAt = (res as any)?.data?.lockedAt ? String((res as any).data.lockedAt) : null;
      const serverStatus = (res as any)?.data?.status ? String((res as any).data.status) : null;
      const serverCompletedAt = (res as any)?.data?.completedAt ? String((res as any).data.completedAt) : null;
      if (!checks || typeof checks !== "object") return;

      setCheckedActivities((prev) => {
        const next = { ...prev };
        const prefix = `${bookingId}__`;
        for (const existingKey of Object.keys(next)) {
          if (existingKey.startsWith(prefix)) delete next[existingKey];
        }
        for (const [id, checkedAt] of Object.entries(checks)) {
          if (checkedAt) next[`${bookingId}__${id}`] = checkedAt;
        }
        return next;
      });

      if (serverLocked || serverLockedAt) {
        setItems((prev) => prev.map((item) => (
          String(item.id) === bookingId
            ? {
              ...item,
              checklistLocked: true,
              checklistLockedAt: serverLockedAt || new Date().toISOString(),
              ...(serverStatus ? { status: serverStatus } : {}),
              ...(serverCompletedAt ? { completedAt: serverCompletedAt } : {}),
            }
            : item
        )));
      }
    } catch (e: any) {
      // Roll back optimistic update on failure.
      setCheckedActivities((prev) => {
        const next = { ...prev };
        if (wasChecked) next[key] = checkedActivities[key];
        else delete next[key];
        return next;
      });

      const serverLocked = Boolean(e?.response?.data?.locked);
      const serverLockedAt = e?.response?.data?.lockedAt ? String(e.response.data.lockedAt) : null;
      const serverStatus = e?.response?.data?.status ? String(e.response.data.status) : null;
      const serverCompletedAt = e?.response?.data?.completedAt ? String(e.response.data.completedAt) : null;
      if (serverLocked || serverLockedAt) {
        setItems((prev) => prev.map((item) => (
          String(item.id) === bookingId
            ? {
              ...item,
              checklistLocked: true,
              checklistLockedAt: serverLockedAt || new Date().toISOString(),
              ...(serverStatus ? { status: serverStatus } : {}),
              ...(serverCompletedAt ? { completedAt: serverCompletedAt } : {}),
            }
            : item
        )));
      }

      setError(e?.response?.data?.error || "Could not update activity status.");
    }
  }, [checkedActivities, isBookingChecklistLocked]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [tourBookingsRes, meRes] = await Promise.all([
          api.get("/api/agent/tour-bookings"),
          api.get("/api/account/me").catch(() => null),
        ]);
        if (!alive) return;
        const tourBookings: BookingItem[] = (tourBookingsRes as any)?.data?.items ?? [];
        const meData = (meRes as any)?.data?.data ?? (meRes as any)?.data ?? null;
        const resolvedAgentName = String(
          meData?.fullName
            || meData?.name
            || meData?.displayName
            || meData?.user?.fullName
            || meData?.user?.name
            || "Operator"
        ).trim();
        const merged = [...tourBookings].sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });
        setItems(Array.isArray(merged) ? merged : []);
        setAgentName(resolvedAgentName || "Operator");
      } catch (e: any) {
        if (!alive) return;
        setError(e?.response?.data?.message || e?.response?.data?.error || "Could not load bookings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const base: Record<BucketKey, BookingItem[]> = {
      new: [], confirmed: [], progress: [], completed: [], cancelled: [], other: [],
    };
    for (const item of items) {
      base[bucketForStatus(item.status, item.pickupValidatedAt, item.completedAt, item.checklistLocked, item.checklistLockedAt)].push(item);
    }
    return base;
  }, [items]);

  // The sidebar shows the same tally the stage strip used to, so publish it
  // whenever the grouping changes instead of counting the list twice.
  useEffect(() => {
    if (loading) return;
    publishRailCounts("bookings", {
      new: grouped.new.length,
      confirmed: grouped.confirmed.length,
      progress: grouped.progress.length,
      completed: grouped.completed.length,
    });
  }, [grouped, loading]);

  const tabs: MainBucketKey[] = MAIN_BUCKETS;
  const activeItems = grouped[activeTab];
  const isConfirmedTab = activeTab === "confirmed";
  const isProgressTab = activeTab === "progress";
  const isCompletedTab = activeTab === "completed";

  const confirmedStats = useMemo(() => {
    const confirmedItems = grouped.confirmed;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const weekStart = new Date(todayStart);
    const day = weekStart.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    weekStart.setDate(weekStart.getDate() - diffToMonday);

    const getStamp = (item: BookingItem) => {
      const raw = item.paidAt || item.confirmedAt || item.createdAt || item.updatedAt;
      return raw ? new Date(raw) : null;
    };

    let today = 0;
    let week = 0;
    for (const item of confirmedItems) {
      const d = getStamp(item);
      if (!d || Number.isNaN(d.getTime())) continue;
      if (d >= todayStart && d < tomorrowStart) today += 1;
      if (d >= weekStart && d < tomorrowStart) week += 1;
    }
    return {
      today,
      week,
      total: confirmedItems.length,
    };
  }, [grouped.confirmed]);

  const onSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      const defaultDir: SortDir = key === "amountPaid" || key.includes("date") || key === "completedAt" || key === "tripRating" ? "desc" : "asc";
      setSortDir(defaultDir);
      return key;
    });
  }, []);

  const sortedActiveItems = useMemo(() => {
    const valueFor = (booking: BookingItem, key: SortKey): string | number => {
      const bookingBy = booking.requester?.fullName || "Guest";
      const nationality = booking.requester?.nationality || "";
      const typeOfPackage = booking.tripType || (booking.title ? String(booking.title).split(" • ")[0] : "Custom");
      const dateOfTrip = booking.tripDate || booking.createdAt || "";
      const dateConfirmed = booking.createdAt || "";
      const completedAt = booking.completedAt || booking.updatedAt || booking.createdAt || "";
      const rating = typeof booking.rating === "number" ? booking.rating : -1;
      const challenge = booking.challenges || booking.description || "";
      switch (key) {
        case "bookingBy": return bookingBy;
        case "bookingCode": return booking.bookingCode || "";
        case "airportDeparture": return booking.airportDeparture || "";
        case "nationality": return nationality;
        case "typeOfPackage": return typeOfPackage;
        case "status": return String(booking.status || "");
        case "dateOfTrip": return dateOfTrip ? new Date(dateOfTrip).getTime() : 0;
        case "amountPaid": return typeof booking.amountPaid === "number" ? booking.amountPaid : -1;
        case "dateConfirmed": return dateConfirmed ? new Date(dateConfirmed).getTime() : 0;
        case "completedAt": return completedAt ? new Date(completedAt).getTime() : 0;
        case "tripRating": return rating;
        case "challenge": return challenge;
        default: return "";
      }
    };

    return [...activeItems].sort((a, b) => {
      const av = valueFor(a, sortKey);
      const bv = valueFor(b, sortKey);
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [activeItems, sortDir, sortKey]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedActiveItems.length / PAGE_SIZE)), [sortedActiveItems.length]);
  const paginatedActiveItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedActiveItems.slice(start, start + PAGE_SIZE);
  }, [currentPage, sortedActiveItems]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, sortKey, sortDir]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const paginationControls =
    sortedActiveItems.length > 0 ? (
      <div className="flex flex-col gap-3 bg-neutral-50/70 px-4 py-3 shadow-[inset_0_1px_0_0_#eeeeee] sm:flex-row sm:items-center sm:justify-between">
        <div className="text-center text-[11px] font-semibold text-neutral-500 sm:text-left">
          Showing {(currentPage - 1) * PAGE_SIZE + 1}
          {" - "}
          {Math.min(currentPage * PAGE_SIZE, sortedActiveItems.length)}
          {" of "}
          {sortedActiveItems.length}
        </div>
        <div className="grid w-full grid-cols-3 items-center gap-2 sm:flex sm:w-auto sm:gap-1">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="inline-flex min-h-9 cursor-pointer appearance-none items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-600 transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="text-center text-[11px] font-semibold text-neutral-500">
            {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="inline-flex min-h-9 cursor-pointer appearance-none items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-600 transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    ) : null;

  if (loading) {
    return (
      <div className="min-w-0 max-w-full pb-10">
        <div className="mb-4 animate-pulse">
          <div className="h-3 w-28 rounded-full bg-neutral-200" />
          <div className="mt-3 h-6 w-44 rounded-full bg-neutral-200" />
          <div className="mt-2 h-3 w-72 max-w-full rounded-full bg-neutral-100" />
        </div>

        <div className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
          <div className="flex gap-4 bg-neutral-50/90 px-4 py-3 shadow-[inset_0_-1px_0_0_#e5e5e5]">
            {[110, 70, 120, 80, 100, 60, 90].map((w, i) => (
              <div key={i} className="h-2.5 animate-pulse rounded-full bg-neutral-200" style={{ width: w }} />
            ))}
          </div>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-4 px-4 py-4 shadow-[inset_0_-1px_0_0_#f5f5f5] last:shadow-none"
            >
              <div className="h-3.5 w-28 rounded-full bg-neutral-200" />
              <div className="h-4 w-16 rounded-full bg-neutral-100" />
              <div className="h-3.5 w-24 rounded-full bg-neutral-200" />
              <div className="h-3.5 w-20 rounded-full bg-neutral-100" />
              <div className="h-3.5 w-24 rounded-full bg-neutral-200" />
              <div className="h-4 w-16 rounded-full bg-neutral-100" />
              <div className="ml-auto h-7 w-7 rounded-full bg-neutral-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full pb-10">
      <Link
        href="/account/agent"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 no-underline transition hover:text-emerald-700"
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to dashboard
      </Link>

      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Operator workspace</p>
          <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">My bookings</h1>
          <p className="m-0 mt-1 text-sm text-neutral-500">
            Bookings assigned to your operator account, organized by trip stage.
          </p>
        </div>

        <div className="group/tooltip relative inline-flex shrink-0">
          <button
            type="button"
            aria-label="Booking stages information"
            className="inline-flex min-h-9 cursor-pointer appearance-none items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 outline-none transition hover:border-emerald-200 hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600/25"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
            Booking stages
          </button>
          <div
            role="tooltip"
            className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-solid border-neutral-200 bg-white p-3 text-left opacity-0 shadow-[0_18px_45px_-25px_rgba(15,23,42,0.5)] transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
          >
            <p className="m-0 text-[11px] font-bold text-neutral-800">Booking stages</p>
            <p className="m-0 mt-1 text-[11px] leading-relaxed text-neutral-500">
              Use these stages to move from new booking review to confirmed trips, live activity tracking and completed
              trip records.
            </p>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
          {/* Stage switcher. Hidden from lg up, where the workspace sidebar owns
              stage selection; below lg the sidebar is not rendered, so this stays
              as the only way to move between stages. */}
          <div
            className="px-4 py-4 lg:hidden"
            style={{ background: "linear-gradient(135deg, #10182e 0%, #143541 52%, #0f4f45 100%)" }}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tabs.map((key) => {
                const isActive = activeTab === key;
                const count = grouped[key].length;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={tabClasses(key, isActive)}
                    style={
                      isActive
                        ? { background: "rgba(255,255,255,0.18)", borderColor: "rgba(255,255,255,0.38)", color: "#fff" }
                        : { background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.70)" }
                    }
                  >
                    <span className="inline-flex items-center gap-2">
                      {bucketIcon(key)}
                      {bucketLabel(key)}
                    </span>
                    <span
                      className={tabCountPillClasses(key, isActive)}
                      style={isActive ? { background: "rgba(255,255,255,0.20)", color: "#fff" } : undefined}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* No top gap from lg up, where the stage strip above is hidden and the
              table header should sit flush with the top of the card. */}
          <div className="mt-3 lg:mt-0">
            {isProgressTab ? (
              activeItems.length === 0 ? (
                <div className="px-4 pb-6 pt-2 sm:px-6">
                  {/* Ghost card — shows the structure the operator will use when a trip is active */}
                  <div className="overflow-hidden rounded-2xl border border-dashed border-amber-300 bg-amber-50/40">
                    {/* Ghost header */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-100 bg-amber-50/60 px-4 py-3">
                      <div className="space-y-1.5">
                        <div className="h-4 w-40 rounded-md bg-amber-200/70" />
                        <div className="h-3 w-28 rounded-md bg-amber-100" />
                      </div>
                      <div className="h-8 w-24 rounded-lg border border-amber-200 bg-white/60" />
                    </div>

                    {/* Ghost meta */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-3">
                      {["Trip Date", "Amount", "Progress"].map((label) => (
                        <p key={label} className="flex items-center gap-2 text-sm">
                          <span className="font-semibold text-amber-700/60">{label}:</span>
                          <span className="h-3 w-20 rounded bg-amber-100 inline-block" />
                        </p>
                      ))}
                    </div>

                    {/* Ghost progress bar */}
                    <div className="mx-4 mb-1 h-2 overflow-hidden rounded-full bg-amber-100">
                      <div className="h-full w-0 rounded-full bg-gradient-to-r from-amber-300 to-orange-300" />
                    </div>

                    {/* Ghost activity rows */}
                    <ul className="divide-y divide-amber-100/60 px-4 pb-4 pt-3">
                      {["Game Drive (Morning)", "Breakfast at Camp", "Game Drive (Evening)", "Bush Walk", "Sundowners", "Campfire Dinner"].map((activity) => (
                        <li key={activity} className="flex items-start gap-3 py-2.5 opacity-50">
                          <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-slate-300 bg-white" />
                          <div className="flex-1 space-y-1">
                            <p className="text-sm font-semibold text-slate-600">{activity}</p>
                            <p className="text-xs text-slate-400">Tap to mark as accomplished</p>
                          </div>
                        </li>
                      ))}
                    </ul>

                    {/* Empty state label at bottom */}
                    <div className="flex items-center justify-center gap-2 border-t border-amber-100 bg-amber-50/80 px-4 py-3">
                      <Activity className="h-4 w-4 text-amber-500" />
                      <p className="text-sm font-semibold text-amber-700">No active trips. This is how activity tracking will look</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 px-4 pb-6 pt-2 sm:px-6">
                  <div className="rounded-2xl border border-teal-300 bg-gradient-to-br from-teal-50 to-cyan-50/70 px-3 py-3 shadow-sm sm:px-4">
                    <div className="grid gap-2.5 sm:grid-cols-[1.2fr,1fr] sm:items-stretch">
                      <div className="rounded-xl border border-teal-200 bg-white/75 px-3 py-2.5">
                        <p className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-teal-800">
                          Daily Focus
                        </p>
                        <p className="mt-1.5 text-base sm:text-lg font-bold text-teal-950">
                          Hello {agentName}, please complete your timetable tasks today.
                        </p>
                      </div>
                      <div className="rounded-xl border border-cyan-200 bg-cyan-50/70 px-3 py-2.5">
                        <p className="text-[11px] font-extrabold uppercase tracking-wide text-cyan-800">Please Note</p>
                        <p className="mt-1 text-sm sm:text-base font-semibold text-cyan-900 leading-relaxed">
                          After you accomplish an activity, put only one tick mark.
                        </p>
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-xs font-bold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Sample tick
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                  {activeItems.map((booking) => {
                    const bid = String(booking.id);
                    const bookingBy = booking.requester?.fullName || "Guest";
                    const nationality = booking.requester?.nationality || "-";
                    const tripDateValue = booking.tripDate || booking.createdAt || "";
                    const dateOfTrip = tripDateValue
                      ? new Date(tripDateValue).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                      : "-";
                    const currency = booking.currency || "USD";
                    const amountPaid = typeof booking.amountPaid === "number"
                      ? `${currency} ${booking.amountPaid.toLocaleString()}`
                      : "-";
                    const typeOfPackage = booking.tripType
                      || (booking.title ? String(booking.title).split(" • ")[0] : "Custom");
                    const activityPlan = getActivityPlan(booking);
                    const allActivities = activityPlan.flatMap((group) => group.items);
                    const doneCount = allActivities.filter((a) => !!checkedActivities[`${bid}__${a.id}`]).length;
                    const progressPercent = allActivities.length > 0 ? Math.round((doneCount / allActivities.length) * 100) : 0;
                    const isChecklistLocked = isBookingChecklistLocked(booking);
                    const showCongratsBanner = isChecklistLocked && (congratsExpiresAt[bid] || 0) > Date.now();
                    const bookingCode = booking.bookingCode || null;
                    const usesAgreedPlan = !!(booking.plannedActivities && booking.plannedActivities.trim());

                    return (
                      <article key={bid} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        {/* Card header */}
                        <div className="border-b border-amber-100 bg-[radial-gradient(circle_at_15%_50%,rgba(251,191,36,0.12),transparent_55%),linear-gradient(135deg,#fffbeb_0%,#fef3c7_100%)] px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-bold text-slate-900">{typeOfPackage}</h3>
                                {bookingCode && (
                                  <span className="inline-block rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">{bookingCode}</span>
                                )}
                              </div>
                              <p className="mt-0.5 text-sm text-slate-600">{bookingBy} &bull; {nationality}</p>
                            </div>
                            <Link
                              href={`/account/agent/tour-bookings/${encodeURIComponent(bid)}`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 no-underline shadow-sm transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Details
                            </Link>
                          </div>

                          {/* Stats chips */}
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                              <CalendarDays className="h-3 w-3 text-slate-400" />
                              {dateOfTrip}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                              <Wallet2 className="h-3 w-3 text-slate-400" />
                              {amountPaid}
                            </span>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold shadow-sm ring-1 ${progressPercent === 100 ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : "bg-amber-100 text-amber-800 ring-amber-200"}`}>
                              <Activity className="h-3 w-3" />
                              {doneCount}/{allActivities.length} done
                            </span>
                            {usesAgreedPlan ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-1 text-xs font-bold text-teal-800 shadow-sm ring-1 ring-teal-200">
                                <ClipboardList className="h-3 w-3" />
                                Agreed Service Plan
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
                                <Info className="h-3 w-3" />
                                Package Template
                              </span>
                            )}
                          </div>

                          {/* Progress bar */}
                          <div className="mt-2.5">
                            <div className="h-1.5 overflow-hidden rounded-full bg-amber-200/60">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                          </div>

                          {showCongratsBanner ? (
                            <div className="mt-3 rounded-xl border border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-2.5">
                              <p className="text-sm font-extrabold text-emerald-800">Congratulations for accomplishing your today&apos;s tasks.</p>
                              <p className="mt-0.5 text-xs font-semibold text-emerald-700">We hope each activity went well. Rest and get ready for the next day. Checklist is now locked.</p>
                            </div>
                          ) : null}
                        </div>

                        {/* Activity checklist */}
                        <div className="space-y-3 px-4 pb-4 pt-3">
                          <div className="relative py-1">
                            <div className="h-px w-full bg-gradient-to-r from-transparent via-teal-300 to-transparent" />
                            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-teal-200 bg-white px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-teal-700">
                              Day Timetable
                            </span>
                          </div>
                          {activityPlan.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center">
                              <p className="text-sm font-semibold text-slate-700">No agreed service timetable yet</p>
                              <p className="mt-1 text-xs text-slate-500">Once the planned activities are provided for this task, they will appear here for ticking and rating.</p>
                            </div>
                          ) : null}
                          {activityPlan.map((group, groupIndex) => {
                            const groupDone = group.items.filter((item) => !!checkedActivities[`${bid}__${item.id}`]).length;
                            return (
                              <div key={`${bid}-${group.label}`} className={groupIndex > 0 ? "pt-2" : ""}>
                                {groupIndex > 0 ? (
                                  <div className="mb-4 flex items-center gap-3" aria-hidden>
                                    <span className="h-2 w-2 rounded-full bg-teal-500" />
                                    <span className="h-px flex-1 bg-gradient-to-r from-teal-300 via-teal-200 to-transparent" />
                                    <span className="rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-teal-700">
                                      {group.label}
                                    </span>
                                  </div>
                                ) : null}
                                <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#f6fbf9] via-[#f8fcfb] to-[#eef7f3] p-3 sm:p-4">
                                <div
                                  aria-hidden
                                  className="pointer-events-none absolute inset-0"
                                  style={{
                                    backgroundImage:
                                      "radial-gradient(circle at 15% 20%, rgba(2,102,94,0.08) 0, rgba(2,102,94,0) 38%), radial-gradient(circle at 85% 75%, rgba(2,102,94,0.06) 0, rgba(2,102,94,0) 36%), repeating-linear-gradient(-27deg, rgba(2,102,94,0.05) 0px, rgba(2,102,94,0.05) 1px, transparent 1px, transparent 24px)",
                                    opacity: 0.35,
                                  }}
                                />
                                <div
                                  aria-hidden
                                  className="pointer-events-none absolute -right-8 top-6 select-none text-[42px] font-black tracking-[0.18em] text-[#02665e]/[0.05]"
                                  style={{ transform: "rotate(-18deg)" }}
                                >
                                  NO4P
                                </div>
                                <div className="relative z-10">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-extrabold uppercase tracking-wide text-teal-700">{group.label}</p>
                                    <h4 className="mt-0.5 text-base font-extrabold text-slate-900">{group.title || group.label}</h4>
                                    {group.description ? (
                                      <p className="mt-1 text-sm leading-6 text-slate-600">{group.description}</p>
                                    ) : null}
                                  </div>
                                  <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">
                                    {groupDone}/{group.items.length} done
                                  </span>
                                </div>

                                <ul className="mt-3 space-y-3">
                                  {group.items.map((item, itemIndex) => {
                                    const key = `${bid}__${item.id}`;
                                    const timestamp = checkedActivities[key];
                                    const done = !!timestamp;
                                    return (
                                      <li key={item.id} className="relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 sm:gap-3">
                                        <div className="relative mt-1.5 flex w-5 justify-center" aria-hidden>
                                          {itemIndex < group.items.length - 1 ? (
                                            <span className="absolute top-3 h-[calc(100%+1.15rem)] w-px bg-gradient-to-b from-teal-300 via-teal-200 to-transparent" />
                                          ) : null}
                                          <span className={`mt-1.5 inline-block h-2.5 w-2.5 rounded-full ring-4 ring-white ${done ? "bg-emerald-500" : "bg-teal-600"}`} />
                                        </div>
                                        <div className={`rounded-2xl border px-3 py-3 shadow-sm transition-all duration-200 hover:shadow-md ${done ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-50/40" : "border-slate-200 bg-gradient-to-br from-white to-slate-50/55"}`}>
                                          <div className="flex flex-wrap items-start justify-between gap-2.5">
                                            <div className="min-w-0">
                                              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${done ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                                                {item.timeLabel || item.period}
                                              </span>
                                              <p className={done ? "mt-1.5 text-base font-bold text-slate-900 line-through decoration-emerald-400" : "mt-1.5 text-base font-bold text-slate-800"}>
                                                {item.label}
                                              </p>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => toggleActivity(booking, item.id, isChecklistLocked)}
                                              disabled={isChecklistLocked}
                                              className={`mt-0.5 flex-shrink-0 rounded-full border-2 p-0.5 transition focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-55 ${
                                                done
                                                  ? "border-emerald-500 bg-emerald-500 text-white shadow-sm"
                                                  : "border-slate-300 bg-white text-transparent hover:border-amber-400 hover:bg-amber-50/50"
                                              }`}
                                              aria-label={isChecklistLocked ? `Checklist locked for ${item.label}` : done ? `Unmark ${item.label}` : `Mark ${item.label} as done`}
                                            >
                                              <CheckCircle2 className="h-4 w-4" />
                                            </button>
                                          </div>
                                          {done && timestamp ? (
                                            <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                              <CheckCircle2 className="h-3 w-3" />
                                              Ticked
                                            </p>
                                          ) : isChecklistLocked ? (
                                            <p className="mt-2 text-xs font-semibold text-emerald-700">Task record locked after full completion.</p>
                                          ) : (
                                            <p className="mt-2 text-xs text-slate-500">Please tap the circle to tick this activity.</p>
                                          )}
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                                </div>
                                </section>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                  </div>
                </div>
              )
            ) : isCompletedTab ? (
              /* ── Completed tab: dedicated summary table ── */
              activeItems.length === 0 ? (
                <StageEmptyState
                  Icon={CheckCircle2}
                  title="No completed trips yet"
                  description="Completed bookings will appear here with ratings and trip notes."
                />
              ) : (
              <>
              <TableScroller label="completed bookings table">
                <table className="w-full min-w-[1200px] border-collapse text-left">
                  <thead className="bg-neutral-50/90 [&>tr>th]:shadow-[inset_0_-1px_0_0_#e5e5e5]">
                    <tr>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Booking By" column="bookingBy" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Tour Code" column="bookingCode" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Airport Departure" column="airportDeparture" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Nationality" column="nationality" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Type of Package" column="typeOfPackage" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Completed At" column="completedAt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Trip Rating" column="tripRating" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Challenge Witnessed" column="challenge" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Status" column="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Amount Paid" column="amountPaid" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white [&>tr>td]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>tr:last-child>td]:shadow-none">
                    {paginatedActiveItems.map((booking) => {
                        const bookingBy = booking.requester?.fullName || "Guest";
                        const nationality = booking.requester?.nationality || "-";
                        const typeOfPackage = booking.tripType || (booking.title ? String(booking.title).split(" • ")[0] : "Custom");
                        const completedAt = booking.completedAt || booking.updatedAt || booking.createdAt;
                        const completedAtLabel = completedAt
                          ? new Date(completedAt).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })
                          : "-";
                        const rating = typeof booking.rating === "number" ? booking.rating : null;
                        const challenge = booking.challenges || booking.description || null;
                        const currency = booking.currency || "TZS";
                        const amountPaid = typeof booking.amountPaid === "number"
                          ? `${currency} ${booking.amountPaid.toLocaleString()}`
                          : "-";
                        const isTourBooking = booking.source === "TOUR_BOOKING";
                        const detailsHref = `/account/agent/bookings/completed/${encodeURIComponent(String(booking.id))}?source=${isTourBooking ? "tour" : "assignment"}`;

                        return (
                          <TableRow key={`${isTourBooking ? "tb" : "pr"}-${String(booking.id)}`} hover={false} className="group transition hover:bg-emerald-50/35">
                            <td className="px-4 py-3 text-sm font-semibold text-slate-900">{bookingBy}</td>
                            <td className="px-4 py-3">
                              {booking.bookingCode ? (
                                <a
                                  href={detailsHref}
                                  className="inline-block whitespace-nowrap rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700 no-underline transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                                  aria-label={`Open completed booking ${String(booking.bookingCode)}`}
                                  title="Open completed booking"
                                >
                                  {booking.bookingCode}
                                </a>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">{booking.airportDeparture || "-"}</td>
                            <td className="px-4 py-3 text-sm text-slate-600">{nationality}</td>
                            <td className="px-4 py-3 text-sm text-slate-700">{typeOfPackage}</td>
                            <td className="px-4 py-3 text-sm text-slate-600">
                              <a
                                href={detailsHref}
                                className="inline-flex items-center gap-1 text-slate-600 no-underline transition hover:text-[#02665e]"
                                aria-label={`Open completed booking date ${String(booking.id)}`}
                                title="Open completed booking"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                {completedAtLabel}
                              </a>
                            </td>
                            <td className="px-4 py-3">
                              {rating !== null ? (
                                <span className="inline-flex items-center gap-0.5">
                                  {[1, 2, 3, 4, 5].map((star) => (
                                    <svg key={star} className={`h-4 w-4 ${star <= rating ? "text-amber-400" : "text-slate-200"}`} fill="currentColor" viewBox="0 0 20 20">
                                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                    </svg>
                                  ))}
                                  <span className="ml-1 text-xs font-semibold text-slate-600">{rating}/5</span>
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">Not rated</span>
                              )}
                            </td>
                            <td className="max-w-[180px] px-4 py-3 text-sm text-slate-600">
                              {challenge ? (
                                <span className="block truncate" title={challenge}>{challenge}</span>
                              ) : (
                                <span className="text-xs text-slate-400">None reported</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <a
                                href={detailsHref}
                                className="inline-flex items-center no-underline"
                                aria-label={`Open completed booking status ${String(booking.id)}`}
                                title="Open completed booking"
                              >
                                <BookingStatusBadge status={booking.status} />
                              </a>
                            </td>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-700">{amountPaid}</td>
                            <td className="px-4 py-3 text-right">
                              {!isTourBooking ? (
                                <a
                                  href={detailsHref}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 no-underline transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                                  aria-label={`View booking ${String(booking.id)}`}
                                  title="View details"
                                >
                                  <Eye className="h-4 w-4" />
                                </a>
                              ) : (
                                <a
                                  href={detailsHref}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 no-underline transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                                  aria-label={`View tour booking ${String(booking.id)}`}
                                  title="View details"
                                >
                                  <Eye className="h-4 w-4" />
                                </a>
                              )}
                            </td>
                          </TableRow>
                        );
                      })}
                  </tbody>
                </table>
              </TableScroller>
              {paginationControls}
              </>
              )
            ) : isConfirmedTab ? (
              <div className="space-y-3 px-4 pb-6 pt-2 sm:px-6">
                <section
                  aria-label="Confirmed bookings at a glance"
                  className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200"
                >
                  {([
                    { label: "Confirmed today", value: confirmedStats.today, helper: "since midnight", tone: "text-emerald-700" },
                    { label: "This week", value: confirmedStats.week, helper: "last 7 days", tone: "text-neutral-900" },
                    { label: "Total confirmed", value: confirmedStats.total, helper: "all time", tone: "text-neutral-900" },
                  ] as const).map((stat) => (
                    <div key={stat.label} className="min-w-0 bg-white px-4 py-3">
                      <p className="m-0 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">{stat.label}</p>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <p className={`m-0 text-2xl font-bold leading-none tabular-nums ${stat.value > 0 ? stat.tone : "text-neutral-300"}`}>
                          {stat.value}
                        </p>
                        <span className="truncate text-[10px] font-medium text-neutral-400">{stat.helper}</span>
                      </div>
                    </div>
                  ))}
                </section>

                {activeItems.length === 0 ? (
                  <StageEmptyState
                    Icon={UserCheck}
                    title="No confirmed bookings yet"
                    description="Confirmed trips appear here once payment is settled."
                  />
                ) : (
                  paginatedActiveItems.map((booking) => {
                    const isTourBooking = booking.source === "TOUR_BOOKING";
                    const bookingKey = `${isTourBooking ? "tb" : "pr"}-${String(booking.id)}`;
                    const isExpanded = expandedRoadmapKey === bookingKey;
                    const bookingBy = booking.requester?.fullName || "Guest";
                    const typeOfPackage = booking.tripType || (booking.title ? String(booking.title).split(" • ")[0] : "Custom");
                    const paidAt = booking.paidAt || (String(booking.paymentStatus || "").toUpperCase() === "PAID" ? booking.updatedAt || booking.createdAt : null);
                    const confirmedAtLabel = formatMilestoneTime(paidAt || booking.confirmedAt || booking.createdAt || null);
                    const completedAt = booking.completedAt || null;
                    const ratingLabel = typeof booking.rating === "number" ? `${booking.rating}/5` : "Pending";
                    const verified = isRevenueVerified(booking.paymentStatus);
                    const payoutApproved = !!booking.payoutApprovedAt || String(booking.payoutStatus || "").toUpperCase() === "APPROVED" || String(booking.paymentStatus || "").toUpperCase() === "APPROVED";
                    const payoutDisbursed = !!booking.payoutPaidAt || String(booking.payoutStatus || "").toUpperCase() === "PAID" || String(booking.paymentStatus || "").toUpperCase() === "DISBURSED";
                    const completedAtSeeded = completedAt;
                    const pickupValidatedAt = booking.pickupValidatedAt || null;
                    const approvedAt = booking.payoutApprovedAt || null;
                    const disbursedAt = booking.payoutPaidAt || null;

                    const checkpoints = [
                      {
                        key: "booked",
                        title: "Booking Created",
                        done: !!booking.createdAt,
                        at: booking.createdAt || null,
                        actor: "System",
                        details: "Booking record captured and queued for operations.",
                      },
                      {
                        key: "paid",
                        title: "Payment Received",
                        done: !!paidAt,
                        at: paidAt,
                        actor: "Payment Gateway",
                        details: "Guest payment confirmed and funds recorded.",
                      },
                      {
                        key: "validated",
                        title: "Agent Validated Pickup",
                        done: !!pickupValidatedAt,
                        at: pickupValidatedAt,
                        actor: "Assigned Agent",
                        details: "First meet / pickup verification completed.",
                      },
                      {
                        key: "verified",
                        title: "Revenue Verified",
                        done: verified,
                        at: verified ? booking.updatedAt || null : null,
                        actor: "Finance",
                        details: "Revenue line checked for reconciliation and compliance.",
                      },
                      {
                        key: "approved",
                        title: "Revenue Approved",
                        done: !!approvedAt || payoutApproved,
                        at: approvedAt,
                        actor: "Finance Approver",
                        details: "Payout request approved for disbursement workflow.",
                      },
                      {
                        key: "disbursed",
                        title: "Revenue Disbursed",
                        done: !!disbursedAt || payoutDisbursed,
                        at: disbursedAt,
                        actor: "Treasury",
                        details: "Operator payout released and marked as settled.",
                      },
                      {
                        key: "completed",
                        title: "Task Completed",
                        done: !!completedAtSeeded,
                        at: completedAtSeeded,
                        actor: "Assigned Agent",
                        details: "Service execution marked complete in the workflow.",
                      },
                      {
                        key: "rated",
                        title: "Trip Rated",
                        done: typeof booking.rating === "number",
                        at: null,
                        actor: "Customer",
                        details: "Post-trip feedback and quality score recorded.",
                      },
                    ];
                    const completedSteps = checkpoints.filter((c) => c.done).length;
                    const progressWidth = Math.round((completedSteps / checkpoints.length) * 100);
                    const nextPending = checkpoints.find((c) => !c.done)?.title || "All stages completed";

                    return (
                      <article key={bookingKey} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-100 bg-[radial-gradient(circle_at_15%_20%,rgba(34,211,238,0.11),transparent_45%),radial-gradient(circle_at_88%_18%,rgba(16,185,129,0.14),transparent_38%),linear-gradient(120deg,#f8fafc_0%,#f0fdfa_40%,#ecfeff_100%)] px-4 py-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-base font-bold text-slate-900">{typeOfPackage}</h3>
                              <p className="mt-0.5 text-sm text-slate-600">{bookingBy}</p>
                              <p className="mt-1 text-[11px] font-semibold text-[#02665e]">Journey Board: {completedSteps}/{checkpoints.length} connected stages completed</p>
                              <p className="mt-1 text-[11px] text-slate-600">Confirmed at: {confirmedAtLabel}</p>
                            </div>
                            <div className="inline-flex items-center gap-2">
                              <BookingStatusBadge status={booking.status} />
                              <button
                                type="button"
                                onClick={() => setExpandedRoadmapKey((prev) => (prev === bookingKey ? null : bookingKey))}
                                className="inline-flex items-center rounded-full border border-[#02665e]/30 bg-white px-3 py-1 text-xs font-bold text-[#02665e] transition hover:bg-[#02665e]/10"
                              >
                                {isExpanded ? "Hide Preview" : "Preview Roadmap"}
                              </button>
                              <Link
                                href={`/account/agent/tour-bookings/${encodeURIComponent(String(booking.id))}`}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 no-underline transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                                aria-label={`View tour booking ${String(booking.id)}`}
                                title="View details"
                              >
                                <Eye className="h-4 w-4" />
                              </Link>
                            </div>
                          </div>

                          <div className="mt-3">
                            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                              <span>Workflow progress</span>
                              <span>{progressWidth}%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                              <div className="h-full rounded-full bg-gradient-to-r from-[#02665e] via-teal-500 to-cyan-500 transition-all duration-500" style={{ width: `${progressWidth}%` }} />
                            </div>
                            <p className="mt-2 text-xs font-semibold text-slate-600">Next pending: <span className="text-slate-800">{nextPending}</span></p>
                          </div>

                          {isExpanded ? (
                            <div className="relative mt-4">
                              <div className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-gradient-to-r from-[#02665e]/15 via-[#02665e]/35 to-slate-200" />
                              <div className="relative grid grid-cols-4 gap-2 sm:grid-cols-8">
                                {checkpoints.map((checkpoint) => {
                                  const theme = checkpointTheme(checkpoint.key as CheckpointKey);
                                  return (
                                    <div key={`rail-${checkpoint.key}`} className="flex flex-col items-center gap-1">
                                      <span className={`z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 shadow-sm ${checkpoint.done ? `${theme.dot} text-white` : "border-slate-300 bg-white text-slate-400"}`}>{checkpointIcon(checkpoint.key as CheckpointKey)}</span>
                                      <span className="text-[10px] font-semibold text-slate-600 text-center leading-tight">{checkpointRailLabel(checkpoint.key as CheckpointKey)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {isExpanded ? (
                          <div className="px-4 py-4 sm:px-5 sm:py-5">
                            <ol className="relative space-y-4 pl-9 before:absolute before:left-[10px] before:top-1 before:h-[calc(100%-8px)] before:w-[2px] before:bg-gradient-to-b before:from-cyan-200 before:via-emerald-200 before:to-amber-200">
                              {checkpoints.map((checkpoint) => {
                                const theme = checkpointTheme(checkpoint.key as CheckpointKey);
                                return (
                                  <li key={checkpoint.key} className="relative">
                                    <span
                                      className={`absolute -left-9 top-3 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 ${checkpoint.done ? `${theme.dot} text-white` : "border-slate-300 bg-white text-slate-400"}`}
                                    >
                                      <span className="text-[9px] font-extrabold">{checkpoint.done ? "OK" : ".."}</span>
                                    </span>

                                    <div className={`rounded-2xl border px-4 py-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${checkpoint.done ? theme.card : "border-slate-200 bg-slate-50/80"}`}>
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ${checkpoint.done ? theme.badge : "bg-slate-300 text-slate-700"}`}>
                                          {checkpoint.title}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-500">
                                          {checkpoint.key === "rated" ? ratingLabel : formatMilestoneTime(checkpoint.at)}
                                        </span>
                                      </div>

                                      <p className="mt-2 text-sm font-semibold text-slate-800">
                                        {checkpoint.actor}
                                      </p>
                                      <p className="mt-1 text-sm text-slate-600">
                                        {checkpoint.details}
                                      </p>
                                    </div>
                                  </li>
                                );
                              })}
                            </ol>
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                )}
                {paginationControls}
              </div>
            ) : (
              /* ── New tab: standard table ── */
              activeItems.length === 0 ? (
                <StageEmptyState
                  Icon={bucketIconComponent(activeTab)}
                  title={`No ${bucketLabel(activeTab).toLowerCase()} bookings yet`}
                  description="Bookings in this stage will appear here automatically."
                />
              ) : (
              <>
              <TableScroller label="bookings table">
                <table className="w-full min-w-[980px] border-collapse text-left">
                  <thead className="bg-neutral-50/90 [&>tr>th]:shadow-[inset_0_-1px_0_0_#e5e5e5]">
                    <tr>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Booking By" column="bookingBy" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Tour Code" column="bookingCode" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Airport Departure" column="airportDeparture" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Nationality" column="nationality" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Type of Package" column="typeOfPackage" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Status" column="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Date of Trip" column="dateOfTrip" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left"><SortableHeader label="Amount Paid" column="amountPaid" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white [&>tr>td]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>tr:last-child>td]:shadow-none">
                    {paginatedActiveItems.map((booking) => {
                        const bookingBy = booking.requester?.fullName || "Guest";
                        const nationality = booking.requester?.nationality || "-";
                        const dateOfTrip = booking.tripDate
                          ? new Date(booking.tripDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                          : booking.createdAt
                            ? new Date(booking.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                            : "-";
                        const currency = booking.currency || "TZS";
                        const amountPaid = typeof booking.amountPaid === "number"
                          ? `${currency} ${booking.amountPaid.toLocaleString()}`
                          : "-";
                        const typeOfPackage = booking.tripType
                          || (booking.title ? String(booking.title).split(" • ")[0] : "Custom");
                        const isTourBooking = booking.source === "TOUR_BOOKING";

                        return (
                          <TableRow key={`${isTourBooking ? "tb" : "pr"}-${String(booking.id)}`} hover={false} className="group transition hover:bg-emerald-50/35">
                            <td className="px-4 py-3 text-sm font-semibold text-slate-900">{bookingBy}</td>
                            <td className="px-4 py-3">
                              {booking.bookingCode ? (
                                <span className="inline-block whitespace-nowrap rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">{booking.bookingCode}</span>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">{booking.airportDeparture || "-"}</td>
                            <td className="px-4 py-3 text-sm text-slate-600">{nationality}</td>
                            <td className="px-4 py-3 text-sm text-slate-700">{typeOfPackage}</td>
                            <td className="px-4 py-3">
                              <BookingStatusBadge status={booking.status} />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">
                              <span className="inline-flex items-center gap-1">
                                <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                                {dateOfTrip}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-700">{amountPaid}</td>
                            <td className="px-4 py-3 text-right">
                              <Link
                                href={`/account/agent/tour-bookings/${encodeURIComponent(String(booking.id))}`}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 no-underline transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                                aria-label={`View tour booking ${String(booking.id)}`}
                                title="View details"
                              >
                                <Eye className="h-4 w-4" />
                              </Link>
                            </td>
                          </TableRow>
                        );
                      })}
                  </tbody>
                </table>
              </TableScroller>
              {paginationControls}
              </>
              )
            )}
          </div>
      </section>
    </div>
  );
}
