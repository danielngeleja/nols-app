"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import LayoutFrame from "@/components/LayoutFrame";
import TableRow from "@/components/TableRow";
import { slugifyProfile } from "@/lib/profileSlug";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, Copy, Eye, Loader2, MapPin, Megaphone, Share2, Star, TrendingUp } from "lucide-react";

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

function RatingJourneyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: RatingJourneyPoint }> }) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const point = payload[0].payload;
  return (
    <div className="max-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-slate-900">{point.title}</div>
      <div className="mt-1 text-slate-500">
        Day {point.day}{point.time ? `, ${point.time}` : ""}
      </div>
      {point.experienceVibe ? <div className="mt-1 text-amber-700">{point.experienceVibe}</div> : null}
      <div className="mt-1 font-semibold text-emerald-700">
        Team average {point.rating.toFixed(1)}/5 - {point.ratingLabel}
      </div>
      <div className="mt-0.5 text-slate-500">{point.ratingCount} traveller{point.ratingCount === 1 ? "" : "s"} rated</div>
    </div>
  );
}

export default function TourPackageTimelinePage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<any>(null);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [pickupMessage, setPickupMessage] = useState<string | null>(null);
  const [showPickupValidateModal, setShowPickupValidateModal] = useState(false);
  const [pickupPolicyAgreed, setPickupPolicyAgreed] = useState(false);
  const [timelineActionMessage, setTimelineActionMessage] = useState<string | null>(null);
  const [marketingShareMessage, setMarketingShareMessage] = useState<string | null>(null);
  const [ratingTarget, setRatingTarget] = useState<{ day: TimelineDay; slot: TimelineSlot; key: string } | null>(null);
  const [selectedRating, setSelectedRating] = useState<number>(0);
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
    try {
      const res = await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/validate-pickup`, {
        policyAgreed: true,
        codeSuffix: pickupCodeSuffix,
      });
      await load();
      setPickupMessage(res?.data?.message || "Meetup validated successfully.");
      setShowPickupValidateModal(false);
    } catch (err: any) {
      setPickupMessage(err?.response?.data?.message || err?.response?.data?.error || "Unable to validate meetup right now.");
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
      <div className="flex min-h-[45vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-teal-700" />
          <div className="mt-2 text-sm text-slate-600">Loading timeline...</div>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/account/tour-packages" className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700 no-underline">
          <ArrowLeft className="h-4 w-4" />
          Back to packages
        </Link>
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error || "Timeline not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden py-6">
      <LayoutFrame heightVariant="sm" topVariant="none" colorVariant="muted" variant="solid" className="mb-4" />
      <main className="w-full max-w-full space-y-4">
        <Link
          href={`/account/tour-packages/${encodeURIComponent(String(id))}`}
          aria-label="Back to package"
          title="Back to package"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-teal-700 no-underline shadow-sm hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <section className="overflow-hidden rounded-2xl border border-teal-100 bg-[radial-gradient(circle_at_1px_1px,rgba(2,102,94,0.11)_1px,transparent_0),linear-gradient(135deg,#ffffff_0%,#f0fdfa_48%,#e0f2fe_100%)] [background-size:20px_20px,100%_100%] px-5 py-7 text-center shadow-sm">
          <div className="mx-auto flex max-w-2xl flex-col items-center">
            <div className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-800">
              <CalendarDays className="h-3.5 w-3.5" />
              Tour Timeline
            </div>
            <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">{item.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Track your timetable and remind the operator if something looks wrong.
            </p>
            <div className="mt-2 text-sm text-slate-600 break-all">Ref: {item.bookingCode}</div>
            <div className="mt-4">
              {pickupValidated ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Meetup validated
                </span>
              ) : customerPickupConfirmed ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Customer confirmed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                  <Clock3 className="h-4 w-4" />
                  Waiting for meetup
                </span>
              )}
            </div>
            <div className="mt-2 inline-flex items-center rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600">
              {timelineIsOwner ? "Owner view" : "Traveller view"} - {timelineParticipantCount + 1} timeline member{timelineParticipantCount === 0 ? "" : "s"}
            </div>
          </div>
        </section>

        <section className={`rounded-2xl border p-4 ${pickupValidated ? "border-emerald-200 bg-emerald-50/80" : customerPickupConfirmed ? "border-sky-200 bg-sky-50/90" : "border-amber-200 bg-amber-50/90"}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Meetup Status</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {pickupValidated
                  ? "Timetable unlocked for active tour tracking."
                  : customerPickupConfirmed
                    ? "Your confirmation is recorded for admin review. Operator validation is still required."
                  : timelineIsOwner
                    ? "Validate meetup to unlock the timetable."
                    : "Waiting for the booking owner to validate meetup."}
              </div>
              <div className={`mt-1 inline-flex items-center gap-1 text-xs ${pickupValidated ? "text-emerald-800" : customerPickupConfirmed ? "text-sky-800" : "text-amber-800"}`}>
                {pickupValidated || customerPickupConfirmed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
                <span>
                  {pickupValidated
                    ? `Validated${validatedAtText ? ` on ${validatedAtText}` : ""}.`
                    : customerPickupConfirmed
                      ? "Customer confirmation does not replace operator validation."
                    : timelineIsOwner
                      ? `Meet your operator at ${validationAirport}, then confirm validation.`
                      : `Meetup is expected at ${validationAirport}.`}
                </span>
              </div>
              {pickupMessage && <div className="mt-2 text-xs text-slate-700">{pickupMessage}</div>}
            </div>
            <button
              type="button"
              onClick={() => {
                if (!canStartPickup || pickupLoading) return;
                setPickupPolicyAgreed(false);
                setShowPickupValidateModal(true);
              }}
              disabled={!canStartPickup || pickupLoading}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                !canStartPickup || pickupLoading
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                  : "bg-teal-600 text-white hover:bg-teal-700"
              }`}
            >
              {pickupLoading ? "Submitting..." : pickupValidated ? "Meetup Confirmed" : customerPickupConfirmed ? "Confirmation Sent" : "Validate Meetup"}
            </button>
          </div>
        </section>

        {timelineCompleted ? (
          <section className="overflow-hidden rounded-2xl border-2 border-emerald-300 bg-white shadow-lg ring-1 ring-emerald-100">
            <div className="grid gap-4 bg-[linear-gradient(135deg,#02665e_0%,#028a7e_100%)] px-4 py-4 text-white sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                  <Megaphone className="h-4 w-4" />
                  Recommend This Tour
                </div>
                <h2 className="mt-3 text-lg font-bold">Loved this tour? Recommend it to others</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-teal-50">
                  Your tour is finished. Send your friends the operator&apos;s public booking page so they can read the
                  approved profile, see reviews, and book the exact same tour you just completed.
                </p>
              </div>
            </div>
            <div className="px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 1. Choose how to send the link</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => shareMarketingViaWhatsApp(marketingPath)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                    <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.512 5.26l-.999 3.648 3.476-.911zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                  </svg>
                  Send on WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => shareMarketingLink(marketingPath)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  <Share2 className="h-4 w-4" />
                  More apps
                </button>
                <button
                  type="button"
                  onClick={() => copyMarketingLink(marketingPath)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  <Copy className="h-4 w-4" />
                  Copy link
                </button>
              </div>

              <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Step 2. Or preview the page first</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
                  {marketingPath}
                </div>
                <Link
                  href={marketingPath}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-bold text-teal-800 no-underline transition hover:bg-teal-100"
                >
                  <Eye className="h-4 w-4" />
                  Preview the booking page
                </Link>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Anyone who opens this link can view the operator&apos;s verified profile and book. They do not need your account.
              </p>
            </div>
            {marketingShareMessage ? (
              <div className="border-t border-slate-100 bg-emerald-50/60 px-4 py-2 text-xs font-medium text-emerald-700">
                {marketingShareMessage}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-teal-700 bg-[#02665e] bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.28)_1px,transparent_0)] [background-size:18px_18px] shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-white/15 bg-[#02665e]/90 px-4 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/95 text-[#02665e] shadow-sm">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-bold text-white">Timetable</div>
                <div className="mt-0.5 text-sm leading-relaxed text-teal-50">Track the package schedule while the tour is running.</div>
              </div>
            </div>
            <div className="shrink-0 rounded-full border border-white/25 bg-white px-4 py-2 text-sm font-bold text-[#02665e] shadow-sm">
              {detailedItinerary.length} day{detailedItinerary.length === 1 ? "" : "s"}
            </div>
          </div>

          {!pickupValidated ? (
            <div className="m-4 rounded-xl border border-dashed border-white/40 bg-white px-4 py-4 text-sm text-slate-600">
              Tour timetable is locked until meetup validation is completed at <span className="font-semibold text-slate-900">{validationAirport}</span>.
            </div>
          ) : detailedItinerary.length ? (
            <div className="space-y-3 p-4">
              {timelineActionMessage ? (
                <div className="rounded-xl border border-white/30 bg-white px-4 py-3 text-sm font-medium text-slate-700">
                  {timelineActionMessage}
                </div>
              ) : null}

              <div className="overflow-hidden rounded-2xl border border-white/25 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-800">
                      <TrendingUp className="h-4 w-4" />
                      Rating Journey
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Tracks all event ratings across the timetable from the first day to the final day.
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rated</div>
                      <div className="text-sm font-bold text-slate-900">{ratingJourney.length}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Average</div>
                      <div className="text-sm font-bold text-slate-900">{ratingJourney.length ? ratingAverage.toFixed(1) : "0.0"}/5</div>
                    </div>
                    <div className="col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-2 sm:col-span-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Top feeling</div>
                      <div className="truncate text-sm font-bold text-slate-900">{highestRatedPoint?.ratingLabel || "Waiting"}</div>
                    </div>
                    <div className="col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-2 sm:col-span-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Team coverage</div>
                      <div className="text-sm font-bold text-slate-900">{timelineJoinedTotal}/{timelineTotalTravellers}</div>
                    </div>
                  </div>
                </div>

                {ratingJourney.length ? (
                  <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div className="h-64 min-w-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={ratingJourney} margin={{ top: 12, right: 12, left: -24, bottom: 0 }}>
                          <defs>
                            <linearGradient id="timelineRatingGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#059669" stopOpacity={0.28} />
                              <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 6" vertical={false} />
                          <XAxis
                            dataKey="axisLabel"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "#64748b", fontSize: 11 }}
                            interval={0}
                          />
                          <YAxis
                            domain={[1, 5]}
                            ticks={[1, 2, 3, 4, 5]}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "#64748b", fontSize: 11 }}
                          />
                          <Tooltip content={<RatingJourneyTooltip />} cursor={{ stroke: "#14b8a6", strokeWidth: 1, strokeDasharray: "4 4" }} />
                          <Area
                            type="monotone"
                            dataKey="rating"
                            stroke="#059669"
                            strokeWidth={3}
                            fill="url(#timelineRatingGradient)"
                            dot={{ r: 4, strokeWidth: 2, fill: "#ffffff", stroke: "#059669" }}
                            activeDot={{ r: 6, strokeWidth: 2, fill: "#059669", stroke: "#ffffff" }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid content-start gap-2">
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Highest rated</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">{highestRatedPoint?.title || "Not available"}</div>
                        <div className="mt-0.5 text-xs text-emerald-700">
                          {highestRatedPoint ? `${highestRatedPoint.rating}/5 - ${highestRatedPoint.ratingLabel}` : "No rating yet"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Lowest rated</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">{lowestRatedPoint?.title || "Not available"}</div>
                        <div className="mt-0.5 text-xs text-amber-700">
                          {lowestRatedPoint ? `${lowestRatedPoint.rating}/5 - ${lowestRatedPoint.ratingLabel}` : "No rating yet"}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4">
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
                      <Star className="mx-auto h-6 w-6 text-slate-300" />
                      <div className="mt-2 text-sm font-semibold text-slate-800">No event ratings yet</div>
                      <div className="mt-1 text-xs text-slate-500">The graph will appear after the user rates timetable events.</div>
                    </div>
                  </div>
                )}
              </div>

              {detailedItinerary.map((day) => (
                <div key={`day-${day.day}-${day.title}`} className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                        Day {day.day}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">{day.title}</div>
                      {day.description ? <div className="mt-1 text-xs leading-relaxed text-slate-600">{day.description}</div> : null}
                    </div>
                    <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      {day.slots.length} stop{day.slots.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="overflow-x-auto">
                      <table className="min-w-[880px] w-full border-separate border-spacing-0">
                        <colgroup>
                          <col className="w-[150px]" />
                          <col />
                          <col className="w-[180px]" />
                          <col className="w-[190px]" />
                        </colgroup>
                        <thead>
                          <tr className="bg-teal-50 text-[11px] font-bold uppercase tracking-wide text-teal-900">
                            <th scope="col" className="px-4 py-3 text-left">Time</th>
                            <th scope="col" className="px-4 py-3 text-left">Activities / Events</th>
                            <th scope="col" className="px-4 py-3 text-left">Experience Vibe</th>
                            <th scope="col" className="px-4 py-3 text-right">Rating</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {day.slots.map((slot, slotIdx) => {
                            const ratingKey = `${day.day}-${slotIdx}`;
                            const savedRating = eventRatings[ratingKey] || 0;
                            const savedRatingOption = EVENT_RATING_OPTIONS.find((option) => option.value === savedRating);
                            const teamRating = teamRatings[ratingKey] || null;
                            return (
                              <TableRow key={`slot-${day.day}-${slotIdx}`}>
                                <td className="px-4 py-3 align-middle text-sm font-semibold text-teal-700">
                                  {slot.time || "Schedule"}
                                </td>
                                <td className="px-4 py-3 align-middle">
                                  <div className="text-sm font-medium text-slate-900">{slot.title || "Activity details"}</div>
                                  {slot.description ? <div className="mt-0.5 text-xs leading-relaxed text-slate-600">{slot.description}</div> : null}
                                </td>
                                <td className="px-4 py-3 align-middle">
                                  {slot.experienceVibe ? (
                                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                                      {slot.experienceVibe}
                                    </span>
                                  ) : (
                                    <span className="text-xs font-medium text-slate-400">Not set</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 align-middle">
                                  <div className="flex items-center justify-end gap-2">
                                    {savedRating ? (
                                      <div className="text-right">
                                        <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800">
                                          <Star className="h-3.5 w-3.5 fill-current" />
                                          Your {savedRating}/5 {savedRatingOption?.label ? `- ${savedRatingOption.label}` : ""}
                                        </span>
                                        {teamRating?.count ? (
                                          <div className="mt-1 text-[11px] font-medium text-slate-500">
                                            Team avg {teamRating.average.toFixed(1)}/5 - {teamRating.count} rating{teamRating.count === 1 ? "" : "s"}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <div className="text-right">
                                        <button
                                          type="button"
                                          onClick={() => openRating(day, slot, ratingKey)}
                                          className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                                        >
                                          Rate
                                        </button>
                                        {teamRating?.count ? (
                                          <div className="mt-1 text-[11px] font-medium text-slate-500">
                                            Team avg {teamRating.average.toFixed(1)}/5 - {teamRating.count} rating{teamRating.count === 1 ? "" : "s"}
                                          </div>
                                        ) : null}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </TableRow>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="m-4 rounded-xl border border-white/30 bg-white px-4 py-4 text-sm text-slate-500">
              No timetable has been uploaded for this package yet.
            </div>
          )}
        </section>
      </main>

      {showPickupValidateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3">
          <button
            type="button"
            aria-label="Close validation popup"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => {
              if (pickupLoading) return;
              setShowPickupValidateModal(false);
            }}
          />
          <div className="relative z-10 w-[92vw] max-w-sm rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="text-xl font-semibold text-slate-900">Validate Meetup</div>
            <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-600 leading-relaxed">
              <MapPin className="h-3.5 w-3.5 text-teal-700" />
              <span>Confirm meetup at {validationAirport}.</span>
            </div>

            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
              <label className="text-xs font-medium text-slate-700">Validation code</label>
              <div className="mt-1 inline-flex rounded-lg border border-slate-300 bg-slate-100 px-3 py-1 text-xl font-semibold tracking-[0.18em] text-slate-800">
                {pickupCodeSuffix || "N/A"}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">Auto-filled and locked.</div>
            </div>

            <div className="mt-2 flex items-start gap-2 text-xs text-slate-700">
              <button
                type="button"
                role="switch"
                aria-checked={pickupPolicyAgreed}
                aria-label="Agree with verification policy"
                disabled={pickupLoading}
                onClick={() => setPickupPolicyAgreed((prev) => !prev)}
                className={`relative mt-0.5 inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
                  pickupPolicyAgreed ? "border-teal-600 bg-teal-600" : "border-slate-300 bg-slate-200"
                } disabled:opacity-60`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    pickupPolicyAgreed ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className="pt-0.5">
                I agree with the{" "}
                <Link href="/verification-policy" target="_blank" rel="noreferrer" className="font-semibold text-teal-700 hover:text-teal-800">
                  verification policy
                </Link>
                .
              </span>
            </div>

            <div className="mt-2.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPickupValidateModal(false)}
                disabled={pickupLoading}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={validateMeetup}
                disabled={!pickupPolicyAgreed || pickupLoading || !pickupCodeSuffix}
                className="rounded-lg bg-teal-600 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {pickupLoading ? "Validating..." : "Validate Now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ratingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close rating popup"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => {
              if (!ratingSaving) setRatingTarget(null);
            }}
          />
          <div className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-xs flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.25)_1px,transparent_0)] [background-size:16px_16px] border-b border-teal-700 bg-[#02665e] px-4 py-2.5 text-white">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-teal-50">Rate this event</div>
              <div className="mt-0.5 truncate text-sm font-bold">{ratingTarget.slot.title || "Activity details"}</div>
              <div className="mt-0.5 text-[11px] text-teal-50">
                Day {ratingTarget.day.day}{ratingTarget.slot.time ? `, ${ratingTarget.slot.time}` : ""}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="grid gap-1.5">
                {EVENT_RATING_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedRating(option.value)}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${
                      selectedRating === option.value
                        ? "border-amber-300 bg-amber-50 text-slate-950"
                        : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex shrink-0 items-center gap-0.5 text-amber-500">
                      {Array.from({ length: 5 }).map((_, idx) => (
                        <Star
                          key={`${option.value}-${idx}`}
                          className={`h-3.5 w-3.5 ${idx < option.value ? "fill-current" : "text-slate-300"}`}
                        />
                      ))}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-tight">{option.value}. {option.label}</span>
                      <span className="block truncate text-[10px] leading-tight text-slate-500">{option.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-white px-3 py-2.5">
              <button
                type="button"
                onClick={() => setRatingTarget(null)}
                disabled={ratingSaving}
                aria-label="Cancel rating"
                title="Cancel rating"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitEventRating}
                disabled={selectedRating <= 0 || ratingSaving}
                aria-label="Save rating"
                title="Save rating"
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ratingSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
