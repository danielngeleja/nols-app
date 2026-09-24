"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { slugifyProfile } from "@/lib/profileSlug";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  Loader2,
  Lock,
  MapPin,
  Megaphone,
  Moon,
  Share2,
  ShieldCheck,
  Star,
  Sun,
  Sunrise,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

const api = apiClient;

const EVENT_RATING_OPTIONS = [
  { value: 1, label: "Bored", description: "It did not feel engaging." },
  { value: 2, label: "Okay", description: "It was acceptable but light." },
  { value: 3, label: "Good", description: "It matched the expectation." },
  { value: 4, label: "Excited", description: "It felt memorable and strong." },
  { value: 5, label: "Beyond expectations", description: "It was outstanding." },
];

type TimelineSlot = {
  time: string;
  title: string;
  description: string;
  experienceVibe: string;
};

type TimelineDay = {
  day: number;
  title: string;
  description: string;
  slots: TimelineSlot[];
};

type RatingJourneyPoint = {
  key: string;
  order: number;
  axisLabel: string;
  rating: number;
  ratingLabel: string;
  ratingCount: number;
  day: number;
  time: string;
  title: string;
  experienceVibe: string;
};

type TeamRatingSummary = {
  average: number;
  count: number;
  highest: number;
  lowest: number;
  labels: string[];
};

function buildTimeLabel(value: any): string {
  const direct = String(value?.timeRange || value?.time || "").trim();
  if (direct) return direct;

  const start = String(value?.startTime || value?.from || "").trim();
  const end = String(value?.endTime || value?.to || "").trim();
  if (start && end) return `${start} - ${end}`;
  return start || end;
}

function parseSlotText(value: string): TimelineSlot {
  const text = String(value || "").trim();
  if (!text) return { time: "", title: "", description: "", experienceVibe: "" };

  const timedMatch = text.match(/^((?:\d{1,2}:\d{2}(?:\s?[APap][Mm])?)(?:\s*-\s*\d{1,2}:\d{2}(?:\s?[APap][Mm])?)?)(?:\s*(?:-|:|\u2022)\s*)?(.*)$/);
  if (timedMatch) {
    return {
      time: String(timedMatch[1] || "").trim(),
      title: String(timedMatch[2] || "").trim(),
      description: "",
      experienceVibe: "",
    };
  }

  return { time: "", title: text, description: "", experienceVibe: "" };
}

function normalizeScheduleSlot(value: any): TimelineSlot | null {
  if (!value) return null;

  if (typeof value === "string") {
    const parsed = parseSlotText(value);
    return parsed.time || parsed.title || parsed.description ? parsed : null;
  }

  const time = buildTimeLabel(value);
  const primary = String(value?.activity || value?.label || value?.title || value?.name || "").trim();
  const secondary = String(value?.description || value?.details || value?.notes || "").trim();
  const experienceVibe = String(
    value?.experienceVibe ||
    value?.experience_vibe ||
    value?.vibe ||
    value?.mood ||
    value?.emotion ||
    value?.emotionalTone ||
    value?.tone ||
    ""
  ).trim();

  if (!time && !primary && !secondary && !experienceVibe) return null;
  return {
    time,
    title: primary || secondary,
    description: primary && secondary ? secondary : "",
    experienceVibe,
  };
}

function normalizeItineraryDays(rows: any[]): TimelineDay[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row: any, idx: number) => {
      const title = String(row?.title || row?.name || row?.dayLabel || `Day ${idx + 1}`).trim();
      const description = String(row?.description || row?.notes || "").trim();
      const slots = [
        ...(Array.isArray(row?.events) ? row.events : []),
        ...(Array.isArray(row?.timeline) ? row.timeline : []),
      ]
        .map((entry) => normalizeScheduleSlot(entry))
        .filter((entry): entry is TimelineSlot => Boolean(entry && (entry.time || entry.title || entry.description || entry.experienceVibe)));

      if (!slots.length) {
        const fallbackSlot = normalizeScheduleSlot({
          timeRange: row?.timeRange,
          time: row?.time,
          startTime: row?.startTime,
          endTime: row?.endTime,
          title,
          description,
        });
        if (fallbackSlot) slots.push(fallbackSlot);
      }

      return {
        day: Number(row?.day) > 0 ? Number(row.day) : idx + 1,
        title,
        description,
        slots,
      };
    })
    .filter((row) => row.title || row.description || row.slots.length)
    .sort((a, b) => a.day - b.day);
}

