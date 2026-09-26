"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronRight, Handshake, Key, Loader2, Mail, MapPin, Minus, Phone, Plane, Route, ShieldCheck, Users } from "lucide-react";
import TourCancellationWorkspace from "@/components/agent/TourCancellationWorkspace";

const api = apiClient;

type TourBookingDetail = {
  id: string | number;
  bookingCode?: string | null;
  title?: string;
  description?: string | null;
  status?: string;
  paymentStatus?: string;
  payoutStatus?: string | null;
  payoutPaidAt?: string | null;
  operatorPayoutAmount?: number | null;
  createdAt?: string;
  updatedAt?: string;
  tripDate?: string | null;
  endDate?: string | null;
  completedAt?: string | null;
  amountPaid?: number | null;
  currency?: string | null;
  tripType?: string | null;
  packageId?: string | null;
  packageSnapshot?: any;
  operatorSnapshot?: any;
  metadata?: any;
  requester?: {
    fullName?: string | null;
    email?: string | null;
    phone?: string | null;
    nationality?: string | null;
    travelerCount?: number | null;
  };
};

type TourCaseEvent = { id: number; type: string; message?: string | null; data?: any; createdAt: string };
type TourCase = {
  id: number;
  type: string;
  status: string;
  severity: string;
  title: string;
  description: string;
  resolutionAmount?: number | string | null;
  createdAt: string;
  events: TourCaseEvent[];
};

/** Where this trip sits from the operator's side of the handover. */
type TripStage = "UPCOMING" | "PICKUP_TODAY" | "PICKUP_OVERDUE" | "ON_TOUR" | "COMPLETED" | "CANCELLED" | "UNDATED";

function listify(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[\n,;]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function itineraryFromSnapshot(snapshot: any): Array<{ day: number; title: string; description: string; timeline: string[] }> {
  if (!Array.isArray(snapshot?.itinerary)) return [];
  return snapshot.itinerary
    .map((row: any, idx: number) => {
      const timeline = Array.isArray(row?.timeline)
        ? row.timeline
            .map((entry: any) => {
              const time = String(entry?.time || "").trim();
              const label = String(entry?.label || "").trim();
              const description = String(entry?.description || "").trim();
              const text = [label, description].filter(Boolean).join(" - ");
              if (!time && !text) return "";
              if (time && text) return `${time} - ${text}`;
              return time || text;
            })
            .filter((v: string) => Boolean(v))
        : [];

      return {
        day: Number(row?.day) || idx + 1,
        title: String(row?.title || "Activity").trim(),
        description: String(row?.description || "").trim(),
        timeline,
      };
    })
    .filter((row: any) => row.title || row.description)
    .sort((a: any, b: any) => a.day - b.day);
}

function parseDurationDays(duration: string): number {
  const m = String(duration || "").match(/(\d{1,2})/);
  if (!m) return 1;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v.trim());
  }
  return out;
}

function servicesFromClassification(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const obj = value as Record<string, unknown>;
  const out: string[] = [];
  for (const key of Object.keys(obj)) {
    const services = listify(obj[key]);
    for (const item of services) out.push(`${key}: ${item}`);
  }
  return out;
}

function MetricCard({ label, value, tone = "slate" }: { label: string; value: React.ReactNode; tone?: "slate" | "teal" | "amber" | "emerald" }) {
  const toneClass =
    tone === "teal"
      ? "border-teal-300 bg-teal-100 text-teal-900"
      : tone === "amber"
      ? "border-amber-300 bg-amber-100 text-amber-900"
      : tone === "emerald"
      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
      : "border-slate-300 bg-slate-100 text-slate-900";

  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${toneClass}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-sm font-extrabold">{value}</div>
    </div>
  );
}

