"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Percent,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import OperatorPublicProfile, { type PublicOperatorProfileData } from "./OperatorPublicProfile";
import { useAdminHref } from "@/lib/adminRecordRefs";


const api = apiClient;

type OperatorProfile = {
  companyName: string;
  companyLogoUrl: string;
  businessAddress: string;
  physicalLocation: string;
  yearsInOperation?: number;
  teamSize?: number;
  languages?: string;
  operatingRegions: string[];
  registeredParks: string[];
  contactPhone: string;
  contactEmail: string;
  whatsapp: string;
  description: string;
  tourismTypes: string[];
  tools: string[];
  vehicles: VehicleAsset[];
  services: string[];
  serviceClassification?: Record<string, string[]>;
  specializations: string[];
  addOns: string[];
  seasonalPricing: string;
  packages: string;
  packageItems: PackageItem[];
  seasonalPrices: SeasonalPrice[];
  capacityNotes: string;
  maxTripsPerDay: string;
  minimumBookingNotice: string;
  guidesAvailable: string;
  peakSeasonAvailability: string;
  blockedPeriods: string;
  gallery: string[];
  classifiedPhotos: Record<string, string[]>;
  review?: {
    status?: string;
    reason?: string | null;
    reviewedAt?: string;
    reviewedByAdminId?: number;
    submittedAt?: string;
    changes?: {
      fieldsModified: Array<{ field: string; oldValue: any; newValue: any }>;
      itemsAdded: Array<{ category: string; count: number; examples: string[] }>;
      itemsRemoved: Array<{ category: string; count: number; examples: string[] }>;
    };
  };
};

type OperatorVerification = {
  status: "VERIFIED";
  certificateId: string;
  approvedAt: string | null;
  verificationUrl: string | null;
};

type VehicleAsset = {
  id: string;
  type: string;
  quantity: string;
  seatsPerVehicle: string;
  registrationNumber: string;
  ownedBy: string;
  serviceMode: string;
  notes: string;
};

type ItineraryDay = {
  id: string;
  day: number;
  title: string;
  description: string;
  events: ItineraryEvent[];
};

type ItineraryEvent = {
  id: string;
  startTime: string;
  endTime: string;
  activity: string;
  difficulty: string;
};

type PackageItem = {
  id: string;
  name: string;
  description: string;
  destination: string;
  category: string;
  duration: string;
  minPax: string;
  maxPax: string;
  pricePerPerson: string;
  currency: string;
  discountFactor: string;
  discountType: string;
  discountValue: string;
  discountCondition: string;
  discountUnit: string;
  mode: string;
  accommodation: string;
  mealPlan: string;
  difficulty: string;
  meetingPoint: string;
  included: string[];
  excluded: string[];
  itinerary: ItineraryDay[];
  notes: string;
};

type SeasonalPrice = {
  id: string;
  seasonName: string;
  startMonth: string;
  endMonth: string;
  pricePerPerson: string;
  currency: string;
  notes: string;
};

function parseTimelineToEvents(input: unknown): ItineraryEvent[] {
  const parseLineText = (line: string): ItineraryEvent | null => {
    const trimmed = String(line || "").trim();
    if (!trimmed) return null;

    const rangeMatch = trimmed.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*-\s*(.+)$/);
    if (rangeMatch) {
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startTime: rangeMatch[1],
        endTime: rangeMatch[2],
        activity: rangeMatch[3].trim(),
        difficulty: "",
      };
    }

    const startMatch = trimmed.match(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/);
    if (startMatch) {
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startTime: startMatch[1],
        endTime: "",
        activity: startMatch[2].trim(),
        difficulty: "",
      };
    }

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startTime: "",
      endTime: "",
      activity: trimmed,
      difficulty: "",
    };
  };

  if (Array.isArray(input)) {
    return input
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const rawTime = String((entry as any)?.time || "").trim();
          const timeParts = rawTime.split(/\s*-\s*/).map((x) => x.trim()).filter(Boolean);
          const startTime = timeParts[0] || "";
          const endTime = timeParts[1] || "";
          const label = String((entry as any)?.label || "").trim();
          const description = String((entry as any)?.description || "").trim();
          const activity = label || description;
          if (!startTime && !endTime && !activity) return null;
          return {
            id: String((entry as any)?.id || "") || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            startTime,
            endTime,
            activity,
            difficulty: String((entry as any)?.experienceVibe || (entry as any)?.difficulty || "").trim(),
          } as ItineraryEvent;
        }
        return parseLineText(String(entry || ""));
      })
      .filter((evt: any): evt is ItineraryEvent => !!evt && (!!evt.activity || !!evt.startTime || !!evt.endTime));
  }

  return String(input || "")
    .split(/\n+/)
    .map((line) => parseLineText(line))
    .filter((evt: any): evt is ItineraryEvent => !!evt && (!!evt.activity || !!evt.startTime || !!evt.endTime));
}

