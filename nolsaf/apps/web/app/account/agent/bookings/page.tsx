"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { ArrowLeft, CalendarDays, ClipboardList, CheckCircle2, Activity, Eye, Info, ArrowUpDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Wallet2, UserCheck, ShieldCheck, BadgeCheck, HandCoins, Flag, Star, Search, Check, type LucideIcon } from "lucide-react";
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
  /** Average of the guests' itinerary ratings. */
  rating?: number | null;
  guestRatingCount?: number;
  /** The operator's own completion rating, 1 to 5. */
  selfRating?: number | null;
  issueSummary?: { total: number; open: number; highestSeverity: "LOW" | "MEDIUM" | "HIGH" | null; latestTitle: string | null } | null;
  operatorPayoutAmount?: number | null;
  endDate?: string | null;
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
  | "challenge"
  | "selfRating"
  | "payout";
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

type Checkpoint = { key: CheckpointKey; title: string; done: boolean; at: string | null; actor: string; details: string };

/** The eight connected stages a confirmed booking moves through, operator and finance side. */
function buildCheckpoints(booking: BookingItem) {
  const paidAt = booking.paidAt || (String(booking.paymentStatus || "").toUpperCase() === "PAID" ? booking.updatedAt || booking.createdAt || null : null);
  const verified = isRevenueVerified(booking.paymentStatus);
  const payoutApproved = !!booking.payoutApprovedAt || String(booking.payoutStatus || "").toUpperCase() === "APPROVED" || String(booking.paymentStatus || "").toUpperCase() === "APPROVED";
  const payoutDisbursed = !!booking.payoutPaidAt || String(booking.payoutStatus || "").toUpperCase() === "PAID" || String(booking.paymentStatus || "").toUpperCase() === "DISBURSED";
  const checkpoints: Checkpoint[] = [
    { key: "booked", title: "Booking Created", done: !!booking.createdAt, at: booking.createdAt || null, actor: "System", details: "Booking record captured and queued for operations." },
    { key: "paid", title: "Payment Received", done: !!paidAt, at: paidAt, actor: "Payment Gateway", details: "Guest payment confirmed and funds recorded." },
    { key: "validated", title: "Agent Validated Pickup", done: !!booking.pickupValidatedAt, at: booking.pickupValidatedAt || null, actor: "Assigned Agent", details: "First meet / pickup verification completed." },
    { key: "verified", title: "Revenue Verified", done: verified, at: verified ? booking.updatedAt || null : null, actor: "Finance", details: "Revenue line checked for reconciliation and compliance." },
    { key: "approved", title: "Revenue Approved", done: !!booking.payoutApprovedAt || payoutApproved, at: booking.payoutApprovedAt || null, actor: "Finance Approver", details: "Payout request approved for disbursement workflow." },
    { key: "disbursed", title: "Revenue Disbursed", done: !!booking.payoutPaidAt || payoutDisbursed, at: booking.payoutPaidAt || null, actor: "Treasury", details: "Operator payout released and marked as settled." },
    { key: "completed", title: "Task Completed", done: !!booking.completedAt, at: booking.completedAt || null, actor: "Assigned Agent", details: "Service execution marked complete in the workflow." },
    { key: "rated", title: "Trip Rated", done: typeof booking.rating === "number", at: null, actor: "Customer", details: "Post-trip feedback and quality score recorded." },
  ];
  const completedSteps = checkpoints.filter((c) => c.done).length;
  const nextPending = checkpoints.find((c) => !c.done) || null;
  return { checkpoints, completedSteps, nextPending, paidAt };
}

function startOfDayMs(value: string | number | Date): number {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole days from today to the trip's start; negative once the date has passed. */
function daysToTrip(booking: BookingItem): number | null {
  if (!booking.tripDate) return null;
  const ms = startOfDayMs(booking.tripDate);
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - startOfDayMs(Date.now())) / 86_400_000);
}

function tourParts(booking: BookingItem): { tour: string; destination: string | null } {
  const parts = String(booking.title || "").split(" • ");
  return { tour: parts[0] || booking.tripType || "Tour", destination: parts[1] || null };
}

/** Three-letter place code in the style of an airport code: Serengeti becomes SER. */
function placeCodeOf(booking: BookingItem): string {
  const { tour, destination } = tourParts(booking);
  const letters = String(destination || tour || "").replace(/[^A-Za-z]/g, "");
  return (letters.slice(0, 3) || "TRP").toUpperCase();
}