export default function AgentTourBookingDetailPage() {
  const params = useParams();
  const bookingId = (params as any)?.id ? String((params as any).id) : "";

  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState<TourBookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [pickupCodeInput, setPickupCodeInput] = useState("");
  const [pickupValidating, setPickupValidating] = useState(false);
  const [pickupValidationMsg, setPickupValidationMsg] = useState<string | null>(null);
  const [pickupValidationErr, setPickupValidationErr] = useState<string | null>(null);
  const [showCongratsPopup, setShowCongratsPopup] = useState(false);
  const [tourCases, setTourCases] = useState<TourCase[]>([]);
  const [caseWorking, setCaseWorking] = useState<number | null>(null);
  const [caseMessages, setCaseMessages] = useState<Record<number, string>>({});
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<number, { kind: "NON_REFUNDABLE_COMPONENT" | "CONSUMED_SERVICE" | "RECOVERY_COST"; description: string; amount: string; evidenceUrl: string; disclosedBeforePayment: boolean }>>({});
  const [caseNotice, setCaseNotice] = useState<string | null>(null);

  const loadTourCases = async () => {
    if (!bookingId) return;
    const res = await api.get(`/api/agent/tour-bookings/${encodeURIComponent(bookingId)}/cases`);
    setTourCases(Array.isArray(res.data?.cases) ? res.data.cases : []);
  };

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        setAuthRequired(false);

        const session = await fetchAccountSession();
        if (!session.ok) {
          setAuthRequired(true);
          setItem(null);
          return;
        }

        const res = await api.get(`/api/agent/tour-bookings/${encodeURIComponent(bookingId)}`);
        if (!alive) return;

        setItem(res.data?.item ?? res.data?.data?.item ?? res.data);
      } catch (e: any) {
        if (!alive) return;
        if (e?.response?.status === 401) {
          setAuthRequired(true);
          setItem(null);
          setError(null);
        } else {
          const msg = e?.response?.data?.error || "Failed to load tour booking";
          setError(String(msg));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [bookingId]);

  const caseAction = async (tourCase: TourCase, action: "ACKNOWLEDGE" | "ESCALATE" | "RESOLVE" | "REJECT") => {
    const message = String(caseMessages[tourCase.id] || "").trim();
    if (!message) return setCaseNotice("Add a response before updating the case.");
    setCaseWorking(tourCase.id);
    setCaseNotice(null);
    try {
      await api.post(`/api/agent/tour-bookings/${encodeURIComponent(bookingId)}/cases/${tourCase.id}/action`, { action, message });
      setCaseMessages((old) => ({ ...old, [tourCase.id]: "" }));
      setCaseNotice(`Case #${tourCase.id} updated.`);
      await loadTourCases();
    } catch (error: any) {
      setCaseNotice(error?.response?.data?.error || "Could not update the case.");
    } finally { setCaseWorking(null); }
  };

  const submitCostEvidence = async (tourCase: TourCase) => {
    const draft = evidenceDrafts[tourCase.id] || { kind: "NON_REFUNDABLE_COMPONENT", description: "", amount: "", evidenceUrl: "", disclosedBeforePayment: false };
    if (!draft.description.trim() || !(Number(draft.amount) > 0) || !/^https?:\/\//i.test(draft.evidenceUrl)) return setCaseNotice("Provide a description, positive amount, and valid evidence URL.");
    setCaseWorking(tourCase.id);
    setCaseNotice(null);
    try {
      await api.post(`/api/agent/tour-bookings/${encodeURIComponent(bookingId)}/cases/${tourCase.id}/cost-evidence`, {
        message: String(caseMessages[tourCase.id] || "Documented supplier cost").trim(),
        items: [{ ...draft, amount: Number(draft.amount) }],
      });
      setEvidenceDrafts((old) => ({ ...old, [tourCase.id]: { kind: "NON_REFUNDABLE_COMPONENT", description: "", amount: "", evidenceUrl: "", disclosedBeforePayment: false } }));
      setCaseMessages((old) => ({ ...old, [tourCase.id]: "" }));
      setCaseNotice("Cost evidence submitted to NoLSAF for review.");
      await loadTourCases();
    } catch (error: any) {
      setCaseNotice(error?.response?.data?.error || "Could not submit cost evidence.");
    } finally { setCaseWorking(null); }
  };

  useEffect(() => {
    if (!showCongratsPopup) return;
    const t = window.setTimeout(() => setShowCongratsPopup(false), 20_000);
    return () => window.clearTimeout(t);
  }, [showCongratsPopup]);

  const title = item?.title || (bookingId ? `Tour Booking #${bookingId}` : "Tour Booking");
  const status = item?.status || "Pending";
  const paymentStatus = item?.paymentStatus || "-";
  const bookingCode = item?.bookingCode || "-";
  const statusTone = String(status).toUpperCase();

  const packageSnapshot = (item?.packageSnapshot as any) || null;
  const operatorSnapshot = (item?.operatorSnapshot as any) || null;
  const bookingMetadata = (item?.metadata as any) || null;

  const departureAirport = bookingMetadata?.departureAirport || null;
  const departureAirportLabel = String(
    departureAirport?.label || departureAirport?.shortLabel || departureAirport?.iataCode || ""
  ).trim();
  const hasClientAirportPickup = Boolean(departureAirportLabel);
  const pickupValidation = bookingMetadata?.pickupValidation || null;
  const alreadyPickupValidated = Boolean(pickupValidation?.validated);
  const pickupValidatedAt = pickupValidation?.validatedAt
    ? new Date(String(pickupValidation.validatedAt)).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : null;
  const expectedCodeSuffix = String(bookingCode || "").replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();

  const includedItems = useMemo(() => listify(packageSnapshot?.included), [packageSnapshot]);
  const excludedItems = useMemo(() => listify(packageSnapshot?.excluded), [packageSnapshot]);
  const itinerary = useMemo(() => itineraryFromSnapshot(packageSnapshot), [packageSnapshot]);
  const packageServices = useMemo(
    () =>
      uniqueStrings([
        ...listify(packageSnapshot?.services),
        ...listify(packageSnapshot?.addOns),
        ...listify(packageSnapshot?.tools),
        ...includedItems,
        ...servicesFromClassification(packageSnapshot?.serviceClassification),
      ]),
    [includedItems, packageSnapshot]
  );

  const packageName =
    String(packageSnapshot?.name || packageSnapshot?.title || item?.title || "Booked package");
  const packageDuration = String(packageSnapshot?.duration || "-");
  const durationDays = useMemo(() => parseDurationDays(packageDuration), [packageDuration]);
  const meetingPoint = String(
    departureAirportLabel || packageSnapshot?.meetingPoint || operatorSnapshot?.meetingPoint || "Agreed pickup point"
  );

  const servicesByDay = useMemo(() => {
    if (itinerary.length > 0) {
      return itinerary.map((it) => {
        const timelineItems = Array.isArray(it.timeline) ? it.timeline : [];
        const descItems = listify(it.description);
        const fromTitle = it.title && it.title !== "Activity" ? [it.title] : [];
        const items = uniqueStrings([...timelineItems, ...fromTitle, ...descItems]);
        return {
          day: it.day,
          title: it.title || `Day ${it.day}`,
          items: items.length > 0 ? items : ["Execute planned package activities for this day."],
        };
      });
    }

    const days = Math.max(1, durationDays);
    const source = packageServices.length > 0 ? packageServices : ["Core package service delivery"];
    const mapped: Array<{ day: number; title: string; items: string[] }> = [];
    for (let d = 1; d <= days; d++) {
      const dayItems: string[] = [];
      for (let i = d - 1; i < source.length; i += days) dayItems.push(source[i]);
      mapped.push({
        day: d,
        title: `Day ${d}`,
        items: dayItems.length > 0 ? dayItems : ["Operations and guest support"],
      });
    }
    return mapped;
  }, [durationDays, itinerary, packageServices]);

  const connectedFlow = useMemo(() => {
    const steps: Array<{ title: string; detail: string }> = [
      {
        title: "Booking Confirmation",
        detail: "Confirm guest profile, dates, and package scope before operations begin.",
      },
      {
        title: "Pickup & Briefing",
        detail: hasClientAirportPickup
          ? `Client requested airport pickup at ${meetingPoint}. Receive the guest there first, then run the trip briefing before moving to itinerary tasks.`
          : `Pickup/meet guest at ${meetingPoint} and run trip briefing with the full activity plan.`,
      },
    ];

    if (itinerary.length > 0) {
      for (const day of itinerary) {
        steps.push({
          title: `Day ${day.day}: ${day.title}`,
          detail: day.description || "Execute this day according to agreed package itinerary.",
        });
      }
    } else {
      for (const [idx, itemName] of includedItems.slice(0, 5).entries()) {
        steps.push({
          title: `Service ${idx + 1}: ${itemName}`,
          detail: "Deliver this included service and confirm completion before moving to the next step.",
        });
      }
    }

    steps.push({
      title: "Drop-off & Completion",
      detail: "Close trip operations, confirm all package inclusions delivered, and update completion status.",
    });

    return steps;
  }, [hasClientAirportPickup, includedItems, itinerary, meetingPoint]);

  async function validatePickupFirstMeet() {
    try {
      setPickupValidationErr(null);
      setPickupValidationMsg(null);
      setPickupValidating(true);

      const suffix = pickupCodeInput.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      if (!suffix || suffix.length < 6) {
        setPickupValidationErr("Enter the last 6 code characters, e.g. B47DA9.");
        return;
      }

      const res = await api.post(`/api/agent/tour-bookings/${encodeURIComponent(String(bookingId))}/validate-pickup`, {
        codeSuffix: suffix,
      });

      const validated = (res as any)?.data?.pickupValidation || null;
      if (validated) {
        setItem((prev) => {
          if (!prev) return prev;
          const prevMd = (prev.metadata && typeof prev.metadata === "object") ? prev.metadata : {};
          return {
            ...prev,
            metadata: {
              ...prevMd,
              pickupValidation: validated,
            },
          };
        });
      }

      setPickupValidationMsg("Pickup/first meet validated successfully.");
      setShowCongratsPopup(true);
      setPickupCodeInput("");
    } catch (e: any) {
      setPickupValidationErr(
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        "Pickup validation failed. Please verify the last 6 code characters."
      );
    } finally {
      setPickupValidating(false);
    }
  }

  // ── Presentation model ────────────────────────────────────────────────
  const [tourName, destination] = (() => {
    const parts = String(title).split(" • ");
    return [parts[0] || title, parts[1] || null] as const;
  })();
  const placeCode = (() => {
    const letters = String(destination || tourName || "").replace(/[^A-Za-z]/g, "");
    return (letters.slice(0, 3) || "TRP").toUpperCase();
  })();
  const daysToTrip = item?.tripDate ? Math.round((dayStart(item.tripDate) - dayStart(Date.now())) / 86_400_000) : null;
  const tripDays = (() => {
    if (item?.tripDate && item?.endDate) {
      const d = Math.round((dayStart(item.endDate) - dayStart(item.tripDate)) / 86_400_000) + 1;
      if (d > 0) return d;
    }
    return packageSnapshot?.duration ? durationDays : null;
  })();
  const stage: TripStage = (() => {
    if (statusTone.includes("CANCEL") || statusTone.includes("REFUND")) return "CANCELLED";
    if (item?.completedAt || statusTone.includes("COMPLETE")) return "COMPLETED";
    if (alreadyPickupValidated) return "ON_TOUR";
    if (daysToTrip == null) return "UNDATED";
    if (daysToTrip < 0) return "PICKUP_OVERDUE";
    if (daysToTrip === 0) return "PICKUP_TODAY";
    return "UPCOMING";
  })();
  const journeyReached = stage === "COMPLETED" ? 4 : stage === "ON_TOUR" ? 3 : 1;
  const heroStatus = (() => {
    switch (stage) {
      case "CANCELLED": return "Booking cancelled";
      case "COMPLETED": return "Trip completed";
      case "ON_TOUR": return "Pickup validated · on tour";
      case "PICKUP_TODAY": return "Pickup is today";
      case "PICKUP_OVERDUE": return `Pickup overdue by ${Math.abs(daysToTrip || 0)} ${Math.abs(daysToTrip || 0) === 1 ? "day" : "days"}`;
      case "UNDATED": return "Paid · date to be confirmed";
      default: return daysToTrip === 1 ? "Paid · pickup tomorrow" : `Paid · pickup in ${daysToTrip} days`;
    }
  })();
  const countdown = (() => {
    switch (stage) {
      case "CANCELLED": return { big: "Off", small: "booking cancelled" };
      case "COMPLETED": return { big: "Done", small: "trip delivered" };
      case "ON_TOUR": {
        const day = daysToTrip != null ? Math.max(1, 1 - daysToTrip) : null;
        return day && tripDays ? { big: String(Math.min(day, tripDays)), small: `day of ${tripDays}` } : { big: "Live", small: "on tour" };
      }
      case "PICKUP_TODAY": return { big: "Today", small: "pickup day" };
      case "PICKUP_OVERDUE": return { big: String(Math.abs(daysToTrip || 0)), small: Math.abs(daysToTrip || 0) === 1 ? "day overdue" : "days overdue" };
      case "UNDATED": return { big: "TBC", small: "date to confirm" };
      default: return { big: String(daysToTrip), small: daysToTrip === 1 ? "day to pickup" : "days to pickup" };
    }
  })();
  const needsPickup = stage === "UPCOMING" || stage === "PICKUP_TODAY" || stage === "PICKUP_OVERDUE" || stage === "UNDATED";
  const guestName = item?.requester?.fullName || "Guest";
  const guestPhone = item?.requester?.phone || null;
  const guestEmail = item?.requester?.email || null;
  const travellers = Number(item?.requester?.travelerCount || 0);
  const currency = item?.currency || "TZS";
  const bookingValue = typeof item?.amountPaid === "number" ? item.amountPaid.toLocaleString("en-US") : null;
  const payoutValue = typeof item?.operatorPayoutAmount === "number" ? `${currency} ${item.operatorPayoutAmount.toLocaleString("en-US")}` : null;
  const payoutTone = String(item?.payoutStatus || "").toUpperCase();
  const fmtDate = (value?: string | null) =>
    value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  const tripDateLabel = fmtDate(item?.tripDate) || "To confirm";
  const endDateLabel = fmtDate(item?.endDate);
  const codeReady = !!(expectedCodeSuffix && pickupCodeInput.toUpperCase() === expectedCodeSuffix);
  const stageChip: Record<TripStage, string> = {
    UPCOMING: "bg-white/15 text-white",
    PICKUP_TODAY: "bg-amber-300 text-amber-950",
    PICKUP_OVERDUE: "bg-orange-400 text-orange-950",
    ON_TOUR: "bg-white/15 text-white",
    COMPLETED: "bg-white/15 text-white",
    CANCELLED: "bg-rose-400 text-rose-950",
    UNDATED: "bg-white/15 text-white",
  };

  return (
    <div id="operator-booking-page" className="w-full min-w-0 space-y-5 py-2 sm:py-4">
      <style>{DETAIL_BOX_SIZING}</style>
      {showCongratsPopup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <div className="relative w-full max-w-lg animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
            <div className="pointer-events-none absolute -left-5 -top-6 text-3xl opacity-80 animate-bounce [animation-duration:2.6s]" aria-hidden>🎈</div>
            <div className="pointer-events-none absolute right-4 -top-6 text-3xl opacity-80 animate-bounce [animation-duration:2.2s]" aria-hidden>🎈</div>
            <div className="pointer-events-none absolute -right-4 -bottom-5 text-2xl opacity-85 animate-bounce [animation-duration:2.8s]" aria-hidden>🌹</div>
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 p-5 shadow-xl">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl border border-emerald-200 bg-white/80 p-2 text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-emerald-900">Congratulations</p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">Validation complete. Wishing you all the best for the trip.</p>
                  <p className="mt-1 text-xs text-slate-500">This message will disappear in 20 seconds.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/account/agent/bookings${stage === "COMPLETED" ? "?stage=completed" : stage === "ON_TOUR" ? "?stage=progress" : stage === "CANCELLED" ? "" : "?stage=confirmed"}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 no-underline shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-[#02665e] hover:text-[#02665e]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          My bookings
        </Link>
        {item?.bookingCode ? <span className="min-w-0 truncate font-mono text-[12px] text-slate-400">{item.bookingCode}</span> : null}
      </div>

      {loading ? (
        <div className="space-y-5" aria-busy="true">
          <span role="status" className="sr-only">Loading booking</span>
          <div className="h-64 animate-pulse rounded-3xl bg-[#02665e]/15" />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-5">
              <div className="h-56 animate-pulse rounded-3xl border border-solid border-slate-200 bg-white" />
              <div className="h-72 animate-pulse rounded-3xl border border-solid border-slate-200 bg-white" />
            </div>
            <div className="space-y-5">
              <div className="h-48 animate-pulse rounded-3xl border border-solid border-slate-200 bg-white" />
              <div className="h-64 animate-pulse rounded-3xl border border-solid border-slate-200 bg-white" />
            </div>
          </div>
        </div>
      ) : authRequired ? (
        <div className="rounded-3xl border border-solid border-slate-200 bg-white p-6">
          <div className="text-sm font-bold text-slate-900">Sign in required</div>
          <div className="mt-1 text-sm text-slate-600">Log in to view booking details.</div>
          <div className="mt-4">
            <Link href="/account/login" className={`${PRIMARY_BUTTON} no-underline`}>
              Sign in
              <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden />
            </Link>
          </div>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="font-bold">Could not load booking</div>
          <div className="mt-1">{error}</div>
        </div>
      ) : (
        <>
          {/* ── Trip pass ── */}
          <section
            aria-label="Trip summary"
            className="relative overflow-hidden rounded-3xl text-white shadow-[0_24px_48px_-30px_rgba(2,102,94,0.9)]"
            style={{ backgroundColor: stage === "CANCELLED" ? "#475569" : BRAND }}
          >
            <div className="grid md:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-w-0 p-5 sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${stageChip[stage]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${stage === "PICKUP_TODAY" || stage === "PICKUP_OVERDUE" || stage === "CANCELLED" ? "bg-current" : "bg-white"}`} aria-hidden />
                    {heroStatus}
                  </span>
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-white/60">Operator booking</p>
                </div>

                <div className="mt-4 flex items-end gap-3 sm:gap-4">
                  <span className="text-[40px] font-black leading-none tracking-[0.08em] text-white sm:text-[56px]">{placeCode}</span>
                  <div className="min-w-0 pb-1">
                    <h1 className="m-0 break-words text-[20px] font-bold leading-tight text-white sm:text-[24px]">{tourName}</h1>
                    <p className="m-0 mt-0.5 truncate text-[13px] text-white/70">
                      {[destination, item?.tripType, `for ${guestName}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>

                <dl className="m-0 mt-6 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
                  {[
                    { label: "Pickup", value: tripDateLabel },
                    { label: tripDays ? "Duration" : "Return", value: tripDays ? `${tripDays} ${tripDays === 1 ? "day" : "days"}` : endDateLabel || "To confirm" },
                    { label: "Travellers", value: travellers ? String(travellers) : "-" },
                    { label: "Meet at", value: meetingPoint },
                  ].map((fact) => (
                    <div key={fact.label} className="min-w-0">
                      <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/55">{fact.label}</dt>
                      <dd className="m-0 mt-1 truncate text-[15px] font-bold text-white" title={fact.value}>{fact.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-6">
                  <JourneySteps reached={journeyReached} blocked={stage === "CANCELLED"} />
                </div>
              </div>

              {/* Stub: countdown to the handover and the one action that matters now */}
              <div className="relative flex flex-wrap items-center justify-between gap-4 border-0 border-t-2 border-dashed border-white/25 px-5 py-4 md:flex-col md:flex-nowrap md:justify-center md:border-l-2 md:border-t-0 md:p-6 md:text-center">
                <span aria-hidden className="absolute -top-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-neutral-50 md:block" />
                <span aria-hidden className="absolute -bottom-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-neutral-50 md:block" />
                <div className="flex items-baseline gap-2 md:block">
                  <div className="text-[36px] font-black leading-none tabular-nums text-white md:text-[52px]">{countdown.big}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70 md:mt-1.5 md:text-[12px]">{countdown.small}</div>
                </div>
                {needsPickup ? (
                  <a
                    href="#pickup-validation"
                    className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-full bg-white px-5 text-[13px] font-bold text-[#02665e] no-underline transition-colors hover:bg-white/90 md:w-full"
                  >
                    <Key className="h-4 w-4" aria-hidden />
                    Validate pickup
                  </a>
                ) : guestPhone && stage !== "CANCELLED" ? (
                  <a
                    href={`tel:${guestPhone}`}
                    className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-full bg-white px-5 text-[13px] font-bold text-[#02665e] no-underline transition-colors hover:bg-white/90 md:w-full"
                  >
                    <Phone className="h-4 w-4" aria-hidden />
                    Call guest
                  </a>
                ) : null}
              </div>
            </div>
          </section>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <div className="min-w-0 space-y-5">
              {/* ── Pickup validation ── */}
              <section
                id="pickup-validation"
                className={`min-w-0 scroll-mt-24 rounded-3xl border border-solid bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6 ${
                  alreadyPickupValidated ? "border-emerald-200" : stage === "PICKUP_TODAY" || stage === "PICKUP_OVERDUE" ? "border-amber-300" : "border-slate-200"
                }`}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="m-0 text-[15.5px] font-bold text-slate-900">Pickup validation</h2>
                    <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">
                      {alreadyPickupValidated
                        ? "The handover is on record. The live itinerary is open for this trip."
                        : "Record the first meet in person. This moves the trip to In progress and opens the guest's live itinerary."}
                    </p>
                  </div>
                  <StatusChip tone={alreadyPickupValidated ? "emerald" : stage === "PICKUP_OVERDUE" ? "rose" : "amber"}>
                    {alreadyPickupValidated ? "Validated" : stage === "PICKUP_OVERDUE" ? "Overdue" : "Pending"}
                  </StatusChip>
                </div>

                {alreadyPickupValidated ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-solid border-emerald-200 bg-emerald-50/70 px-4 py-3.5">
                    <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e] text-white">
                      <ShieldCheck className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[14px] font-bold text-emerald-950">You met {guestName}</div>
                      <div className="text-[12.5px] text-emerald-800/80">{pickupValidatedAt ? `Validated on ${pickupValidatedAt}` : "Validated"}</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <ol className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-3">
                      {[
                        { icon: Handshake, title: "Meet the guest", text: `In person at ${meetingPoint}` },
                        { icon: ShieldCheck, title: "Verify identity", text: `Confirm you are with ${guestName}` },
                        { icon: Key, title: "Enter the code", text: "Last 6 characters of the tour code on their voucher" },
                      ].map((step, index) => (
                        <li key={step.title} className="flex min-w-0 items-start gap-3 rounded-2xl border border-solid border-slate-200 bg-slate-50/70 p-3.5">
                          <span className="relative inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                            <step.icon className="h-4 w-4" aria-hidden />
                            <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#02665e] text-[9.5px] font-bold text-white">{index + 1}</span>
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-bold text-slate-900">{step.title}</span>
                            <span className="block text-[12px] leading-snug text-slate-500">{step.text}</span>
                          </span>
                        </li>
                      ))}
                    </ol>

                    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-solid border-slate-200 p-3.5 sm:flex-row sm:items-center">
                      <label className="min-w-0 flex-1">
                        <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Code suffix</span>
                        <input
                          value={pickupCodeInput}
                          onChange={(e) => setPickupCodeInput(e.target.value.toUpperCase())}
                          placeholder={expectedCodeSuffix ? `e.g. ${expectedCodeSuffix}` : "e.g. B47DA9"}
                          className="block h-11 w-full min-w-0 rounded-xl border border-solid border-slate-300 bg-white px-3 font-mono text-[16px] font-bold uppercase tracking-[0.3em] text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] placeholder:font-sans placeholder:text-[13px] placeholder:font-medium placeholder:tracking-normal placeholder:text-slate-400 hover:border-slate-400 focus:border-[#02665e] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]"
                          maxLength={12}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void validatePickupFirstMeet()}
                        disabled={!!(pickupValidating || pickupCodeInput.length === 0 || (expectedCodeSuffix && !codeReady))}
                        className={`${PRIMARY_BUTTON} h-11 sm:mt-5`}
                        style={{ fontFamily: "inherit" }}
                      >
                        {pickupValidating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : codeReady ? <Check className="h-4 w-4" aria-hidden /> : <Key className="h-4 w-4" aria-hidden />}
                        {pickupValidating ? "Validating..." : "Validate first meet"}
                      </button>
                    </div>

                    <p className="m-0 mt-3 flex items-start gap-2 rounded-2xl border border-solid border-rose-200 bg-rose-50/70 px-3.5 py-3 text-[12px] leading-relaxed text-rose-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-600" aria-hidden />
                      <span>
                        <strong className="font-bold">Only validate after meeting the guest.</strong> Validating without physically meeting the client is a Terms of Service violation and may lead to account suspension, cancelled bookings and legal action.
                      </span>
                    </p>
                  </>
                )}

                {pickupValidationErr ? (
                  <div role="alert" className="mt-3 rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700">{pickupValidationErr}</div>
                ) : null}
                {pickupValidationMsg ? (
                  <div className="mt-3 rounded-2xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] font-semibold text-emerald-800">{pickupValidationMsg}</div>
                ) : null}
              </section>

              <TourCancellationWorkspace
                bookingId={bookingId}
                bookingCode={bookingCode}
                bookingStatus={String(item?.status || "")}
                payoutStatus={item?.payoutStatus}
                startDate={item?.tripDate}
                currency={item?.currency}
                operatorPayoutAmount={item?.operatorPayoutAmount}
              />

              <section className="hidden rounded-2xl border border-amber-200 bg-white p-5 sm:p-6 shadow-sm" aria-hidden="true">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-700" /><h2 className="text-sm font-bold text-slate-900">Traveler Cases & Refund Evidence</h2></div><p className="mt-1 text-xs text-slate-600">Respond to traveler cases and submit verifiable supplier costs. NoLSAF makes every cancellation and refund decision.</p></div>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">{tourCases.length} active record{tourCases.length === 1 ? "" : "s"}</span>
                </div>
                {caseNotice && <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900">{caseNotice}</div>}
                <div className="mt-4 space-y-4">
                  {tourCases.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">No traveler cases for this booking.</div> : tourCases.map((tourCase) => {
                    const eligibility = tourCase.events.find((event) => event.type === "ELIGIBILITY_CALCULATED")?.data;
                    const evidence = tourCase.events.filter((event) => event.type === "OPERATOR_COST_EVIDENCE").flatMap((event) => Array.isArray(event.data?.items) ? event.data.items : []);
                    const draft = evidenceDrafts[tourCase.id] || { kind: "NON_REFUNDABLE_COMPONENT" as const, description: "", amount: "", evidenceUrl: "", disclosedBeforePayment: false };
                    const financial = ["CANCELLATION", "REFUND"].includes(tourCase.type.toUpperCase());
                    const closed = ["WITHDRAWN", "CLOSED", "RESOLVED", "REJECTED"].includes(tourCase.status.toUpperCase());
                    return <article key={tourCase.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex flex-wrap justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">{tourCase.type} · Case #{tourCase.id}</div><h3 className="mt-1 font-bold text-slate-900">{tourCase.title}</h3><p className="mt-1 text-sm text-slate-700">{tourCase.description}</p></div><span className="h-fit rounded-full border bg-white px-2.5 py-1 text-xs font-bold">{tourCase.status.replaceAll("_", " ")}</span></div>
                      {eligibility && <div className="mt-3 grid gap-2 sm:grid-cols-3"><MetricCard label="Policy" value={eligibility.eligibilityCode} tone="amber" /><MetricCard label="Provisional" value={`${eligibility.refundPercent}%`} tone="teal" /><MetricCard label="Estimate" value={`${item?.currency || "TZS"} ${Number(eligibility.estimatedRefundAmount || 0).toLocaleString()}`} tone="emerald" /></div>}
                      {evidence.length > 0 && <div className="mt-3 rounded-xl border bg-white p-3"><div className="text-xs font-bold">Evidence submitted</div>{evidence.map((entry: any, index: number) => <a key={index} href={entry.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 flex justify-between text-xs text-teal-700 underline"><span>{entry.description}</span><strong>{Number(entry.amount).toLocaleString()} {item?.currency}</strong></a>)}</div>}
                      {!closed && <><textarea value={caseMessages[tourCase.id] || ""} onChange={(e) => setCaseMessages((old) => ({ ...old, [tourCase.id]: e.target.value }))} rows={2} placeholder="Response to traveler or NoLSAF…" className="mt-3 w-full rounded-xl border p-3 text-sm" />
                        {financial && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="text-xs font-bold text-amber-900">Add documented tour cost</div><div className="mt-2 grid gap-2 md:grid-cols-2"><select value={draft.kind} onChange={(e) => setEvidenceDrafts((old) => ({ ...old, [tourCase.id]: { ...draft, kind: e.target.value as any } }))} className="rounded-lg border px-3 py-2 text-xs"><option value="NON_REFUNDABLE_COMPONENT">Non-refundable component</option><option value="CONSUMED_SERVICE">Consumed service</option><option value="RECOVERY_COST">Recovery cost</option></select><input value={draft.description} onChange={(e) => setEvidenceDrafts((old) => ({ ...old, [tourCase.id]: { ...draft, description: e.target.value } }))} placeholder="Description" className="rounded-lg border px-3 py-2 text-xs" /><input value={draft.amount} onChange={(e) => setEvidenceDrafts((old) => ({ ...old, [tourCase.id]: { ...draft, amount: e.target.value } }))} placeholder="Amount" inputMode="decimal" className="rounded-lg border px-3 py-2 text-xs" /><input value={draft.evidenceUrl} onChange={(e) => setEvidenceDrafts((old) => ({ ...old, [tourCase.id]: { ...draft, evidenceUrl: e.target.value } }))} placeholder="Evidence URL" className="rounded-lg border px-3 py-2 text-xs" /></div><label className="mt-2 flex gap-2 text-xs"><input type="checkbox" checked={draft.disclosedBeforePayment} onChange={(e) => setEvidenceDrafts((old) => ({ ...old, [tourCase.id]: { ...draft, disclosedBeforePayment: e.target.checked } }))} />Disclosed before payment</label><button onClick={() => void submitCostEvidence(tourCase)} disabled={caseWorking === tourCase.id} className="mt-2 rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white">Submit evidence</button></div>}
                        <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void caseAction(tourCase, "ACKNOWLEDGE")} disabled={caseWorking === tourCase.id} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold">Acknowledge</button><button onClick={() => void caseAction(tourCase, "ESCALATE")} disabled={caseWorking === tourCase.id} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white">Escalate</button>{!financial && <button onClick={() => void caseAction(tourCase, "RESOLVE")} disabled={caseWorking === tourCase.id} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Resolve</button>}</div></>}
                      <details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-slate-600">Audit timeline ({tourCase.events.length})</summary><div className="mt-2 space-y-2 border-l pl-3">{tourCase.events.map((event) => <div key={event.id} className="text-xs text-slate-600"><strong>{event.type.replaceAll("_", " ")}</strong> · {new Date(event.createdAt).toLocaleString()}<div>{event.message}</div></div>)}</div></details>
                    </article>;
                  })}
                </div>
              </section>

              {/* ── Package delivered ── */}
              <Panel
                title="What you deliver"
                subtitle={`${packageName}${packageDuration !== "-" ? ` · ${packageDuration}` : ""}`}
                action={<StatusChip tone="emerald">From package</StatusChip>}
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Included</div>
                    {includedItems.length ? (
                      <ul className="m-0 list-none space-y-2 p-0">
                        {includedItems.map((inc, idx) => (
                          <li key={`${inc}-${idx}`} className="flex items-start gap-2 text-[13.5px] leading-5 text-slate-800">
                            <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-white"><Check className="h-3 w-3" aria-hidden /></span>
                            <span className="min-w-0 break-words">{inc}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="m-0 text-[13px] text-slate-400">No inclusions captured in this package snapshot</p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Not included</div>
                    {excludedItems.length ? (
                      <ul className="m-0 list-none space-y-2 p-0">
                        {excludedItems.map((exc, idx) => (
                          <li key={`${exc}-${idx}`} className="flex items-start gap-2 text-[13.5px] leading-5 text-slate-600">
                            <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600"><Minus className="h-3 w-3" aria-hidden /></span>
                            <span className="min-w-0 break-words">{exc}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="m-0 text-[13px] text-slate-400">Nothing listed</p>
                    )}
                  </div>
                </div>
                <dl className="m-0 mt-5 grid gap-3 border-0 border-t border-solid border-slate-100 pt-4 sm:grid-cols-3">
                  {[
                    { icon: MapPin, label: "Pickup point", value: meetingPoint },
                    { icon: Plane, label: "Airport pickup", value: hasClientAirportPickup ? `Requested · ${departureAirportLabel}` : "Not requested" },
                    { icon: Users, label: "Group size", value: `${packageSnapshot?.minPax || "-"} to ${packageSnapshot?.maxPax || "-"} pax` },
                  ].map((fact) => (
                    <div key={fact.label} className="flex min-w-0 items-start gap-2.5">
                      <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]"><fact.icon className="h-4 w-4" aria-hidden /></span>
                      <div className="min-w-0">
                        <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{fact.label}</dt>
                        <dd className="m-0 mt-0.5 break-words text-[13.5px] font-semibold text-slate-900">{fact.value}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
              </Panel>

              {/* ── Day by day ── */}
              <Panel
                title="Day-by-day plan"
                subtitle="Services to run on each day of the trip."
                action={<StatusChip tone="slate">{servicesByDay.length} {servicesByDay.length === 1 ? "day" : "days"}</StatusChip>}
              >
                <ol className="m-0 list-none space-y-0 p-0">
                  {servicesByDay.map((day, index) => (
                    <li key={`day-${day.day}`} className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
                      {index < servicesByDay.length - 1 ? <span aria-hidden className="absolute bottom-0 left-[1.375rem] top-11 w-px bg-slate-200" /> : null}
                      <span className="relative flex h-11 w-11 flex-col items-center justify-center rounded-2xl bg-[#02665e] text-white">
                        <span className="text-[8.5px] font-bold uppercase tracking-[0.12em] text-white/70">Day</span>
                        <span className="text-[16px] font-black leading-none">{day.day}</span>
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="m-0 text-[14px] font-bold text-slate-900">{day.title}</h3>
                          <span className="text-[11.5px] font-semibold text-slate-400">{day.items.length} {day.items.length === 1 ? "service" : "services"}</span>
                        </div>
                        <ul className="m-0 mt-2 grid list-none gap-1.5 p-0 sm:grid-cols-2">
                          {day.items.map((svc, idx) => (
                            <li key={`${day.day}-${idx}-${svc}`} className="flex min-w-0 items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] leading-5 text-slate-700">
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                              <span className="min-w-0 break-words">{svc}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  ))}
                </ol>
                {packageServices.length > 0 ? (
                  <div className="mt-5 border-0 border-t border-solid border-slate-100 pt-4">
                    <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">All services in this package</div>
                    <div className="flex flex-wrap gap-1.5">
                      {packageServices.map((svc, idx) => (
                        <span key={`${svc}-${idx}`} className="rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[12px] font-semibold text-[#02665e]">{svc}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Panel>
            </div>

            {/* ── Side rail ── */}
            <aside className="min-w-0 space-y-5">
              <Panel title="Guest">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#02665e] text-[16px] font-black text-white">
                    {initials(guestName)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold text-slate-900">{guestName}</div>
                    <div className="truncate text-[12.5px] text-slate-500">
                      {[item?.requester?.nationality, travellers ? `${travellers} ${travellers === 1 ? "traveller" : "travellers"}` : null].filter(Boolean).join(" · ") || "Lead traveller"}
                    </div>
                  </div>
                </div>
                <div className="mt-4 divide-y divide-solid divide-slate-200 overflow-hidden rounded-2xl border border-solid border-slate-200 [&>*]:border-x-0">
                  <ContactRow href={guestPhone ? `tel:${guestPhone}` : undefined} icon={Phone} label="Phone" value={guestPhone} />
                  <ContactRow href={guestEmail ? `mailto:${guestEmail}` : undefined} icon={Mail} label="Email" value={guestEmail} />
                </div>
                <p className="m-0 mt-3 text-[11.5px] leading-relaxed text-slate-400">Contact details are for trip coordination only.</p>
              </Panel>

              <Panel title="Booking">
                <dl className="m-0 divide-y divide-solid divide-slate-200 [&>*]:border-x-0">
                  <SummaryRow label="Tour code" value={<span className="font-mono">{bookingCode}</span>} />
                  <SummaryRow label="Status" value={<StatusChip tone={stage === "CANCELLED" ? "rose" : stage === "COMPLETED" ? "slate" : "emerald"}>{String(status).replace(/_/g, " ").toLowerCase()}</StatusChip>} />
                  <SummaryRow label="Guest payment" value={<StatusChip tone={String(paymentStatus).toUpperCase().includes("REFUND") ? "rose" : "emerald"}>{String(paymentStatus).replace(/_/g, " ").toLowerCase()}</StatusChip>} />
                  <SummaryRow label="Booking value" value={bookingValue ? <span className="font-bold text-slate-900">{currency} {bookingValue}</span> : "-"} />
                  <SummaryRow label="Package type" value={item?.tripType || "-"} />
                  <SummaryRow label="Trip dates" value={endDateLabel && endDateLabel !== tripDateLabel ? `${tripDateLabel} to ${endDateLabel}` : tripDateLabel} />
                  <SummaryRow label="Booked on" value={fmtDate(item?.createdAt) || "-"} />
                  {item?.completedAt ? <SummaryRow label="Completed" value={fmtDate(item.completedAt) || "-"} /> : null}
                </dl>
              </Panel>

              <Panel title="Your payout">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[22px] font-extrabold leading-none tabular-nums text-slate-900">{payoutValue || "Pending"}</div>
                    <div className="mt-1 text-[12px] text-slate-500">
                      {payoutTone === "PAID" && item?.payoutPaidAt ? `Paid on ${fmtDate(item.payoutPaidAt)}` : payoutValue ? "Net after NoLSAF commission" : "Calculated when the booking settles"}
                    </div>
                  </div>
                  <StatusChip tone={payoutTone === "PAID" ? "emerald" : payoutTone.includes("RECOVER") || payoutTone.includes("HOLD") ? "rose" : "amber"}>
                    {payoutTone ? payoutTone.replace(/_/g, " ").toLowerCase() : "not started"}
                  </StatusChip>
                </div>
                <Link
                  href="/account/agent/revenues"
                  className="group mt-4 flex items-center justify-between rounded-2xl bg-slate-50 px-3.5 py-3 text-[13px] font-semibold text-slate-700 no-underline transition-colors hover:bg-[#02665e]/5 hover:text-[#02665e]"
                >
                  View all revenues
                  <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden />
                </Link>
              </Panel>

              <Panel
                title="Handling flow"
                subtitle={hasClientAirportPickup ? `Airport pickup requested at ${departureAirportLabel}.` : "No airport pickup requested."}
              >
                <ol className="m-0 list-none p-0">
                  {connectedFlow.map((step, idx) => {
                    const done = idx === 0 || (idx === 1 && alreadyPickupValidated) || stage === "COMPLETED";
                    return (
                      <li key={`${step.title}-${idx}`} className="relative flex gap-3 pb-4 last:pb-0">
                        {idx < connectedFlow.length - 1 ? <span aria-hidden className={`absolute bottom-0 left-[0.6875rem] top-6 w-px ${done ? "bg-[#02665e]/40" : "bg-slate-200"}`} /> : null}
                        <span className={`relative inline-flex h-[1.375rem] w-[1.375rem] flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold ${done ? "bg-[#02665e] text-white" : "border border-solid border-slate-300 bg-white text-slate-500"}`}>
                          {done ? <Check className="h-3 w-3" aria-hidden /> : idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900">
                            {step.title}
                          </div>
                          <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-slate-500">{step.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-4 flex items-center gap-2 rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[12px] text-slate-500">
                  <Route className="h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden />
                  Day tasks are ticked from My bookings once the trip is in progress.
                </div>
              </Panel>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

// ── Presentation pieces ─────────────────────────────────────────────────

const BRAND = "#02665e";
// Preflight is off in this app, so nothing sets border-box globally: a w-full
// field with padding would overflow its column on phones. Scoped to this page.
const DETAIL_BOX_SIZING = "#operator-booking-page, #operator-booking-page * { box-sizing: border-box; }";
const PRIMARY_BUTTON = "inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition-colors hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-50";
const JOURNEY_STEPS = ["Booked", "Paid", "Pickup", "On tour", "Completed"] as const;

function dayStart(value: string | number | Date): number {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "G") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-3xl border border-solid border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[15.5px] font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
        </div>
        {action ? <div className="flex-shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function StatusChip({ tone, children }: { tone: "emerald" | "amber" | "rose" | "slate"; children: ReactNode }) {
  const style = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-600",
  }[tone];
  const dot = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-400" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="flex-shrink-0 text-[12.5px] text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-[13px] font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function ContactRow({ href, icon: Icon, label, value }: { href?: string; icon: typeof Phone; label: string; value: string | null }) {
  const body = (
    <>
      <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</span>
        <span className={`block truncate text-[13.5px] font-semibold ${value ? "text-slate-900" : "text-slate-400"}`}>{value || "Not shared"}</span>
      </span>
      {href ? <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden /> : null}
    </>
  );
  const rowClass = "group flex w-full items-center gap-3 bg-white px-3.5 py-3";
  return href ? <a href={href} className={`${rowClass} no-underline transition-colors hover:bg-slate-50`}>{body}</a> : <div className={rowClass}>{body}</div>;
}

/** Five named steps on a line, on the brand pass; filled up to where this trip is. */
function JourneySteps({ reached, blocked }: { reached: number; blocked?: boolean }) {
  return (
    <ol className="m-0 grid list-none grid-cols-5 p-0" aria-label={`Journey: ${JOURNEY_STEPS[reached]}, step ${reached + 1} of ${JOURNEY_STEPS.length}`}>
      {JOURNEY_STEPS.map((step, index) => {
        const done = index <= reached && !blocked;
        const current = index === reached;
        const lineDone = index + 1 <= reached && !blocked;
        const label = current ? "text-white" : done ? "text-white/75" : "text-white/45";
        return (
          <li key={step} className="relative flex flex-col items-center gap-1.5 text-center">
            {index < JOURNEY_STEPS.length - 1 ? <span aria-hidden className={`absolute left-1/2 top-[5px] h-px w-full ${lineDone ? "bg-white/70" : "bg-white/20"}`} /> : null}
            <span className={`relative h-2.5 w-2.5 rounded-full ${done ? "bg-white" : "bg-white/25"} ${current && !blocked ? "ring-4 ring-white/20" : ""}`} />
            <span className={`text-[10.5px] font-semibold leading-tight sm:text-[11.5px] ${label}`}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