function normalizeItineraryDay(day: any, index: number): ItineraryDay {
  const rawEvents: any[] = Array.isArray(day?.events) ? day.events : [];
  const mappedEvents = rawEvents
    .map((evt: any) => {
      const startTime = String(evt?.startTime || "").trim();
      const endTime = String(evt?.endTime || "").trim();
      const activity = String(evt?.activity || "").trim();
      if (!startTime && !endTime && !activity) return null;
      return {
        id: String(evt?.id || "") || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startTime,
        endTime,
        activity,
        difficulty: String(evt?.experienceVibe || evt?.difficulty || "").trim(),
      } as ItineraryEvent;
    })
    .filter((evt: any) => !!evt) as ItineraryEvent[];

  const events = mappedEvents.length > 0 ? mappedEvents : parseTimelineToEvents(day?.timeline);

  return {
    id: String(day?.id || "") || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    day: Number(day?.day) > 0 ? Number(day.day) : index + 1,
    title: String(day?.title || "").trim(),
    description: String(day?.description || "").trim(),
    events,
  };
}

export function OperatorProfilePreviewScreen({
  adminAgentId: adminAgentIdProp,
  publicAgentKey: publicAgentKeyProp,
}: {
  adminAgentId?: number;
  publicAgentKey?: string;
} = {}) {
  const recordHref = useAdminHref();
  const searchParams = useSearchParams();
  const adminAgentIdRaw = String(searchParams.get("adminAgentId") || "").trim();
  const adminAgentIdFromQuery = Number(adminAgentIdRaw);
  const adminAgentId = Number.isFinite(Number(adminAgentIdProp)) && Number(adminAgentIdProp) > 0
    ? Number(adminAgentIdProp)
    : adminAgentIdFromQuery;
  const publicAgentKey = String(publicAgentKeyProp || "").trim().toLowerCase();
  const isAdminPreview = Number.isFinite(adminAgentId) && adminAgentId > 0;
  const isPublicPreview = !isAdminPreview && /^[a-z0-9]{20,40}$/.test(publicAgentKey);
  const [resolvedPublicAgentId, setResolvedPublicAgentId] = useState(0);
  // Resolved agent ID used for booking links (public or admin preview)
  const effectiveAgentId = (isAdminPreview ? adminAgentId : resolvedPublicAgentId) || 0;
  const backHref = isAdminPreview
    ? recordHref("agent", adminAgentId, { suffix: "?tab=profile" })
    : isPublicPreview
      ? "/public/tour-packages"
      : "/account/agent/profile";
  const backLabel = isAdminPreview
    ? "Back to submitted profile review"
    : isPublicPreview
      ? "Back to tour packages"
      : "Back to profile editor";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; text: string; retry: boolean } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [profile, setProfile] = useState<OperatorProfile | null>(null);
  const [operatorVerification, setOperatorVerification] = useState<OperatorVerification | null>(null);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>("SUBMITTED");
  const [reviewLoading, setReviewLoading] = useState(false);
  // Inline decision step in the review bar: approve confirmation or the rejection reason.
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [suspendConfirmOpen, setSuspendConfirmOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendLoading, setSuspendLoading] = useState(false);
  const [reviewToast, setReviewToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [commissionPercent, setCommissionPercent] = useState<number>(15);
  const [systemCommission, setSystemCommission] = useState<number>(15);
  const [commissionDraft, setCommissionDraft] = useState<string>("15");
  const [useSystemCommission, setUseSystemCommission] = useState<boolean>(true);
  const [commissionModalOpen, setCommissionModalOpen] = useState(false);
  const [_totalPhotos, setTotalPhotos] = useState(0);

  const resolveProfileCommission = (rawProfile: any) => {
    const profileCommission = Number(
      rawProfile?.commissionPercent ??
      (rawProfile?.services && typeof rawProfile.services === "object" ? rawProfile.services?.commissionPercent : undefined)
    );
    return Number.isFinite(profileCommission) && profileCommission >= 0 ? profileCommission : null;
  };

  useEffect(() => {
    (async () => {
      try {
        let loadedCommission: number | null = null;
        const res = isAdminPreview
          ? await api.get(`/api/admin/agents/${adminAgentId}`)
          : isPublicPreview
            ? await api.get(`/api/public/agents/${encodeURIComponent(publicAgentKey)}`)
          : await api.get("/api/agent/me");
        if (isAdminPreview) {
          // Settings only supply the default commission; never let them sink the whole review.
          try {
            const settingsRes = await api.get("/api/admin/settings");
            const settings = (settingsRes as any)?.data ?? {};
            const loadedPct = Number(settings?.agentCommissionPercent ?? settings?.commissionPercent ?? 15);
            loadedCommission = Number.isFinite(loadedPct) ? loadedPct : 15;
          } catch {
            loadedCommission = 15;
          }
        } else if (isPublicPreview) {
          try {
            const settingsRes = await fetch(`/api/public/support/system-settings`, { cache: "no-store" });
            if (settingsRes.ok) {
              const settings = await settingsRes.json();
              const loadedPct = Number(settings?.agentCommissionPercent ?? settings?.commissionPercent ?? 15);
              loadedCommission = Number.isFinite(loadedPct) ? loadedPct : 15;
            }
          } catch {
            loadedCommission = 15;
          }
        }
        const payload = (res as any)?.data;
        const agent = payload?.agent ?? payload?.data ?? payload ?? null;
        if (isPublicPreview) {
          const resolvedId = Number(agent?.id || 0);
          setResolvedPublicAgentId(Number.isFinite(resolvedId) && resolvedId > 0 ? resolvedId : 0);
        }
        const raw = agent?.operatorProfile ?? agent?.profile ?? null;
        const verification = agent?.verification;
        setOperatorVerification(
          isPublicPreview && verification?.status === "VERIFIED" && typeof verification?.certificateId === "string"
            ? {
                status: "VERIFIED",
                certificateId: verification.certificateId,
                approvedAt: typeof verification.approvedAt === "string" ? verification.approvedAt : null,
                verificationUrl: typeof verification.verificationUrl === "string" ? verification.verificationUrl : null,
              }
            : null,
        );
        const profileCommission = resolveProfileCommission(raw);
        const effectiveCommission = profileCommission ?? loadedCommission;
        if (Number.isFinite(Number(loadedCommission))) {
          setSystemCommission(Number(loadedCommission));
        }
        if (Number.isFinite(Number(effectiveCommission))) {
          setCommissionPercent(Number(effectiveCommission));
          setCommissionDraft(String(Number(effectiveCommission)));
          setUseSystemCommission(profileCommission === null);
        }
        setAgentStatus(agent?.status ?? (isPublicPreview ? "ACTIVE" : null));
        const nextReviewStatus = String((raw as any)?.reviewStatus || (raw as any)?.review?.status || (isPublicPreview ? "APPROVED" : "SUBMITTED")).toUpperCase();
        setReviewStatus(nextReviewStatus);
        if (raw && typeof raw === "object") {
          const toStringArr = (v: unknown) =>
            Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
          const yearsInOperation = Number((raw as any).yearsInOperation);
          const teamSize = Number((raw as any).teamSize);
          const sanitized: OperatorProfile = {
            ...(raw as any),
            services: toStringArr((raw as any).services),
            yearsInOperation: Number.isFinite(yearsInOperation) ? yearsInOperation : undefined,
            teamSize: Number.isFinite(teamSize) ? teamSize : undefined,
            languages: typeof (raw as any).languages === "string" ? (raw as any).languages : "",
            serviceClassification:
              raw && typeof (raw as any).serviceClassification === "object"
                ? Object.entries((raw as any).serviceClassification).reduce((acc, [k, v]) => {
                    acc[String(k)] = toStringArr(v);
                    return acc;
                  }, {} as Record<string, string[]>)
                : {},
            specializations: toStringArr((raw as any).specializations),
            addOns: toStringArr((raw as any).addOns),
            tourismTypes: toStringArr((raw as any).tourismTypes),
            operatingRegions: toStringArr((raw as any).operatingRegions),
            registeredParks: toStringArr((raw as any).registeredParks),
            tools: toStringArr((raw as any).tools),
            gallery: toStringArr((raw as any).gallery),
            packageItems: Array.isArray((raw as any).packageItems)
              ? (raw as any).packageItems.map((pkg: any) => ({
                  ...pkg,
                  name: pkg.name ?? "",
                  description: pkg.description ?? "",
                  destination: pkg.destination ?? "",
                  category: pkg.category ?? "",
                  duration: pkg.duration ?? "",
                  minPax: pkg.minPax ?? "",
                  maxPax: pkg.maxPax ?? "",
                  pricePerPerson: pkg.pricePerPerson ?? "",
                  currency: pkg.currency ?? "USD",
                  discountFactor: pkg.discountFactor ?? "",
                  discountType: pkg.discountType ?? "",
                  discountValue: pkg.discountValue ?? "",
                  discountCondition: pkg.discountCondition ?? "",
                  discountUnit: pkg.discountUnit ?? "",
                  mode: pkg.mode ?? "Private",
                  accommodation: pkg.accommodation ?? "",
                  mealPlan: pkg.mealPlan ?? "",
                  difficulty: pkg.difficulty ?? "",
                  meetingPoint: pkg.meetingPoint ?? "",
                  included: toStringArr(pkg.included),
                  excluded: toStringArr(pkg.excluded),
                  itinerary: Array.isArray(pkg.itinerary)
                    ? pkg.itinerary.map((day: any, idx: number) => normalizeItineraryDay(day, idx))
                    : [],
                }))
              : [],
            vehicles: Array.isArray((raw as any).vehicles) ? (raw as any).vehicles : [],
            seasonalPrices: Array.isArray((raw as any).seasonalPrices) ? (raw as any).seasonalPrices : [],
          };
          setProfile(sanitized);
          const photos = Object.values(sanitized.classifiedPhotos ?? {}).reduce(
            (sum: number, arr: unknown) => sum + (Array.isArray(arr) ? arr.length : 0),
            0
          );
          setTotalPhotos(photos);
        }
      } catch (err: any) {
        // Say what actually went wrong instead of one generic line.
        const status = Number(err?.response?.status || 0);
        const serverText = String(err?.response?.data?.error || err?.response?.data?.message || "").trim();
        setError(
          status === 401 ? { title: "Your session has ended", text: "Sign in again to continue.", retry: false }
            : status === 403 ? { title: "You do not have access to this profile", text: serverText || "Ask an administrator for access.", retry: false }
              : status === 404 ? { title: isPublicPreview ? "This operator is not available" : "Operator not found", text: isPublicPreview ? "The profile may be under review or no longer listed." : "It may have been removed.", retry: false }
                : !err?.response ? { title: "Could not reach NoLSAF", text: "Check your connection and try again.", retry: true }
                  : { title: isAdminPreview ? "The submitted profile did not load" : "The profile did not load", text: serverText || `The server answered with an error${status ? ` (${status})` : ""}.`, retry: true },
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdminPreview, adminAgentId, isPublicPreview, publicAgentKey, reloadKey]);


  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        {/* Topbar skeleton */}
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <div className="h-9 w-9 animate-pulse rounded-full bg-slate-200" />
            <div className="h-6 w-40 animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6 space-y-4">
          {/* Banner photo strip */}
          <div className="h-48 w-full animate-pulse rounded-2xl bg-slate-200 sm:h-64" />

          {/* Company header card */}
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              {/* Logo circle */}
              <div className="h-16 w-16 flex-none animate-pulse rounded-2xl bg-slate-200" />
              <div className="flex-1 space-y-2.5">
                <div className="h-5 w-48 animate-pulse rounded-full bg-slate-200" />
                <div className="h-3.5 w-32 animate-pulse rounded-full bg-slate-100" />
                <div className="flex gap-2">
                  <div className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
                  <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />
                </div>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex divide-x divide-slate-100">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5 px-4 py-4">
                  <div className="h-6 w-8 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-14 animate-pulse rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          </div>

          {/* Main grid: 2-col content + 1-col sidebar */}
          <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
            {/* Left col (spans 2) */}
            <div className="space-y-4 lg:col-span-2">
              {/* About block */}
              <div className="h-36 w-full animate-pulse rounded-2xl bg-slate-200" />
              {/* Packages block */}
              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
                <div className="h-4 w-32 animate-pulse rounded-full bg-slate-200" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
                  ))}
                </div>
              </div>
            </div>

            {/* Right sidebar */}
            <div className="space-y-4">
              {/* Contact card */}
              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="h-10 w-full animate-pulse bg-slate-200" />
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-8 w-full animate-pulse rounded-lg bg-slate-100" />
                  ))}
                </div>
              </div>
              {/* Services card */}
              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="h-10 w-full animate-pulse bg-slate-200" />
                <div className="space-y-1 p-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-7 w-full animate-pulse rounded-lg bg-slate-100" />
                  ))}
                </div>
              </div>
              {/* Parks card */}
              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="h-10 w-full animate-pulse bg-slate-200" />
                <div className="flex flex-wrap gap-2 p-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-6 w-16 animate-pulse rounded-full bg-slate-100" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex min-h-[60vh] items-center justify-center px-4 py-12 ${isAdminPreview ? "bg-slate-50" : "bg-white"}`}>
        <div className="w-full max-w-md rounded-2xl border border-solid border-neutral-200 bg-white p-6 text-center shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)]">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="m-0 mt-4 text-base font-bold text-neutral-950">{error.title}</h1>
          <p className="m-0 mt-1.5 text-sm leading-6 text-neutral-500">{error.text}</p>
          <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">
            <Link href={backHref} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 no-underline hover:bg-neutral-50">
              <ArrowLeft className="h-4 w-4" aria-hidden /> {backLabel}
            </Link>
            {error.retry ? (
              <button
                type="button"
                onClick={() => { setError(null); setLoading(true); setReloadKey((k) => k + 1); }}
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-4 text-sm font-semibold text-white hover:bg-[#12342f]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden /> Try again
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const p = profile;
  const logoPhotos = p?.classifiedPhotos?.["logo"] ?? [];
  const logoUrl = p?.companyLogoUrl || logoPhotos[0] || null;

  const packagePriceRows = (p?.packageItems ?? [])
    .map((pkg, index) => {
      const price = Number(pkg?.pricePerPerson ?? 0);
      const currency = String(pkg?.currency || "USD");
      const title = String(pkg?.name || pkg?.destination || "Shared package");
      return { id: String(pkg?.id || index), price, currency, title };
    })
    .filter((row) => Number.isFinite(row.price) && row.price > 0);
  const effectiveCommissionForModal = Math.max(
    0,
    Math.min(100, useSystemCommission ? Number(systemCommission || 0) : Number(commissionDraft || 0)),
  );
  const shouldShowCommissionAdjustedPrice = isAdminPreview || isPublicPreview;
  const displayCommissionRate = Math.max(0, Number(commissionPercent || 0)) / 100;





  const suspendReasonOptions = [
    "Policy violation detected in submitted profile content.",
    "Repeated non-compliance with admin review requirements.",
    "Fraud risk or suspicious activity pending investigation.",
  ];

  // Confirmation and the rejection reason are collected inline in the review bar
  // (no browser prompt/confirm), so this only sends the decision.
  async function reviewFromPreview(nextStatus: "APPROVED" | "REJECTED", options?: { reason?: string }) {
    if (!isAdminPreview || !Number.isFinite(adminAgentId) || adminAgentId <= 0) return;

    const reason = String(options?.reason || "").trim();
    if (nextStatus === "REJECTED" && reason.length < 5) {
      setReviewToast({ kind: "error", text: "Tell the operator what to fix (at least 5 characters)." });
      window.setTimeout(() => setReviewToast(null), 3200);
      return;
    }

    try {
      setReviewLoading(true);
      await api.patch(`/api/admin/agents/${adminAgentId}/profile-review`, {
        status: nextStatus,
        reason: reason || null,
      });
      setReviewStatus(nextStatus);
      setReviewToast({
        kind: "success",
        text: nextStatus === "APPROVED" ? "Profile approved." : "Profile rejected.",
      });
      window.setTimeout(() => setReviewToast(null), 2800);
    } catch (e: any) {
      setReviewToast({ kind: "error", text: e?.response?.data?.error || e?.message || "Failed to update profile review status" });
      window.setTimeout(() => setReviewToast(null), 3200);
    } finally {
      setReviewLoading(false);
    }
  }

  async function suspendFromPreview() {
    if (!isAdminPreview || !Number.isFinite(adminAgentId) || adminAgentId <= 0) return;
    const reason = suspendReason.trim();
    if (reason.length < 10) {
      setReviewToast({ kind: "error", text: "Suspension reason must be at least 10 characters." });
      window.setTimeout(() => setReviewToast(null), 3200);
      return;
    }

    try {
      setSuspendLoading(true);
      await api.post(`/api/admin/agents/${adminAgentId}/suspend`, { reason });
      setAgentStatus("SUSPENDED");
      setSuspendConfirmOpen(false);
      setSuspendReason("");
      setReviewToast({ kind: "success", text: "Agent suspended successfully." });
      window.setTimeout(() => setReviewToast(null), 2800);
    } catch (e: any) {
      setReviewToast({ kind: "error", text: e?.response?.data?.error || e?.message || "Failed to suspend agent." });
      window.setTimeout(() => setReviewToast(null), 3200);
    } finally {
      setSuspendLoading(false);
    }
  }

  async function saveCommissionFromModal() {
    if (!isAdminPreview) return;
    const next = useSystemCommission ? Number(systemCommission) : Number(commissionDraft);
    if (!Number.isFinite(next) || next < 0 || next > 100) {
      setReviewToast({ kind: "error", text: "Commission must be a number between 0 and 100." });
      window.setTimeout(() => setReviewToast(null), 3200);
      return;
    }
    // Apply only for this submitted-profile review context. System default remains unchanged.
    const prev = Number(commissionPercent);
    setCommissionPercent(next);
    setCommissionModalOpen(false);

    if (Number.isFinite(adminAgentId) && adminAgentId > 0 && Math.abs(prev - next) > 0.0001) {
      try {
        const noteText = useSystemCommission
          ? `Commission reverted to system default (${systemCommission}%) for submitted profile pricing review.`
          : `Commission override set to ${next}% (system default ${systemCommission}%) for submitted profile pricing review.`;
        await api.post(`/api/admin/agents/${adminAgentId}/notes`, { text: noteText });
      } catch {
        // Non-blocking: pricing change can still apply in preview even if note creation fails.
      }
    }
  }

  return (
    <div className={isAdminPreview ? "min-h-screen bg-slate-50" : `min-h-screen bg-white text-slate-900${isPublicPreview ? " header-offset" : ""}`}>
      {/* -- Sticky topbar: admin review and the operator's own preview only.
          The public page is laid out like a stay page and carries its own "All tours" back pill. -- */}
      {isPublicPreview && !isAdminPreview ? null : (
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className={isAdminPreview ? "mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3" : "public-container flex items-center justify-between gap-3 py-3"}>
          <Link
            href={backHref}
            aria-label={backLabel}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-emerald-700"
            style={{ textDecoration: "none" }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {!isAdminPreview && !isPublicPreview ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-800">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="hidden sm:inline">Preview how customers will see this profile</span>
              <span className="sm:hidden">Preview mode</span>
            </div>
          ) : <div />}
        </div>
      </div>
      )}

      {reviewToast ? (
        <div className="fixed right-4 top-20 z-[70] w-[min(420px,calc(100vw-2rem))] rounded-xl border bg-white p-3.5 shadow-xl">
          <div className="flex items-start gap-2.5">
            <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${reviewToast.kind === "success" ? "bg-emerald-500" : "bg-rose-500"}`} />
            <div>
              <p className={`text-sm font-bold ${reviewToast.kind === "success" ? "text-emerald-700" : "text-rose-700"}`}>
                {reviewToast.kind === "success" ? "Update complete" : "Action failed"}
              </p>
              <p className="mt-0.5 text-sm text-slate-700">{reviewToast.text}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className={isAdminPreview ? "mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6" : "public-container py-6 sm:py-8"}>
        {/* Admin review bar: the decision, above the exact page travellers will see */}
        {isAdminPreview ? (
          <section className="mb-5 overflow-hidden rounded-2xl bg-[#0b2420] text-white">
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="m-0 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">
                  Profile review
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal ${reviewStatus === "APPROVED" ? "bg-emerald-400/20 text-emerald-200" : reviewStatus === "REJECTED" ? "bg-rose-400/20 text-rose-200" : "bg-amber-300/20 text-amber-200"}`}>
                    {reviewStatus === "APPROVED" ? "Approved" : reviewStatus === "REJECTED" ? "Returned to operator" : "Waiting for your decision"}
                  </span>
                  {agentStatus === "SUSPENDED" ? <span className="rounded-full bg-rose-400/20 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-rose-200">Account suspended</span> : null}
                </p>
                <h1 className="m-0 mt-1 truncate text-lg font-bold text-white">{p?.companyName || "Submitted operator profile"}</h1>
                <p className="m-0 mt-0.5 text-xs text-white/55">Below is exactly what travellers will see, with prices at {commissionPercent}% NoLSAF commission.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCommissionDraft(String(commissionPercent));
                    setUseSystemCommission(Math.abs(Number(commissionPercent) - Number(systemCommission)) < 0.0001);
                    setCommissionModalOpen(true);
                  }}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 hover:bg-white/[0.12]"
                  title="Try another commission rate on this preview. It does not change the operator's commission."
                >
                  <Percent className="h-3.5 w-3.5" aria-hidden /> Preview prices
                </button>
                {reviewStatus === "APPROVED" ? (
                  <button
                    type="button"
                    onClick={() => setSuspendConfirmOpen(true)}
                    aria-disabled={suspendLoading || agentStatus === "SUSPENDED"}
                    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-rose-300/40 bg-rose-400/10 px-3 text-xs font-semibold text-rose-100 hover:bg-rose-400/20 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {agentStatus === "SUSPENDED" ? "Suspended" : "Suspend"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { setDecision(decision === "REJECT" ? null : "REJECT"); setRejectReason(""); }}
                      aria-pressed={decision === "REJECT"}
                      className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid px-3 text-xs font-semibold ${decision === "REJECT" ? "border-rose-300 bg-rose-500 text-white" : "border-rose-300/40 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20"}`}
                    >
                      <XCircle className="h-3.5 w-3.5" aria-hidden /> Return
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecision(decision === "APPROVE" ? null : "APPROVE")}
                      aria-pressed={decision === "APPROVE"}
                      className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 px-3.5 text-xs font-semibold ${decision === "APPROVE" ? "bg-white text-[#0b2420]" : "bg-emerald-400 text-[#0b2420] hover:bg-emerald-300"}`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Approve
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Inline decision step: approve confirmation, or the reason the operator will read */}
            {decision && reviewStatus !== "APPROVED" ? (
              <div className="border-0 border-t border-solid border-white/10 bg-white/[0.04] px-5 py-4">
                {decision === "APPROVE" ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="m-0 text-sm text-white/80">
                      Approve and publish this profile? It goes live for travellers at once and the operator is notified.
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setDecision(null)} className="h-9 cursor-pointer rounded-lg border border-solid border-white/15 bg-transparent px-3 text-xs font-semibold text-white/80 hover:bg-white/10">Cancel</button>
                      <button
                        type="button"
                        onClick={() => { void reviewFromPreview("APPROVED").then(() => setDecision(null)); }}
                        aria-disabled={reviewLoading}
                        className="h-9 cursor-pointer rounded-lg border-0 bg-emerald-400 px-3.5 text-xs font-semibold text-[#0b2420] hover:bg-emerald-300 aria-disabled:pointer-events-none aria-disabled:opacity-60"
                      >
                        {reviewLoading ? "Approving" : "Yes, approve and publish"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="reject-reason" className="block text-xs font-semibold text-white/85">What should the operator fix before resubmitting?</label>
                    <textarea
                      id="reject-reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value.slice(0, 1000))}
                      placeholder="For example: package photos are missing and the Serengeti price looks too low."
                      className="mt-2 block min-h-[80px] w-full resize-y rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-rose-300"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-white/45">The operator reads this in their notification and email.</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setDecision(null)} className="h-9 cursor-pointer rounded-lg border border-solid border-white/15 bg-transparent px-3 text-xs font-semibold text-white/80 hover:bg-white/10">Cancel</button>
                        <button
                          type="button"
                          onClick={() => { void reviewFromPreview("REJECTED", { reason: rejectReason }).then(() => setDecision(null)); }}
                          aria-disabled={reviewLoading || rejectReason.trim().length < 5}
                          className="h-9 cursor-pointer rounded-lg border-0 bg-rose-500 px-3.5 text-xs font-semibold text-white hover:bg-rose-600 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                        >
                          {reviewLoading ? "Sending" : "Return to operator"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        {isAdminPreview && suspendConfirmOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              if (!suspendLoading) setSuspendConfirmOpen(false);
            }}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-slate-900">Are you sure?</h3>
              <p className="mt-2 text-sm text-slate-600">Are you sure you want to suspend this profile?</p>
              <div className="mt-4 mx-auto w-full max-w-md">
                <label className="mb-2 block text-xs font-semibold text-slate-600">Select suspension reason</label>
                <div className="space-y-2">
                  {suspendReasonOptions.map((reason) => (
                    <label
                      key={reason}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
                    >
                      <input
                        type="radio"
                        name="suspend-reason"
                        value={reason}
                        checked={suspendReason === reason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        className="mt-0.5 h-4 w-4 text-[#02665e]"
                      />
                      <span className="text-sm text-slate-700">{reason}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSuspendConfirmOpen(false)}
                  disabled={suspendLoading}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void suspendFromPreview()}
                  disabled={suspendLoading || !suspendReason.trim()}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-rose-200 bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {suspendLoading ? "Suspending..." : "Yes, Suspend"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isAdminPreview && commissionModalOpen ? (
          <div
            id="commission-preview-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/55 p-3 backdrop-blur-sm sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="commission-preview-title"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setCommissionModalOpen(false); }}
          >
            <style>{`#commission-preview-modal, #commission-preview-modal * { box-sizing: border-box; }`}</style>
            <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_32px_100px_-24px_rgba(0,0,0,.55)]">
              {/* Header */}
              <div className="flex shrink-0 items-start justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4">
                <div className="min-w-0">
                  <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Price preview</p>
                  <h2 id="commission-preview-title" className="m-0 mt-0.5 truncate text-base font-bold text-neutral-950">{p?.companyName || "Submitted operator"}</h2>
                  <p className="m-0 mt-0.5 text-[11px] text-neutral-500">Try a commission rate and see what travellers would pay. The operator&apos;s real commission does not change.</p>
                </div>
                <button type="button" onClick={() => setCommissionModalOpen(false)} aria-label="Close" className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Rate control: one number drives every price below */}
              <div className="shrink-0 border-0 border-b border-solid border-neutral-100 bg-neutral-50/70 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setUseSystemCommission(true); setCommissionDraft(String(systemCommission)); }}
                    aria-pressed={useSystemCommission}
                    className={`h-8 cursor-pointer rounded-lg border border-solid px-3 text-xs font-semibold transition ${useSystemCommission ? "border-[#0b2420] bg-[#0b2420] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
                  >
                    System default · {systemCommission}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseSystemCommission(false)}
                    aria-pressed={!useSystemCommission}
                    className={`h-8 cursor-pointer rounded-lg border border-solid px-3 text-xs font-semibold transition ${!useSystemCommission ? "border-[#0b2420] bg-[#0b2420] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
                  >
                    Custom rate
                  </button>
                  <span className="ml-auto text-[11px] text-neutral-500">Now showing <span className="font-bold tabular-nums text-neutral-900">{commissionPercent}%</span></span>
                </div>
                {(() => {
                  // Slider runs 0 to 40%; the number box accepts up to 100 for edge cases.
                  const SLIDER_MAX = 40;
                  const draft = Math.max(0, Number(commissionDraft) || 0);
                  const fill = (Math.min(SLIDER_MAX, draft) / SLIDER_MAX) * 100;
                  const defaultAt = (Math.min(SLIDER_MAX, Number(systemCommission) || 0) / SLIDER_MAX) * 100;
                  const nudge = (by: number) => {
                    const next = Math.max(0, Math.min(100, Math.round((draft + by) * 10) / 10));
                    setUseSystemCommission(false);
                    setCommissionDraft(String(next));
                  };
                  return (
                    <div className={`mt-4 transition-opacity ${useSystemCommission ? "pointer-events-none opacity-40" : ""}`}>
                      <style>{`
                        #commission-preview-modal .rate-range { -webkit-appearance: none; appearance: none; background: transparent; height: 20px; margin: 0; }
                        #commission-preview-modal .rate-range::-webkit-slider-runnable-track { height: 6px; border-radius: 999px; background: transparent; }
                        #commission-preview-modal .rate-range::-moz-range-track { height: 6px; border-radius: 999px; background: transparent; }
                        #commission-preview-modal .rate-range::-webkit-slider-thumb { -webkit-appearance: none; height: 18px; width: 18px; margin-top: -6px; border-radius: 999px; background: #fff; border: 2px solid #02665e; box-shadow: 0 1px 4px rgba(15,23,42,.25); cursor: pointer; }
                        #commission-preview-modal .rate-range::-moz-range-thumb { height: 14px; width: 14px; border-radius: 999px; background: #fff; border: 2px solid #02665e; box-shadow: 0 1px 4px rgba(15,23,42,.25); cursor: pointer; }
                        #commission-preview-modal .rate-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px rgba(16,185,129,.25); }
                        #commission-preview-modal .rate-number::-webkit-outer-spin-button, #commission-preview-modal .rate-number::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
                        #commission-preview-modal .rate-number { -moz-appearance: textfield; }
                      `}</style>
                      <div className="flex items-center gap-4">
                        <div className="relative min-w-0 flex-1">
                          {/* Track: filled part in brand green, with a tick where the system default sits */}
                          <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-neutral-200" aria-hidden />
                          <span className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#02665e]" style={{ width: `${fill}%` }} aria-hidden />
                          <span className="pointer-events-none absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-400" style={{ left: `${defaultAt}%` }} aria-hidden />
                          <input
                            type="range"
                            min={0}
                            max={SLIDER_MAX}
                            step={0.5}
                            value={Math.min(SLIDER_MAX, draft)}
                            onChange={(e) => { setUseSystemCommission(false); setCommissionDraft(e.target.value); }}
                            aria-label="Commission rate"
                            className="rate-range relative block w-full cursor-pointer"
                          />
                        </div>
                        <div className="flex shrink-0 items-center rounded-lg border border-solid border-neutral-200 bg-white focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100">
                          <button type="button" onClick={() => nudge(-0.5)} aria-label="Lower by half a percent" className="grid h-9 w-8 cursor-pointer place-items-center rounded-l-lg border-0 bg-transparent text-base font-semibold text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900">−</button>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={commissionDraft}
                            onChange={(e) => { setUseSystemCommission(false); setCommissionDraft(e.target.value); }}
                            aria-label="Commission percent"
                            className="rate-number block h-9 w-14 border-0 bg-transparent p-0 text-center text-sm font-bold tabular-nums text-neutral-900 outline-none"
                          />
                          <span className="pr-1 text-xs font-semibold text-neutral-400">%</span>
                          <button type="button" onClick={() => nudge(0.5)} aria-label="Raise by half a percent" className="grid h-9 w-8 cursor-pointer place-items-center rounded-r-lg border-0 bg-transparent text-base font-semibold text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900">+</button>
                        </div>
                      </div>
                      {/* Scale under the slider; the spacer matches the number box so labels line up */}
                      <div className="mt-1 flex gap-4 text-[10px] tabular-nums text-neutral-400" aria-hidden>
                        <div className="relative h-4 min-w-0 flex-1">
                          <span className="absolute left-0">0%</span>
                          <span className="absolute -translate-x-1/2 whitespace-nowrap font-semibold text-neutral-500" style={{ left: `${defaultAt}%` }}>Default {systemCommission}%</span>
                          <span className="absolute right-0">{SLIDER_MAX}%</span>
                        </div>
                        <span className="w-[8.25rem] shrink-0" />
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Live price table */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {packagePriceRows.length > 0 ? (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-0 border-b border-solid border-neutral-100 text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                        <th className="px-5 py-2.5">Package</th>
                        <th className="px-3 py-2.5 text-right">Operator asks</th>
                        <th className="px-3 py-2.5 text-right">Traveller pays</th>
                        <th className="px-5 py-2.5 text-right">NoLSAF earns</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packagePriceRows.map((row) => {
                        const rate = effectiveCommissionForModal / 100;
                        const nowRate = Number(commissionPercent || 0) / 100;
                        const cut = Math.round(row.price * rate * 100) / 100;
                        const final = Math.round((row.price + cut) * 100) / 100;
                        const delta = Math.round((final - row.price * (1 + nowRate)) * 100) / 100;
                        const fmt = (n: number) => `${row.currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
                        return (
                          <tr key={row.id} className="border-0 border-b border-solid border-neutral-100">
                            <td className="max-w-[220px] px-5 py-3"><span className="block truncate font-semibold text-neutral-900" title={row.title}>{row.title}</span><span className="text-[11px] text-neutral-400">per person</span></td>
                            <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-neutral-500">{fmt(row.price)}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right">
                              <span className="block font-bold tabular-nums text-neutral-950">{fmt(final)}</span>
                              {delta !== 0 ? <span className={`block text-[11px] font-semibold tabular-nums ${delta > 0 ? "text-amber-700" : "text-emerald-700"}`}>{delta > 0 ? "+" : "-"}{fmt(Math.abs(delta))} vs now</span> : <span className="block text-[11px] text-neutral-300">Same as now</span>}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-violet-700">{fmt(cut)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="m-0 px-5 py-10 text-center text-sm text-neutral-500">This profile has no package with a price yet.</p>
                )}
              </div>

              {/* Footer */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-5 py-3">
                <Link href="/admin/management/settings" className="text-[11px] font-semibold text-neutral-500 no-underline hover:text-neutral-900 hover:underline">
                  Discounts and bonuses live in Settings
                </Link>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCommissionModalOpen(false)} className="h-9 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Cancel</button>
                  <button
                    type="button"
                    onClick={saveCommissionFromModal}
                    aria-disabled={Math.abs(effectiveCommissionForModal - Number(commissionPercent)) < 0.0001}
                    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3.5 text-xs font-semibold text-white hover:bg-[#12342f] aria-disabled:pointer-events-none aria-disabled:opacity-40"
                  >
                    Show prices at {effectiveCommissionForModal}%
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {/* Everyone sees the same booking-first page: travellers, the operator previewing
            it, and the admin reviewing it (under the review bar above). */}
        {p ? (
          <OperatorPublicProfile
            profile={p as unknown as PublicOperatorProfileData}
            logoUrl={logoUrl}
            verified={isAdminPreview ? reviewStatus === "APPROVED" && agentStatus === "ACTIVE" : agentStatus === "ACTIVE"}
            verification={isPublicPreview && operatorVerification ? {
              certificateId: operatorVerification.certificateId,
              approvedAt: operatorVerification.approvedAt,
              verificationUrl: operatorVerification.verificationUrl,
            } : null}
            bookingKey={isPublicPreview && effectiveAgentId > 0 ? publicAgentKey : null}
            displayPrice={(raw) => {
              const base = Number(raw);
              if (!Number.isFinite(base)) return NaN;
              return shouldShowCommissionAdjustedPrice ? base * (1 + displayCommissionRate) : base;
            }}
            previewOnly={!isPublicPreview}
          />
        ) : null}

        {/* The old admin-only copy of the profile layout was retired: the admin review renders OperatorPublicProfile above. */}

        {/* Footer note */}
        {!isAdminPreview && !isPublicPreview ? (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-5 py-4 text-center text-xs text-slate-500">
            This is a preview of how this operator profile will appear to customers.{" "}
            <Link href={backHref} className="font-bold text-emerald-700 hover:text-emerald-800">
              Go to profile editor
            </Link>{" "}
            to update any details.
          </div>
        ) : null}
      </div>
    </div>
  );
}

