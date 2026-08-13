"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import { AlertTriangle, ArrowLeft, Calendar, CheckCircle2, CircleDollarSign, ClipboardList, CreditCard, ExternalLink, FileText, MapPin, Phone, Route, Send, User, Users, Handshake, ShieldCheck, Key } from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";
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

function InfoRow({
  icon,
  label,
  value,
  accent = false,
  slideDelayMs = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  slideDelayMs?: number;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border p-3 shadow-sm transition-all duration-700 motion-reduce:transition-none ${accent ? "border-[#02665e]/25 bg-white/90" : "border-slate-300 bg-slate-100"}`}>
      {accent ? (
        <div
          className="pointer-events-none absolute inset-0 transition-transform duration-700 ease-out motion-reduce:transition-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.42) 1px, transparent 1.4px), linear-gradient(95deg, rgba(2,102,94,0.16) 0%, rgba(2,102,94,0.1) 52%, rgba(2,102,94,0.14) 100%)",
            backgroundSize: "14px 14px, auto",
            transform: "translateX(0)",
            transitionDelay: `${slideDelayMs}ms`,
          }}
          aria-hidden
        />
      ) : null}

      <div className="relative z-10 flex items-start gap-3">
        <div className={`h-10 w-10 rounded-xl border flex items-center justify-center shadow-sm transition-colors duration-700 motion-reduce:transition-none ${accent ? "bg-white/90 border-[#02665e]/25 text-[#02665e]" : "bg-white border-teal-300 text-[#01564f]"}`}>
          {icon}
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{label}</div>
          <div className="mt-1 text-sm font-extrabold text-slate-950">{value}</div>
        </div>
      </div>
    </div>
  );
}

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

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
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
  const statusLabel = String(status).replace(/_/g, " ");
  const paymentLabel = String(paymentStatus).replace(/_/g, " ");
  const statusTone = String(status).toUpperCase();
  const paymentTone = String(paymentStatus).toUpperCase();

  const statusClass =
    statusTone.includes("COMPLETE")
      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
      : statusTone.includes("CONFIRM") || statusTone === "PAID"
      ? "border-teal-300 bg-teal-100 text-teal-900"
      : statusTone.includes("CANCEL") || statusTone.includes("REFUND")
      ? "border-rose-300 bg-rose-100 text-rose-900"
      : "border-amber-300 bg-amber-100 text-amber-900";

  const paymentClass =
    paymentTone === "PAID"
      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
      : paymentTone.includes("REFUND")
      ? "border-rose-300 bg-rose-100 text-rose-900"
      : "border-blue-300 bg-blue-100 text-blue-900";

  const tripDate = useMemo(
    () =>
      item?.tripDate
        ? new Date(item.tripDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "-",
    [item?.tripDate]
  );

  const createdAt = useMemo(
    () =>
      item?.createdAt
        ? new Date(item.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "-",
    [item?.createdAt]
  );

  const completedAt = useMemo(
    () =>
      item?.completedAt
        ? new Date(item.completedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "-",
    [item?.completedAt]
  );

  const amountPaid =
    typeof item?.amountPaid === "number"
      ? `${item?.currency || "TZS"} ${item.amountPaid.toLocaleString()}`
      : "-";

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
        second: "2-digit",
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
          ? `Client requested airport pickup at ${meetingPoint}. Agent must receive the guest there first, then run trip briefing before moving to itinerary tasks.`
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

  return (
    <div className="w-full py-2 sm:py-4">
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

      <div className="mb-6 rounded-3xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/30 to-cyan-50/20 shadow-card overflow-hidden">
        <div className="p-5 sm:p-7">
          <Link
            href="/account/agent/bookings"
            className="mb-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-3 py-1.5 text-sm font-semibold text-slate-700 no-underline transition-colors hover:border-[#02665e]/30 hover:text-[#02665e] group"
          >
            <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-1" />
            Back to My Bookings
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">{title}</h1>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <MetricCard label="Tour Code" value={bookingCode} tone="teal" />
                <div className={`rounded-2xl border p-3 shadow-sm ${statusClass}`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">Status</div>
                  <div className="mt-1 text-sm font-bold uppercase">{statusLabel}</div>
                </div>
                <div className={`rounded-2xl border p-3 shadow-sm ${paymentClass}`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">Disbursement Status</div>
                  <div className="mt-1 text-sm font-bold uppercase">{paymentLabel}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
              <Skeleton className="h-4 w-36" />
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
              <Skeleton className="h-4 w-28" />
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
            <Skeleton className="h-4 w-52" />
            <div className="mt-4 grid grid-cols-2 xl:grid-cols-5 gap-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
            <Skeleton className="h-4 w-56" />
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-3 h-28" />
              <Skeleton className="mt-3 h-28" />
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
              <Skeleton className="h-4 w-52" />
              <Skeleton className="mt-3 h-20" />
              <Skeleton className="mt-3 h-20" />
              <Skeleton className="mt-3 h-20" />
            </section>
          </div>

          <div className="flex flex-col items-center justify-center py-2">
            <LogoSpinner size="sm" ariaLabel="Loading tour booking" />
            <p className="mt-2 text-xs text-slate-500">Loading booking details...</p>
          </div>
        </div>
      ) : authRequired ? (
        <div className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur p-6 shadow-card">
          <div className="text-sm font-bold text-slate-900">Sign in required</div>
          <div className="text-sm text-slate-600 mt-1">Log in to view booking details.</div>
          <div className="mt-4">
            <Link
              href="/account/login"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-white font-semibold no-underline hover:bg-brand-700 shadow-card transition-colors"
            >
              Sign in
              <ArrowLeft className="w-4 h-4 rotate-180" aria-hidden />
            </Link>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          <div className="font-bold">Could not load booking</div>
          <div className="text-sm mt-1 text-rose-800">{error}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">Trip Snapshot</h2>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Card Summary</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={<ClipboardList className="w-5 h-5" aria-hidden />} label="Status" value={status} />
              <InfoRow icon={<CreditCard className="w-5 h-5" aria-hidden />} label="Disbursement Status" value={paymentStatus} />
              <InfoRow icon={<Calendar className="w-5 h-5" aria-hidden />} label="Trip date" value={tripDate} />
              <InfoRow icon={<CheckCircle2 className="w-5 h-5" aria-hidden />} label="Completed" value={completedAt} />
              <InfoRow icon={<Calendar className="w-5 h-5" aria-hidden />} label="Booked on" value={createdAt} />
              <InfoRow icon={<Users className="w-5 h-5" aria-hidden />} label="Travelers" value={item?.requester?.travelerCount ?? "-"} />
            </div>
          </section>

          <section
            className={`relative overflow-hidden rounded-2xl p-5 sm:p-6 shadow-sm transition-all duration-700 motion-reduce:transition-none ${alreadyPickupValidated ? "border-emerald-200" : "border-teal-200"}`}
            style={{
              background: alreadyPickupValidated
                ? "linear-gradient(135deg, #f3fdf8 0%, #e9faf3 48%, #e6f7f5 100%)"
                : "linear-gradient(135deg, #f0fdf9 0%, #ecf9f7 50%, #e0f2f1 100%)",
            }}
          >
            <svg className="pointer-events-none absolute inset-0 w-full h-full opacity-40" viewBox="0 0 400 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="80" cy="40" r="60" stroke="#02665e" strokeOpacity="0.05" strokeWidth="1" />
              <circle cx="320" cy="160" r="80" stroke="#0d9488" strokeOpacity="0.04" strokeWidth="1" />
              <circle cx="200" cy="100" r="40" stroke="#14b8a6" strokeOpacity="0.05" strokeWidth="1" />
            </svg>
            <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "radial-gradient(circle, rgba(2,102,94,0.03) 1px, transparent 1px)", backgroundSize: "24px 24px" }} aria-hidden="true" />
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h2 className="text-sm font-bold text-slate-900">Pickup Validation</h2>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all duration-500 motion-reduce:transition-none ${alreadyPickupValidated ? "border-emerald-200 bg-emerald-100 text-emerald-800 shadow-sm shadow-emerald-200/60" : "border-amber-200 bg-amber-100 text-amber-800"}`}>
                  {alreadyPickupValidated ? "Validated" : "Pending"}
                </span>
              </div>

            <div className="relative overflow-hidden space-y-3 rounded-xl bg-teal-50/40 p-4">
              <div className="pointer-events-none absolute inset-0" aria-hidden>
                <Handshake className={`absolute -left-4 top-2 h-20 w-20 transition-colors duration-700 ${alreadyPickupValidated ? "text-emerald-700/10" : "text-teal-700/10"}`} />
                <ShieldCheck className={`absolute right-6 top-6 h-16 w-16 transition-colors duration-700 ${alreadyPickupValidated ? "text-emerald-700/10" : "text-teal-700/10"}`} />
                <Key className={`absolute right-16 bottom-2 h-20 w-20 transition-colors duration-700 ${alreadyPickupValidated ? "text-emerald-700/10" : "text-teal-700/10"}`} />
              </div>
              <div className="relative z-10">
                <p className="text-sm font-semibold text-slate-900">
                  Validation Steps
                </p>
                <ol className="space-y-2 text-sm text-slate-700">
                  <li className="flex items-start gap-2">
                    <Handshake className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" aria-hidden />
                    <span><strong>Meet the client</strong> in person for first pickup</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" aria-hidden />
                    <span><strong>Verify identity</strong> confirm you met <strong>{item?.requester?.fullName || "the client"}</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Key className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" aria-hidden />
                    <span>
                      <strong>Enter code suffix</strong> last 6 characters of tour code
                      {expectedCodeSuffix ? (
                        <> (e.g., <strong className="text-slate-900">{expectedCodeSuffix}</strong>)</>
                      ) : null}
                    </span>
                  </li>
                </ol>
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 mt-3">
                  <p className="text-xs font-bold text-rose-700 uppercase tracking-wide">⚠️ Terms of Service Violation</p>
                  <p className="mt-2 text-xs text-rose-800">
                    Validating without physically meeting the client will be considered a violation of our Terms of Service and may result in account suspension, cancellation of bookings, and legal action.
                  </p>
                </div>
              </div>
            </div>

            <div className={`mt-3 overflow-hidden transition-all duration-500 motion-reduce:transition-none ${alreadyPickupValidated ? "max-h-24 opacity-100 translate-y-0" : "max-h-0 opacity-0 -translate-y-1"}`}>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden />
                  <span>Pickup already validated{pickupValidatedAt ? ` on ${pickupValidatedAt}` : ""}.</span>
                </div>
              </div>
            </div>

            {!alreadyPickupValidated ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-center">
                <input
                  value={pickupCodeInput}
                  onChange={(e) => setPickupCodeInput(e.target.value.toUpperCase())}
                  placeholder="Enter last 6 (e.g. B47DA9)"
                  className="h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-900 outline-none ring-0 focus:border-[#02665e]"
                  maxLength={12}
                />
                <button
                  type="button"
                  onClick={() => void validatePickupFirstMeet()}
                  disabled={!!(pickupValidating || pickupCodeInput.length === 0 || (expectedCodeSuffix && pickupCodeInput.toUpperCase() !== expectedCodeSuffix))}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-[#02665e] px-4 text-sm font-bold text-white transition hover:bg-[#01564f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pickupValidating ? "Validating..." : "Validate First Meet"}
                </button>
              </div>
            ) : null}

            {pickupValidationErr ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700">{pickupValidationErr}</div>
            ) : null}
            {pickupValidationMsg ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">{pickupValidationMsg}</div>
            ) : null}
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
              <div className="text-sm font-bold text-slate-900">Guest details</div>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <InfoRow
                  icon={<User className="w-5 h-5" aria-hidden />}
                  label="Full name"
                  value={item?.requester?.fullName || "-"}
                  accent={alreadyPickupValidated}
                  slideDelayMs={0}
                />
                <InfoRow
                  icon={<Phone className="w-5 h-5" aria-hidden />}
                  label="Phone"
                  value={item?.requester?.phone || "-"}
                  accent={alreadyPickupValidated}
                  slideDelayMs={80}
                />
                <InfoRow
                  icon={<User className="w-5 h-5" aria-hidden />}
                  label="Email"
                  value={item?.requester?.email || "-"}
                  accent={alreadyPickupValidated}
                  slideDelayMs={160}
                />
                <InfoRow
                  icon={<User className="w-5 h-5" aria-hidden />}
                  label="Nationality"
                  value={item?.requester?.nationality || "-"}
                  accent={alreadyPickupValidated}
                  slideDelayMs={240}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
              <div className="text-sm font-bold text-slate-900">Booking info</div>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <InfoRow icon={<ClipboardList className="w-5 h-5" aria-hidden />} label="Tour code" value={bookingCode} />
                <InfoRow icon={<ClipboardList className="w-5 h-5" aria-hidden />} label="Package type" value={item?.tripType || "-"} />
                <InfoRow icon={<CreditCard className="w-5 h-5" aria-hidden />} label="Amount paid" value={amountPaid} />
                <InfoRow icon={<Calendar className="w-5 h-5" aria-hidden />} label="End date" value={item?.endDate ? new Date(item.endDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-"} />
              </div>
            </section>
          </div>

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

          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">Booked Package Blueprint</h2>
              <span className="rounded-full border border-teal-200 bg-teal-100 px-2.5 py-1 text-[11px] font-bold text-teal-800">Connected to package</span>
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
              <InfoRow icon={<ClipboardList className="w-5 h-5" aria-hidden />} label="Package" value={packageName} />
              <InfoRow icon={<Calendar className="w-5 h-5" aria-hidden />} label="Duration" value={packageDuration} />
              <InfoRow icon={<MapPin className="w-5 h-5" aria-hidden />} label="Pickup Point" value={meetingPoint} />
              <InfoRow
                icon={<MapPin className="w-5 h-5" aria-hidden />}
                label="Client Pickup Request"
                value={hasClientAirportPickup ? `Yes - ${departureAirportLabel}` : "No airport pickup selected"}
              />
              <InfoRow icon={<Users className="w-5 h-5" aria-hidden />} label="Pax Range" value={`${packageSnapshot?.minPax || "-"} - ${packageSnapshot?.maxPax || "-"}`} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">Package Services by Day</h2>
              <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">
                {servicesByDay.length} day plan
              </span>
            </div>

            {packageServices.length > 0 ? (
              <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">All Services In This Package</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {packageServices.map((svc, idx) => (
                    <span key={`${svc}-${idx}`} className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-900">
                      {svc}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {servicesByDay.map((day) => (
                <div key={`day-${day.day}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Day {day.day}</p>
                    <span className="rounded-full border border-teal-200 bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800">{day.items.length} services</span>
                  </div>
                  <h3 className="mt-1 text-sm font-bold text-slate-900">{day.title}</h3>
                  <ul className="mt-3 space-y-2">
                    {day.items.map((svc, idx) => (
                      <li key={`${day.day}-${idx}-${svc}`} className="flex items-start gap-2 text-sm text-slate-800">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-700" />
                        <span>{svc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">What Agent Will Deliver</h2>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">Included in Package</div>
                  {includedItems.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {includedItems.map((v, idx) => (
                        <li key={`${v}-${idx}`} className="flex items-start gap-2 text-sm text-emerald-900">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>{v}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-emerald-900">No explicit inclusions were captured in this package snapshot.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-rose-800">Not Included</div>
                  {excludedItems.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {excludedItems.map((v, idx) => (
                        <li key={`${v}-${idx}`} className="flex items-start gap-2 text-sm text-rose-900">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-500" />
                          <span>{v}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-rose-900">No exclusion list was captured for this booking.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Connected Task Handling Flow</h2>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                {hasClientAirportPickup
                  ? `Pickup instruction from booking: Airport pickup requested at ${departureAirportLabel}.`
                  : "Pickup instruction from booking: No airport pickup requested by client."}
              </p>
              <div className="mt-4 space-y-3">
                {connectedFlow.map((step, idx) => (
                  <div key={`${step.title}-${idx}`} className="relative rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    {idx < connectedFlow.length - 1 ? (
                      <span className="pointer-events-none absolute -bottom-4 left-7 h-4 w-px bg-slate-300" aria-hidden />
                    ) : null}
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-teal-300 bg-teal-100 text-xs font-bold text-teal-900">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                          <Route className="h-4 w-4 text-teal-700" />
                          {step.title}
                        </div>
                        <p className="mt-1 text-sm text-slate-700">{step.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