/** "7:00 AM", "07:00" and "19:30" as minutes since midnight. */
function clockMinutes(value: string): number | null {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = (m[3] || "").toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** "07:00 - 08:00" into its start and end, as labels and minutes. */
function slotRange(time: string): { start: number | null; end: number | null; startLabel: string; endLabel: string } {
  const [a = "", b = ""] = String(time || "").split(/\s*(?:-|–|to)\s*/i);
  const start = clockMinutes(a);
  const end = clockMinutes(b);
  return { start, end, startLabel: start != null ? a.trim() : String(time || "").trim(), endLabel: end != null ? b.trim() : "" };
}

/** Morning, afternoon or evening, each with its own mark and colour on the rail. */
function timeOfDay(minutes: number | null): { label: string; Icon: typeof Sun; hex: string } {
  if (minutes == null) return { label: "Anytime", Icon: Clock3, hex: "#94a3b8" };
  if (minutes < 12 * 60) return { label: "Morning", Icon: Sunrise, hex: "#f59e0b" };
  if (minutes < 17 * 60) return { label: "Afternoon", Icon: Sun, hex: "#0ea5e9" };
  return { label: "Evening", Icon: Moon, hex: "#6366f1" };
}

function durationLabel(minutes: number): string {
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function listify(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[\n,;|]+/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function firstText(...values: unknown[]): string {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function withMarketingSource(path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}recommendedFrom=timeline`;
}

function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

function normalizeTimelineRatings(value: any, currentUserId: any): { own: Record<string, number>; team: Record<string, TeamRatingSummary> } {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const userKey = String(currentUserId || "");
  return Object.entries(source).reduce<{ own: Record<string, number>; team: Record<string, TeamRatingSummary> }>((acc, [key, entry]) => {
    const eventEntry = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as any : {};
    const ratings = eventEntry.ratings && typeof eventEntry.ratings === "object" && !Array.isArray(eventEntry.ratings)
      ? eventEntry.ratings
      : {};
    const ratingEntries = Object.keys(ratings).length
      ? Object.entries(ratings)
      : eventEntry.rating
        ? [[String(eventEntry.ratedByUserId || currentUserId || "legacy"), eventEntry]]
        : [];

    const values = ratingEntries
      .map(([ratingUserId, ratingEntry]) => {
        const rating = Number((ratingEntry as any)?.rating ?? ratingEntry);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
        const option = EVENT_RATING_OPTIONS.find((item) => item.value === rating);
        if (String(ratingUserId) === userKey) acc.own[key] = rating;
        return {
          rating,
          label: String((ratingEntry as any)?.label || option?.label || `${rating}/5`),
        };
      })
      .filter((rating): rating is { rating: number; label: string } => Boolean(rating));

    if (values.length) {
      const total = values.reduce((sum, item) => sum + item.rating, 0);
      acc.team[key] = {
        average: total / values.length,
        count: values.length,
        highest: Math.max(...values.map((item) => item.rating)),
        lowest: Math.min(...values.map((item) => item.rating)),
        labels: values.map((item) => item.label),
      };
    }
    return acc;
  }, { own: {}, team: {} });
}

function buildRatingJourney(days: TimelineDay[], ratings: Record<string, TeamRatingSummary>): RatingJourneyPoint[] {
  const points: RatingJourneyPoint[] = [];
  days.forEach((day) => {
    day.slots.forEach((slot, slotIdx) => {
      const key = `${day.day}-${slotIdx}`;
      const rating = ratings[key];
      if (!rating?.count) return;
      const rounded = Math.round(rating.average);
      const option = EVENT_RATING_OPTIONS.find((item) => item.value === rounded);
      points.push({
        key,
        order: points.length + 1,
        axisLabel: `D${day.day}.${slotIdx + 1}`,
        rating: Number(rating.average.toFixed(2)),
        ratingLabel: option?.label || `${rating.average.toFixed(1)}/5`,
        ratingCount: rating.count,
        day: day.day,
        time: slot.time,
        title: slot.title || "Activity details",
        experienceVibe: slot.experienceVibe,
      });
    });
  });
  return points;
}

export default function TourPackageTimelinePage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<any>(null);
  // Minutes since midnight, refreshed each minute, so today's stops tick off live
  const [nowMinutes, setNowMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    };
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [pickupMessage, setPickupMessage] = useState<string | null>(null);
  const [showPickupValidateModal, setShowPickupValidateModal] = useState(false);
  const [pickupPolicyAgreed, setPickupPolicyAgreed] = useState(false);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [pickupJustValidated, setPickupJustValidated] = useState(false);
  const [pickupCodeCopied, setPickupCodeCopied] = useState(false);
  const [timelineActionMessage, setTimelineActionMessage] = useState<string | null>(null);
  const [marketingShareMessage, setMarketingShareMessage] = useState<string | null>(null);
  const [ratingTarget, setRatingTarget] = useState<{ day: TimelineDay; slot: TimelineSlot; key: string } | null>(null);
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  // Floating day navigator: shown once the in-page day tabs leave the screen
  const [mounted, setMounted] = useState(false);
  const [daysFabVisible, setDaysFabVisible] = useState(false);
  const [daysMenuOpen, setDaysMenuOpen] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const nav = document.getElementById("trip-day-nav");
    if (!nav || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      setDaysFabVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      if (entry.isIntersecting) setDaysMenuOpen(false);
    });
    io.observe(nav);
    return () => io.disconnect();
  });
  const goToTripDay = (dayNumber: number) => {
    setDaysMenuOpen(false);
    document.getElementById(`trip-day-${dayNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [eventRatings, setEventRatings] = useState<Record<string, number>>({});
  const [teamRatings, setTeamRatings] = useState<Record<string, TeamRatingSummary>>({});
  const [ratingSaving, setRatingSaving] = useState(false);

  const load = async () => {
    const res = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}/timeline`);
    const nextItem = res.data || null;
    const nextRatings = normalizeTimelineRatings(nextItem?.metadata?.timelineEventRatings, nextItem?.timelineCurrentUserId);
    setItem(nextItem);
    setEventRatings(nextRatings.own);
    setTeamRatings(nextRatings.team);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}/timeline`);
        if (!alive) return;
        const nextItem = res.data || null;
        const nextRatings = normalizeTimelineRatings(nextItem?.metadata?.timelineEventRatings, nextItem?.timelineCurrentUserId);
        setItem(nextItem);
        setEventRatings(nextRatings.own);
        setTeamRatings(nextRatings.team);
        setError(null);
      } catch (err: any) {
        if (!alive) return;
        setError(err?.response?.data?.error || "Failed to load tour timeline");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const validateMeetup = async () => {
    if (!id) return;
    setPickupLoading(true);
    setPickupMessage(null);
    setPickupError(null);
    try {
      await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/validate-pickup`, {
        policyAgreed: true,
        codeSuffix: pickupCodeSuffix,
      });
      await load();
      // Stay in the popup and show the success state; it leads straight to day 1
      setPickupJustValidated(true);
    } catch (err: any) {
      // Keep the error inside the popup, where the traveller is looking
      setPickupError(err?.response?.data?.message || err?.response?.data?.error || "Unable to validate the meetup right now. Please try again.");
    } finally {
      setPickupLoading(false);
    }
  };

  const shareMarketingLink = async (url: string) => {
    const shareUrl = absoluteUrl(url);
    const shareTitle = item?.title ? `Recommended tour: ${item.title}` : "Recommended tour package";
    const shareText = item?.title
      ? `I completed ${item.title} and recommend checking this tour operator.`
      : "I completed this tour and recommend checking this tour operator.";

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
        setMarketingShareMessage("Recommendation share opened.");
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setMarketingShareMessage("Recommendation link copied.");
        return;
      }

      setMarketingShareMessage(shareUrl);
    } catch (err: any) {
      if (String(err?.name || "").toLowerCase() === "aborterror") return;
      setMarketingShareMessage("Unable to share right now. Please copy the public booking link manually.");
    }
  };

  const shareMarketingViaWhatsApp = (url: string) => {
    const shareUrl = absoluteUrl(url);
    const text = item?.title
      ? `I completed ${item.title} and recommend this tour operator on NoLSAF. Review their approved profile and book the same tour here: ${shareUrl}`
      : `I recommend this tour operator on NoLSAF. Review their approved profile and book the same tour here: ${shareUrl}`;
    if (typeof window !== "undefined") {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      setMarketingShareMessage("WhatsApp opened. Pick a contact to send the booking link.");
    }
  };

  const copyMarketingLink = async (url: string) => {
    const shareUrl = absoluteUrl(url);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      setMarketingShareMessage("Public booking link copied. Paste it anywhere to share.");
      return;
    }
    setMarketingShareMessage(shareUrl);
  };

  const openRating = (day: TimelineDay, slot: TimelineSlot, key: string) => {
    if (eventRatings[key] || ratingSaving) return;
    setRatingTarget({ day, slot, key });
    setSelectedRating(0);
    setHoverRating(0);
    setTimelineActionMessage(null);
  };

  const submitEventRating = async () => {
    if (!ratingTarget || selectedRating <= 0 || ratingSaving) return;
    const selected = EVENT_RATING_OPTIONS.find((option) => option.value === selectedRating);
    const keyParts = ratingTarget.key.split("-");
    const slotIndex = Number(keyParts[keyParts.length - 1] || 0);
    setRatingSaving(true);
    try {
      const res = await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/timeline-event-rating`, {
        key: ratingTarget.key,
        day: ratingTarget.day.day,
        slotIndex,
        time: ratingTarget.slot.time,
        title: ratingTarget.slot.title,
        rating: selectedRating,
      });
      const storedRatings = normalizeTimelineRatings(res?.data?.timelineEventRatings, item?.timelineCurrentUserId);
      setEventRatings(Object.keys(storedRatings.own).length ? storedRatings.own : { [ratingTarget.key]: selectedRating });
      setTeamRatings(storedRatings.team);
      setTimelineActionMessage(
        `Rating saved for Day ${ratingTarget.day.day}${ratingTarget.slot.time ? `, ${ratingTarget.slot.time}` : ""}: ${selected?.label || `${selectedRating}/5`}.`
      );
      setRatingTarget(null);
      setSelectedRating(0);
    } catch (err: any) {
      const existingRating = err?.response?.data?.rating;
      if (err?.response?.status === 409 && existingRating) {
        setEventRatings((prev) => ({
          ...prev,
          [ratingTarget.key]: Number(existingRating?.rating || existingRating) || selectedRating,
        }));
      }
      setTimelineActionMessage(
        err?.response?.data?.message || err?.response?.data?.error || "Unable to save this event rating right now."
      );
      if (err?.response?.status === 409) {
        setRatingTarget(null);
        setSelectedRating(0);
      }
    } finally {
      setRatingSaving(false);
    }
  };

  const packageSnapshot = item?.packageSnapshot && typeof item.packageSnapshot === "object" ? item.packageSnapshot : {};
  const operatorSnapshot = item?.operatorSnapshot && typeof item.operatorSnapshot === "object" ? item.operatorSnapshot : {};
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const itinerary = (() => {
    const candidates = [
      (packageSnapshot as any)?.itinerary,
      (metadata as any)?.itinerary,
      (packageSnapshot as any)?.timelineDays,
      (metadata as any)?.timelineDays,
    ];
    return candidates.find((candidate) => Array.isArray(candidate)) || [];
  })();
  const detailedItinerary = normalizeItineraryDays(itinerary);
  const ratingJourney = useMemo(
    () => buildRatingJourney(detailedItinerary, teamRatings),
    [detailedItinerary, teamRatings]
  );
  const ratingAverage = ratingJourney.length
    ? ratingJourney.reduce((total, point) => total + point.rating, 0) / ratingJourney.length
    : 0;
  const highestRatedPoint = ratingJourney.reduce<RatingJourneyPoint | null>(
    (best, point) => (!best || point.rating > best.rating ? point : best),
    null
  );
  const lowestRatedPoint = ratingJourney.reduce<RatingJourneyPoint | null>(
    (lowest, point) => (!lowest || point.rating < lowest.rating ? point : lowest),
    null
  );

  const airportMeetingPoint = (() => {
    const airport =
      (metadata as any)?.departureAirport ||
      (metadata as any)?.selectedAirport ||
      (metadata as any)?.airport ||
      (metadata as any)?.pickupAirport ||
      (metadata as any)?.flight?.departureAirport ||
      null;

    if (!airport) return null;
    if (typeof airport === "string") return airport.trim() || null;
    if (typeof airport === "object") {
      const a = airport as Record<string, any>;
      return String(a.shortLabel || a.label || a.iataCode || a.airport || a.airportName || a.city || "").trim() || null;
    }
    return null;
  })();

  const roots = [packageSnapshot, (metadata as any)?.packageSnapshot, (metadata as any)?.tourPackage, (metadata as any)?.package]
    .filter((v) => v && typeof v === "object") as any[];
  const meetingPoints = (() => {
    const raw = roots.find((r) => r?.meetingPoints || r?.meetingPoint || r?.departurePoint);
    return listify(raw?.meetingPoints || raw?.meetingPoint || raw?.departurePoint || airportMeetingPoint);
  })();

  const pickupValidation = item?.pickupValidation && typeof item.pickupValidation === "object"
    ? item.pickupValidation
    : metadata?.pickupValidation && typeof metadata.pickupValidation === "object"
      ? metadata.pickupValidation
      : null;
  const pickupValidationOperator = metadata?.pickupValidationOperator && typeof metadata.pickupValidationOperator === "object"
    ? metadata.pickupValidationOperator
    : null;
  const pickupValidationCustomer = metadata?.pickupValidationCustomer && typeof metadata.pickupValidationCustomer === "object"
    ? metadata.pickupValidationCustomer
    : null;
  const pickupValidated = Boolean(
    pickupValidation?.validated ||
    pickupValidation?.firstMeetValidated ||
    pickupValidationOperator?.validated ||
    pickupValidationOperator?.validatedAt ||
    item?.pickupTimeline?.validatedAt ||
    metadata?.pickupTimeline?.validatedAt
  );
  const customerPickupConfirmed = Boolean(pickupValidationCustomer?.validated || pickupValidationCustomer?.validatedAt);
  const timelineTeam = item?.timelineTeam && typeof item.timelineTeam === "object" ? item.timelineTeam : {};
  const timelineIsOwner = Boolean(item?.timelineIsOwner || item?.timelineAccessRole === "OWNER");
  const timelineParticipantCount = Array.isArray(metadata?.timelineParticipants) ? metadata.timelineParticipants.length : 0;
  const timelineJoinedTotal = Math.max(1, Number(timelineTeam.joinedTotal || timelineParticipantCount + 1));
  const timelineTotalTravellers = Math.max(1, Number(timelineTeam.totalTravellers || item?.travelerCount || timelineJoinedTotal));
  const canStartPickup = timelineIsOwner && !pickupValidated && !customerPickupConfirmed && ["PAID_PACKAGES", "ACTIVE_TIMELINE", "IN_PROGRESS"].includes(String(item?.dashboardBucket || ""));
  const validationAirport = (meetingPoints[0] || airportMeetingPoint || "your selected airport").toString();
  const pickupCodeSuffix = String((metadata as any)?.pickupCheckIn?.codeSuffix || item?.bookingCode || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase();
  const validatedAtRaw = String(
    pickupValidationOperator?.validatedAt ||
    pickupValidation?.validatedAt ||
    item?.pickupTimeline?.validatedAt ||
    ""
  ).trim();
  const validatedAtText = validatedAtRaw ? new Date(validatedAtRaw).toLocaleString() : null;
  const timelineCompletion = item?.timelineCompletion && typeof item.timelineCompletion === "object" ? item.timelineCompletion : null;
  const timelineCompleted = Boolean(timelineCompletion?.isComplete || item?.timelineCompletionStatus === "COMPLETED_TIMELINE");
  const operatorPublicKey = String(item?.operatorPublicKey || "").trim().toLowerCase();
  const operatorName = firstText(
    (operatorSnapshot as any)?.companyName,
    (operatorSnapshot as any)?.name,
    (packageSnapshot as any)?.operatorName,
    "Approved Tour Operator"
  );
  const marketingPath = /^[a-z0-9]{20,40}$/.test(operatorPublicKey)
    ? withMarketingSource(
        `/public/tour-packages/operators/${operatorPublicKey}/submitted-profile/${slugifyProfile(operatorName)}`
      )
    : withMarketingSource("/public/tour-packages");

  if (loading) {
    return (
      <div className="w-full min-w-0 space-y-5" aria-busy="true">
        <span role="status" className="sr-only">Loading your itinerary</span>
        <div className="h-9 w-32 rounded-full bg-slate-200" />
        <div className="h-60 rounded-3xl bg-[#02665e]/15" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="h-96 rounded-3xl border border-solid border-slate-200 bg-white" />
          <div className="h-64 rounded-3xl border border-solid border-slate-200 bg-white" />
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="w-full min-w-0 space-y-5">
        <Link
          href={`/account/tour-packages/${encodeURIComponent(String(id))}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 no-underline hover:border-[#02665e] hover:text-[#02665e]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to trip
        </Link>
        <div role="alert" className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
          {error || "We could not find this itinerary."}
        </div>
      </div>
    );
  }

  // ── Presentation model ────────────────────────────────────────────────
  const dayStartMs = (value: string | number | Date) => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const tripStart = item?.startDate ? dayStartMs(item.startDate) : null;
  const todayIndex = tripStart != null ? Math.round((dayStartMs(Date.now()) - tripStart) / 86_400_000) + 1 : null;
  const dateForDay = (dayNumber: number) =>
    tripStart != null
      ? new Date(tripStart + (dayNumber - 1) * 86_400_000).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })
      : null;
  const totalDays = detailedItinerary.length;
  const liveDay = pickupValidated && !timelineCompleted && todayIndex != null && todayIndex >= 1 && todayIndex <= Math.max(totalDays, 1) ? todayIndex : null;
  const detailHref = `/account/tour-packages/${encodeURIComponent(String(id))}`;
  // The trip page (payment, voucher, documents) belongs to the booking owner.
  // A traveller who joined by invite goes back to My tours, where the trip
  // appears under "Shared with you".
  const backHref = timelineIsOwner ? detailHref : "/account/tour-packages";
  const backLabel = timelineIsOwner ? "Back to trip" : "My tours";

  const stepState = (step: 1 | 2 | 3): "done" | "current" | "upcoming" => {
    if (step === 1) return pickupValidated ? "done" : "current";
    if (step === 2) return timelineCompleted ? "done" : pickupValidated ? "current" : "upcoming";
    return timelineCompleted ? "current" : "upcoming";
  };
  const steps = [
    {
      n: 1 as const,
      title: "Meet your operator",
      text: pickupValidated
        ? `Validated${validatedAtText ? ` ${validatedAtText}` : ""}`
        : customerPickupConfirmed
          ? "Your confirmation is recorded. The operator still validates."
          : `At ${validationAirport}`,
    },
    {
      n: 2 as const,
      title: "Follow your days",
      text: timelineCompleted
        ? "All days completed"
        : !pickupValidated
          ? "Unlocks after the meetup"
          : totalDays === 0
            ? "Waiting for the operator's plan"
            : liveDay
              ? `Day ${liveDay} of ${totalDays}`
              : `${totalDays} day${totalDays === 1 ? "" : "s"} planned`,
    },
    {
      n: 3 as const,
      title: "Rate and recommend",
      text: timelineCompleted ? "Tell others about this tour" : "Opens when the tour ends",
    },
  ];

  // Manifest values. A manifest is a document, so it uses the house document
  // font (Trebuchet MS), like the voucher and receipts.
  const DOC_FONT = '"Trebuchet MS", Trebuchet, Arial, sans-serif';
  // Security-paper background: interlaced fine waves (a light guilloche), like
  // the printed ground of a passport page, in faint brand green.
  const GUILLOCHE = `url("data:image/svg+xml,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='36' viewBox='0 0 120 36'>" +
      "<g fill='none' stroke='#02665e' stroke-width='0.8'>" +
      "<path stroke-opacity='0.07' d='M0 18 Q15 4 30 18 T60 18 T90 18 T120 18'/>" +
      "<path stroke-opacity='0.05' d='M0 18 Q15 32 30 18 T60 18 T90 18 T120 18'/>" +
      "<path stroke-opacity='0.04' d='M0 6 Q15 -8 30 6 T60 6 T90 6 T120 6'/>" +
      "<path stroke-opacity='0.04' d='M0 30 Q15 44 30 30 T60 30 T90 30 T120 30'/>" +
      "</g></svg>",
  )}")`;
  const HATCH = "repeating-linear-gradient(135deg, rgba(2,102,94,0.06) 0 1px, transparent 1px 7px)";
  const longDate = (value: number | string | null | undefined) =>
    value == null ? null : new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  const departsText = longDate(tripStart) || "To confirm";
  const returnsText = item?.endDate
    ? longDate(item.endDate)
    : tripStart != null && totalDays > 0
      ? longDate(tripStart + (totalDays - 1) * 86_400_000)
      : null;
  const stamp = timelineCompleted
    ? { label: "Completed", sub: "Tour finished", tone: "#475569" }
    : pickupValidated
      ? { label: "Validated", sub: validatedAtRaw ? new Date(validatedAtRaw).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : "Meetup done", tone: "#02665e" }
      : customerPickupConfirmed
        ? { label: "Confirmed", sub: "Awaiting operator", tone: "#0369a1" }
        : { label: "Pending", sub: "Awaiting meetup", tone: "#b45309" };
  // Completion date for the seal: the recorded completion, else the last day.
  const completedOnRaw =
    (timelineCompletion as any)?.completedAt ||
    (item as any)?.completedAt ||
    item?.endDate ||
    (tripStart != null && totalDays > 0 ? tripStart + (totalDays - 1) * 86_400_000 : null);
  const completedOnText = completedOnRaw
    ? new Date(completedOnRaw).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()
    : null;
  const dayState = (dayNumber: number): "done" | "today" | "next" =>
    timelineCompleted || (liveDay != null && dayNumber < liveDay) ? "done" : liveDay === dayNumber ? "today" : "next";

  return (
    <div id="tour-timeline-page" className="w-full min-w-0 space-y-5">
      <style>{"#tour-timeline-page, #tour-timeline-page * { box-sizing: border-box; }"}</style>

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={backHref}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 no-underline shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-[#02665e] hover:text-[#02665e]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </Link>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
          <Users className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
          {timelineIsOwner ? "Trip owner" : "Traveller"} · {timelineJoinedTotal}/{timelineTotalTravellers} connected
        </span>
      </div>

      {/* ── Itinerary manifest ── */}
      <section
        aria-label="Itinerary manifest"
        className="overflow-hidden rounded-3xl border border-solid border-[#d7e6e3] shadow-[0_2px_8px_rgba(2,102,94,0.06),0_18px_44px_-22px_rgba(2,102,94,0.3)]"
        style={{ fontFamily: DOC_FONT, backgroundColor: "#fbfdfc", backgroundImage: GUILLOCHE }}
      >
        {/* Document header: the issuing band, tinted and finely hatched */}
        <div
          className="flex items-center justify-between gap-3 border-0 border-b border-solid border-[#d7e6e3] px-5 py-3.5 sm:px-7"
          style={{ backgroundColor: "#eef7f5", backgroundImage: HATCH }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/NoLS2025-04.png" alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-contain" style={{ background: "#edf7f6" }} />
            <div className="min-w-0 leading-none">
              <div className="text-[13px] font-black tracking-wide text-[#024d47]">NoLSAF</div>
              <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.22em] text-[#8aaca9]">Itinerary manifest</div>
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-[8.5px] font-bold uppercase tracking-[0.2em] text-[#8aaca9]">Manifest no.</div>
            <div className="truncate font-mono text-[11.5px] font-bold text-[#1e3a38]">{item.bookingCode}</div>
          </div>
        </div>

        {/* Tour + stamp */}
        <div className={`relative px-5 pb-5 pt-5 sm:px-7 ${timelineCompleted ? "min-h-[124px] sm:min-h-[146px]" : ""}`}>
          {/* Watermark, clipped in its own layer so the stamp above is never cut */}
          <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden sm:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/NoLS2025-04.png" alt="" className="absolute -bottom-10 right-44 h-44 w-44 select-none object-contain opacity-[0.06]" />
          </div>
          <div className="relative min-w-0 pr-28 sm:pr-40">
            <p className="m-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[#8aaca9]">Tour</p>
            <h1 className="m-0 mt-1 break-words text-[22px] font-black leading-tight tracking-tight text-[#0f2e2b] sm:text-[28px]">{item.title}</h1>
            <p className="m-0 mt-1 text-[12.5px] font-medium text-[#5a9990]">
              {[item?.destination ? `${item.destination}, Tanzania` : null, operatorName && operatorName !== "Approved Tour Operator" ? `Operated by ${operatorName}` : null].filter(Boolean).join(" · ") || "NoLSAF tour package"}
            </p>
          </div>
          {timelineCompleted ? (
            /* Completion seal: a round official stamp pressed onto the finished
               manifest. Ring text runs along a circle; the centre carries the
               check, the word and the completion date. */
            <svg
              viewBox="0 0 120 120"
              role="img"
              aria-label={`Tour completed${completedOnText ? ` on ${completedOnText}` : ""}`}
              className="absolute right-4 top-4 z-10 h-[92px] w-[92px] -rotate-[8deg] overflow-visible drop-shadow-[0_2px_4px_rgba(2,102,94,0.12)] sm:right-7 sm:top-3 sm:h-[118px] sm:w-[118px]"
              style={{ color: "#02665e" }}
            >
              <defs>
                {/* Ring text runs on a circle between the outer rings and the inner disc */}
                <path id="manifest-seal-ring" d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0" />
              </defs>
              <circle cx="60" cy="60" r="58" fill="rgba(255,255,255,0.92)" stroke="currentColor" strokeWidth="3" />
              <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="0.9" />
              <circle cx="60" cy="60" r="39" fill="rgba(2,102,94,0.05)" stroke="currentColor" strokeWidth="1.3" />
              <text fill="currentColor" fontSize="8.4" fontWeight="800" letterSpacing="1.2" style={{ fontFamily: DOC_FONT }}>
                <textPath href="#manifest-seal-ring" startOffset="0" textLength="282" lengthAdjust="spacing">
                  NOLSAF • TOUR COMPLETED • VERIFIED •
                </textPath>
              </text>
              {/* Centre: check, word, date, each inside the inner disc */}
              <path d="M47 51 l8.5 8.5 l17.5 -18" fill="none" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
              <text x="60" y="73.5" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="900" letterSpacing="1.1" style={{ fontFamily: DOC_FONT }}>
                COMPLETED
              </text>
              {completedOnText ? (
                <text x="60" y="83" textAnchor="middle" fill="currentColor" fontSize="6" fontWeight="700" letterSpacing="0.5" style={{ fontFamily: DOC_FONT, opacity: 0.85 }}>
                  {completedOnText}
                </text>
              ) : null}
            </svg>
          ) : (
            /* Rubber stamp: the meetup state at a glance */
            <div
              className="absolute right-5 top-5 -rotate-6 rounded-lg px-3 py-1.5 text-center sm:right-7"
              style={{ border: `2px solid ${stamp.tone}`, boxShadow: `inset 0 0 0 2px #fff, inset 0 0 0 3px ${stamp.tone}`, color: stamp.tone }}
            >
              <div className="text-[13px] font-black uppercase leading-none tracking-[0.16em] sm:text-[15px]">{stamp.label}</div>
              <div className="mt-1 text-[8px] font-bold uppercase tracking-[0.14em] opacity-80">{stamp.sub}</div>
            </div>
          )}
        </div>

        {/* Ruled fields */}
        <dl className="m-0 grid grid-cols-2 border-0 border-t border-solid border-[#d7e6e3] bg-white/60 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Departs", value: departsText },
            { label: "Returns", value: returnsText || "To confirm" },
            { label: "Duration", value: totalDays ? `${totalDays} day${totalDays === 1 ? "" : "s"}` : "Not shared" },
            { label: "Travellers", value: `${timelineJoinedTotal} of ${timelineTotalTravellers}`, sub: "connected" },
            { label: "Meeting point", value: validationAirport },
            { label: "Meetup", value: pickupValidated ? (validatedAtText || "Validated") : customerPickupConfirmed ? "You confirmed" : "Pending" },
          ].map((field) => (
            <div key={field.label} className="min-w-0 border-0 border-b border-r border-solid border-[#d7e6e3] px-5 py-3 sm:px-7 lg:px-5">
              <dt className="text-[8.5px] font-bold uppercase tracking-[0.2em] text-[#8aaca9]">{field.label}</dt>
              <dd className="m-0 mt-1 truncate text-[13px] font-bold text-[#1e3a38]" title={field.value}>
                {field.value}
                {field.sub ? <span className="ml-1 text-[11px] font-medium text-[#8aaca9]">{field.sub}</span> : null}
              </dd>
            </div>
          ))}
        </dl>

        {/* Route */}
        <div className="px-5 py-5 sm:px-7">
          <p className="m-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[#8aaca9]">Route</p>
          {totalDays ? (
            <ol className="m-0 mt-3 flex list-none gap-0 overflow-x-auto p-0 pb-1 [scrollbar-width:thin]">
              {detailedItinerary.map((day, index) => {
                const state = dayState(day.day);
                return (
                  <li key={`route-${day.day}`} className="relative flex min-w-[9.5rem] flex-1 flex-col items-start pr-4">
                    {index < detailedItinerary.length - 1 ? (
                      <span aria-hidden className="absolute left-7 right-0 top-[13px] border-0 border-t-2 border-dashed" style={{ borderColor: state === "done" ? "#02665e" : "#d0e8e5" }} />
                    ) : null}
                    <span
                      className="relative inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black"
                      style={
                        state === "done"
                          ? { background: "#02665e", color: "#fff" }
                          : state === "today"
                            ? { background: "#fff", color: "#02665e", boxShadow: "0 0 0 2px #02665e, 0 0 0 6px rgba(2,102,94,0.14)" }
                            : { background: "#f7fbfa", color: "#8aaca9", boxShadow: "inset 0 0 0 1.5px #d0e8e5" }
                      }
                    >
                      {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : day.day}
                    </span>
                    <span className="mt-2 text-[8.5px] font-bold uppercase tracking-[0.18em]" style={{ color: state === "today" ? "#02665e" : "#8aaca9" }}>
                      {state === "today" ? "Today" : `Day ${day.day}`}{dateForDay(day.day) ? ` · ${dateForDay(day.day)}` : ""}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[12.5px] font-bold leading-snug text-[#1e3a38]">{day.title}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="m-0 mt-2 text-[12.5px] text-[#5a9990]">The operator has not shared the day-by-day route yet.</p>
          )}
        </div>

        {/* Checkpoints */}
        <div
          className="flex flex-col gap-3 border-0 border-t border-solid border-[#d7e6e3] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-7"
          style={{ backgroundColor: "#eef7f5", backgroundImage: HATCH }}
        >
          <ol className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-2 p-0">
            {steps.map((step) => {
              const state = stepState(step.n);
              return (
                <li key={step.n} className="inline-flex items-center gap-1.5 text-[12px]" title={step.text}>
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full"
                    style={
                      state === "done"
                        ? { background: "#02665e", color: "#fff" }
                        : state === "current"
                          ? { boxShadow: "inset 0 0 0 2px #02665e" }
                          : { boxShadow: "inset 0 0 0 1.5px #c9d8d6" }
                    }
                  >
                    {state === "done" ? <Check className="h-2.5 w-2.5" aria-hidden /> : state === "current" ? <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" /> : null}
                  </span>
                  <span className={state === "upcoming" ? "font-semibold text-[#9ab8b6]" : "font-bold text-[#1e3a38]"}>{step.title}</span>
                  {state === "current" ? <span className="text-[#5a9990]">· {step.text}</span> : null}
                </li>
              );
            })}
          </ol>
          {!pickupValidated && canStartPickup ? (
            <button
              type="button"
              onClick={() => {
                if (pickupLoading) return;
                setPickupPolicyAgreed(false);
                setPickupError(null);
                setPickupJustValidated(false);
                setShowPickupValidateModal(true);
              }}
              style={{ fontFamily: DOC_FONT, background: "linear-gradient(135deg,#024d47,#02665e)" }}
              className="inline-flex h-9 flex-shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border-0 px-4 text-[13px] font-bold text-white"
            >
              <MapPin className="h-4 w-4" aria-hidden />
              Validate meetup
            </button>
          ) : null}
        </div>
      </section>

      {pickupMessage ? (
        <div role="status" className="rounded-2xl border border-solid border-[#02665e]/25 bg-[#02665e]/5 px-4 py-3 text-[13px] text-slate-700">{pickupMessage}</div>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        {/* ── Itinerary ── */}
        <section className="min-w-0 rounded-3xl border border-solid border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="m-0 text-[16px] font-bold text-slate-900">
                Day by day
                {totalDays ? <span className="ml-2 text-[12.5px] font-medium text-slate-500">{totalDays} day{totalDays === 1 ? "" : "s"} · {detailedItinerary.reduce((sum, d) => sum + d.slots.length, 0)} stops</span> : null}
              </h2>
              <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">
                {pickupValidated ? "Rate each stop as you go. Your group sees the team average." : "Your full plan appears once the meetup is validated."}
              </p>
            </div>
            <div
              title="This plan is kept on record with your booking and followed live here. If the trip differs from it, NoLSAF steps in."
              className="flex max-w-full items-center gap-1.5 rounded-full bg-[#02665e]/[0.07] py-0.5 pl-0.5 pr-2.5 ring-1 ring-inset ring-[#02665e]/15"
            >
              <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-white">
                <ShieldCheck className="h-3 w-3" aria-hidden />
              </span>
              <span className="text-[11.5px] font-semibold text-[#024d47]">Protected by NoLSAF</span>
              <span className="hidden text-[11px] text-[#02665e]/70 sm:inline">· tracked live</span>
            </div>
          </div>

          {/* Day navigator: jump to any day, or straight to what is happening now */}
          {pickupValidated && detailedItinerary.length > 1 ? (
            // Not sticky: the account layout's overflow-x-hidden wrappers disable position:sticky.
            // The floating Days button takes over once this bar scrolls away.
            <div id="trip-day-nav" className="mb-4 flex items-center gap-3 rounded-2xl bg-slate-50 px-2 py-2 ring-1 ring-inset ring-slate-200/70">
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {liveDay != null ? (
                  <button
                    type="button"
                    onClick={() => document.getElementById(`trip-day-${liveDay}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="inline-flex h-8 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-[#02665e] px-3 text-[12.5px] font-bold text-white shadow-sm"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    Jump to now
                  </button>
                ) : null}
                {detailedItinerary.map((d) => {
                  const done = timelineCompleted || (liveDay != null && d.day < liveDay);
                  const today = liveDay === d.day;
                  return (
                    <button
                      key={`nav-${d.day}`}
                      type="button"
                      title={d.title}
                      onClick={() => document.getElementById(`trip-day-${d.day}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className={[
                        "inline-flex h-8 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-solid pl-3 pr-1 text-[12.5px] font-semibold transition-colors",
                        today ? "border-[#02665e] bg-[#02665e]/[0.07] text-[#02665e]" : done ? "border-slate-200 bg-slate-50 text-slate-400" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                      ].join(" ")}
                    >
                      {done ? <Check className="h-3.5 w-3.5 text-[#02665e]" strokeWidth={3} aria-hidden /> : null}
                      Day {d.day}
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10.5px] font-bold tabular-nums text-slate-500">{d.slots.length}</span>
                    </button>
                  );
                })}
              </div>
              <div className="hidden flex-shrink-0 items-center gap-3 text-[11px] text-slate-500 xl:flex">
                {[timeOfDay(8 * 60), timeOfDay(13 * 60), timeOfDay(19 * 60)].map((part) => (
                  <span key={part.label} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: part.hex }} />{part.label}</span>
                ))}
              </div>
            </div>
          ) : null}

          {timelineActionMessage ? (
            <div role="status" className="mb-4 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">{timelineActionMessage}</div>
          ) : null}

          {!pickupValidated ? (
            // Locked: what unlocks the plan, as three steps, with the action right here for the owner
            <div className="overflow-hidden rounded-2xl border border-solid border-slate-200">
              <div className="flex items-center gap-3 bg-slate-50 px-4 py-3.5 sm:px-5">
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                  <Lock className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="text-[15px] font-bold text-slate-900">Your plan opens at the meetup</div>
                  <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">
                    {customerPickupConfirmed
                      ? "Your confirmation is recorded. It opens as soon as the operator validates too."
                      : timelineIsOwner
                        ? "Validating the meetup starts your trip and unlocks every day."
                        : "The trip owner validates the meetup to unlock the plan for everyone."}
                  </p>
                </div>
              </div>
              <ol className="m-0 grid list-none gap-0 p-0 sm:grid-cols-3">
                {[
                  { title: "Arrive", text: validationAirport, Icon: MapPin },
                  { title: "Meet your operator", text: "Show your meetup code", Icon: Users },
                  { title: "Validate", text: "Your day-by-day plan opens", Icon: CheckCircle2 },
                ].map(({ title, text, Icon }, i) => (
                  <li key={title} className={`flex items-start gap-2.5 px-4 py-3 sm:px-5 ${i ? "border-0 border-t border-solid border-slate-100 sm:border-l sm:border-t-0" : ""}`}>
                    <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-[#02665e] ring-1 ring-slate-200">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 leading-tight">
                      <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400">Step {i + 1}</div>
                      <div className="text-[13px] font-semibold text-slate-900">{title}</div>
                      <div className="truncate text-[11.5px] text-slate-500" title={text}>{text}</div>
                    </div>
                  </li>
                ))}
              </ol>
              {timelineIsOwner && canStartPickup && !customerPickupConfirmed ? (
                <div className="border-0 border-t border-solid border-slate-100 px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    onClick={() => {
                      if (pickupLoading) return;
                      setPickupPolicyAgreed(false);
                      setPickupError(null);
                      setPickupJustValidated(false);
                      setShowPickupValidateModal(true);
                    }}
                    className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] text-[14px] font-bold text-white hover:bg-[#014d47] sm:w-auto sm:px-6"
                  >
                    <MapPin className="h-4 w-4" aria-hidden />
                    I am with my operator, validate
                  </button>
                </div>
              ) : null}
            </div>
          ) : !detailedItinerary.length ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <CalendarDays className="h-5 w-5" aria-hidden />
              </span>
              <div className="mt-3 text-[15px] font-bold text-slate-900">No itinerary shared yet</div>
              <p className="m-0 mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">
                {operatorName} has not uploaded a day-by-day plan for this package.{" "}
                {timelineIsOwner ? "You can ask for it from your trip page." : "The trip owner can ask the operator for it."}
              </p>
            </div>
          ) : (
            // One stop per day on a spine. Inside, each activity sits on a rail
            // marked by time of day, with its place in the day drawn underneath.
            // On the live day, finished stops tick off and the current one glows.
            <ol className="m-0 list-none p-0">
              {detailedItinerary.map((day, dayIdx) => {
                const isToday = liveDay === day.day;
                const isPast = timelineCompleted || (liveDay != null && day.day < liveDay);
                const lastDay = dayIdx === detailedItinerary.length - 1;
                const date = dateForDay(day.day);
                const rated = day.slots
                  .map((_, slotIdx) => teamRatings[`${day.day}-${slotIdx}`])
                  .filter((rating): rating is TeamRatingSummary => Boolean(rating?.count));
                const dayAverage = rated.length ? rated.reduce((sum, rating) => sum + rating.average, 0) / rated.length : null;
                const ranges = day.slots.map((slot) => slotRange(slot.time));
                const firstStart = ranges.find((r) => r.startLabel)?.startLabel || "";
                const lastEnd = [...ranges].reverse().find((r) => r.endLabel || r.startLabel);
                const span = firstStart ? [firstStart, lastEnd?.endLabel || ""].filter(Boolean).join(" to ") : "";
                return (
                  <li key={`day-${day.day}-${day.title}`} id={`trip-day-${day.day}`} className="relative min-w-0 scroll-mt-[calc(var(--header-height,4rem)+1rem)] pb-5 pl-14 sm:pl-16">
                    {/* Spine to the next day */}
                    {!lastDay ? (
                      <span aria-hidden className={`absolute bottom-0 left-[21px] top-12 w-0.5 sm:left-[23px] ${isPast ? "bg-[#02665e]/40" : "bg-[repeating-linear-gradient(to_bottom,#cbd5e1_0_6px,transparent_6px_11px)]"}`} />
                    ) : null}
                    {/* Day marker: done, today or ahead */}
                    <span
                      className={[
                        "absolute left-0 top-0 flex h-11 w-11 flex-col items-center justify-center rounded-2xl sm:h-12 sm:w-12",
                        isPast ? "bg-slate-100 text-slate-500 ring-1 ring-slate-200" : "bg-[#02665e] text-white shadow-[0_8px_18px_-10px_rgba(2,102,94,0.8)]",
                        isToday ? "ring-4 ring-[#02665e]/15" : "",
                      ].join(" ")}
                    >
                      {isPast ? (
                        <Check className="h-5 w-5" strokeWidth={3} aria-hidden />
                      ) : (
                        <>
                          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/70">Day</span>
                          <span className="text-[17px] font-black leading-none tabular-nums">{String(day.day).padStart(2, "0")}</span>
                        </>
                      )}
                    </span>

                    <div className={`min-w-0 overflow-hidden rounded-2xl border border-solid bg-white ${isToday ? "border-[#02665e] shadow-[0_0_0_3px_rgba(2,102,94,0.10)]" : "border-slate-200 shadow-sm"}`}>
                      {/* Preflight is off: dividers and directional borders need border-solid to render. */}
                      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-3.5 sm:px-5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={`text-[11px] font-black uppercase tracking-[0.14em] ${isPast ? "text-slate-400" : "text-[#02665e]"}`}>Day {day.day}</span>
                            {date ? <span className="text-[12px] text-slate-400">{date}</span> : null}
                            {isToday ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#02665e] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                                Today
                              </span>
                            ) : null}
                            {isPast ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Done</span> : null}
                          </div>
                          <h3 className={`m-0 mt-1 text-[16px] font-bold leading-snug ${isPast ? "text-slate-600" : "text-slate-900"}`}>{day.title}</h3>
                          {day.description ? <p className="m-0 mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-slate-500">{day.description}</p> : null}
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1">
                          {dayAverage != null ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-900">
                              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                              {dayAverage.toFixed(1)}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                            <Clock3 className="h-3 w-3" aria-hidden />
                            {[span, `${day.slots.length} stop${day.slots.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                      </div>

                      <ol className="m-0 list-none border-0 border-t border-solid border-slate-100 bg-slate-50/50 px-3 py-3 sm:px-5">
                        {day.slots.map((slot, slotIdx) => {
                          const ratingKey = `${day.day}-${slotIdx}`;
                          const savedRating = eventRatings[ratingKey] || 0;
                          const savedOption = EVENT_RATING_OPTIONS.find((option) => option.value === savedRating);
                          const teamRating = teamRatings[ratingKey] || null;
                          const range = ranges[slotIdx];
                          const part = timeOfDay(range.start);
                          const nextPart = timeOfDay(ranges[slotIdx + 1]?.start ?? null);
                          const lastSlot = slotIdx === day.slots.length - 1;
                          // Live state on today: finished, happening now, or still ahead
                          const slotEnd = range.end ?? ranges[slotIdx + 1]?.start ?? null;
                          const done = isPast || (isToday && slotEnd != null && nowMinutes >= slotEnd);
                          const now = isToday && !done && range.start != null && nowMinutes >= range.start;
                          const length = range.start != null && range.end != null && range.end > range.start ? durationLabel(range.end - range.start) : "";
                          return (
                            <li key={`slot-${day.day}-${slotIdx}`} className="relative grid grid-cols-[3.75rem_1.75rem_minmax(0,1fr)] items-start gap-x-2 sm:grid-cols-[4.75rem_1.75rem_minmax(0,1fr)]">
                              {/* Time */}
                              <div className="pt-2 text-right leading-tight">
                                <div className={`text-[13px] font-bold tabular-nums sm:text-[13.5px] ${done ? "text-slate-400" : "text-slate-900"}`}>{range.startLabel || "Anytime"}</div>
                                {range.endLabel ? <div className="text-[10.5px] tabular-nums text-slate-400 sm:text-[11px]">to {range.endLabel}</div> : null}
                              </div>
                              {/* Rail */}
                              <div className="relative flex h-full justify-center">
                                {!lastSlot ? (
                                  <span
                                    aria-hidden
                                    className="absolute -bottom-2 top-8 w-0.5 rounded-full"
                                    style={{ background: done ? "#02665e" : `linear-gradient(to bottom, ${part.hex}, ${nextPart.hex})`, opacity: done ? 0.45 : 0.6 }}
                                  />
                                ) : null}
                                <span
                                  title={done ? "Done" : now ? "Happening now" : part.label}
                                  className={`relative mt-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-solid shadow-[0_4px_10px_-4px_rgba(15,23,42,0.35)] ${done ? "bg-[#02665e]" : "bg-white"}`}
                                  style={{ borderColor: done ? "#02665e" : part.hex }}
                                >
                                  {now ? <span aria-hidden className="absolute inset-0 animate-ping rounded-full" style={{ backgroundColor: `${part.hex}55` }} /> : null}
                                  {done ? (
                                    <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden />
                                  ) : (
                                    <part.Icon className="relative h-3.5 w-3.5" style={{ color: part.hex }} strokeWidth={2.4} aria-hidden />
                                  )}
                                </span>
                              </div>
                              {/* Activity */}
                              <div className={`min-w-0 ${lastSlot ? "" : "pb-2.5"}`}>
                                <div className={`rounded-xl px-3 py-2 sm:px-3.5 sm:py-2.5 ${now ? "bg-white ring-2 ring-[#02665e]/40" : done ? "bg-white/70 ring-1 ring-slate-200/70" : "bg-white ring-1 ring-slate-200/80"}`}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className={`text-[14px] font-semibold leading-snug ${done ? "text-slate-500" : "text-slate-900"}`}>{slot.title || "Activity"}</span>
                                        {now ? <span className="rounded-full bg-[#02665e] px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.08em] text-white">Now</span> : null}
                                      </div>
                                      {slot.description ? <p className="m-0 mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{slot.description}</p> : null}
                                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        {range.start != null ? (
                                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-semibold" style={{ backgroundColor: `${part.hex}14`, color: part.hex }}>
                                            <part.Icon className="h-3 w-3" aria-hidden />
                                            {part.label}
                                          </span>
                                        ) : null}
                                        {length ? <span className="rounded-full bg-slate-100 px-2 py-px text-[10.5px] font-semibold tabular-nums text-slate-600">{length}</span> : null}
                                        {slot.experienceVibe ? <span className="rounded-full bg-amber-50 px-2 py-px text-[10.5px] font-semibold text-amber-800">{slot.experienceVibe}</span> : null}
                                      </div>
                                    </div>
                                    {/* Your rating */}
                                    <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                                      {savedRating ? (
                                        <>
                                          <span className="flex items-center gap-0.5" role="img" aria-label={`You rated ${savedRating} of 5${savedOption ? `, ${savedOption.label}` : ""}`}>
                                            {Array.from({ length: 5 }).map((_, idx) => (
                                              <Star key={idx} className={`h-3.5 w-3.5 ${idx < savedRating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} aria-hidden />
                                            ))}
                                          </span>
                                          <span className="text-[11px] text-slate-400">
                                            {savedOption?.label || `${savedRating}/5`}
                                            {teamRating && teamRating.count > 1 ? ` · team ${teamRating.average.toFixed(1)}` : ""}
                                          </span>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => openRating(day, slot, ratingKey)}
                                            className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-solid border-slate-300 bg-white px-3 text-[12px] font-bold text-slate-700 transition-colors hover:border-amber-400 hover:text-amber-700"
                                          >
                                            <Star className="h-3.5 w-3.5" aria-hidden />
                                            Rate
                                          </button>
                                          {teamRating?.count ? <span className="text-[11px] text-slate-400">team {teamRating.average.toFixed(1)}</span> : null}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  {/* Where this sits in the day: a 06:00 to 22:00 ruler */}
                                  {range.start != null ? (() => {
                                    const from = 6 * 60;
                                    const total = 16 * 60;
                                    const left = Math.min(100, Math.max(0, ((range.start - from) / total) * 100));
                                    const width = range.end != null && range.end > range.start ? Math.max(2, Math.min(100 - left, ((range.end - range.start) / total) * 100)) : 2;
                                    const nowAt = isToday ? Math.min(100, Math.max(0, ((nowMinutes - from) / total) * 100)) : null;
                                    return (
                                      <div className="mt-2 flex items-center gap-2" aria-hidden>
                                        <span className="text-[9.5px] tabular-nums text-slate-300">06</span>
                                        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                          {[25, 50, 75].map((tick) => <span key={tick} className="absolute top-0 h-full w-px bg-white" style={{ left: `${tick}%` }} />)}
                                          <span className="absolute top-0 h-full rounded-full" style={{ left: `${left}%`, width: `${width}%`, backgroundColor: done ? "#02665e" : part.hex, opacity: done ? 0.5 : 1 }} />
                                          {nowAt != null ? <span className="absolute top-0 h-full w-0.5 bg-slate-900" style={{ left: `${nowAt}%` }} /> : null}
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
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* ── Side column ── */}
        <aside className="min-w-0 space-y-5">
          <section className="rounded-3xl border border-solid border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <h2 className="m-0 mb-3 text-[15px] font-bold text-slate-900">Trip at a glance</h2>
            <dl className="m-0 divide-y divide-solid divide-slate-200 [&>*]:border-x-0">
              {[
                {
                  label: "Meetup",
                  value: (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${pickupValidated ? "bg-emerald-50 text-emerald-700" : customerPickupConfirmed ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-800"}`}>
                      {pickupValidated ? "Validated" : customerPickupConfirmed ? "You confirmed" : "Waiting"}
                    </span>
                  ),
                },
                { label: "Meeting point", value: validationAirport },
                { label: "Starts", value: item?.startDate ? new Date(item.startDate).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "To confirm" },
                { label: "Travellers", value: `${timelineJoinedTotal} of ${timelineTotalTravellers} connected` },
                { label: "Booking", value: <span className="font-mono text-[12px]">{item.bookingCode}</span> },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                  <dt className="flex-shrink-0 text-[12.5px] text-slate-500">{row.label}</dt>
                  <dd className="m-0 min-w-0 truncate text-right text-[13px] font-semibold text-slate-800">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {pickupValidated && detailedItinerary.length ? (() => {
            // Group mood, told in plain words: overall feeling, how each day
            // went, which way it is trending, the best moment, and what is left
            // to rate. Built only from the team ratings already loaded.
            const totalStops = detailedItinerary.reduce((sum, day) => sum + day.slots.length, 0);
            const rated = ratingJourney.length;
            const unratedByMe = detailedItinerary.reduce(
              (sum, day) => sum + day.slots.filter((_, slotIdx) => !eventRatings[`${day.day}-${slotIdx}`]).length,
              0,
            );
            const moodFor = (value: number) => EVENT_RATING_OPTIONS.find((option) => option.value === Math.round(value))?.label || "";
            const dayScores = detailedItinerary.map((day) => {
              const points = ratingJourney.filter((point) => point.day === day.day);
              return {
                day: day.day,
                title: day.title,
                average: points.length ? points.reduce((sum, point) => sum + point.rating, 0) / points.length : null,
              };
            });
            const scoredDays = dayScores.filter((entry): entry is { day: number; title: string; average: number } => entry.average != null);
            const bestDay = scoredDays.reduce<(typeof scoredDays)[number] | null>((best, entry) => (!best || entry.average > best.average ? entry : best), null);
            const trend = scoredDays.length >= 2 ? scoredDays[scoredDays.length - 1].average - scoredDays[0].average : null;
            return (
              <section className="rounded-3xl border border-solid border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="m-0 text-[15px] font-bold text-slate-900">How it is going</h2>
                  <span className="text-[12px] font-semibold text-slate-400">{rated} of {totalStops} stops rated</span>
                </div>

                {rated ? (
                  <>
                    {/* Overall feeling */}
                    <div className="mt-4 flex items-center gap-4">
                      <span className="text-[40px] font-black leading-none tabular-nums text-slate-900">{ratingAverage.toFixed(1)}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-0.5" aria-hidden>
                          {Array.from({ length: 5 }).map((_, idx) => (
                            <Star key={idx} className={`h-4 w-4 ${idx < Math.round(ratingAverage) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                          ))}
                        </div>
                        <div className="mt-1 text-[13px] font-bold text-slate-800">{moodFor(ratingAverage) || "Team average"}</div>
                        {trend != null && Math.abs(trend) >= 0.1 ? (
                          <div className={`mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-semibold ${trend > 0 ? "text-emerald-700" : "text-amber-700"}`}>
                            <TrendingUp className={`h-3.5 w-3.5 ${trend > 0 ? "" : "rotate-180"}`} aria-hidden />
                            {trend > 0 ? "Up" : "Down"} {Math.abs(trend).toFixed(1)} since Day {scoredDays[0].day}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Day by day */}
                    <ul className="m-0 mt-5 list-none space-y-2.5 p-0">
                      {dayScores.map((entry) => {
                        const isBest = bestDay != null && entry.day === bestDay.day && scoredDays.length > 1;
                        return (
                          <li key={entry.day} className="grid grid-cols-[3.25rem_minmax(0,1fr)_2.25rem] items-center gap-2.5">
                            <span className="text-[12px] font-bold text-slate-600">Day {entry.day}</span>
                            <span className="relative h-2.5 overflow-hidden rounded-full bg-slate-100" title={entry.title}>
                              {entry.average != null ? (
                                <span
                                  className={`absolute inset-y-0 left-0 rounded-full ${isBest ? "bg-[#02665e]" : "bg-[#02665e]/45"}`}
                                  style={{ width: `${(entry.average / 5) * 100}%` }}
                                />
                              ) : null}
                            </span>
                            <span className="text-right text-[12px] font-bold tabular-nums text-slate-800">{entry.average != null ? entry.average.toFixed(1) : "–"}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {bestDay && scoredDays.length > 1 ? (
                      <p className="m-0 mt-2 text-[11.5px] text-slate-500">
                        Best day so far: <span className="font-semibold text-slate-700">Day {bestDay.day}, {bestDay.title}</span>
                      </p>
                    ) : null}

                    {/* Best moment */}
                    {highestRatedPoint ? (
                      <div className="mt-4 flex items-start gap-3 rounded-2xl bg-[#02665e]/[0.06] px-3.5 py-3">
                        <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e] text-white">
                          <Star className="h-4 w-4 fill-current" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#02665e]">Best moment</div>
                          <div className="truncate text-[13.5px] font-bold text-slate-900">{highestRatedPoint.title}</div>
                          <div className="text-[11.5px] text-slate-500">
                            Day {highestRatedPoint.day}{highestRatedPoint.time ? ` · ${highestRatedPoint.time}` : ""} · {highestRatedPoint.rating.toFixed(1)}/5
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {unratedByMe > 0 ? (
                      <p className="m-0 mt-3 text-[12px] text-slate-500">
                        You have <span className="font-semibold text-slate-700">{unratedByMe} {unratedByMe === 1 ? "stop" : "stops"}</span> left to rate.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="m-0 mt-3 rounded-2xl bg-slate-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-slate-500">
                    Rate stops in your itinerary and your group&apos;s mood shows up here, day by day.
                  </p>
                )}
              </section>
            );
          })() : null}

          {timelineCompleted ? (
            <section className="rounded-3xl border border-solid border-[#02665e]/30 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                <Megaphone className="h-5 w-5" aria-hidden />
              </span>
              <h2 className="m-0 mt-3 text-[15px] font-bold text-slate-900">Loved it? Recommend it</h2>
              <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-slate-500">
                Send friends the operator&apos;s public page so they can read reviews and book this same tour.
              </p>
              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={() => shareMarketingViaWhatsApp(marketingPath)}
                  className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-[#02665e] text-[13px] font-bold text-white hover:bg-[#014d47]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                    <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.512 5.26l-.999 3.648 3.476-.911zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                  </svg>
                  Send on WhatsApp
                </button>
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => shareMarketingLink(marketingPath)} className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white text-[12px] font-semibold text-slate-700 hover:border-[#02665e] hover:text-[#02665e]">
                    <Share2 className="h-3.5 w-3.5" aria-hidden />
                    Share
                  </button>
                  <button type="button" onClick={() => copyMarketingLink(marketingPath)} className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white text-[12px] font-semibold text-slate-700 hover:border-[#02665e] hover:text-[#02665e]">
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    Copy
                  </button>
                  <Link href={marketingPath} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white text-[12px] font-semibold text-slate-700 no-underline hover:border-[#02665e] hover:text-[#02665e]">
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    View
                  </Link>
                </div>
              </div>
              {marketingShareMessage ? <p className="m-0 mt-3 text-[12px] font-semibold text-[#02665e]">{marketingShareMessage}</p> : null}
            </section>
          ) : null}
        </aside>
      </div>

      {/* ── Validate meetup: three clear steps, errors stay inside, and a real success state ── */}
      {showPickupValidateModal ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 cursor-default border-0 bg-slate-900/50"
            onClick={() => {
              if (!pickupLoading) setShowPickupValidateModal(false);
            }}
          />
          <div role="dialog" aria-modal="true" aria-labelledby="validate-meetup-title" className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            {pickupJustValidated ? (
              // Success: the trip is now live
              <div className="p-6 text-center">
                <span className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#02665e] text-white shadow-[0_12px_28px_-12px_rgba(2,102,94,0.9)]">
                  <CheckCircle2 className="h-8 w-8" aria-hidden />
                </span>
                <h2 id="validate-meetup-title" className="m-0 mt-4 text-[20px] font-bold text-slate-950">Meetup validated</h2>
                <p className="m-0 mx-auto mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-slate-600">
                  Your trip is live. The day-by-day plan is open, and you can rate each stop as you go.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowPickupValidateModal(false);
                    setPickupJustValidated(false);
                    window.requestAnimationFrame(() => document.getElementById(`trip-day-${detailedItinerary[0]?.day ?? 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
                  }}
                  className="mt-5 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] text-[15px] font-bold text-white hover:bg-[#014d47]"
                >
                  See day 1
                  <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#02665e]">Start your trip</div>
                    <h2 id="validate-meetup-title" className="m-0 mt-0.5 text-[19px] font-bold leading-snug text-slate-950">Validate your meetup</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPickupValidateModal(false)}
                    disabled={pickupLoading}
                    aria-label="Close"
                    className="inline-flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                <ol className="m-0 min-h-0 flex-1 list-none space-y-3 overflow-y-auto px-5 pb-4 pt-1">
                  {/* 1. Where */}
                  <li className="flex gap-3">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-[12px] font-black text-white">1</span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="m-0 text-[14px] font-semibold text-slate-900">Meet your operator</p>
                      <p className="m-0 mt-0.5 flex items-start gap-1.5 text-[12.5px] text-slate-500">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                        {validationAirport}
                      </p>
                    </div>
                  </li>
                  {/* 2. The code, as a ticket stub */}
                  <li className="flex gap-3">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-[12px] font-black text-white">2</span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="m-0 text-[14px] font-semibold text-slate-900">Show them this code</p>
                      <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-[#02665e]/30 bg-[#02665e]/[0.04] px-4 py-3">
                        <span className="font-mono text-[28px] font-black leading-none tracking-[0.24em] text-slate-950">{pickupCodeSuffix || "N/A"}</span>
                        {pickupCodeSuffix ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard?.writeText(pickupCodeSuffix);
                                setPickupCodeCopied(true);
                                window.setTimeout(() => setPickupCodeCopied(false), 1600);
                              } catch {}
                            }}
                            className="inline-flex h-8 flex-shrink-0 cursor-pointer items-center gap-1 rounded-full border border-solid border-[#02665e]/25 bg-white px-3 text-[12px] font-semibold text-[#02665e]"
                          >
                            {pickupCodeCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                            {pickupCodeCopied ? "Copied" : "Copy"}
                          </button>
                        ) : null}
                      </div>
                      <p className="m-0 mt-1 text-[11.5px] text-slate-400">Your operator checks it matches their manifest.</p>
                    </div>
                  </li>
                  {/* 3. Confirm */}
                  <li className="flex gap-3">
                    <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-black ${pickupPolicyAgreed ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"}`}>3</span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p id="meetup-policy-label" className="m-0 text-[14px] font-semibold text-slate-900">You are together now</p>
                          <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-slate-500">
                            I confirm I have met my operator and agree with the{" "}
                            <Link href="/verification-policy" target="_blank" rel="noreferrer" className="font-semibold text-[#02665e]">verification policy</Link>.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={pickupPolicyAgreed}
                          aria-labelledby="meetup-policy-label"
                          disabled={pickupLoading}
                          onClick={() => setPickupPolicyAgreed((prev) => !prev)}
                          className={`relative mt-0.5 inline-flex h-7 w-12 flex-shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors disabled:opacity-60 ${pickupPolicyAgreed ? "bg-[#02665e]" : "bg-slate-300"}`}
                        >
                          <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${pickupPolicyAgreed ? "translate-x-5" : "translate-x-0"}`} />
                        </button>
                      </div>
                    </div>
                  </li>
                </ol>

                {pickupError ? (
                  <div role="alert" className="mx-5 mb-3 rounded-xl border border-solid border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-800">{pickupError}</div>
                ) : null}

                <div className="border-0 border-t border-solid border-slate-100 bg-white px-5 py-3">
                  <button
                    type="button"
                    onClick={validateMeetup}
                    disabled={!pickupPolicyAgreed || pickupLoading || !pickupCodeSuffix}
                    className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] text-[15px] font-bold text-white transition-colors hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    {pickupLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                    {pickupLoading ? "Validating..." : pickupPolicyAgreed ? "Validate and start my trip" : "Confirm step 3 first"}
                  </button>
                  <p className="m-0 mt-2 text-center text-[11.5px] text-slate-400">Only validate when you are with your operator. This unlocks your trip.</p>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Floating day navigator: reachable from anywhere once the tab bar scrolls away ── */}
      {mounted && pickupValidated && detailedItinerary.length > 1 && daysFabVisible ? createPortal(
        <div className="fixed bottom-[calc(76px+env(safe-area-inset-bottom,0px))] left-1/2 z-[60] -translate-x-1/2 md:bottom-6">
          {daysMenuOpen ? (
            <>
              <button type="button" aria-label="Close days" className="fixed inset-0 cursor-default border-0 bg-transparent" onClick={() => setDaysMenuOpen(false)} />
              <div role="menu" className="absolute bottom-full left-1/2 mb-2 w-64 -translate-x-1/2 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_-12px_rgba(15,23,42,0.35)]">
                {liveDay != null ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => goToTripDay(liveDay)}
                    className="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-xl border-0 bg-[#02665e] px-3 py-2 text-left text-[13px] font-bold text-white"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    Jump to now
                  </button>
                ) : null}
                <div className="max-h-64 overflow-y-auto">
                  {detailedItinerary.map((d) => {
                    const done = timelineCompleted || (liveDay != null && d.day < liveDay);
                    const today = liveDay === d.day;
                    return (
                      <button
                        key={`fab-${d.day}`}
                        type="button"
                        role="menuitem"
                        onClick={() => goToTripDay(d.day)}
                        className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl border-0 px-3 py-2 text-left transition-colors ${today ? "bg-[#02665e]/[0.07]" : "bg-transparent hover:bg-slate-50"}`}
                      >
                        <span className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-black tabular-nums ${done ? "bg-slate-100 text-slate-400" : "bg-[#02665e] text-white"}`}>
                          {done ? <Check className="h-3.5 w-3.5 text-[#02665e]" strokeWidth={3} aria-hidden /> : String(d.day).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className={`block truncate text-[13px] font-semibold ${done ? "text-slate-400" : "text-slate-900"}`}>{d.title || `Day ${d.day}`}</span>
                          <span className="block text-[11px] text-slate-400">Day {d.day} · {d.slots.length} stop{d.slots.length === 1 ? "" : "s"}{today ? " · today" : ""}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setDaysMenuOpen((v) => !v)}
            aria-expanded={daysMenuOpen}
            className="relative inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border-0 bg-slate-900 pl-3 pr-4 text-[13px] font-bold text-white shadow-[0_12px_28px_-10px_rgba(15,23,42,0.6)] transition-transform hover:-translate-y-0.5"
          >
            <CalendarDays className="h-4 w-4" aria-hidden />
            {liveDay != null ? `Day ${liveDay} of ${detailedItinerary.length}` : "Days"}
            {liveDay != null ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> : null}
          </button>
        </div>,
        document.body,
      ) : null}

      {/* ── Rate a stop: one row of stars, the meaning shown as you choose ── */}
      {ratingTarget ? (() => {
        const range = slotRange(ratingTarget.slot.time);
        const part = timeOfDay(range.start);
        const shown = hoverRating || selectedRating;
        const option = EVENT_RATING_OPTIONS.find((o) => o.value === shown) || null;
        const team = teamRatings[ratingTarget.key] || null;
        const tones = ["#94a3b8", "#f97316", "#eab308", "#22c55e", "#10b981", "#02665e"];
        const tone = tones[shown] || tones[0];
        return (
          <div className="fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center">
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 cursor-default border-0 bg-slate-900/45"
              onClick={() => {
                if (!ratingSaving) setRatingTarget(null);
              }}
            />
            <div role="dialog" aria-modal="true" aria-labelledby="rate-stop-title" className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              {/* The stop being rated */}
              <div className="flex items-start gap-3 px-5 pb-4 pt-5">
                <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: `${part.hex}18`, color: part.hex }}>
                  <part.Icon className="h-5 w-5" strokeWidth={2.2} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#02665e]">
                    Day {ratingTarget.day.day}
                    {range.startLabel ? ` · ${range.startLabel}${range.endLabel ? ` to ${range.endLabel}` : ""}` : ""}
                  </div>
                  <h2 id="rate-stop-title" className="m-0 mt-0.5 text-[18px] font-bold leading-snug text-slate-900">{ratingTarget.slot.title || "How was this stop?"}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setRatingTarget(null)}
                  disabled={ratingSaving}
                  aria-label="Close"
                  className="inline-flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-60"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                <div className="rounded-2xl bg-slate-50 px-4 pb-4 pt-5 text-center ring-1 ring-inset ring-slate-200/70">
                  <p className="m-0 text-[13px] font-semibold text-slate-600">How did it feel?</p>
                  {/* One row, tap or hover to choose */}
                  <div className="mt-3 flex justify-center gap-1.5 sm:gap-2" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHoverRating(0)}>
                    {EVENT_RATING_OPTIONS.map((o) => {
                      const lit = o.value <= shown;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="radio"
                          aria-checked={selectedRating === o.value}
                          aria-label={`${o.value} of 5, ${o.label}`}
                          onMouseEnter={() => setHoverRating(o.value)}
                          onFocus={() => setHoverRating(o.value)}
                          onBlur={() => setHoverRating(0)}
                          onClick={() => setSelectedRating(o.value)}
                          className="inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl border-0 bg-transparent p-0 transition-transform duration-150 hover:scale-110 active:scale-95"
                        >
                          <Star
                            className={`h-10 w-10 transition-colors ${lit ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
                            strokeWidth={1.6}
                            aria-hidden
                          />
                        </button>
                      );
                    })}
                  </div>
                  {/* What the chosen level means */}
                  <div className="mt-3 min-h-[44px]" aria-live="polite">
                    {option ? (
                      <>
                        <span className="inline-flex items-center rounded-full px-3 py-1 text-[13px] font-bold text-white" style={{ backgroundColor: tone }}>{option.label}</span>
                        <p className="m-0 mt-1.5 text-[12.5px] text-slate-500">{option.description}</p>
                      </>
                    ) : (
                      <p className="m-0 pt-2 text-[12.5px] text-slate-400">Tap a star to choose</p>
                    )}
                  </div>
                </div>

                {team?.count ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl px-1 text-[12.5px] text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      Your group so far
                    </span>
                    <span className="inline-flex items-center gap-1 font-bold text-slate-900">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                      {team.average.toFixed(1)}
                      <span className="font-normal text-slate-400">· {team.count} rating{team.count === 1 ? "" : "s"}</span>
                    </span>
                  </div>
                ) : null}

                <p className="m-0 mt-3 flex items-center gap-1.5 px-1 text-[11.5px] text-slate-500">
                  <Lock className="h-3 w-3 flex-shrink-0 text-slate-400" aria-hidden />
                  Each stop is rated once. Your group sees the team average.
                </p>
              </div>

              <div className="border-0 border-t border-solid border-slate-100 bg-white px-5 py-3">
                <button
                  type="button"
                  onClick={submitEventRating}
                  disabled={selectedRating <= 0 || ratingSaving}
                  className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] text-[15px] font-bold text-white transition-colors hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {ratingSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Star className="h-4 w-4" aria-hidden />}
                  {ratingSaving
                    ? "Saving..."
                    : selectedRating
                      ? `Save rating · ${EVENT_RATING_OPTIONS.find((o) => o.value === selectedRating)?.label || `${selectedRating}/5`}`
                      : "Choose a rating"}
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