function pickupChip(days: number | null): { label: string; cls: string; dot: string; urgent: boolean } {
  if (days == null) return { label: "Date to confirm", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", urgent: false };
  if (days < 0) {
    const n = Math.abs(days);
    return { label: `Pickup overdue ${n}d`, cls: "bg-orange-50 text-orange-800", dot: "bg-orange-500", urgent: true };
  }
  if (days === 0) return { label: "Pickup today", cls: "bg-amber-50 text-amber-800", dot: "bg-amber-500", urgent: true };
  if (days === 1) return { label: "Pickup tomorrow", cls: "bg-[#02665e]/10 text-[#02665e]", dot: "bg-[#02665e]", urgent: false };
  return { label: `Pickup in ${days} days`, cls: "bg-[#02665e]/10 text-[#02665e]", dot: "bg-[#02665e]", urgent: false };
}

function shortTripDate(value?: string | null): string {
  if (!value) return "TBC";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "TBC" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Eight connected stages as dots on one line, filled where done. */
function StageRail({ checkpoints, onBrand }: { checkpoints: Checkpoint[]; onBrand?: boolean }) {
  const done = checkpoints.filter((c) => c.done).length;
  return (
    <div className="flex items-center" role="img" aria-label={`Journey board: ${done} of ${checkpoints.length} stages completed`}>
      {checkpoints.map((checkpoint, index) => {
        const theme = checkpointTheme(checkpoint.key);
        const dot = checkpoint.done
          ? onBrand ? "bg-white" : theme.dot.split(" ").find((c) => c.startsWith("bg-"))
          : onBrand ? "bg-white/25" : "bg-slate-200";
        const line = checkpoint.done ? (onBrand ? "bg-white/60" : "bg-slate-300") : onBrand ? "bg-white/20" : "bg-slate-200";
        return (
          <span key={checkpoint.key} className="flex items-center" title={`${checkpoint.title}${checkpoint.done ? " (done)" : ""}`}>
            {index > 0 ? <span className={`h-px w-3 sm:w-4 ${line}`} /> : null}
            <span className={`h-2 w-2 rounded-full ${dot}`} />
          </span>
        );
      })}
    </div>
  );
}

type ActivityTiming = "done" | "live" | "late" | "soon" | "today" | "later" | "open";

/** "07:00-09:00", "07:00 - 09:00" or "07:00" as minutes since midnight. */
function parseWindow(timeLabel?: string): { start: number; end: number | null } | null {
  const m = String(timeLabel || "").match(/([01]?\d|2[0-3]):([0-5]\d)(?:\s*[-–]\s*([01]?\d|2[0-3]):([0-5]\d))?/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = m[3] != null ? Number(m[3]) * 60 + Number(m[4]) : null;
  return { start, end: end != null && end > start ? end : null };
}

function formatSpan(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/**
 * Where one activity stands against the clock. The trip's own day (from its
 * start date) decides which timetable day is "today"; past days are late,
 * future days wait, and today's items are read against their time window.
 */
function activityTiming(
  done: boolean,
  groupDay: number,
  tourDay: number | null,
  timeLabel: string | undefined,
  nowMs: number,
): { state: ActivityTiming; note: string } {
  if (done) return { state: "done", note: "" };
  if (tourDay == null) return { state: "open", note: "" };
  if (groupDay < tourDay) return { state: "late", note: tourDay - groupDay === 1 ? "was due yesterday" : `was due ${tourDay - groupDay} days ago` };
  if (groupDay > tourDay) return { state: "later", note: groupDay - tourDay === 1 ? "tomorrow" : `in ${groupDay - tourDay} days` };
  const win = parseWindow(timeLabel);
  if (!win) return { state: "today", note: "today" };
  const now = new Date(nowMs);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const end = win.end ?? win.start + 60;
  if (minutes < win.start) return { state: "soon", note: `starts in ${formatSpan(win.start - minutes)}` };
  if (minutes <= end) return { state: "live", note: win.end != null ? `running now · ends in ${formatSpan(end - minutes)}` : "running now" };
  return { state: "late", note: `ended ${formatSpan(minutes - end)} ago` };
}

function isPayoutSettled(b: BookingItem): boolean {
  return !!b.payoutPaidAt || String(b.payoutStatus || "").toUpperCase() === "PAID";
}

function payoutChip(b: BookingItem): { label: string; cls: string; dot: string } {
  const s = String(b.payoutStatus || "").toUpperCase();
  if (isPayoutSettled(b)) return { label: "Paid", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" };
  if (s.includes("RECOVER") || s.includes("HOLD") || s.includes("REJECT")) return { label: s.replace(/_/g, " ").toLowerCase(), cls: "bg-rose-50 text-rose-700", dot: "bg-rose-500" };
  if (s === "APPROVED" || s === "PROCESSING" || s === "AUTHORIZED" || s === "BATCHED") return { label: s.toLowerCase(), cls: "bg-sky-50 text-sky-700", dot: "bg-sky-500" };
  if (s) return { label: s.replace(/_/g, " ").toLowerCase(), cls: "bg-amber-50 text-amber-800", dot: "bg-amber-500" };
  return { label: "Not started", cls: "bg-slate-100 text-slate-500", dot: "bg-slate-400" };
}

function MiniStars({ value, size = "h-3.5 w-3.5" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-px" aria-hidden>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} className={`${size} ${value >= s - 0.25 ? "text-amber-400" : "text-slate-300"}`} fill={value >= s - 0.25 ? "currentColor" : "none"} strokeWidth={1.75} />
      ))}
    </span>
  );
}

function tickedTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = startOfDayMs(d) === startOfDayMs(Date.now());
  return sameDay
    ? `ticked ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : `ticked ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/** A torn-ticket perforation with a bite out of each edge in the surface colour. */
function Perforation() {
  return (
    <div className="relative" aria-hidden>
      <div className="mx-5 border-0 border-t-2 border-dashed border-slate-200" />
      <span className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-solid border-slate-200 bg-white" style={{ left: -11, clipPath: "inset(0 0 0 50%)" }} />
      <span className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-solid border-slate-200 bg-white" style={{ right: -11, clipPath: "inset(0 50% 0 0)" }} />
    </div>
  );
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
        // The endpoint pages (default 20), so walk every page: otherwise older
        // trips, usually the completed ones, silently fall off the stages.
        const loadAllTourBookings = async (): Promise<BookingItem[]> => {
          const all: BookingItem[] = [];
          for (let page = 1; page <= 20; page += 1) {
            const res = await api.get(`/api/agent/tour-bookings?page=${page}&pageSize=100`);
            const batch: BookingItem[] = (res as any)?.data?.items ?? [];
            const total = Number((res as any)?.data?.total ?? 0);
            all.push(...batch);
            if (batch.length < 100 || (total > 0 && all.length >= total)) break;
          }
          return all;
        };
        const [tourBookings, meRes] = await Promise.all([
          loadAllTourBookings(),
          api.get("/api/account/me").catch(() => null),
        ]);
        if (!alive) return;
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

  // Confirmed trips are all paid and waiting for the pickup handover, so the
  // useful numbers are about time to pickup, not when the booking came in.
  const confirmedStats = useMemo(() => {
    let due = 0;
    let week = 0;
    let next: number | null = null;
    for (const item of grouped.confirmed) {
      const d = daysToTrip(item);
      if (d == null) continue;
      if (d <= 0) due += 1;
      else if (d <= 7) week += 1;
      if (d >= 0 && (next == null || d < next)) next = d;
    }
    return { due, week, next, total: grouped.confirmed.length };
  }, [grouped.confirmed]);

  const [confirmedQuery, setConfirmedQuery] = useState("");

  // ── Completed stage: summary, quick filters and search ──
  const [completedFilter, setCompletedFilter] = useState<"ALL" | "TO_RATE" | "ISSUES" | "PAYOUT_PENDING">("ALL");
  const [completedQuery, setCompletedQuery] = useState("");
  const completedStats = useMemo(() => {
    const rows = grouped.completed;
    let ratingSum = 0;
    let ratingCount = 0;
    let toRate = 0;
    let withIssues = 0;
    let paid = 0;
    for (const b of rows) {
      const n = Number(b.guestRatingCount || 0);
      if (typeof b.rating === "number" && n > 0) { ratingSum += b.rating * n; ratingCount += n; }
      if (b.selfRating == null) toRate += 1;
      if ((b.issueSummary?.total || 0) > 0) withIssues += 1;
      if (isPayoutSettled(b)) paid += 1;
    }
    return { total: rows.length, guestAvg: ratingCount ? ratingSum / ratingCount : null, ratingCount, toRate, withIssues, paid };
  }, [grouped.completed]);

  // A minute clock so "running now", "starts in 20m" and "late" stay honest
  // while the operator keeps the page open on tour.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Smart order: overdue pickups first (oldest first), then today, then the
  // soonest departures, then trips still waiting for a date.
  const confirmedOrdered = useMemo(() => {
    const q = confirmedQuery.trim().toLowerCase();
    const rows = grouped.confirmed.filter((b) =>
      !q || [b.requester?.fullName, b.bookingCode, b.title, b.tripType, b.requester?.nationality, b.airportDeparture]
        .some((v) => String(v || "").toLowerCase().includes(q))
    );
    const rank = (b: BookingItem): [number, number] => {
      const d = daysToTrip(b);
      if (d == null) return [3, 0];
      if (d < 0) return [0, d];
      if (d === 0) return [1, 0];
      return [2, d];
    };
    return [...rows].sort((a, b) => {
      const [ra, da] = rank(a);
      const [rb, db] = rank(b);
      return ra !== rb ? ra - rb : da - db;
    });
  }, [grouped.confirmed, confirmedQuery]);

  // The first trip in smart order is the one that needs the operator next; it
  // gets the full pass and is not repeated in the grid below.
  const confirmedHero = !confirmedQuery.trim() ? confirmedOrdered[0] ?? null : null;
  const confirmedGrid = confirmedHero ? confirmedOrdered.slice(1) : confirmedOrdered;
  const confirmedPages = Math.max(1, Math.ceil(confirmedGrid.length / PAGE_SIZE));
  const confirmedPage = Math.min(currentPage, confirmedPages);
  const confirmedPageItems = confirmedGrid.slice((confirmedPage - 1) * PAGE_SIZE, confirmedPage * PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [confirmedQuery]);

  const onSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      const defaultDir: SortDir = key === "amountPaid" || key.includes("date") || key === "completedAt" || key === "tripRating" || key === "selfRating" || key === "challenge" ? "desc" : "asc";
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
        case "challenge": return booking.issueSummary ? booking.issueSummary.total : (challenge ? 1 : 0);
        case "selfRating": return typeof booking.selfRating === "number" ? booking.selfRating : -1;
        case "payout": return isPayoutSettled(booking) ? 2 : booking.payoutStatus ? 1 : 0;
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
                <div className="px-4 pb-6 pt-2 sm:px-6 lg:pt-5">
                  <div className="flex flex-col items-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#02665e]/10 text-[#02665e]">
                      <Activity className="h-6 w-6" aria-hidden />
                    </span>
                    <p className="m-0 mt-4 text-[16px] font-bold text-slate-900">No trips on tour right now</p>
                    <p className="m-0 mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">
                      A trip moves here the moment you validate the pickup. Its day-by-day timetable then opens for ticking, one activity at a time.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab("confirmed")}
                      style={{ fontFamily: "inherit" }}
                      className="mt-5 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition-colors hover:bg-[#014d47]"
                    >
                      <UserCheck className="h-4 w-4" aria-hidden />
                      See upcoming pickups
                    </button>
                  </div>
                </div>
              ) : (() => {
                const plans = activeItems
                  .map((booking) => {
                    const bid = String(booking.id);
                    const activityPlan = getActivityPlan(booking);
                    const allActivities = activityPlan.flatMap((group) => group.items.map((it) => ({ ...it, day: group.day })));
                    const doneCount = allActivities.filter((a) => !!checkedActivities[`${bid}__${a.id}`]).length;
                    const locked = isBookingChecklistLocked(booking);
                    const d = daysToTrip(booking);
                    const tourDay = d != null && d <= 0 ? 1 - d : null;
                    const totalDays = activityPlan.length ? Math.max(...activityPlan.map((g) => g.day)) : null;
                    const overrunDays = !locked && tourDay != null && totalDays != null && tourDay > totalDays ? tourDay - totalDays : 0;
                    const timing: Record<string, { state: ActivityTiming; note: string }> = {};
                    for (const a of allActivities) {
                      timing[a.id] = activityTiming(!!checkedActivities[`${bid}__${a.id}`], a.day, tourDay, a.timeLabel, nowTick);
                    }
                    const liveItems = allActivities.filter((a) => timing[a.id].state === "live");
                    const lateItems = allActivities.filter((a) => timing[a.id].state === "late");
                    const focus = locked
                      ? null
                      : liveItems[0]
                        ? { item: liveItems[0], kind: "now" as const }
                        : lateItems[0]
                          ? { item: lateItems[0], kind: "late" as const }
                          : (() => {
                              const next = allActivities.find((a) => !checkedActivities[`${bid}__${a.id}`]);
                              return next ? { item: next, kind: "next" as const } : null;
                            })();
                    return { booking, bid, activityPlan, allActivities, doneCount, locked, tourDay, totalDays, overrunDays, timing, liveCount: liveItems.length, lateCount: lateItems.length, focus };
                  })
                  // Trips that need the operator right now come first.
                  .sort((a, b) => (b.lateCount + b.liveCount * 2) - (a.lateCount + a.liveCount * 2));
                const totalTasks = plans.reduce((sum, p) => sum + p.allActivities.length, 0);
                const totalDone = plans.reduce((sum, p) => sum + p.doneCount, 0);
                const totalLive = plans.reduce((sum, p) => sum + p.liveCount, 0);
                const totalLate = plans.reduce((sum, p) => sum + p.lateCount, 0);
                const firstName = agentName.split(" ")[0];
                const headline = totalLate > 0
                  ? `${firstName}, ${totalLate} ${totalLate === 1 ? "activity is" : "activities are"} overdue`
                  : totalLive > 0
                    ? `${firstName}, ${totalLive} ${totalLive === 1 ? "activity is" : "activities are"} running now`
                    : totalTasks - totalDone > 0
                      ? `Hello ${firstName}, ${totalTasks - totalDone} ${totalTasks - totalDone === 1 ? "activity" : "activities"} left to tick`
                      : `Well done ${firstName}, every activity is ticked`;
                const subline = totalLate > 0
                  ? "Tick each one that was delivered. Anything not delivered should be raised from the trip details, not ticked."
                  : totalLive > 0
                    ? "Tick it as soon as it is delivered, once only. A fully ticked timetable locks and completes the trip."
                    : "Tick an activity once, right after it is delivered. A fully ticked timetable locks and completes the trip.";
                const nowLabel = new Date(nowTick).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
                return (
                  <div id="progress-stage" className="space-y-4 px-4 pb-6 pt-2 sm:px-6 lg:pt-5">
                    <style>{"#progress-stage, #progress-stage * { box-sizing: border-box; }"}</style>

                    {/* Today strip: leads with whatever needs the operator first. */}
                    <section
                      className="flex flex-col gap-4 rounded-3xl p-5 text-white sm:p-6 lg:flex-row lg:items-center lg:justify-between"
                      style={{ backgroundColor: totalLate > 0 ? "#9a3412" : "#02665e" }}
                    >
                      <div className="min-w-0">
                        <p className="m-0 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/65">
                          <span className="relative flex h-2 w-2" aria-hidden>
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                          </span>
                          On tour · {nowLabel}
                        </p>
                        <h2 className="m-0 mt-1.5 text-[19px] font-bold leading-tight text-white sm:text-[21px]">{headline}</h2>
                        <p className="m-0 mt-1 max-w-2xl text-[12.5px] leading-relaxed text-white/75">{subline}</p>
                      </div>
                      <dl className="m-0 grid flex-shrink-0 grid-cols-4 gap-2 sm:gap-3">
                        {[
                          { value: String(plans.length), label: plans.length === 1 ? "Trip" : "Trips", tone: "text-white" },
                          { value: String(totalLive), label: "Now", tone: totalLive ? "text-white" : "text-white/40" },
                          { value: String(totalLate), label: "Late", tone: totalLate ? "text-amber-200" : "text-white/40" },
                          { value: `${totalDone}/${totalTasks}`, label: "Ticked", tone: "text-white" },
                        ].map((s) => (
                          <div key={s.label} className="min-w-[3.75rem] rounded-2xl bg-white/10 px-3 py-2.5 text-center">
                            <dd className={`m-0 text-[22px] font-black leading-none tabular-nums ${s.tone}`}>{s.value}</dd>
                            <dt className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/60">{s.label}</dt>
                          </div>
                        ))}
                      </dl>
                    </section>

                    {plans.map(({ booking, bid, activityPlan, allActivities, doneCount, locked: isChecklistLocked, tourDay, totalDays, overrunDays, timing, liveCount, lateCount, focus }) => {
                      const { tour, destination } = tourParts(booking);
                      const showCongratsBanner = isChecklistLocked && (congratsExpiresAt[bid] || 0) > Date.now();
                      const usesAgreedPlan = !!(booking.plannedActivities && booking.plannedActivities.trim());
                      const scheduledEnd = booking.tripDate && totalDays
                        ? new Date(startOfDayMs(booking.tripDate) + (totalDays - 1) * 86_400_000)
                        : null;
                      const chip = isChecklistLocked
                        ? { label: "Timetable complete", cls: "bg-emerald-50 text-emerald-700", pulse: false }
                        : overrunDays > 0
                          ? { label: `Ran over by ${overrunDays} ${overrunDays === 1 ? "day" : "days"}`, cls: "bg-orange-50 text-orange-800", pulse: false }
                          : liveCount > 0
                            ? { label: "Activity running", cls: "bg-[#02665e] text-white", pulse: true }
                            : { label: tourDay && totalDays ? `Day ${tourDay} of ${totalDays}` : "On tour", cls: "bg-[#02665e] text-white", pulse: true };

                      return (
                        <article
                          key={bid}
                          className={`min-w-0 overflow-hidden rounded-3xl border border-solid bg-white ${
                            lateCount > 0 ? "border-orange-200" : liveCount > 0 ? "border-[#02665e]/40" : "border-slate-200"
                          }`}
                        >
                          {/* Trip header */}
                          <div className="p-5 sm:p-6">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex min-w-0 items-end gap-3">
                                <span className="text-[34px] font-black leading-none tracking-[0.08em] text-[#02665e]">{placeCodeOf(booking)}</span>
                                <div className="min-w-0 pb-0.5">
                                  <h3 className="m-0 truncate text-[16px] font-bold text-slate-900">{booking.requester?.fullName || "Guest"}</h3>
                                  <p className="m-0 truncate text-[12.5px] text-slate-500">
                                    {[booking.tripType || tour, destination, booking.requester?.nationality].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-2">
                                <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold ${chip.cls}`}>
                                  {isChecklistLocked ? (
                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                                  ) : chip.pulse ? (
                                    <span className="relative flex h-2 w-2" aria-hidden>
                                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
                                      <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                                    </span>
                                  ) : (
                                    <span className="h-1.5 w-1.5 rounded-full bg-orange-500" aria-hidden />
                                  )}
                                  {chip.label}
                                </span>
                                <Link
                                  href={`/account/agent/tour-bookings/${encodeURIComponent(bid)}`}
                                  title="Trip details"
                                  aria-label={`Open details for ${booking.requester?.fullName || "this trip"}`}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-500 no-underline transition-colors hover:border-[#02665e] hover:text-[#02665e]"
                                >
                                  <Eye className="h-4 w-4" aria-hidden />
                                </Link>
                              </div>
                            </div>

                            <dl className="m-0 mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                              {[
                                { label: "Started", value: shortTripDate(booking.tripDate) },
                                { label: scheduledEnd && scheduledEnd.getTime() < startOfDayMs(nowTick) ? "Was due to end" : "Ends", value: scheduledEnd ? scheduledEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "TBC" },
                                { label: "Guests", value: String(booking.requester?.travelerCount ?? "-") },
                                { label: "Plan", value: usesAgreedPlan ? "Agreed service plan" : "Package template" },
                              ].map((fact) => (
                                <div key={fact.label} className="min-w-0">
                                  <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{fact.label}</dt>
                                  <dd className="m-0 mt-0.5 truncate text-[14px] font-bold tabular-nums text-slate-900" title={fact.value}>{fact.value}</dd>
                                </div>
                              ))}
                            </dl>

                            {/* One segment per activity, coloured by where it stands against the clock. */}
                            <div className="mt-4">
                              <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]">
                                <span className="min-w-0 truncate text-slate-500">
                                  {isChecklistLocked ? (
                                    "All activities delivered. The record is locked."
                                  ) : focus ? (
                                    <>
                                      <span className={`font-bold ${focus.kind === "late" ? "text-orange-700" : focus.kind === "now" ? "text-[#02665e]" : "text-slate-500"}`}>
                                        {focus.kind === "late" ? "Overdue:" : focus.kind === "now" ? "Now:" : "Next up:"}
                                      </span>{" "}
                                      <span className="font-semibold text-slate-800">{focus.item.label}</span>
                                      {timing[focus.item.id]?.note ? <span className="text-slate-400"> · {timing[focus.item.id].note}</span> : null}
                                    </>
                                  ) : (
                                    "No timetable yet"
                                  )}
                                </span>
                                <span className="flex-shrink-0 font-bold tabular-nums text-slate-700">{doneCount}/{allActivities.length}</span>
                              </div>
                              {allActivities.length > 0 ? (
                                <div className="flex gap-1" aria-hidden>
                                  {allActivities.map((a) => {
                                    const s = timing[a.id]?.state;
                                    const cls = s === "done" ? "bg-emerald-500" : s === "live" ? "animate-pulse bg-[#02665e]" : s === "late" ? "bg-orange-400" : "bg-slate-200";
                                    return <span key={a.id} className={`h-1.5 min-w-0 flex-1 rounded-full ${cls}`} />;
                                  })}
                                </div>
                              ) : null}
                            </div>

                            {overrunDays > 0 ? (
                              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-solid border-orange-200 bg-orange-50/70 px-4 py-3">
                                <Flag className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-600" aria-hidden />
                                <div className="min-w-0 text-[12.5px] leading-relaxed text-orange-900">
                                  <strong className="font-bold">This trip should have closed {scheduledEnd ? `on ${scheduledEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "already"}.</strong>{" "}
                                  {allActivities.length - doneCount} {allActivities.length - doneCount === 1 ? "activity is" : "activities are"} still unticked, so the trip cannot complete. Tick what was delivered, or{" "}
                                  <Link href={`/account/agent/tour-bookings/${encodeURIComponent(bid)}`} className="font-bold text-orange-900 underline underline-offset-2">open the trip</Link> to raise what was not.
                                </div>
                              </div>
                            ) : null}

                            {showCongratsBanner ? (
                              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-solid border-emerald-200 bg-emerald-50/70 px-4 py-3">
                                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" aria-hidden />
                                <div>
                                  <p className="m-0 text-[13.5px] font-bold text-emerald-900">Well done, every activity is delivered.</p>
                                  <p className="m-0 mt-0.5 text-[12px] text-emerald-800/80">We hope each activity went well. The checklist is now locked.</p>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          {/* Timetable */}
                          <div className="border-0 border-t border-solid border-slate-100 bg-slate-50/60 p-5 sm:p-6">
                            {activityPlan.length === 0 ? (
                              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
                                <p className="m-0 text-[13.5px] font-bold text-slate-700">No agreed service timetable yet</p>
                                <p className="m-0 mt-1 text-[12px] text-slate-500">Once the planned activities are provided for this trip, they appear here for ticking.</p>
                              </div>
                            ) : (
                              <ol className="m-0 list-none space-y-5 p-0">
                                {activityPlan.map((group) => {
                                  const groupDone = group.items.filter((it) => !!checkedActivities[`${bid}__${it.id}`]).length;
                                  const isToday = tourDay === group.day;
                                  const groupComplete = groupDone === group.items.length;
                                  const groupLate = !groupComplete && group.items.some((it) => timing[it.id]?.state === "late");
                                  return (
                                    <li key={`${bid}-${group.label}`} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
                                      <span
                                        className={`flex h-11 w-11 flex-col items-center justify-center rounded-2xl ${
                                          groupComplete
                                            ? "bg-emerald-600 text-white"
                                            : groupLate
                                              ? "bg-orange-500 text-white"
                                              : isToday
                                                ? "bg-[#02665e] text-white"
                                                : "border border-solid border-slate-200 bg-white text-slate-700"
                                        }`}
                                      >
                                        <span className={`text-[8.5px] font-bold uppercase tracking-[0.12em] ${groupComplete || groupLate || isToday ? "text-white/75" : "text-slate-400"}`}>Day</span>
                                        <span className="text-[16px] font-black leading-none">{group.day}</span>
                                      </span>
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                          <div className="flex min-w-0 items-center gap-2">
                                            <h4 className="m-0 truncate text-[14px] font-bold text-slate-900">{group.title || group.label}</h4>
                                            {isToday ? <span className="rounded-full bg-[#02665e]/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#02665e]">Today</span> : null}
                                            {groupLate && !isToday ? <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-orange-700">Unfinished</span> : null}
                                          </div>
                                          <span className={`text-[11.5px] font-bold tabular-nums ${groupComplete ? "text-emerald-600" : "text-slate-400"}`}>{groupDone}/{group.items.length} done</span>
                                        </div>
                                        {group.description ? (
                                          <p className="m-0 mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-slate-500" title={group.description}>{group.description}</p>
                                        ) : null}
                                        <ul className="m-0 mt-2.5 list-none space-y-1.5 p-0">
                                          {group.items.map((act) => {
                                            const key = `${bid}__${act.id}`;
                                            const done = !!checkedActivities[key];
                                            const t = timing[act.id] || { state: "open" as ActivityTiming, note: "" };
                                            const isFocus = !isChecklistLocked && focus?.item.id === act.id;
                                            const row =
                                              t.state === "done"
                                                ? "border-emerald-200 bg-emerald-50/60"
                                                : t.state === "live"
                                                  ? "border-[#02665e] bg-white shadow-[0_0_0_3px_rgba(2,102,94,0.12)]"
                                                  : t.state === "late"
                                                    ? isFocus ? "border-orange-400 bg-white shadow-[0_0_0_3px_rgba(234,88,12,0.12)]" : "border-orange-200 bg-white"
                                                    : isFocus
                                                      ? "border-[#02665e]/50 bg-white"
                                                      : "border-slate-200 bg-white hover:border-slate-300";
                                            const tag =
                                              t.state === "live" ? { text: "Now", cls: "bg-[#02665e] text-white" }
                                              : t.state === "late" ? { text: "Late", cls: "bg-orange-500 text-white" }
                                              : isFocus ? { text: "Next", cls: "bg-slate-900 text-white" }
                                              : null;
                                            const note = done ? tickedTime(checkedActivities[key]) : t.note;
                                            return (
                                              <li key={act.id}>
                                                <button
                                                  type="button"
                                                  onClick={() => toggleActivity(booking, act.id, isChecklistLocked)}
                                                  disabled={isChecklistLocked}
                                                  aria-pressed={done}
                                                  aria-label={isChecklistLocked ? `Checklist locked for ${act.label}` : done ? `Unmark ${act.label}` : `Mark ${act.label} as done`}
                                                  style={{ fontFamily: "inherit" }}
                                                  className={`group grid w-full cursor-pointer grid-cols-[auto_4.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-solid px-3.5 py-3 text-left transition-colors disabled:cursor-default max-sm:grid-cols-[auto_minmax(0,1fr)_auto] ${row}`}
                                                >
                                                  <span className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 border-solid transition-colors ${
                                                    done ? "border-emerald-500 bg-emerald-500 text-white" : t.state === "late" ? "border-orange-300 bg-white text-transparent group-hover:border-orange-500 group-hover:text-orange-500/40" : "border-slate-300 bg-white text-transparent group-hover:border-[#02665e] group-hover:text-[#02665e]/40"
                                                  }`}>
                                                    <Check className="h-4 w-4" aria-hidden />
                                                  </span>
                                                  <span className={`font-mono text-[12px] font-bold tabular-nums max-sm:hidden ${done ? "text-slate-400" : t.state === "late" ? "text-orange-700" : t.state === "live" ? "text-[#02665e]" : "text-slate-600"}`}>
                                                    {act.timeLabel || act.period}
                                                  </span>
                                                  <span className="min-w-0">
                                                    <span className={`block truncate text-[13.5px] font-bold ${done ? "text-slate-500 line-through decoration-emerald-400" : "text-slate-900"}`}>{act.label}</span>
                                                    <span className={`block truncate text-[11.5px] ${t.state === "late" ? "text-orange-700" : t.state === "live" ? "text-[#02665e]" : done ? "text-emerald-700" : "text-slate-400"}`}>
                                                      <span className="sm:hidden">{act.timeLabel || act.period}{note ? " · " : ""}</span>
                                                      {note || (t.state === "open" ? "tap the circle once delivered" : "")}
                                                    </span>
                                                  </span>
                                                  {tag ? (
                                                    <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tag.cls}`}>
                                                      {t.state === "live" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden /> : null}
                                                      {tag.text}
                                                    </span>
                                                  ) : <span />}
                                                </button>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ol>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                );
              })()
            ) : isCompletedTab ? (
              /* ── Completed: a record of delivered trips, with what still needs closing ── */
              activeItems.length === 0 ? (
                <StageEmptyState
                  Icon={CheckCircle2}
                  title="No completed trips yet"
                  description="Completed bookings will appear here with guest ratings, issues and payout status."
                />
              ) : (() => {
                const q = completedQuery.trim().toLowerCase();
                const rows = sortedActiveItems.filter((b) => {
                  if (completedFilter === "TO_RATE" && b.selfRating != null) return false;
                  if (completedFilter === "ISSUES" && !(b.issueSummary?.total || 0)) return false;
                  if (completedFilter === "PAYOUT_PENDING" && isPayoutSettled(b)) return false;
                  if (!q) return true;
                  return [b.requester?.fullName, b.bookingCode, b.title, b.tripType, b.requester?.nationality, b.airportDeparture]
                    .some((v) => String(v || "").toLowerCase().includes(q));
                });
                const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
                const page = Math.min(currentPage, pages);
                const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
                const filters = [
                  { key: "ALL" as const, label: "All", count: completedStats.total },
                  { key: "TO_RATE" as const, label: "Needs your rating", count: completedStats.toRate },
                  { key: "ISSUES" as const, label: "With issues", count: completedStats.withIssues },
                  { key: "PAYOUT_PENDING" as const, label: "Payout pending", count: completedStats.total - completedStats.paid },
                ];
                return (
                  <div id="completed-stage" className="space-y-4 px-4 pb-6 pt-2 sm:px-6 lg:pt-5">
                    <style>{"#completed-stage, #completed-stage * { box-sizing: border-box; }"}</style>

                    {/* At a glance */}
                    <section aria-label="Completed trips at a glance" className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-solid border-slate-200 bg-slate-200 lg:grid-cols-4">
                      <div className="min-w-0 bg-white px-4 py-3.5">
                        <p className="m-0 truncate text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Trips delivered</p>
                        <p className="m-0 mt-1.5 text-[26px] font-black leading-none tabular-nums text-slate-900">{completedStats.total}</p>
                        <p className="m-0 mt-1 truncate text-[11.5px] text-slate-400">all time</p>
                      </div>
                      <div className="min-w-0 bg-white px-4 py-3.5">
                        <p className="m-0 truncate text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Guest rating</p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <p className={`m-0 text-[26px] font-black leading-none tabular-nums ${completedStats.guestAvg != null ? "text-slate-900" : "text-slate-300"}`}>
                            {completedStats.guestAvg != null ? completedStats.guestAvg.toFixed(1) : "0.0"}
                          </p>
                          {completedStats.guestAvg != null ? <MiniStars value={completedStats.guestAvg} size="h-4 w-4" /> : null}
                        </div>
                        <p className="m-0 mt-1 truncate text-[11.5px] text-slate-400">
                          {completedStats.ratingCount ? `from ${completedStats.ratingCount} ${completedStats.ratingCount === 1 ? "rating" : "ratings"}` : "no guest ratings yet"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCompletedFilter(completedStats.toRate ? "TO_RATE" : "ALL")}
                        style={{ fontFamily: "inherit" }}
                        className="min-w-0 cursor-pointer border-0 bg-white px-4 py-3.5 text-left transition-colors hover:bg-amber-50/50"
                      >
                        <p className="m-0 truncate text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Awaiting your rating</p>
                        <p className={`m-0 mt-1.5 text-[26px] font-black leading-none tabular-nums ${completedStats.toRate ? "text-amber-600" : "text-slate-300"}`}>{completedStats.toRate}</p>
                        <p className="m-0 mt-1 truncate text-[11.5px] text-slate-400">{completedStats.toRate ? "rate to build your record" : "all trips rated"}</p>
                      </button>
                      <div className="min-w-0 bg-white px-4 py-3.5">
                        <p className="m-0 truncate text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Payouts settled</p>
                        <p className="m-0 mt-1.5 text-[26px] font-black leading-none tabular-nums text-slate-900">
                          {completedStats.paid}<span className="text-[15px] font-bold text-slate-300">/{completedStats.total}</span>
                        </p>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${completedStats.total ? Math.round((completedStats.paid / completedStats.total) * 100) : 0}%` }} />
                        </div>
                      </div>
                    </section>

                    {/* Quick filters and search */}
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div role="tablist" aria-label="Filter completed trips" className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]">
                        {filters.map((f) => {
                          const on = completedFilter === f.key;
                          if (f.key !== "ALL" && f.count === 0 && !on) return null;
                          return (
                            <button
                              key={f.key}
                              type="button"
                              role="tab"
                              aria-selected={on}
                              onClick={() => { setCompletedFilter(f.key); setCurrentPage(1); }}
                              style={{ fontFamily: "inherit" }}
                              className={`inline-flex h-9 flex-shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border-0 px-3.5 text-[13px] font-semibold transition-colors ${
                                on ? "bg-slate-900 text-white" : "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              }`}
                            >
                              {f.label}
                              <span className={`inline-flex min-w-[20px] justify-center rounded-full px-1.5 text-[11.5px] font-bold tabular-nums ${on ? "bg-white/15 text-white" : f.key === "TO_RATE" ? "bg-amber-100 text-amber-800" : f.key === "ISSUES" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500"}`}>{f.count}</span>
                            </button>
                          );
                        })}
                      </div>
                      <label className="flex h-10 w-full items-center gap-2 rounded-full border border-solid border-slate-300 bg-white px-4 text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] hover:border-slate-400 focus-within:border-[#02665e] focus-within:text-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)] lg:w-80">
                        <Search className="h-4 w-4 flex-shrink-0" aria-hidden />
                        <span className="sr-only">Search completed trips</span>
                        <input
                          type="search"
                          value={completedQuery}
                          onChange={(event) => { setCompletedQuery(event.target.value); setCurrentPage(1); }}
                          placeholder="Search guest, code, tour or airport"
                          className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                          style={{ fontFamily: "inherit" }}
                        />
                      </label>
                    </div>

                    {rows.length === 0 ? (
                      <div className="flex flex-col items-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                        <CheckCircle2 className="h-8 w-8 text-slate-300" aria-hidden />
                        <p className="m-0 mt-3 text-[15px] font-bold text-slate-900">Nothing matches</p>
                        <p className="m-0 mt-1 text-[13px] text-slate-500">
                          {completedFilter === "TO_RATE" ? "Every completed trip has your rating." : completedFilter === "ISSUES" ? "No completed trip has a reported issue." : completedFilter === "PAYOUT_PENDING" ? "Every payout is settled." : "Try a guest name or tour code."}
                        </p>
                        <button
                          type="button"
                          onClick={() => { setCompletedFilter("ALL"); setCompletedQuery(""); }}
                          style={{ fontFamily: "inherit" }}
                          className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-full border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:border-[#02665e] hover:text-[#02665e]"
                        >
                          Show all completed trips
                        </button>
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
                        <TableScroller label="completed trips table">
                          <table className="w-full min-w-[1080px] border-collapse text-left">
                            <thead className="bg-slate-50/90 [&>tr>th]:shadow-[inset_0_-1px_0_0_#e5e5e5]">
                              <tr>
                                <th scope="col" className="whitespace-nowrap px-4 py-3"><SortableHeader label="Trip" column="bookingBy" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                                <th scope="col" className="whitespace-nowrap px-4 py-3"><SortableHeader label="Completed" column="completedAt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                                <th scope="col" className="whitespace-nowrap px-4 py-3"><SortableHeader label="Guest rating" column="tripRating" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                                <th scope="col" className="whitespace-nowrap px-4 py-3"><SortableHeader label="Your rating" column="selfRating" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                                <th scope="col" className="whitespace-nowrap px-4 py-3"><SortableHeader label="Issues" column="challenge" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                                <th scope="col" className="whitespace-nowrap px-4 py-3"><SortableHeader label="Payout" column="payout" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                                <th scope="col" className="whitespace-nowrap px-4 py-3 text-right"><SortableHeader label="Booking value" column="amountPaid" sortKey={sortKey} sortDir={sortDir} onSort={onSort} /></th>
                                <th scope="col" className="w-12 px-4 py-3"><span className="sr-only">Open</span></th>
                              </tr>
                            </thead>
                            <tbody className="bg-white [&>tr>td]:shadow-[inset_0_-1px_0_0_#f1f5f9] [&>tr:last-child>td]:shadow-none">
                              {pageRows.map((booking) => {
                                const bid = String(booking.id);
                                const detailsHref = `/account/agent/bookings/completed/${encodeURIComponent(bid)}?source=tour`;
                                const { tour, destination } = tourParts(booking);
                                const completedAt = booking.completedAt || booking.updatedAt || booking.createdAt || null;
                                const tripDays = booking.tripDate && booking.endDate
                                  ? Math.round((startOfDayMs(booking.endDate) - startOfDayMs(booking.tripDate)) / 86_400_000) + 1
                                  : null;
                                const guestCount = Number(booking.guestRatingCount || 0);
                                const guestAvg = typeof booking.rating === "number" && guestCount > 0 ? booking.rating : null;
                                const issues = booking.issueSummary || null;
                                const payout = payoutChip(booking);
                                const currency = booking.currency || "TZS";
                                return (
                                  <TableRow key={`tb-${bid}`} hover={false} className="group transition hover:bg-slate-50/70">
                                    <td className="px-4 py-3">
                                      <a href={detailsHref} className="flex min-w-0 items-center gap-3 no-underline">
                                        <span className="inline-flex h-10 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[13px] font-black tracking-[0.08em] text-slate-500 transition-colors group-hover:bg-[#02665e]/10 group-hover:text-[#02665e]">
                                          {placeCodeOf(booking)}
                                        </span>
                                        <span className="min-w-0">
                                          <span className="block max-w-[15rem] truncate text-[13.5px] font-bold text-slate-900">{booking.requester?.fullName || "Guest"}</span>
                                          <span className="block max-w-[15rem] truncate text-[12px] text-slate-500">
                                            {[booking.tripType || tour, destination, booking.requester?.nationality].filter(Boolean).join(" · ")}
                                          </span>
                                          {booking.bookingCode ? <span className="block font-mono text-[11px] text-slate-400">{booking.bookingCode}</span> : null}
                                        </span>
                                      </a>
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className="block whitespace-nowrap text-[13px] font-semibold text-slate-800">{completedAt ? new Date(completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "-"}</span>
                                      <span className="block whitespace-nowrap text-[11.5px] text-slate-400">
                                        {[
                                          booking.tripDate ? `from ${shortTripDate(booking.tripDate)}` : null,
                                          tripDays && tripDays > 0 ? `${tripDays} ${tripDays === 1 ? "day" : "days"}` : null,
                                          booking.requester?.travelerCount ? `${booking.requester.travelerCount} pax` : null,
                                        ].filter(Boolean).join(" · ") || "-"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3">
                                      {guestAvg != null ? (
                                        <span className="flex flex-col gap-0.5">
                                          <span className="inline-flex items-center gap-1.5">
                                            <span className="text-[13.5px] font-bold tabular-nums text-slate-900">{guestAvg.toFixed(1)}</span>
                                            <MiniStars value={guestAvg} />
                                          </span>
                                          <span className="text-[11.5px] text-slate-400">{guestCount} {guestCount === 1 ? "rating" : "ratings"}</span>
                                        </span>
                                      ) : (
                                        <span className="text-[12px] text-slate-400">No guest ratings</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      {typeof booking.selfRating === "number" ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-800">
                                          <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" aria-hidden />
                                          {booking.selfRating.toFixed(1)}
                                        </span>
                                      ) : (
                                        <a
                                          href={detailsHref}
                                          className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-solid border-amber-300 bg-white px-3 text-[12px] font-bold text-amber-700 no-underline transition-colors hover:bg-amber-50"
                                        >
                                          <Star className="h-3.5 w-3.5" aria-hidden />
                                          Rate now
                                        </a>
                                      )}
                                    </td>
                                    <td className="max-w-[14rem] px-4 py-3">
                                      {issues && issues.total > 0 ? (
                                        <span className="flex min-w-0 flex-col gap-0.5" title={issues.latestTitle || undefined}>
                                          <span className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold ${issues.highestSeverity === "HIGH" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>
                                            <span className={`h-1.5 w-1.5 rounded-full ${issues.highestSeverity === "HIGH" ? "bg-rose-500" : "bg-amber-500"}`} aria-hidden />
                                            {issues.total} {issues.total === 1 ? "issue" : "issues"}
                                            {issues.open > 0 ? ` · ${issues.open} open` : ""}
                                          </span>
                                          {issues.latestTitle ? <span className="truncate text-[11.5px] text-slate-500">{issues.latestTitle}</span> : null}
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
                                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                                          Clean trip
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className="flex flex-col gap-0.5">
                                        <span className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize ${payout.cls}`}>
                                          <span className={`h-1.5 w-1.5 rounded-full ${payout.dot}`} aria-hidden />
                                          {payout.label}
                                        </span>
                                        {typeof booking.operatorPayoutAmount === "number" ? (
                                          <span className="whitespace-nowrap text-[11.5px] tabular-nums text-slate-500">{currency} {booking.operatorPayoutAmount.toLocaleString("en-US")}</span>
                                        ) : null}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      <span className="whitespace-nowrap text-[13.5px] font-bold tabular-nums text-slate-900">
                                        {typeof booking.amountPaid === "number" ? booking.amountPaid.toLocaleString("en-US") : "-"}
                                      </span>
                                      <span className="ml-1 text-[11px] font-semibold text-slate-400">{currency}</span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      <a
                                        href={detailsHref}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-500 no-underline transition-colors hover:border-[#02665e] hover:text-[#02665e]"
                                        aria-label={`Open completed trip for ${booking.requester?.fullName || "guest"}`}
                                        title="Open record"
                                      >
                                        <ChevronRight className="h-4 w-4" aria-hidden />
                                      </a>
                                    </td>
                                  </TableRow>
                                );
                              })}
                            </tbody>
                          </table>
                        </TableScroller>
                        {rows.length > PAGE_SIZE ? (
                          <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-4 py-3">
                            <span className="text-[12px] font-semibold text-slate-500">
                              {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setCurrentPage(Math.max(1, page - 1))}
                                disabled={page <= 1}
                                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-300 bg-white text-slate-600 transition hover:border-[#02665e] hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-45"
                                aria-label="Previous page"
                              >
                                <ChevronLeft className="h-4 w-4" aria-hidden />
                              </button>
                              <span className="text-[12px] font-semibold text-slate-500">{page} of {pages}</span>
                              <button
                                type="button"
                                onClick={() => setCurrentPage(Math.min(pages, page + 1))}
                                disabled={page >= pages}
                                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-300 bg-white text-slate-600 transition hover:border-[#02665e] hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-45"
                                aria-label="Next page"
                              >
                                <ChevronRight className="h-4 w-4" aria-hidden />
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : isConfirmedTab ? (
              <div className="space-y-4 px-4 pb-6 pt-2 sm:px-6 lg:pt-5">
                <style>{"#confirmed-stage, #confirmed-stage * { box-sizing: border-box; }"}</style>
                <div id="confirmed-stage" className="space-y-4">
                {/* At a glance: everything here is paid and waiting for the pickup handover. */}
                <section
                  aria-label="Confirmed bookings at a glance"
                  className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-solid border-slate-200 bg-slate-200 sm:grid-cols-4"
                >
                  {([
                    {
                      label: "Pickups due",
                      value: String(confirmedStats.due),
                      helper: confirmedStats.due > 0 ? "today or overdue" : "nothing waiting",
                      tone: confirmedStats.due > 0 ? "text-amber-600" : "text-slate-300",
                    },
                    {
                      label: "Next 7 days",
                      value: String(confirmedStats.week),
                      helper: confirmedStats.week === 1 ? "departure" : "departures",
                      tone: confirmedStats.week > 0 ? "text-[#02665e]" : "text-slate-300",
                    },
                    {
                      label: "Next pickup",
                      value: confirmedStats.next == null ? "-" : confirmedStats.next === 0 ? "Today" : `${confirmedStats.next}d`,
                      helper: confirmedStats.next == null ? "no dated trips" : confirmedStats.next === 0 ? "be at the meeting point" : "until handover",
                      tone: confirmedStats.next == null ? "text-slate-300" : "text-slate-900",
                    },
                    {
                      label: "Confirmed",
                      value: String(confirmedStats.total),
                      helper: "paid, awaiting pickup",
                      tone: confirmedStats.total > 0 ? "text-slate-900" : "text-slate-300",
                    },
                  ] as const).map((stat) => (
                    <div key={stat.label} className="min-w-0 bg-white px-4 py-3.5">
                      <p className="m-0 truncate text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{stat.label}</p>
                      <p className={`m-0 mt-1.5 text-[26px] font-black leading-none tabular-nums ${stat.tone}`}>{stat.value}</p>
                      <p className="m-0 mt-1 truncate text-[11.5px] text-slate-400">{stat.helper}</p>
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
                  <>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex h-10 w-full items-center gap-2 rounded-full border border-solid border-slate-300 bg-white px-4 text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] hover:border-slate-400 focus-within:border-[#02665e] focus-within:text-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)] sm:w-80">
                        <Search className="h-4 w-4 flex-shrink-0" aria-hidden />
                        <span className="sr-only">Search confirmed bookings</span>
                        <input
                          type="search"
                          value={confirmedQuery}
                          onChange={(event) => setConfirmedQuery(event.target.value)}
                          placeholder="Search guest, code, tour or airport"
                          className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                          style={{ fontFamily: "inherit" }}
                        />
                      </label>
                      <span className="text-[12.5px] text-slate-500">
                        <strong className="font-bold tabular-nums text-slate-900">{confirmedOrdered.length}</strong> of {activeItems.length} · ordered by pickup urgency
                      </span>
                    </div>

                    {/* ── Needs you next: boarding pass ── */}
                    {confirmedHero ? (() => {
                      const booking = confirmedHero;
                      const bid = String(booking.id);
                      const { tour, destination } = tourParts(booking);
                      const d = daysToTrip(booking);
                      const { checkpoints, completedSteps, nextPending } = buildCheckpoints(booking);
                      const detailHref = `/account/agent/tour-bookings/${encodeURIComponent(bid)}`;
                      const due = d != null && d <= 0;
                      const countdown = d == null
                        ? { big: "TBC", small: "date to confirm" }
                        : d < 0
                          ? { big: String(Math.abs(d)), small: Math.abs(d) === 1 ? "day overdue" : "days overdue" }
                          : d === 0
                            ? { big: "Today", small: "pickup day" }
                            : { big: String(d), small: d === 1 ? "day to pickup" : "days to pickup" };
                      return (
                        <section aria-label="Needs you next" className="relative overflow-hidden rounded-3xl text-white shadow-[0_24px_48px_-28px_rgba(2,102,94,0.9)]" style={{ backgroundColor: "#02665e" }}>
                          <div className="grid md:grid-cols-[minmax(0,1fr)_14rem] lg:grid-cols-[minmax(0,1fr)_16rem]">
                            <div className="min-w-0 p-5 sm:p-6">
                              <div className="flex items-center justify-between gap-3">
                                <p className="m-0 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
                                  {due ? (
                                    <span className="relative flex h-2 w-2" aria-hidden>
                                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300/80" />
                                      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
                                    </span>
                                  ) : null}
                                  {d != null && d < 0 ? "Pickup overdue" : d === 0 ? "Pickup today" : "Next pickup"}
                                </p>
                                {booking.bookingCode ? <span className="font-mono text-[11px] text-white/50">{booking.bookingCode}</span> : null}
                              </div>
                              <div className="mt-4 flex items-end gap-3 sm:gap-4">
                                <span className="text-[40px] font-black leading-none tracking-[0.08em] text-white sm:text-[52px]">{placeCodeOf(booking)}</span>
                                <div className="min-w-0 pb-1">
                                  <h2 className="m-0 truncate text-[18px] font-bold leading-tight text-white">{booking.requester?.fullName || "Guest"}</h2>
                                  <p className="m-0 mt-0.5 truncate text-[13px] text-white/70">
                                    {[tour, destination, booking.requester?.nationality].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                              </div>
                              <dl className="m-0 mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                                {[
                                  { label: "Pickup", value: shortTripDate(booking.tripDate) },
                                  { label: "Guests", value: String(booking.requester?.travelerCount ?? "-") },
                                  { label: "Meet at", value: booking.airportDeparture || "Agreed point" },
                                  { label: "Value", value: typeof booking.amountPaid === "number" ? `${booking.currency || "TZS"} ${booking.amountPaid.toLocaleString("en-US")}` : "-" },
                                ].map((fact) => (
                                  <div key={fact.label} className="min-w-0">
                                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/55">{fact.label}</dt>
                                    <dd className="m-0 mt-1 truncate text-[15px] font-bold tabular-nums text-white" title={fact.value}>{fact.value}</dd>
                                  </div>
                                ))}
                              </dl>
                              <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <StageRail checkpoints={checkpoints} onBrand />
                                <span className="text-[11.5px] font-semibold text-white/80">
                                  {completedSteps}/{checkpoints.length} · next: {nextPending?.title || "All stages completed"}
                                </span>
                              </div>
                            </div>
                            <div className="relative flex items-center justify-between gap-4 border-0 border-t-2 border-dashed border-white/25 px-5 py-4 md:flex-col md:justify-center md:border-l-2 md:border-t-0 md:p-6 md:text-center">
                              <span aria-hidden className="absolute -top-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-white md:block" />
                              <span aria-hidden className="absolute -bottom-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-white md:block" />
                              <div className="flex items-baseline gap-2 md:block">
                                <div className={`text-[36px] font-black leading-none tabular-nums md:text-[50px] ${due ? "text-amber-300" : "text-white"}`}>{countdown.big}</div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70 md:mt-1.5 md:text-[12px]">{countdown.small}</div>
                              </div>
                              <Link
                                href={`${detailHref}#pickup-validation`}
                                className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#02665e] no-underline transition-colors hover:bg-white/90 md:w-full"
                              >
                                <UserCheck className="h-4 w-4" aria-hidden />
                                {due ? "Validate pickup" : "Prepare pickup"}
                              </Link>
                            </div>
                          </div>
                        </section>
                      );
                    })() : null}

                    {confirmedOrdered.length === 0 ? (
                      <div className="flex flex-col items-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                        <span className="text-[40px] font-black leading-none tracking-[0.08em] text-slate-200">TRP</span>
                        <p className="m-0 mt-3 text-[15px] font-bold text-slate-900">No matching bookings</p>
                        <p className="m-0 mt-1 text-[13px] text-slate-500">Nothing matches &quot;{confirmedQuery.trim()}&quot;. Try a guest name or tour code.</p>
                        <button
                          type="button"
                          onClick={() => setConfirmedQuery("")}
                          style={{ fontFamily: "inherit" }}
                          className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-full border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:border-[#02665e] hover:text-[#02665e]"
                        >
                          Clear search
                        </button>
                      </div>
                    ) : null}

                    {confirmedPageItems.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                        {confirmedPageItems.map((booking) => {
                          const bid = String(booking.id);
                          const bookingKey = `tb-${bid}`;
                          const isExpanded = expandedRoadmapKey === bookingKey;
                          const { tour, destination } = tourParts(booking);
                          const d = daysToTrip(booking);
                          const chip = pickupChip(d);
                          const { checkpoints, completedSteps, nextPending, paidAt } = buildCheckpoints(booking);
                          const detailHref = `/account/agent/tour-bookings/${encodeURIComponent(bid)}`;
                          const ratingLabel = typeof booking.rating === "number" ? `${booking.rating}/5` : "Pending";
                          const payout = String(booking.payoutStatus || "").replace(/_/g, " ").toLowerCase();
                          return (
                            <article
                              key={bookingKey}
                              className={`flex min-w-0 flex-col rounded-3xl border border-solid bg-white transition-shadow hover:shadow-[0_16px_32px_-24px_rgba(15,23,42,0.45)] ${
                                chip.urgent ? "border-amber-300" : "border-slate-200"
                              }`}
                            >
                              <div className="flex-1 p-5">
                                <div className="flex items-start justify-between gap-3">
                                  <span className="text-[32px] font-black leading-none tracking-[0.08em] text-[#02665e]">{placeCodeOf(booking)}</span>
                                  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold ${chip.cls}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} aria-hidden />
                                    {chip.label}
                                  </span>
                                </div>
                                <h3 className="m-0 mt-3 truncate text-[15.5px] font-bold text-slate-900">{booking.requester?.fullName || "Guest"}</h3>
                                <p className="m-0 mt-0.5 truncate text-[12.5px] text-slate-500">
                                  {[booking.tripType || tour, destination, booking.requester?.nationality].filter(Boolean).join(" · ")}
                                </p>
                                <dl className="m-0 mt-4 grid grid-cols-3 gap-3">
                                  {[
                                    { label: "Pickup", value: shortTripDate(booking.tripDate) },
                                    { label: "Guests", value: String(booking.requester?.travelerCount ?? "-") },
                                    { label: "Meet at", value: booking.airportDeparture || "Agreed" },
                                  ].map((fact) => (
                                    <div key={fact.label} className="min-w-0">
                                      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{fact.label}</dt>
                                      <dd className="m-0 mt-0.5 truncate text-[14px] font-bold tabular-nums text-slate-900" title={fact.value}>{fact.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                                <div className="mt-4 space-y-1.5">
                                  <StageRail checkpoints={checkpoints} />
                                  <p className="m-0 truncate text-[11.5px] text-slate-500">
                                    <span className="font-bold text-slate-700">{completedSteps}/{checkpoints.length}</span> stages · next: <span className="font-semibold text-slate-700">{nextPending?.title || "All stages completed"}</span>
                                  </p>
                                </div>
                              </div>

                              <Perforation />

                              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-5 pt-4">
                                <div className="min-w-0">
                                  <div className="text-[17px] font-extrabold leading-tight tabular-nums text-slate-900">
                                    {typeof booking.amountPaid === "number" ? booking.amountPaid.toLocaleString("en-US") : "-"}{" "}
                                    <span className="text-[11.5px] font-semibold text-slate-400">{booking.currency || "TZS"}</span>
                                  </div>
                                  <div className="mt-0.5 truncate text-[11.5px] text-slate-400">
                                    {payout ? `Payout ${payout}` : `Paid ${formatMilestoneTime(paidAt).split(",")[0]}`}
                                    {booking.bookingCode ? <span className="font-mono text-slate-300"> · {booking.bookingCode}</span> : null}
                                  </div>
                                </div>
                                <div className="flex flex-shrink-0 items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedRoadmapKey((prev) => (prev === bookingKey ? null : bookingKey))}
                                    aria-expanded={isExpanded}
                                    title={isExpanded ? "Hide journey board" : "Show journey board"}
                                    aria-label={isExpanded ? "Hide journey board" : "Show journey board"}
                                    className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-solid transition-colors ${
                                      isExpanded ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-500 hover:border-[#02665e] hover:text-[#02665e]"
                                    }`}
                                  >
                                    <Activity className="h-4 w-4" aria-hidden />
                                  </button>
                                  <Link
                                    href={chip.urgent ? `${detailHref}#pickup-validation` : detailHref}
                                    className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold no-underline transition-colors ${
                                      chip.urgent
                                        ? "bg-amber-500 text-white hover:bg-amber-600"
                                        : "border-2 border-solid border-[#02665e] bg-white text-[#02665e] hover:bg-[#02665e] hover:text-white"
                                    }`}
                                  >
                                    {chip.urgent ? <UserCheck className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                                    {chip.urgent ? "Validate pickup" : "Open trip"}
                                  </Link>
                                </div>
                              </div>

                              {isExpanded ? (
                                <ol className="m-0 list-none space-y-0 border-0 border-t border-solid border-slate-100 px-5 py-4">
                                  {checkpoints.map((checkpoint, index) => {
                                    const theme = checkpointTheme(checkpoint.key);
                                    return (
                                      <li key={checkpoint.key} className="relative flex gap-3 pb-3 last:pb-0">
                                        {index < checkpoints.length - 1 ? (
                                          <span aria-hidden className={`absolute bottom-0 left-[0.8125rem] top-7 w-px ${checkpoint.done ? "bg-slate-300" : "bg-slate-200"}`} />
                                        ) : null}
                                        <span className={`relative inline-flex h-[1.625rem] w-[1.625rem] flex-shrink-0 items-center justify-center rounded-full border-2 border-solid ${checkpoint.done ? `${theme.dot} text-white` : "border-slate-200 bg-white text-slate-400"}`}>
                                          {checkpointIcon(checkpoint.key)}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                                            <span className={`text-[13px] font-bold ${checkpoint.done ? "text-slate-900" : "text-slate-400"}`}>{checkpoint.title}</span>
                                            <span className="text-[11px] font-semibold tabular-nums text-slate-400">
                                              {checkpoint.key === "rated" ? ratingLabel : checkpoint.done ? formatMilestoneTime(checkpoint.at) : "Pending"}
                                            </span>
                                          </div>
                                          <p className="m-0 text-[11.5px] leading-snug text-slate-500">{checkpoint.actor} · {checkpoint.details}</p>
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ol>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    ) : null}

                    {confirmedGrid.length > PAGE_SIZE ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[12px] font-semibold text-slate-500">
                          {(confirmedPage - 1) * PAGE_SIZE + 1} to {Math.min(confirmedPage * PAGE_SIZE, confirmedGrid.length)} of {confirmedGrid.length}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setCurrentPage(Math.max(1, confirmedPage - 1))}
                            disabled={confirmedPage <= 1}
                            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-300 bg-white text-slate-600 transition hover:border-[#02665e] hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-45"
                            aria-label="Previous page"
                          >
                            <ChevronLeft className="h-4 w-4" aria-hidden />
                          </button>
                          <span className="text-[12px] font-semibold text-slate-500">{confirmedPage} of {confirmedPages}</span>
                          <button
                            type="button"
                            onClick={() => setCurrentPage(Math.min(confirmedPages, confirmedPage + 1))}
                            disabled={confirmedPage >= confirmedPages}
                            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-300 bg-white text-slate-600 transition hover:border-[#02665e] hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-45"
                            aria-label="Next page"
                          >
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
                </div>
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
