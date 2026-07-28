"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarClock,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Flame,
  Globe2,
  Landmark,
  Mail,
  MapPin,
  Mountain,
  Package,
  Percent,
  Phone,
  PlusCircle,
  Save,
  Settings,
  ShieldCheck,
  Tag,
  Users,
  Wrench,
  Lock,
  X,
  XCircle,
  Zap,
  Gauge,
  Camera,
  HeartPulse,
  Radio,
  CreditCard,
  Smartphone,
} from "lucide-react";
import apiClient from "@/lib/apiClient";


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

type SubmittedProfileAuditItem = {
  id: number;
  action: string;
  details: any;
  createdAt: string;
  adminId?: number;
  targetUserId?: number | null;
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

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5 mb-4">
      <span className="text-emerald-600">{icon}</span>
      <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">{title}</h2>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function StatItem({ value, label, icon: Icon, description }: { value: number | string; label: string; icon: React.ElementType; description: string }) {
  return (
    <div className="flex flex-1 items-center gap-2.5 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10">
        <Icon className="h-4 w-4 text-[#02665e]" />
      </div>
      <div className="min-w-0">
        <span className="block text-lg font-extrabold leading-none text-[#02665e]">{value}</span>
        <span className="block text-[11px] font-semibold text-slate-700 leading-tight">{label}</span>
        <span className="block text-[10px] text-slate-400 leading-tight truncate">{description}</span>
      </div>
    </div>
  );
}

function PhotoCarousel({ urls, category }: { urls: string[]; category: string }) {
  const [current, setCurrent] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const label =
    category === "vehicles" ? "Vehicles" :
    category === "team" ? "Our team" :
    category === "office" ? "Office & location" :
    category === "attractions" ? "Attractions" :
    category === "proof" ? "Proof photos" :
    category;

  const goTo = (idx: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.offsetWidth, behavior: "smooth" });
    setCurrent(idx);
  };

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setCurrent(Math.round(el.scrollLeft / el.offsetWidth));
  };

  if (!urls.length) return null;

  return (
    <div>
      <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{label}</p>
      <div className="relative overflow-hidden rounded-xl">
        {/* Scroll track */}
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory overflow-x-auto"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
        >
          {urls.map((url, i) => (
            <div key={i} className="relative aspect-[4/3] w-full flex-none snap-start bg-slate-100">
              <Image
                src={url}
                alt={`${label} ${i + 1}`}
                fill
                sizes="(max-width:1024px) 100vw, 66vw"
                className="object-cover"
                unoptimized
              />
            </div>
          ))}
        </div>

        {/* Prev arrow */}
        {urls.length > 1 && current > 0 && (
          <button
            onClick={() => goTo(current - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 hidden sm:flex items-center justify-center rounded-full bg-black/40 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/60"
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        {/* Next arrow */}
        {urls.length > 1 && current < urls.length - 1 && (
          <button
            onClick={() => goTo(current + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:flex items-center justify-center rounded-full bg-black/40 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/60"
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* Counter */}
        {urls.length > 1 && (
          <div className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm">
            {current + 1}/{urls.length}
          </div>
        )}
      </div>

      {/* Dot indicators */}
      {urls.length > 1 && (
        <div className="mt-2 flex justify-center gap-1">
          {urls.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Photo ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-200 ${i === current ? "w-4 bg-emerald-600" : "w-1.5 bg-slate-300"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroBanner({ photos }: { photos: string[] }) {
  const [current, setCurrent] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const goTo = (idx: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.offsetWidth, behavior: "smooth" });
    setCurrent(idx);
  };

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setCurrent(Math.round(el.scrollLeft / el.offsetWidth));
  };

  if (photos.length === 0) {
    return <div className="h-32 sm:h-52 bg-gradient-to-br from-emerald-800 via-emerald-600 to-teal-500" />;
  }

  return (
    <div className="relative overflow-hidden">
      {/* Scroll track */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
      >
        {photos.map((url, i) => (
          <div key={i} className="relative h-44 sm:h-56 w-full flex-none snap-start bg-slate-100">
            <Image src={url} alt="Cover" fill sizes="100vw" className="object-cover" priority={i === 0} unoptimized />
          </div>
        ))}
      </div>

      {/* Prev arrow */}
      {photos.length > 1 && current > 0 && (
        <button
          onClick={() => goTo(current - 1)}
          className="absolute left-2 top-1/2 -translate-y-1/2 hidden sm:flex items-center justify-center rounded-full bg-black/40 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/60"
          aria-label="Previous photo"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {/* Next arrow */}
      {photos.length > 1 && current < photos.length - 1 && (
        <button
          onClick={() => goTo(current + 1)}
          className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:flex items-center justify-center rounded-full bg-black/40 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/60"
          aria-label="Next photo"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      {/* Photo counter */}
      {photos.length > 1 && (
        <div className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm">
          {current + 1}/{photos.length}
        </div>
      )}

      {/* Dot indicators */}
      {photos.length > 1 && (
        <div className="absolute bottom-2.5 left-0 right-0 flex justify-center gap-1">
          {photos.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to photo ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-200 ${i === current ? "w-4 bg-white" : "w-1.5 bg-white/50"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatVerificationDate(value: string | null): string {
  if (!value) return "NoLSAF approval record";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NoLSAF approval record";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function experienceVibeStyle(value: string): { badge: string; icon: string } {
  switch (value.trim().toLowerCase()) {
    case "easy":
      return { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: "text-emerald-600" };
    case "normal":
      return { badge: "border-sky-200 bg-sky-50 text-sky-700", icon: "text-sky-600" };
    case "difficult":
      return { badge: "border-amber-200 bg-amber-50 text-amber-800", icon: "text-amber-600" };
    case "funny":
      return { badge: "border-violet-200 bg-violet-50 text-violet-700", icon: "text-violet-600" };
    case "delicious":
      return { badge: "border-yellow-200 bg-yellow-50 text-yellow-800", icon: "text-yellow-600" };
    default:
      return { badge: "border-slate-200 bg-slate-50 text-slate-700", icon: "text-slate-500" };
  }
}

export function OperatorProfilePreviewScreen({
  adminAgentId: adminAgentIdProp,
  publicAgentId: publicAgentIdProp,
}: {
  adminAgentId?: number;
  publicAgentId?: number;
} = {}) {
  const searchParams = useSearchParams();
  const adminAgentIdRaw = String(searchParams.get("adminAgentId") || "").trim();
  const adminAgentIdFromQuery = Number(adminAgentIdRaw);
  const adminAgentId = Number.isFinite(Number(adminAgentIdProp)) && Number(adminAgentIdProp) > 0
    ? Number(adminAgentIdProp)
    : adminAgentIdFromQuery;
  const publicAgentId = Number.isFinite(Number(publicAgentIdProp)) && Number(publicAgentIdProp) > 0
    ? Number(publicAgentIdProp)
    : NaN;
  const isAdminPreview = Number.isFinite(adminAgentId) && adminAgentId > 0;
  const isPublicPreview = !isAdminPreview && Number.isFinite(publicAgentId) && publicAgentId > 0;
  // Resolved agent ID used for booking links (public or admin preview)
  const effectiveAgentId = (isAdminPreview ? adminAgentId : publicAgentId) || 0;
  const backHref = isAdminPreview
    ? `/admin/agents/${adminAgentId}?tab=profile`
    : isPublicPreview
      ? "/public/tour-packages"
      : "/account/agent/profile";
  const backLabel = isAdminPreview
    ? "Back to submitted profile review"
    : isPublicPreview
      ? "Back to tour packages"
      : "Back to profile editor";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<OperatorProfile | null>(null);
  const [operatorVerification, setOperatorVerification] = useState<OperatorVerification | null>(null);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>("SUBMITTED");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [suspendConfirmOpen, setSuspendConfirmOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendLoading, setSuspendLoading] = useState(false);
  const [reviewToast, setReviewToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [adminTargetUserId, setAdminTargetUserId] = useState<number | null>(null);
  const [commissionPercent, setCommissionPercent] = useState<number>(15);
  const [systemCommission, setSystemCommission] = useState<number>(15);
  const [commissionDraft, setCommissionDraft] = useState<string>("15");
  const [useSystemCommission, setUseSystemCommission] = useState<boolean>(true);
  const [commissionModalOpen, setCommissionModalOpen] = useState(false);
  const [commissionModalTab, setCommissionModalTab] = useState<"pricing" | "discounts">("pricing");
  const [submittedProfileAudit, setSubmittedProfileAudit] = useState<SubmittedProfileAuditItem[]>([]);
  const [submittedProfileAuditLoading, setSubmittedProfileAuditLoading] = useState(false);
  const [submittedProfileAuditError, setSubmittedProfileAuditError] = useState<string | null>(null);
  const [submittedProfileAuditReloadTick, setSubmittedProfileAuditReloadTick] = useState(0);
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
            ? await api.get(`/api/public/agents/${publicAgentId}`)
          : await api.get("/api/agent/me");
        if (isAdminPreview) {
          const settingsRes = await api.get("/api/admin/settings");
          const settings = (settingsRes as any)?.data ?? {};
          const loadedPct = Number(settings?.agentCommissionPercent ?? settings?.commissionPercent ?? 15);
          const safePct = Number.isFinite(loadedPct) ? loadedPct : 15;
          loadedCommission = safePct;
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
        const resolvedTargetUserId = Number(agent?.user?.id ?? agent?.userId ?? 0);
        setAdminTargetUserId(Number.isFinite(resolvedTargetUserId) && resolvedTargetUserId > 0 ? resolvedTargetUserId : null);
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
      } catch {
        setError(isAdminPreview ? "Failed to load submitted operator profile." : "Failed to load operator profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdminPreview, adminAgentId, isPublicPreview, publicAgentId]);

  useEffect(() => {
    if (!isAdminPreview || !Number.isFinite(adminTargetUserId) || Number(adminTargetUserId) <= 0) {
      setSubmittedProfileAudit([]);
      setSubmittedProfileAuditError(null);
      setSubmittedProfileAuditLoading(false);
      return;
    }

    let cancelled = false;

    const loadSubmittedProfileAudit = async () => {
      try {
        setSubmittedProfileAuditLoading(true);
        setSubmittedProfileAuditError(null);
        const res = await api.get("/api/admin/audits", {
          params: {
            targetId: adminTargetUserId,
            page: 1,
            pageSize: 50,
            sortBy: "createdAt",
            sortDir: "desc",
          },
        });

        const payload = (res as any)?.data ?? {};
        const data = payload?.data ?? payload;
        const rawItems = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload)
              ? payload
              : [];

        const relevant = rawItems
          .filter((item: any) => {
            const action = String(item?.action || "").toUpperCase();
            const detailsText = JSON.stringify(item?.details || {}).toUpperCase();
            return (
              action.includes("PROFILE") ||
              action.includes("OPERATOR") ||
              action.includes("SUBMIT") ||
              action.includes("REVIEW") ||
              action.includes("APPROVE") ||
              action.includes("REJECT") ||
              action.includes("ADD_NOTE") ||
              action.includes("COMMISSION") ||
              detailsText.includes("OPERATORPROFILE") ||
              detailsText.includes("REVIEWSTATUS") ||
              detailsText.includes("PACKAGES") ||
              detailsText.includes("COMMISSION")
            );
          })
          .slice(0, 20)
          .map((item: any) => ({
            id: Number(item?.id || 0),
            action: String(item?.action || "UPDATE"),
            details: item?.details ?? null,
            createdAt: String(item?.createdAt || ""),
            adminId: Number.isFinite(Number(item?.adminId)) ? Number(item.adminId) : undefined,
            targetUserId: Number.isFinite(Number(item?.targetUserId)) ? Number(item.targetUserId) : null,
          }));

        if (!cancelled) setSubmittedProfileAudit(relevant);
      } catch {
        if (!cancelled) {
          setSubmittedProfileAudit([]);
          setSubmittedProfileAuditError("Failed to load submitted profile audit trail.");
        }
      } finally {
        if (!cancelled) setSubmittedProfileAuditLoading(false);
      }
    };

    void loadSubmittedProfileAudit();
    return () => {
      cancelled = true;
    };
  }, [isAdminPreview, adminTargetUserId, reviewStatus, submittedProfileAuditReloadTick]);

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
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <p className="text-sm font-semibold text-rose-600">{error}</p>
        <Link href={backHref} className="mt-4 inline-block text-sm font-bold text-emerald-700">
          {backLabel}
        </Link>
      </div>
    );
  }

  const p = profile;
  const logoPhotos = p?.classifiedPhotos?.["logo"] ?? [];
  const logoUrl = p?.companyLogoUrl || logoPhotos[0] || null;

  const bannerPhotos = [
    ...(p?.classifiedPhotos?.["attractions"] ?? []),
    ...(p?.classifiedPhotos?.["proof"] ?? []),
    ...(p?.classifiedPhotos?.["office"] ?? []),
  ].slice(0, 4);

  const galleryCategories = Object.entries(p?.classifiedPhotos ?? {}).filter(
    ([k, urls]) => k !== "logo" && urls.length > 0
  );

  const serviceGroups = Object.entries(p?.serviceClassification ?? {}).filter(([, list]) => list.length > 0);
  const classifiedServices = new Set(serviceGroups.flatMap(([, list]) => list));
  const uncategorizedServices = (p?.services ?? []).filter((svc) => !classifiedServices.has(svc));
  const hasCompanyServices = serviceGroups.length > 0 || uncategorizedServices.length > 0;
  const hasSpecializations = (p?.specializations?.length ?? 0) > 0;
  const hasAddOns = (p?.addOns?.length ?? 0) > 0;
  const hasCapacity =
    !!p?.maxTripsPerDay || !!p?.minimumBookingNotice || !!p?.guidesAvailable || !!p?.peakSeasonAvailability;
  const destinationSites = (p?.registeredParks?.length ?? 0) > 0 ? (p?.registeredParks ?? []) : (p?.operatingRegions ?? []);

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
  const formatDisplayedPrice = (rawPrice: unknown) => {
    const base = Number(rawPrice);
    if (!Number.isFinite(base)) return String(rawPrice ?? "");
    const adjusted = shouldShowCommissionAdjustedPrice ? base * (1 + displayCommissionRate) : base;
    const rounded = Math.round(adjusted * 100) / 100;
    return Number.isInteger(rounded)
      ? rounded.toLocaleString()
      : rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const reviewBadgeClass =
    reviewStatus === "APPROVED"
      ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
      : reviewStatus === "REJECTED"
        ? "bg-red-50 border border-red-200 text-red-700"
        : "bg-amber-50 border border-amber-200 text-amber-700";

  const formatAuditAction = (action: string) =>
    String(action || "UPDATE")
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const formatAuditTime = (iso: string) => {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "Unknown time";
    return dt.toLocaleString();
  };

  const getAuditDetail = (details: any) => {
    if (typeof details === "string" && details.trim()) return details;
    if (!details || typeof details !== "object") return "Profile activity recorded.";
    if (typeof details?.reason === "string" && details.reason.trim()) return `Reason: ${details.reason.trim()}`;
    if (typeof details?.status === "string" && details.status.trim()) return `Status: ${details.status.trim()}`;
    if (typeof details?.message === "string" && details.message.trim()) return details.message.trim();
    return "Profile activity recorded.";
  };

  const suspendReasonOptions = [
    "Policy violation detected in submitted profile content.",
    "Repeated non-compliance with admin review requirements.",
    "Fraud risk or suspicious activity pending investigation.",
  ];

  async function reviewFromPreview(
    nextStatus: "APPROVED" | "REJECTED",
    options?: { skipConfirm?: boolean },
  ) {
    if (!isAdminPreview || !Number.isFinite(adminAgentId) || adminAgentId <= 0) return;

    let reason = "";
    if (nextStatus === "REJECTED") {
      reason = String(window.prompt("Please enter rejection reason for the submitted profile:", "") || "").trim();
      if (!reason) {
        alert("Rejection reason is required.");
        return;
      }
    }

    if (!options?.skipConfirm) {
      const confirmed = window.confirm(
        nextStatus === "APPROVED"
          ? "Approve this submitted operator profile?"
          : "Reject this submitted operator profile?",
      );
      if (!confirmed) return;
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
      setSubmittedProfileAuditReloadTick((n) => n + 1);
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
      setSubmittedProfileAuditReloadTick((n) => n + 1);
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
      alert("Commission must be a number between 0 and 100.");
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
      setSubmittedProfileAuditReloadTick((n) => n + 1);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* -- Sticky topbar -- */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
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

      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
        {isAdminPreview ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${reviewBadgeClass}`}>
              {reviewStatus}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCommissionDraft(String(commissionPercent));
                  setUseSystemCommission(Math.abs(Number(commissionPercent) - Number(systemCommission)) < 0.0001);
                  setCommissionModalTab("pricing");
                  setCommissionModalOpen(true);
                }}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Edit
              </button>
              {reviewStatus === "APPROVED" ? (
                <button
                  type="button"
                  onClick={() => setSuspendConfirmOpen(true)}
                  disabled={suspendLoading || agentStatus === "SUSPENDED"}
                  className="inline-flex min-w-[132px] items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {agentStatus === "SUSPENDED" ? "Suspended" : suspendLoading ? "Suspending..." : "Suspend"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void reviewFromPreview("REJECTED")}
                    disabled={reviewLoading}
                    className="inline-flex min-w-[108px] items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => setApproveConfirmOpen(true)}
                    disabled={reviewLoading}
                    className="inline-flex min-w-[132px] items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {reviewLoading ? "Saving..." : "Approve"}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {isAdminPreview && approveConfirmOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              if (!reviewLoading) setApproveConfirmOpen(false);
            }}
          >
            <div
              className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-slate-900">Confirm Approval</h3>
              <p className="mt-2 text-sm text-slate-600">
                Are you sure you want to approve this submitted profile?
              </p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setApproveConfirmOpen(false)}
                  disabled={reviewLoading}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApproveConfirmOpen(false);
                    void reviewFromPreview("APPROVED", { skipConfirm: true });
                  }}
                  disabled={reviewLoading}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-emerald-200 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#02554e] disabled:opacity-50"
                >
                  {reviewLoading ? "Approving..." : "Yes, Approve"}
                </button>
              </div>
            </div>
          </div>
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setCommissionModalOpen(false)}
          >
            <div
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex-1 min-w-0 pr-3">
                  <h2 className="text-xl font-bold text-slate-900">Edit NoLSAF Commission</h2>
                  <p className="text-sm text-slate-600 mt-0.5 truncate">{p?.companyName || "Submitted operator"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCommissionModalOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-all duration-200"
                  aria-label="Close"
                >
                  <X className="h-5 w-5 text-slate-600" />
                </button>
              </div>

              <div className="flex items-center justify-center border-b border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl p-1.5 max-w-fit">
                  <button
                    type="button"
                    onClick={() => setCommissionModalTab("pricing")}
                    className={`relative flex items-center justify-center gap-2 px-6 py-2.5 font-medium transition-all duration-200 whitespace-nowrap rounded-lg ${
                      commissionModalTab === "pricing"
                        ? "bg-[#02665e] text-white"
                        : "text-slate-600 hover:text-slate-800"
                    }`}
                  >
                    <DollarSign className={`h-4 w-4 ${commissionModalTab === "pricing" ? "text-white" : "text-slate-500"}`} />
                    <span className={`text-sm ${commissionModalTab === "pricing" ? "font-semibold" : "font-medium"}`}>Pricing & Commission</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommissionModalTab("discounts")}
                    className={`relative flex items-center justify-center gap-2 px-6 py-2.5 font-medium transition-all duration-200 whitespace-nowrap rounded-lg ${
                      commissionModalTab === "discounts"
                        ? "bg-[#02665e] text-white"
                        : "text-slate-600 hover:text-slate-800"
                    }`}
                  >
                    <Percent className={`h-4 w-4 ${commissionModalTab === "discounts" ? "text-white" : "text-slate-500"}`} />
                    <span className={`text-sm ${commissionModalTab === "discounts" ? "font-semibold" : "font-medium"}`}>Discounts & Bonuses</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-5 bg-slate-50">
                {commissionModalTab === "pricing" ? (
                  <div className="space-y-4">
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                      <h3 className="text-base font-semibold text-slate-900 mb-1">Package Price Impact Preview</h3>
                      <p className="text-xs text-slate-500 mb-3">All submitted package base prices with commission-adjusted final prices.</p>
                      {packagePriceRows.length > 0 ? (
                        <div className="space-y-2 pr-1">
                          {packagePriceRows.map((row) => {
                            const commissionRate = effectiveCommissionForModal / 100;
                            const commissionAdded = Math.round((row.price * commissionRate) * 100) / 100;
                            const finalWithCommission = Math.round((row.price + commissionAdded) * 100) / 100;
                            return (
                              <div key={row.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div>
                                  <div className="text-sm font-semibold text-slate-900 truncate" title={row.title}>{row.title}</div>
                                </div>

                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <div className="flex flex-col">
                                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 mb-2">
                                      Owner&apos;s Original Price
                                      <span title="Locked - cannot be edited" aria-label="Locked - cannot be edited">
                                        <Lock className="h-3.5 w-3.5 text-slate-400" />
                                      </span>
                                    </label>
                                    <div className="px-4 py-3 bg-slate-100 border border-slate-200 rounded-lg">
                                      <div className="text-base font-semibold text-slate-700">
                                        {row.currency} {row.price.toLocaleString()}
                                      </div>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1.5">Price submitted by operator</p>
                                  </div>

                                  <div className="flex flex-col">
                                    <label className="block text-xs font-semibold text-slate-700 mb-2">
                                      Final Price (with {effectiveCommissionForModal}% NoLSAF commission)
                                    </label>
                                    <div className="px-4 py-3 bg-white border-2 border-[#02665e]/20 rounded-lg">
                                      <div className="text-base font-bold text-[#02665e] mb-1.5">
                                        {row.currency} {finalWithCommission.toLocaleString()}
                                      </div>
                                      <div className="text-xs text-slate-600 pt-2 border-t border-slate-200">
                                        <span className="font-medium text-slate-700">Commission:</span>{" "}
                                        <span className="text-[#02665e] font-semibold">
                                          {row.currency} {commissionAdded.toLocaleString()}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-600">No package base prices found in this submitted profile.</p>
                      )}
                    </div>

                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-4 border border-slate-200 hover:border-[#02665e]/20 transition-all duration-200">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-1.5 rounded-lg bg-[#02665e]/10">
                          <Settings className="h-4 w-4 text-[#02665e]" />
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">Commission Rate</h3>
                          <div className="text-sm text-slate-500 mt-0.5">Global NoLSAF commission applied across agent payouts.</div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-white/60 transition-colors">
                          <input
                            type="radio"
                            checked={useSystemCommission}
                            onChange={() => setUseSystemCommission(true)}
                            className="w-4 h-4 text-[#02665e] flex-shrink-0"
                            aria-label="Use system default commission"
                            title="Use system default commission"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-slate-900">Use System Default</div>
                            <div className="text-xs text-slate-600">
                              Agent Commission: {systemCommission}% (from Management Settings → Agent Commission)
                            </div>
                          </div>
                        </label>

                        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-white/60 transition-colors">
                          <input
                            type="radio"
                            checked={!useSystemCommission}
                            onChange={() => setUseSystemCommission(false)}
                            className="w-4 h-4 text-[#02665e] flex-shrink-0"
                            aria-label="Override commission"
                            title="Override commission"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-slate-900 mb-2">Override Commission</div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={commissionDraft}
                                onChange={(e) => setCommissionDraft(e.target.value)}
                                disabled={useSystemCommission}
                                min="0"
                                max="100"
                                step="0.1"
                                className="w-24 px-3 py-1.5 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-500 focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-all"
                                placeholder="0.0"
                              />
                              <span className="text-sm text-slate-600">%</span>
                            </div>
                          </div>
                        </label>

                        <div className="px-3 pt-1 text-xs text-slate-500">Current effective value: {commissionPercent}%</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="text-base font-bold text-slate-900">Discounts & Bonuses</div>
                    <p className="mt-2 text-sm text-slate-600">
                      Bonus and discount controls are managed centrally in Admin Settings.
                    </p>
                    <div className="mt-4">
                      <Link
                        href="/admin/management/settings"
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 no-underline hover:bg-slate-50"
                      >
                        Open Full Admin Settings
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 bg-white p-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCommissionModalOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCommissionFromModal}
                  disabled={commissionModalTab !== "pricing"}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#02554e] disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* -- All-in-one journey banner (public preview only) -- */}
        {isPublicPreview ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#02665e]/15 bg-[#02665e]/5 px-4 py-3">
            <p className="text-sm font-bold text-[#02665e]">All in One. No more fragmentation.</p>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <Car className="h-4 w-4 text-[#02665e]" />
              <span>Airport Pickup</span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              <Building2 className="h-4 w-4 text-[#02665e]" />
              <span>Hotel / Lodge</span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              <Mountain className="h-4 w-4 text-[#02665e]" />
              <span>Tour Site</span>
            </div>
          </div>
        ) : null}

        {/* -- Hero card -- */}
        <Card className="overflow-hidden">
          <HeroBanner photos={bannerPhotos} />

          {/* Branded info panel */}
          <div
            className="relative overflow-hidden px-4 pb-6 pt-0 sm:px-6"
            style={{ background: "linear-gradient(135deg, #013d38 0%, #02665e 45%, #025a52 100%)" }}
          >
            {/* ── Dot grid — right 75%, fading left ── */}
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-3/4"
              style={{
                backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.55) 1.5px, transparent 1.5px)",
                backgroundSize: "22px 22px",
                maskImage: "linear-gradient(to left, rgba(0,0,0,0.9) 0%, transparent 80%)",
                WebkitMaskImage: "linear-gradient(to left, rgba(0,0,0,0.9) 0%, transparent 80%)",
              }}
            />

            {/* ── Diagonal accent lines ── */}
            <svg
              className="pointer-events-none absolute right-[10%] top-0 h-full opacity-60"
              width="130"
              viewBox="0 0 130 170"
              preserveAspectRatio="none"
              fill="none"
              aria-hidden
            >
              <line x1="130" y1="8"  x2="30"  y2="120" stroke="#606363" strokeWidth="1.8" strokeLinecap="round" />
              <line x1="110" y1="2"  x2="10"  y2="114" stroke="#606363" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="90"  y1="0"  x2="0"   y2="100" stroke="#606363" strokeWidth="1"   strokeLinecap="round" opacity="0.55" />
            </svg>

            {/* ── Shimmer top edge ── */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            {/* ── Bottom vignette ── */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/25 to-transparent" />

            {/* ── Glass info card — logo + name + contact ── */}
            <div className="relative mt-4 rounded-2xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-sm shadow-inner">
              <div className="flex items-center gap-4">
                {/* Logo — prominent, with glow ring */}
                <div className="relative shrink-0">
                  {/* Outer glow ring */}
                  <div className="absolute inset-0 rounded-2xl bg-white/20 blur-md scale-110" />
                  <div className="relative h-16 w-16 sm:h-20 sm:w-20 overflow-hidden rounded-2xl border-2 border-white/60 bg-white shadow-2xl">
                    {logoUrl ? (
                      <Image src={logoUrl} alt="Logo" fill sizes="80px" className="object-cover" unoptimized />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#02665e]/20">
                        <Building2 className="h-8 w-8 text-white/50" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Name + badge + contact */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-lg font-extrabold text-white drop-shadow sm:text-xl leading-tight">
                      {p?.companyName || <span className="font-normal italic text-white/40">Company name not set</span>}
                    </h1>
                    {agentStatus === "ACTIVE" && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/[0.12] px-2.5 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm">
                        <BadgeCheck className="h-3.5 w-3.5" /> Verified
                      </span>
                    )}
                  </div>

                  <div className="my-2 h-px w-10 bg-white/30 rounded-full" />

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/65">
                    {p?.physicalLocation && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 text-white/50 shrink-0" /> {p.physicalLocation}
                      </span>
                    )}
                    {p?.contactPhone && (
                      <span className="flex items-center gap-1.5">
                        <Phone className="h-3 w-3 text-white/50 shrink-0" /> {p.contactPhone}
                      </span>
                    )}
                    {p?.contactEmail && (
                      <span className="flex items-center gap-1.5">
                        <Mail className="h-3 w-3 text-white/50 shrink-0" /> {p.contactEmail}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-white/[0.12] bg-white/[0.06] px-3 py-2.5 text-white shadow-sm backdrop-blur-sm">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Years in operation</div>
                  <div className="mt-1 text-sm font-extrabold leading-none">
                    {typeof p?.yearsInOperation === "number" ? `${p.yearsInOperation}+` : "Not set"}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.12] bg-white/[0.06] px-3 py-2.5 text-white shadow-sm backdrop-blur-sm">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Team size</div>
                  <div className="mt-1 text-sm font-extrabold leading-none">
                    {typeof p?.teamSize === "number" ? p.teamSize : "Not set"}
                  </div>
                </div>
                <div className="col-span-2 rounded-xl border border-white/[0.12] bg-white/[0.06] px-3 py-2.5 text-white shadow-sm backdrop-blur-sm sm:col-span-1">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Languages</div>
                  <div className="mt-1 text-sm font-extrabold leading-none">
                    {p?.languages?.trim() ? p.languages : "Not set"}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Tourism pills ── */}
            {(p?.tourismTypes?.length ?? 0) > 0 && (
              <div className="relative mt-4 flex flex-wrap items-center gap-1.5">
                {p!.tourismTypes.slice(0, 3).map((t, i) => (
                  <span
                    key={t}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-center text-[11px] font-semibold backdrop-blur-sm transition ${
                      i === 0
                        ? "border-white/40 bg-white/[0.18] text-white"
                        : "border-white/15 bg-transparent text-white/65 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {t}
                  </span>
                ))}
                {p!.tourismTypes.length > 3 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold text-white/85 backdrop-blur-sm">
                    <PlusCircle className="h-3 w-3" aria-hidden />
                    +{p!.tourismTypes.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* -- Stats strip -- */}
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap divide-x divide-slate-100">
            <StatItem value={p?.tourismTypes?.length ?? 0} label="Tour Types" description="Types of tours offered" icon={Globe2} />
            <StatItem value={p?.vehicles?.length ?? 0} label="Vehicles" description="Fleet available for guests" icon={Car} />
            <StatItem value={p?.packageItems?.length ?? 0} label="Packages" description="Ready-to-book tour packages" icon={Package} />
            <StatItem value={p?.tools?.length ?? 0} label="Tools" description="Equipment &amp; gear provided" icon={Wrench} />
          </div>
        </div>

        {/* -- Main grid: stacked on mobile, 2+1 on desktop -- */}
        <div className="mt-4 grid gap-4 lg:grid-cols-3 lg:items-start">

          {isPublicPreview && operatorVerification?.status === "VERIFIED" && (
            <section className="relative order-0 overflow-hidden rounded-2xl border border-[#02665e]/15 bg-[#fcfffe] shadow-[0_16px_40px_-30px_rgba(2,102,94,0.42)] lg:col-span-2">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#02665e]/[0.025] via-transparent to-[#4ecdc4]/[0.05]" />
              <ShieldCheck className="pointer-events-none absolute -right-6 -top-10 h-40 w-40 text-[#02665e] opacity-[0.05]" aria-hidden />

              <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex min-w-0 items-start gap-3.5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#02665e] text-white shadow-[0_10px_22px_-12px_rgba(2,102,94,0.75)]">
                    <BadgeCheck className="h-5.5 w-5.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold tracking-[0.18em] text-[#02665e]/60">NoLSAF verified</p>
                    <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Verified Tour Operator</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500">
                      <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#0f9f8d]" aria-hidden />Approved profile</span>
                      <span className="text-[#02665e]/35" aria-hidden>•</span>
                      <span>Active NoLSAF partner</span>
                    </div>
                  </div>
                </div>
                {operatorVerification.verificationUrl ? (
                  <a
                    href={operatorVerification.verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#02665e] px-4 py-3 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-[#014b45]"
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                    View certificate
                  </a>
                ) : null}
              </div>

              <div className="relative grid grid-cols-2 border-t border-[#02665e]/10 bg-white/65">
                <div className="px-4 py-3.5 sm:px-6">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Certificate ID</p>
                  <p className="mt-1 font-mono text-sm font-bold tracking-wide text-[#02665e]">{operatorVerification.certificateId}</p>
                </div>
                <div className="flex items-center gap-2 border-l border-[#02665e]/10 px-4 py-3.5 sm:px-6">
                  <CalendarClock className="h-4 w-4 text-[#02665e]" aria-hidden />
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Verified on</p>
                    <p className="mt-1 text-sm font-bold text-slate-700">{formatVerificationDate(operatorVerification.approvedAt)}</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* About */}
            {p?.description && (
              <div className="relative overflow-hidden rounded-2xl shadow-xl order-1 lg:col-span-2" style={{ background: "linear-gradient(135deg, #011f1c 0%, #02665e 45%, #013d38 75%, #024d46 100%)" }}>
                {/* Dot grid */}
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
                    backgroundSize: "22px 22px",
                    maskImage: "linear-gradient(to bottom right, transparent 10%, rgba(0,0,0,0.7) 100%)",
                    WebkitMaskImage: "linear-gradient(to bottom right, transparent 10%, rgba(0,0,0,0.7) 100%)",
                  }}
                />
                {/* Diagonal accent lines */}
                <svg className="pointer-events-none absolute right-[8%] top-0 h-full opacity-20" width="140" viewBox="0 0 140 200" preserveAspectRatio="none" fill="none" aria-hidden>
                  <line x1="140" y1="10"  x2="30"  y2="140" stroke="#606363" strokeWidth="2"   strokeLinecap="round" />
                  <line x1="118" y1="2"   x2="8"   y2="130" stroke="#606363" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
                  <line x1="96"  y1="0"   x2="0"   y2="110" stroke="#606363" strokeWidth="1"   strokeLinecap="round" opacity="0.4" />
                </svg>
                {/* Giant faded Globe2 watermark */}
                <div className="pointer-events-none absolute -right-10 -top-10 opacity-[0.04]">
                  <Globe2 className="h-60 w-60 text-white" />
                </div>
                {/* Top shimmer */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                {/* Bottom vignette */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/30 to-transparent" />

                <div className="relative p-6">
                  {/* Giant decorative quote */}
                  <div className="pointer-events-none absolute left-4 top-2 select-none text-8xl font-black leading-none text-white/[0.04]" aria-hidden>&ldquo;</div>

                  {/* Header */}
                  <div className="mb-5 flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/20">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-white/55">About this operator</h2>
                      <div className="mt-1 h-0.5 w-8 rounded-full bg-[#4ecdc4]/60" />
                    </div>
                  </div>

                  <p className="relative text-sm leading-[1.9] text-white/85 whitespace-pre-line">{p.description}</p>
                </div>
              </div>
            )}

            {/* Fleet */}
            {(p?.vehicles?.length ?? 0) > 0 && (
              <Card className="overflow-hidden order-5 lg:col-span-2">

                {/* ── Hero header banner ── */}
                <div className="relative overflow-hidden" style={{ background: "linear-gradient(120deg, #02665e 0%, #034d47 60%, #606363 100%)" }}>
                  {/* Dot grid */}
                  <div className="pointer-events-none absolute inset-0"
                    style={{
                      backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.12) 1.5px, transparent 1.5px)",
                      backgroundSize: "20px 20px",
                      maskImage: "linear-gradient(to left, rgba(0,0,0,0.8) 0%, transparent 70%)",
                      WebkitMaskImage: "linear-gradient(to left, rgba(0,0,0,0.8) 0%, transparent 70%)",
                    }}
                  />
                  {/* Giant faint Car watermark */}
                  <div className="pointer-events-none absolute -right-6 -bottom-4 opacity-[0.12]">
                    <Car className="h-32 w-32 text-white" />
                  </div>
                  {/* Shimmer */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

                  <div className="relative flex items-center justify-between gap-4 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 shadow-inner ring-1 ring-white/20">
                        <Car className="h-5 w-5 text-white" />
                      </span>
                      <div>
                        <p className="text-[10px] font-extrabold uppercase tracking-widest text-white/50">Fleet overview</p>
                        <p className="text-base font-extrabold text-white leading-tight">Vehicles &amp; Transport</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-2xl font-extrabold text-white leading-none">{p!.vehicles.length}</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                        {p!.vehicles.length === 1 ? "vehicle" : "vehicles"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ── Vehicle list ── */}
                <div className="divide-y divide-slate-100">
                  {p!.vehicles.map((v, idx) => (
                    <div key={v.id} className="group relative flex items-stretch gap-0 transition-colors hover:bg-[#02665e]/[0.03]">
                      {/* Left accent bar */}
                      <div className="w-1 shrink-0 bg-gradient-to-b from-[#02665e]/40 to-[#606363]/20 group-hover:from-[#02665e] group-hover:to-[#606363]/60 transition-colors" />

                      <div className="flex flex-1 items-start gap-4 px-4 py-4 sm:px-5">
                        {/* Index badge */}
                        <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl border border-[#02665e]/15 bg-[#02665e]/5">
                          <Car className="h-4 w-4 text-[#02665e]" />
                          <span className="text-[9px] font-extrabold text-[#02665e]/60 leading-none mt-0.5">#{idx + 1}</span>
                        </div>

                        {/* Main info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-extrabold text-slate-900">{v.type || "Vehicle"}</span>
                            <span className="rounded-full bg-[#02665e] px-3 py-0.5 text-xs font-extrabold text-white shadow-sm">
                              ×{v.quantity || 1}
                            </span>
                          </div>

                          {/* Stat chips row */}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {v.seatsPerVehicle && (
                              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                <Users className="h-3 w-3 text-[#02665e]" /> {v.seatsPerVehicle} seats
                              </span>
                            )}
                            {v.serviceMode && (
                              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                <Globe2 className="h-3 w-3 text-[#02665e]" /> {v.serviceMode}
                              </span>
                            )}
                            {v.ownedBy && (
                              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                <ShieldCheck className="h-3 w-3 text-[#606363]" /> {v.ownedBy}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Vehicle photos */}
                {(p?.classifiedPhotos?.["vehicles"] ?? []).length > 0 && (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-5">
                    <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Fleet photos</p>
                    <PhotoCarousel urls={p!.classifiedPhotos["vehicles"]} category="vehicles" />
                  </div>
                )}
              </Card>
            )}

            {/* Company services */}
            {hasCompanyServices && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm order-7 lg:col-span-2">
                {/* Header */}
                <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #011f1c 0%, #02665e 55%, #013d38 100%)" }}>
                  {/* Dot grid */}
                  <div className="pointer-events-none absolute inset-0" style={{
                    backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.10) 1.5px, transparent 1.5px)",
                    backgroundSize: "18px 18px",
                  }} />
                  {/* Top shimmer */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                  {/* Zap watermark */}
                  <Zap className="pointer-events-none absolute right-14 top-1/2 h-20 w-20 -translate-y-1/2 text-white opacity-[0.04]" />

                  <div className="relative px-4 py-4">
                    <div className="flex items-start gap-3">
                      {/* Icon badge */}
                      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                        <Zap className="h-4 w-4 text-[#4ecdc4]" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/50">What we offer</p>
                        <p className="text-base font-bold leading-tight text-white">Services &amp; Experiences</p>
                        {/* Teal accent underline */}
                        <div className="my-1.5 h-0.5 w-8 rounded-full bg-[#4ecdc4]/60" />
                        <p className="max-w-md text-xs leading-relaxed text-white/65">
                          Everything this operator provides. Guided adventures, essential support services and more. All in one place.
                        </p>
                      </div>

                      {/* Count badge */}
                      <div className="flex flex-shrink-0 flex-col items-center gap-0.5 rounded-xl bg-white/15 px-2.5 py-1.5 ring-1 ring-white/20">
                        <span className="text-lg font-black leading-none text-white">{(p?.services?.length ?? 0)}</span>
                        <span className="text-[8px] font-semibold uppercase tracking-wider text-white/55">services</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  {serviceGroups.map(([category, items]) => (
                    <div key={category} className="overflow-hidden rounded-xl border border-slate-100">
                      {/* Category label */}
                      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" />
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{category}</p>
                      </div>
                      {/* Service chips */}
                      <div className="grid grid-cols-1 gap-px bg-slate-100 min-[520px]:grid-cols-2 xl:grid-cols-3">
                        {items.map((svc) => (
                          <div key={`${category}-${svc}`} className="group flex cursor-default items-center gap-2.5 bg-white px-3 py-2.5 transition-all duration-200 hover:bg-[#02665e]/5 hover:scale-[1.02] hover:shadow-sm">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#02665e] transition-transform duration-200 group-hover:scale-110" />
                            <span className="text-sm font-medium text-slate-700 transition-colors duration-200 group-hover:text-[#02665e]">{svc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {uncategorizedServices.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-slate-100">
                      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Other Services</p>
                      </div>
                      <div className="grid grid-cols-1 gap-px bg-slate-100 min-[520px]:grid-cols-2 xl:grid-cols-3">
                        {uncategorizedServices.map((svc) => (
                          <div key={`uncategorized-${svc}`} className="group flex cursor-default items-center gap-2.5 bg-white px-3 py-2.5 transition-all duration-200 hover:bg-slate-50 hover:scale-[1.02] hover:shadow-sm">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 group-hover:scale-110" />
                            <span className="text-sm font-medium text-slate-600 transition-colors duration-200 group-hover:text-slate-800">{svc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Specializations */}
            {hasSpecializations && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm order-11 lg:col-start-3">
                {/* Header */}
                <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #1a0a2e 0%, #4a1a7a 55%, #2d0f55 100%)" }}>
                  <div className="pointer-events-none absolute inset-0" style={{
                    backgroundImage: "radial-gradient(circle, rgba(200,160,255,0.12) 1.5px, transparent 1.5px)",
                    backgroundSize: "18px 18px",
                  }} />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/30 to-transparent" />
                  <Tag className="pointer-events-none absolute right-3 top-1/2 h-20 w-20 -translate-y-1/2 text-white opacity-[0.04]" />
                  <div className="relative px-4 py-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                        <Tag className="h-4 w-4 text-violet-300" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/50">Expertise</p>
                        <p className="text-xl font-bold leading-tight text-white">Specializations</p>
                        <div className="my-1.5 h-0.5 w-8 rounded-full bg-violet-400/60" />
                        <p className="max-w-sm text-sm leading-relaxed text-white/65">
                          The travel categories this operator has built deep expertise in. Each specialization reflects years of focused experience on the ground.
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-center gap-0.5 rounded-xl bg-white/15 px-2.5 py-1.5 ring-1 ring-white/20">
                        <span className="text-lg font-black leading-none text-white">{p!.specializations.length}</span>
                        <span className="text-[8px] font-semibold uppercase tracking-wider text-white/55">areas</span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Spec chips */}
                <div className="grid grid-cols-1 gap-px bg-slate-100 min-[520px]:grid-cols-2 lg:grid-cols-1">
                  {p!.specializations.map((spec) => (
                    <div key={spec} className="group flex cursor-default items-center gap-2.5 bg-white px-4 py-3 transition-all duration-200 hover:bg-violet-50 hover:scale-[1.02] hover:shadow-sm">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-violet-100 ring-1 ring-violet-200 transition-all duration-200 group-hover:bg-violet-200">
                        <Tag className="h-3 w-3 text-violet-600 transition-transform duration-200 group-hover:scale-110" />
                      </span>
                      <span className="text-sm font-medium text-slate-700 transition-colors duration-200 group-hover:text-violet-700">{spec}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add-ons */}
            {hasAddOns && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm order-12 lg:col-start-3">
                {/* Header */}
                <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #1a0e00 0%, #7c3d00 55%, #3d1a00 100%)" }}>
                  <div className="pointer-events-none absolute inset-0" style={{
                    backgroundImage: "radial-gradient(circle, rgba(255,200,100,0.03) 1.5px, transparent 1.5px)",
                    backgroundSize: "18px 18px",
                  }} />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/30 to-transparent" />
                  <PlusCircle className="pointer-events-none absolute right-3 top-1/2 h-20 w-20 -translate-y-1/2 text-white opacity-[0.04]" />
                  <div className="relative px-4 py-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                        <PlusCircle className="h-4 w-4 text-amber-300" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/50">Optional extras</p>
                        <p className="text-xl font-bold leading-tight text-white">Add-ons</p>
                        <div className="my-1.5 h-0.5 w-8 rounded-full bg-amber-400/60" />
                        <p className="max-w-sm text-sm leading-relaxed text-white/65">
                          Enhance your trip with hand-picked extras. Each add-on is available on request and tailored to make your experience truly yours.
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-center gap-0.5 rounded-xl bg-white/15 px-2.5 py-1.5 ring-1 ring-white/20">
                        <span className="text-lg font-black leading-none text-white">{p!.addOns.length}</span>
                        <span className="text-[8px] font-semibold uppercase tracking-wider text-white/55">extras</span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Add-on items */}
                <div className="grid grid-cols-2 gap-px bg-slate-100 lg:grid-cols-1">
                  {p!.addOns.map((a) => (
                    <div
                      key={a}
                      className="group flex cursor-default items-center gap-2.5 bg-white px-4 py-3 transition-all duration-200 hover:bg-amber-50 hover:scale-[1.03] hover:z-10 hover:shadow-md"
                    >
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-amber-100 ring-1 ring-amber-200 transition-all duration-200 group-hover:bg-amber-200">
                        <PlusCircle className="h-3 w-3 text-amber-600 transition-transform duration-200 group-hover:scale-110" />
                      </span>
                      <span className="min-w-0 text-sm font-medium text-slate-700 transition-colors duration-200 group-hover:text-amber-700">{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Book Available Packages CTA card ── */}
            {(p?.packageItems?.length ?? 0) > 0 && (
              <div className="overflow-hidden rounded-2xl border border-[#02665e]/20 bg-white shadow-sm order-13 lg:col-start-3">
                {/* Header */}
                <div
                  className="relative overflow-hidden px-4 py-4"
                  style={{ background: "linear-gradient(135deg, #011f1c 0%, #02665e 50%, #013d38 100%)" }}
                >
                  <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1.5px, transparent 1.5px)", backgroundSize: "18px 18px" }} />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                  <Package className="pointer-events-none absolute right-3 top-1/2 h-20 w-20 -translate-y-1/2 text-white opacity-[0.05]" />
                  <div className="relative">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Available now</p>
                    <p className="mt-0.5 text-xl font-black leading-tight text-white">Book the Packages</p>
                    <div className="my-1.5 h-0.5 w-8 rounded-full bg-[#4ecdc4]/60" />
                    <p className="text-sm leading-relaxed text-white/65">
                      {p!.packageItems.length} tour package{p!.packageItems.length === 1 ? "" : "s"} ready. Pick your experience and secure your spot.
                    </p>
                  </div>
                </div>

                {/* Payment methods */}
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="mb-2.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Accepted payments</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { icon: CreditCard,  label: "Visa / Mastercard", bg: "bg-blue-100",   ring: "ring-blue-200",   color: "text-blue-600"   },
                      { icon: Smartphone,  label: "Mobile Money",      bg: "bg-emerald-100", ring: "ring-emerald-200", color: "text-emerald-600" },
                      { icon: Building2,   label: "Bank Transfer",      bg: "bg-amber-100",  ring: "ring-amber-200",  color: "text-amber-600"  },
                    ].map(({ icon: Icon, label, bg, ring, color }) => (
                      <div key={label} className="flex items-center gap-2 rounded-lg border border-[#02665e]/15 bg-[#02665e]/5 px-2.5 py-2 last:col-span-2 last:justify-center">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${bg} ring-1 ${ring}`}>
                          <Icon className={`h-3.5 w-3.5 ${color}`} />
                        </span>
                        <span className="text-[11px] font-semibold text-slate-700">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* CTA */}
                <div className="px-4 pb-4 pt-3">
                  <a
                    href="#tour-packages"
                    onClick={(e) => {
                      // If there's exactly one package, go directly to the booking form
                      if (effectiveAgentId > 0 && p?.packageItems?.length === 1) {
                        e.preventDefault();
                        const firstPkg = p.packageItems[0] as any;
                        const pkgId = String(firstPkg?.id ?? 0);
                        window.location.href = `/public/booking/tour-confirm?agentId=${effectiveAgentId}&packageId=${encodeURIComponent(pkgId)}`;
                      }
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white no-underline shadow-sm transition-all duration-200 hover:brightness-110 hover:shadow-md hover:shadow-[#02665e]/30"
                    style={{ background: "linear-gradient(135deg, #02665e 0%, #028a7e 100%)" }}
                  >
                    Book &amp; Pay
                  </a>
                  {/* Security assurance row */}
                  <div className="mt-2.5 flex items-center justify-center gap-1.5">
                    <Lock className="h-3 w-3 shrink-0 text-[#02665e]" />
                    <span className="text-[10px] font-semibold text-slate-400">256-bit SSL encrypted. Your payment is fully secure.</span>
                  </div>
                </div>
              </div>
            )}

            {/* Tour packages */}
            {(p?.packageItems?.length ?? 0) > 0 && (
              <div id="tour-packages" className="space-y-4 order-3 lg:col-span-2">
                {/* Section label */}
                <div className="relative overflow-hidden rounded-2xl shadow-lg" style={{ background: "linear-gradient(135deg, #011f1c 0%, #02665e 50%, #013d38 100%)" }}>
                  {/* Dot grid */}
                  <div className="pointer-events-none absolute inset-0" style={{
                    backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
                    backgroundSize: "20px 20px",
                  }} />
                  {/* Giant faded Package watermark */}
                  <div className="pointer-events-none absolute -right-6 -bottom-4 opacity-[0.06]">
                    <Package className="h-44 w-44 text-white" />
                  </div>
                  {/* Top shimmer */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

                  <div className="relative flex items-center justify-between gap-3 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                        <Package className="h-5 w-5 text-white" />
                      </span>
                      <div>
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/50">What&apos;s available</p>
                        <p className="text-lg font-black leading-tight text-white">Tour Packages</p>
                        <div className="mt-1 h-0.5 w-8 rounded-full bg-[#4ecdc4]/60" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isAdminPreview && reviewStatus === "APPROVED" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80 backdrop-blur-sm">
                          <BadgeCheck className="h-3.5 w-3.5" />
                          Verified
                        </span>
                      ) : null}
                      <div className="flex flex-col items-center justify-center rounded-xl bg-white/15 px-3 py-1.5 ring-1 ring-white/20 backdrop-blur-sm">
                        <span className="text-xl font-black leading-none text-white">{p!.packageItems.length}</span>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/50">packages</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Individual package cards */}
                {p!.packageItems.map((pkg, idx) => {
                  const normalizedDiscountCondition = String(pkg.discountCondition || "").trim();
                  const normalizedDiscountUnit = String(pkg.discountUnit || "").trim();
                  const isNumericCondition = /^\d+$/.test(normalizedDiscountCondition);
                  const discountConditionText = (() => {
                    if (!normalizedDiscountCondition) return "";
                    if (!isNumericCondition) return normalizedDiscountCondition;

                    if (normalizedDiscountUnit === "Travelers") return `${normalizedDiscountCondition}+ travelers are booked together`;
                    if (normalizedDiscountUnit === "Days before travel") return `${normalizedDiscountCondition}+ days before travel`;
                    if (normalizedDiscountUnit === "Completed previous bookings") return `${normalizedDiscountCondition}+ completed previous bookings`;
                    if (normalizedDiscountUnit === "Bookings") return `${normalizedDiscountCondition}+ bookings`;
                    if (normalizedDiscountUnit === "Nights") return `${normalizedDiscountCondition}+ nights`;

                    if (pkg.discountFactor === "Large group size") return `${normalizedDiscountCondition}+ travelers are booked together`;
                    if (pkg.discountFactor === "Early booking") return `${normalizedDiscountCondition}+ days before travel`;
                    if (pkg.discountFactor === "Returning customer") return `${normalizedDiscountCondition}+ completed previous bookings`;

                    return normalizedDiscountCondition;
                  })();
                  return (
                  <div key={pkg.id} className="space-y-3">
                    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl ring-1 ring-black/5 transition-all duration-150 active:scale-[0.985] active:shadow-md active:brightness-[0.97] cursor-pointer select-none">

                      {/* ── SUMMARY HERO ── */}
                      <div className="relative overflow-hidden border-b border-slate-100 bg-white">
                        {/* "PACKAGE N" large transparent watermark */}
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-end pr-4 select-none" aria-hidden>
                          <span className="text-[72px] font-black uppercase leading-none tracking-tight text-[#02665e]/[0.06] sm:text-[88px]">
                            PACKAGE {idx + 1}
                          </span>
                        </div>

                        <div className="relative px-6 pt-5 pb-6">
                          {/* Tags row */}
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02665e]/8 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#02665e] ring-1 ring-[#02665e]/15">
                              <Package className="h-3 w-3" />
                              Package {idx + 1}
                            </span>
                            {isPublicPreview && operatorVerification?.status === "VERIFIED" && (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700 ring-1 ring-emerald-200">
                                <BadgeCheck className="h-3.5 w-3.5" />
                                Verified operator
                              </span>
                            )}
                            {pkg.category && (
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-600 ring-1 ring-slate-200">
                                {pkg.category}
                              </span>
                            )}
                            {pkg.difficulty && (
                              (() => {
                                const difficultyHelp =
                                  pkg.difficulty === "Easy"
                                    ? "Suitable for most travellers with light activity and easy movement."
                                    : pkg.difficulty === "Moderate"
                                      ? "Requires some fitness, longer travel time, or uneven terrain."
                                      : pkg.difficulty === "Challenging"
                                        ? "Requires good fitness and may include long days, steep areas, or demanding conditions."
                                        : "For experienced travellers only. May include high effort, rough terrain, or more demanding conditions.";
                                return (
                                  <span title={difficultyHelp} aria-label={`${pkg.difficulty}: ${difficultyHelp}`}
                                    className={`inline-flex cursor-help items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] ring-1 ${
                                      pkg.difficulty === "Easy" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" :
                                      pkg.difficulty === "Moderate" ? "bg-amber-50 text-amber-700 ring-amber-200" :
                                      pkg.difficulty === "Challenging" ? "bg-orange-50 text-orange-700 ring-orange-200" :
                                      "bg-rose-50 text-rose-700 ring-rose-200"
                                    }`}>
                                    {pkg.difficulty === "Easy" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> :
                                     pkg.difficulty === "Moderate" ? <Gauge className="h-3.5 w-3.5 shrink-0" /> :
                                     pkg.difficulty === "Challenging" ? <Mountain className="h-3.5 w-3.5 shrink-0" /> :
                                     <Flame className="h-3.5 w-3.5 shrink-0" />}
                                    {pkg.difficulty}
                                  </span>
                                );
                              })()
                            )}
                          </div>

                          {/* Conversational intro line */}
                          <p className="mb-1 text-xs font-semibold text-[#02665e]/70 tracking-wide">Your next adventure is waiting —</p>

                          {/* Package name */}
                          <h3 className="text-2xl font-black leading-tight text-slate-900 sm:text-3xl">{pkg.name}</h3>

                          {/* Destination */}
                          {pkg.destination && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                              <span className="text-sm font-semibold text-slate-500">{pkg.destination}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── CONTENT ── */}
                      <div className="space-y-5 px-5 py-5 sm:px-6">
                        {/* Description */}
                        {pkg.description && (
                          <p className="text-sm leading-[1.85] text-slate-600">{pkg.description}</p>
                        )}

                        {/* Operator note */}
                        {pkg.notes && (
                          <div className="flex gap-3 rounded-xl border-l-4 border-[#02665e] bg-[#f0faf9] px-4 py-3.5">
                            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" />
                            <div>
                              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#02665e]">Operator note</p>
                              <p className="mt-1 text-sm leading-relaxed text-slate-700">{pkg.notes}</p>
                            </div>
                          </div>
                        )}

                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                          {pkg.duration && (
                            <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10">
                                <CalendarClock className="h-4 w-4 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Duration</p>
                                <p className="text-sm font-bold text-slate-800">{pkg.duration}{/^\d+$/.test(String(pkg.duration)) ? " days" : ""}</p>
                              </div>
                            </div>
                          )}
                          {pkg.mode && (
                            <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10">
                                <Car className="h-4 w-4 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Travel mode</p>
                                <p className="text-sm font-bold text-slate-800">{pkg.mode}</p>
                              </div>
                            </div>
                          )}
                          {(pkg.minPax || pkg.maxPax) && (
                            <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10">
                                <Users className="h-4 w-4 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Group size</p>
                                <p className="text-sm font-bold text-slate-800">{pkg.minPax && pkg.maxPax ? `${pkg.minPax}–${pkg.maxPax} pax` : pkg.minPax ? `Min ${pkg.minPax} pax` : `Max ${pkg.maxPax} pax`}</p>
                              </div>
                            </div>
                          )}
                          {pkg.accommodation && (
                            <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10">
                                <Landmark className="h-4 w-4 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Accommodation</p>
                                <p className="text-sm font-bold text-slate-800">{pkg.accommodation}</p>
                              </div>
                            </div>
                          )}
                          {pkg.mealPlan && (
                            <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10">
                                <Zap className="h-4 w-4 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Meal plan</p>
                                <p className="text-sm font-bold text-slate-800">{pkg.mealPlan}</p>
                              </div>
                            </div>
                          )}
                          {pkg.meetingPoint && (
                            <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 sm:col-span-2 xl:col-span-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10">
                                <MapPin className="h-4 w-4 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Meeting / departure point</p>
                                <p className="text-sm font-bold text-slate-800">{pkg.meetingPoint}</p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* ── Journey flow + commitment ── */}
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 px-5 py-5">
                          {/* Section label */}
                          <p className="mb-4 text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">How your trip comes together</p>

                          {/* Flow diagram */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* Step 1 */}
                            <div className="flex items-center gap-2 rounded-xl border border-[#02665e]/15 bg-white px-3 py-2.5 shadow-sm">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10">
                                <Car className="h-3.5 w-3.5 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Arrival</p>
                                <p className="text-xs font-bold text-slate-700">Airport Pickup</p>
                              </div>
                            </div>

                            <ChevronRight className="h-4 w-4 shrink-0 text-[#02665e]/40" />

                            {/* Step 2 */}
                            <div className="flex items-center gap-2 rounded-xl border border-[#02665e]/15 bg-white px-3 py-2.5 shadow-sm">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10">
                                <Landmark className="h-3.5 w-3.5 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Stay</p>
                                <p className="text-xs font-bold text-slate-700">Hotel / Lodge</p>
                              </div>
                            </div>

                            <ChevronRight className="h-4 w-4 shrink-0 text-[#02665e]/40" />

                            {/* Step 3 */}
                            <div className="flex items-center gap-2 rounded-xl border border-[#02665e]/15 bg-white px-3 py-2.5 shadow-sm">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10">
                                <Mountain className="h-3.5 w-3.5 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Experience</p>
                                <p className="text-xs font-bold text-slate-700">Tour / Destination</p>
                              </div>
                            </div>

                            <ChevronRight className="h-4 w-4 shrink-0 text-[#02665e]/40" />

                            {/* Step 4 */}
                            <div className="flex items-center gap-2 rounded-xl border border-[#02665e]/15 bg-white px-3 py-2.5 shadow-sm">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10">
                                <Users className="h-3.5 w-3.5 text-[#02665e]" />
                              </span>
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Return</p>
                                <p className="text-xs font-bold text-slate-700">Safe Drop-off</p>
                              </div>
                            </div>
                          </div>

                          {/* Commitment strip */}
                          <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-200/70 pt-4">
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                              <span className="text-[11px] font-semibold text-slate-600">Operator-managed end to end</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                              <span className="text-[11px] font-semibold text-slate-600">No third-party fragmentation</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                              <span className="text-[11px] font-semibold text-slate-600">Your journey, your terms</span>
                            </div>
                          </div>
                        </div>

                        {/* Price CTA */}
                        {pkg.pricePerPerson && (
                          <div className="relative overflow-hidden rounded-2xl" style={{ background: "linear-gradient(135deg, #011f1c 0%, #02665e 50%, #013d38 100%)" }}>
                            {/* Dot grid */}
                            <div className="pointer-events-none absolute inset-0" style={{
                              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
                              backgroundSize: "18px 18px",
                            }} />
                            {/* Top shimmer */}
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                            {/* Bottom shimmer */}
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                            {/* Glow orb */}
                            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#4ecdc4]/10 blur-3xl" />

                            <div className="relative px-5 py-5">
                              {/* Top row: label + per-person badge */}
                              <div className="mb-3 flex items-center justify-between">
                                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/45">Starting from</p>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/65 backdrop-blur-sm">
                                  <Users className="h-3 w-3" />
                                  per person
                                </span>
                              </div>

                              {/* Price row */}
                              <div className="flex items-end justify-between gap-4">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-sm font-bold text-white/50">{pkg.currency}</span>
                                  <span className="text-5xl font-black leading-none tracking-tight text-white">{formatDisplayedPrice(pkg.pricePerPerson)}</span>
                                </div>
                                {/* Right badge */}
                                <div className="flex flex-col items-center gap-1 shrink-0">
                                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                                    <DollarSign className="h-6 w-6 text-white" />
                                  </div>
                                </div>
                              </div>

                              {/* Bottom note */}
                              <p className="mt-3 text-[11px] text-white/40 leading-snug">
                                All services included. Price covers the full itinerary as outlined above.
                              </p>
                              {pkg.discountFactor && pkg.discountType && pkg.discountValue ? (
                                <div className="mt-3 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-[11px] text-white/80 backdrop-blur-sm">
                                  Discount available for <span className="font-bold text-white">{pkg.discountFactor.toLowerCase()}</span>: {pkg.discountType === "Fixed amount" ? `${pkg.currency} ${pkg.discountValue} off` : `${pkg.discountValue}% off`}
                                  {discountConditionText ? ` when ${discountConditionText}.` : "."}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── BODY ── */}
                      <div className="divide-y divide-slate-100 border-t border-slate-100 bg-white">

                      {/* Included + Excluded side-by-side when both exist */}
                      {((pkg.included?.length ?? 0) > 0 || (pkg.excluded?.length ?? 0) > 0) && (
                        <div className={`grid gap-0 divide-slate-100 ${
                          (pkg.included?.length ?? 0) > 0 && (pkg.excluded?.length ?? 0) > 0
                            ? "grid-cols-2 divide-x"
                            : "grid-cols-1"
                        }`}>

                          {/* Included */}
                          {(pkg.included?.length ?? 0) > 0 && (
                            <div className="px-4 py-4">
                              <p className="mb-3 flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#02665e]">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Included
                              </p>
                              <ul className="space-y-1.5">
                                {pkg.included.map((item, i) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                                    <span className="text-xs font-medium leading-tight text-slate-700">{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Excluded */}
                          {(pkg.excluded?.length ?? 0) > 0 && (
                            <div className="px-4 py-4">
                              <p className="mb-3 flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-rose-500">
                                <XCircle className="h-3.5 w-3.5" />
                                Not Included
                              </p>
                              <ul className="space-y-1.5">
                                {pkg.excluded.map((item, i) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                                    <span className="text-xs font-medium leading-tight text-slate-500">{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Meeting point */}
                      {pkg.meetingPoint && (
                        <div className="px-5 py-3 border-t border-slate-100">
                          <p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-400">Meeting / departure point</p>
                          <div className="flex items-start gap-1.5">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                            <span className="text-xs font-medium text-slate-700">{pkg.meetingPoint}</span>
                          </div>
                        </div>
                      )}

                      {/* Day-by-day itinerary */}
                      {(pkg.itinerary?.length ?? 0) > 0 && (
                        <div className="border-t border-slate-100 px-5 py-4">
                          <div className="mb-4 overflow-hidden rounded-2xl border border-[#02665e]/15 bg-gradient-to-br from-[#f4fbfa] via-white to-[#f7fbfa]">
                            <div className="flex items-center justify-between gap-3 border-b border-[#02665e]/10 px-3.5 py-2.5">
                              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#02665e]">Day-by-day itinerary</p>
                              <span className="rounded-full border border-[#02665e]/20 bg-white px-2.5 py-0.5 text-[10px] font-bold text-[#02665e]">
                                {pkg.itinerary.length} day{pkg.itinerary.length > 1 ? "s" : ""}
                              </span>
                            </div>

                            <ol className="m-0 list-none space-y-3 p-3">
                              {pkg.itinerary.map((day, dayIndex) => (
                                <li key={day.id} className="relative pl-11">
                                  {dayIndex < pkg.itinerary.length - 1 ? (
                                    <span className="absolute left-[15px] top-8 bottom-0 w-px bg-[#02665e]/25" aria-hidden />
                                  ) : null}

                                  <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[#02665e] text-xs font-black text-white shadow-sm">
                                    {day.day}
                                  </span>

                                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.04)]">
                                    {day.title && <p className="text-sm font-extrabold leading-snug text-slate-900">{day.title}</p>}
                                    {day.description && <p className="mt-1 text-xs leading-relaxed text-slate-500">{day.description}</p>}

                                    {(day.events?.length ?? 0) > 0 ? (
                                      <ul className="m-0 mt-3 list-none space-y-2 border-l border-[#02665e]/20 pl-3">
                                        {day.events.map((evt) => {
                                          const timeText = [evt.startTime, evt.endTime].filter(Boolean).join(" - ");
                                          const vibeStyle = experienceVibeStyle(evt.difficulty);
                                          return (
                                            <li key={evt.id} className="relative pl-3">
                                              <span className="absolute -left-[17px] top-2 h-2 w-2 rounded-full border border-white bg-[#02665e]" aria-hidden />
                                              <div className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl border border-slate-100 bg-white px-3 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.03)] sm:grid-cols-[168px_minmax(0,1fr)_116px] sm:items-center">
                                                <div className="min-w-0 sm:order-1">
                                                  <span className="mb-1 block text-[8px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Time</span>
                                                  <div className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] font-extrabold tracking-wide text-slate-700">
                                                    <CalendarClock className="h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
                                                    <span className="truncate">{timeText || "Flexible"}</span>
                                                  </div>
                                                </div>
                                                <div className="order-3 col-span-2 min-w-0 border-t border-slate-100 pt-3 sm:order-2 sm:col-span-1 sm:border-t-0 sm:pt-0">
                                                  <span className="mb-1 block text-[8px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Activity</span>
                                                  <p className="break-words text-sm font-semibold leading-relaxed text-slate-800">{evt.activity || "Activity details"}</p>
                                                </div>
                                                <div className="order-2 min-w-0 border-l border-[#02665e]/10 pl-3 sm:order-3">
                                                  <span className="mb-1 block text-[8px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Vibe</span>
                                                  {evt.difficulty ? (
                                                    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold ${vibeStyle.badge}`}>
                                                      <Tag className={`h-3 w-3 shrink-0 ${vibeStyle.icon}`} aria-hidden />
                                                      <span className="truncate">{evt.difficulty}</span>
                                                    </span>
                                                  ) : <span className="block px-2.5 py-1 text-[10px] font-semibold text-slate-400">—</span>}
                                                </div>
                                              </div>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    ) : (
                                      <p className="mt-2 text-[11px] font-medium text-slate-400">Detailed timeline will appear after event times are added.</p>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </div>
                        </div>
                      )}

                      {/* CTA footer */}
                      <div className="mx-4 mb-4 overflow-hidden rounded-2xl border border-[#02665e]/20 shadow-sm"
                        style={{ background: "linear-gradient(135deg, #f0faf9 0%, #f7fbfa 60%, #ffffff 100%)" }}
                      >
                        {/* Top shimmer */}
                        <div className="h-px w-full bg-gradient-to-r from-transparent via-[#02665e]/30 to-transparent" />

                        <div className="px-5 py-4">
                          {/* Heading row */}
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-black text-slate-800">Ready to book this package?</p>
                              <p className="mt-0.5 text-[11px] text-slate-500">Availability is live. Secure your spot in seconds.</p>
                            </div>
                            {effectiveAgentId > 0 ? (
                              <Link
                                href={`/public/booking/tour-confirm?agentId=${effectiveAgentId}&packageId=${encodeURIComponent(String((pkg as any).id ?? idx))}`}
                                className="no-underline flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[12px] font-bold text-white shadow-md transition-all hover:brightness-110 hover:shadow-lg hover:shadow-[#02665e]/30"
                                style={{ background: "linear-gradient(135deg, #02665e 0%, #028a7e 100%)" }}
                              >
                                <Phone className="h-3.5 w-3.5" />
                                Book Now
                              </Link>
                            ) : p?.contactPhone ? (
                              <a
                                href={`tel:${p.contactPhone}`}
                                className="no-underline flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[12px] font-bold text-white shadow-md transition-all hover:brightness-110 hover:shadow-lg hover:shadow-[#02665e]/30"
                                style={{ background: "linear-gradient(135deg, #02665e 0%, #028a7e 100%)" }}
                              >
                                <Phone className="h-3.5 w-3.5" />
                                Book Now
                              </a>
                            ) : null}
                          </div>

                          {/* Trust badges row */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[#02665e]/10 pt-3">
                            <div className="flex items-center gap-1.5">
                              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                              <span className="text-[10px] font-semibold text-slate-500">Confirmed on booking</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                              <span className="text-[10px] font-semibold text-slate-500">No hidden fees</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                              <span className="text-[10px] font-semibold text-slate-500">Verified operator</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      </div>
                    </div>

                    {idx < p!.packageItems.length - 1 && (
                      <div className="flex justify-center py-1">
                        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
                          <span className="h-2 w-2 rounded-full bg-[#02665e]" />
                          <ChevronRight className="h-3 w-3 rotate-90 text-slate-400" />
                          <span className="h-2 w-2 rounded-full bg-slate-200" />
                        </div>
                      </div>
                    )}
                  </div>
                );
                })}
              </div>
            )}

            {/* Photo gallery — all categories except logo & vehicles (shown with fleet) */}
            {galleryCategories.filter(([k]) => k !== "vehicles").length > 0 && (
              <Card className="p-5 order-9 lg:col-span-2">
                <SectionHeading icon={<Users className="h-4 w-4" />} title="Gallery" />
                <div className="space-y-5">
                  {galleryCategories
                    .filter(([k]) => k !== "vehicles")
                    .map(([key, urls]) => (
                      <PhotoCarousel key={key} urls={urls} category={key} />
                    ))}
                </div>
              </Card>
            )}

            {/* Parks & Sites */}
            {destinationSites.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-green-900/20 shadow-md order-8 lg:col-start-3">
                {/* Jungle header */}
                <div className="relative overflow-hidden" style={{
                  background: "radial-gradient(ellipse 110% 90% at 18% 55%, rgba(50,140,15,0.28) 0%, transparent 60%), linear-gradient(155deg, #050f02 0%, #133d08 40%, #1b5c0c 72%, #0a2905 100%)"
                }}>
                  {/* Canopy dot grid — warm green tones */}
                  <div className="pointer-events-none absolute inset-0" style={{
                    backgroundImage: "radial-gradient(circle, rgba(140,230,80,0.13) 1.5px, transparent 1.5px)",
                    backgroundSize: "18px 18px",
                  }} />
                  {/* Top shimmer */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/25 to-transparent" />
                  {/* Diagonal branch lines */}
                  <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                    <line x1="0" y1="110%" x2="95%" y2="-10%" stroke="white" strokeWidth="1.5" />
                    <line x1="-15%" y1="110%" x2="75%" y2="-10%" stroke="white" strokeWidth="0.8" />
                    <line x1="20%" y1="110%" x2="115%" y2="-10%" stroke="white" strokeWidth="1" />
                  </svg>
                  {/* Mountain watermark */}
                  <Mountain className="pointer-events-none absolute right-2 top-1/2 h-28 w-28 -translate-y-1/2 text-white opacity-[0.05]" />

                  <div className="relative px-4 py-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                        <Landmark className="h-4 w-4 text-[#4ecdc4]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-lime-300/60">Expert Territory</p>
                        <p className="text-xl font-bold leading-tight text-white">Parks &amp; Sites</p>
                        <div className="my-1.5 h-0.5 w-8 rounded-full bg-lime-400/50" />
                        <p className="max-w-sm text-sm leading-relaxed text-white/65">
                          Our guides know every trail, gate and seasonal pattern across each of these parks. You are not just visiting. You are guided.
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-center gap-0.5 rounded-xl bg-white/15 px-2.5 py-1.5 ring-1 ring-white/20">
                        <span className="text-lg font-black leading-none text-white">{destinationSites.length}</span>
                        <span className="text-[8px] font-semibold uppercase tracking-wider text-white/55">parks</span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Chips body — earthy forest floor */}
                <div className="px-4 py-4" style={{ background: "linear-gradient(180deg, #f2f8ed 0%, #ffffff 60%)" }}>
                  <div className="flex flex-wrap gap-2">
                    {destinationSites.map((site) => (
                      <span
                        key={site}
                        className="group inline-flex cursor-default items-center gap-1.5 rounded-full border border-green-700/25 bg-green-800/10 px-3 py-1.5 text-xs font-semibold text-green-900 transition-all duration-200 hover:bg-green-800/20 hover:scale-105 hover:shadow-sm"
                      >
                        <MapPin className="h-3 w-3 flex-shrink-0 text-green-700 transition-transform duration-200 group-hover:scale-110" />
                        {site}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tools & assets */}
            {(p?.tools?.length ?? 0) > 0 && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm order-10 lg:col-start-3">
                {/* Header */}
                <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0a1628 0%, #1b3a6b 55%, #0d2240 100%)" }}>
                  <div className="pointer-events-none absolute inset-0" style={{
                    backgroundImage: "radial-gradient(circle, rgba(148,196,255,0.12) 1.5px, transparent 1.5px)",
                    backgroundSize: "18px 18px",
                  }} />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/25 to-transparent" />
                  <Wrench className="pointer-events-none absolute right-3 top-1/2 h-20 w-20 -translate-y-1/2 text-white opacity-[0.04]" />
                  <div className="relative px-4 py-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                        <Wrench className="h-4 w-4 text-sky-300" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/50">Equipment &amp; support</p>
                        <p className="text-xl font-bold leading-tight text-white">Tools &amp; Assets</p>
                        <div className="my-1.5 h-0.5 w-8 rounded-full bg-sky-400/60" />
                        <p className="max-w-sm text-sm leading-relaxed text-white/65">
                          Everything we carry into the field. From safety gear to specialist support, your journey is fully equipped.
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-center gap-0.5 rounded-xl bg-white/15 px-2.5 py-1.5 ring-1 ring-white/20">
                        <span className="text-lg font-black leading-none text-white">{p!.tools.length}</span>
                        <span className="text-[8px] font-semibold uppercase tracking-wider text-white/55">items</span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Tool items */}
                <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-1 sm:bg-transparent sm:divide-y sm:divide-slate-100">
                  {p!.tools.map((t) => {
                    const lower = t.toLowerCase();
                    let ToolIcon: React.ElementType = Wrench;
                    if (/guide/.test(lower) && !/driver/.test(lower)) ToolIcon = Users;
                    else if (/driver/.test(lower)) ToolIcon = Car;
                    else if (/camp/.test(lower)) ToolIcon = Mountain;
                    else if (/first.aid|medic|health/.test(lower)) ToolIcon = HeartPulse;
                    else if (/phone|satellite/.test(lower)) ToolIcon = Phone;
                    else if (/translat|language/.test(lower)) ToolIcon = Globe2;
                    else if (/radio|communic/.test(lower)) ToolIcon = Radio;
                    else if (/photo/.test(lower)) ToolIcon = Camera;
                    else if (/vehicle|transport/.test(lower)) ToolIcon = Car;
                    else if (/track|gps|navig/.test(lower)) ToolIcon = MapPin;
                    else if (/kit|bag|gear/.test(lower)) ToolIcon = Package;
                    else if (/measure|gauge|meter/.test(lower)) ToolIcon = Gauge;
                    return (
                      <div key={t} className="group relative flex cursor-default items-center gap-3 bg-white px-4 py-3 transition-all duration-200 hover:z-10 hover:scale-[1.04] hover:bg-[#02665e]/5 hover:shadow-md sm:bg-transparent sm:hover:scale-100 sm:hover:shadow-none">
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#02665e]/8 ring-1 ring-[#02665e]/15 transition-all duration-200 group-hover:bg-[#02665e]/15 group-hover:ring-[#02665e]/25">
                          <ToolIcon className="h-3.5 w-3.5 text-[#02665e] transition-transform duration-200 group-hover:scale-110" />
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-medium text-slate-700 transition-colors duration-200 group-hover:text-[#02665e]">{t}</span>
                        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Availability */}
            {hasCapacity && (
              <div
                className="relative overflow-hidden rounded-2xl shadow-lg order-4 lg:col-start-3"
                style={{ background: "linear-gradient(135deg, #0a2825 0%, #02665e 55%, #0d3b36 100%)" }}
              >
                {/* Dot grid */}
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.12) 1px, transparent 1px)",
                    backgroundSize: "20px 20px",
                    maskImage: "linear-gradient(to bottom-left, rgba(0,0,0,0.6) 0%, transparent 60%)",
                    WebkitMaskImage: "linear-gradient(to bottom-left, rgba(0,0,0,0.6) 0%, transparent 60%)",
                  }}
                />
                {/* Shimmer top edge */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                {/* Large watermark icon */}
                <CalendarClock className="pointer-events-none absolute -bottom-3 right-2 h-24 w-24 text-white opacity-[0.05]" />

                {/* Header */}
                <div className="relative flex items-center gap-3 border-b border-white/10 px-4 py-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                    <CalendarClock className="h-4 w-4 text-white" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/50">Schedule &amp; capacity</p>
                    <p className="text-sm font-bold leading-tight text-white">What&apos;s Available</p>
                  </div>
                  {/* Live pulse badge */}
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-2.5 py-1 ring-1 ring-emerald-400/30">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-300">Live</span>
                  </span>
                </div>

                {/* 2×2 metric tiles */}
                <div className="relative grid grid-cols-2 gap-2 p-3">
                  {p?.maxTripsPerDay && (
                    <div className="flex flex-col gap-2 rounded-xl bg-white/10 p-3 ring-1 ring-white/15">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/20 ring-1 ring-amber-400/30">
                        <Zap className="h-3.5 w-3.5 text-amber-300" />
                      </span>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">Daily Capacity</p>
                        <p className="mt-0.5 text-2xl font-black leading-none text-white">{p.maxTripsPerDay}</p>
                        <p className="mt-1 text-[10px] leading-tight text-white/30">tours per day max</p>
                      </div>
                    </div>
                  )}
                  {p?.minimumBookingNotice && (
                    <div className="flex flex-col gap-2 rounded-xl bg-white/10 p-3 ring-1 ring-white/15">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-400/20 ring-1 ring-sky-400/30">
                        <CalendarClock className="h-3.5 w-3.5 text-sky-300" />
                      </span>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">Advance Notice</p>
                        <p className="mt-0.5 text-lg font-black leading-tight text-white">{p.minimumBookingNotice}</p>
                        <p className="mt-1 text-[10px] leading-tight text-white/30">required to book</p>
                      </div>
                    </div>
                  )}
                  {p?.guidesAvailable && (
                    <div className="flex flex-col gap-2 rounded-xl bg-white/10 p-3 ring-1 ring-white/15">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-400/20 ring-1 ring-violet-400/30">
                        <Users className="h-3.5 w-3.5 text-violet-300" />
                      </span>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">Field Guides</p>
                        <p className="mt-0.5 text-2xl font-black leading-none text-white">{p.guidesAvailable}</p>
                        <p className="mt-1 text-[10px] leading-tight text-white/30">trained professionals</p>
                      </div>
                    </div>
                  )}
                  {p?.peakSeasonAvailability && (
                    <div className="flex flex-col gap-2 rounded-xl bg-emerald-400/15 p-3 ring-1 ring-emerald-400/25">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/20 ring-1 ring-emerald-400/30">
                        <Globe2 className="h-3.5 w-3.5 text-emerald-300" />
                      </span>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/60">Peak Season</p>
                        <p className="mt-0.5 text-sm font-black leading-tight text-emerald-200">{p.peakSeasonAvailability}</p>
                        <p className="mt-1 text-[10px] leading-tight text-emerald-300/40">high demand window</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer disclaimer */}
                <div className="relative border-t border-white/10 px-4 py-2.5">
                  <p className="text-center text-[10px] text-white/25">Availability confirmed at time of booking</p>
                </div>
              </div>
            )}

            {/* Seasonal pricing */}
            {(p?.seasonalPrices?.length ?? 0) > 0 && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm order-6 lg:col-start-3">
                {/* Header */}
                <div className="relative overflow-hidden border-b border-slate-100 bg-[#02665e]">
                  {/* White dot grid */}
                  <div className="pointer-events-none absolute inset-0" style={{
                    backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.18) 1.5px, transparent 1.5px)",
                    backgroundSize: "16px 16px",
                  }} />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                  <div className="flex items-center gap-2.5 px-4 py-3">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                      <CalendarClock className="h-4 w-4 text-white" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/50">Plan your trip</p>
                      <p className="text-sm font-bold leading-tight text-white">When to Travel</p>
                    </div>
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-bold text-white ring-1 ring-white/20">
                      {p!.seasonalPrices.length}
                    </span>
                  </div>
                </div>
                {/* Season cards */}
                <div className="space-y-2 p-3">
                  {p!.seasonalPrices.map((sp) => {
                    const nameLC = sp.seasonName?.toLowerCase() ?? "";
                    const isHigh = nameLC.includes("high") || nameLC.includes("peak");
                    const isMid  = nameLC.includes("mid") || nameLC.includes("shoulder");
                    const palette = isHigh
                      ? { card: "bg-amber-50/60 border-amber-100", badge: "bg-amber-100 text-amber-700", label: "Peak", dot: "bg-amber-400", period: "text-amber-600/80" }
                      : isMid
                      ? { card: "bg-sky-50/60 border-sky-100", badge: "bg-sky-100 text-sky-700", label: "Shoulder", dot: "bg-sky-400", period: "text-sky-600/80" }
                      : { card: "bg-emerald-50/50 border-emerald-100", badge: "bg-emerald-100 text-emerald-700", label: "Low demand", dot: "bg-emerald-400", period: "text-emerald-600/80" };
                    return (
                      <div key={sp.id} className={`relative overflow-hidden rounded-xl border p-3.5 ${palette.card}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`h-2 w-2 rounded-full ${palette.dot}`} />
                              <p className="text-sm font-extrabold text-slate-900">{sp.seasonName}</p>
                            </div>
                            <p className={`text-xs font-semibold ${palette.period}`}>{sp.startMonth} – {sp.endMonth}</p>
                            {sp.notes && (
                              <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">{sp.notes}</p>
                            )}
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest ${palette.badge}`}>
                            {palette.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <p className="px-1 pt-1 text-[10px] text-slate-400 leading-snug">
                    Rates may vary by season. Contact the operator for a personalised quote.
                  </p>
                </div>
              </div>
            )}

            {/* Team photos */}
            {(p?.classifiedPhotos?.["team"] ?? []).length > 0 && (
              <Card className="p-5 order-11 lg:col-start-3">
                <SectionHeading icon={<Users className="h-4 w-4" />} title="Our team" />
                <PhotoCarousel urls={p!.classifiedPhotos["team"] ?? []} category="team" />
              </Card>
            )}

            {isAdminPreview && (
              <>
                {/* Change Summary Section */}
                {(p?.review as any) && (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm order-10 lg:col-span-2">
                    {/* Header */}
                    <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 ring-1 ring-violet-200">
                        <Zap className="h-4 w-4 text-violet-600" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Submission diff</p>
                        <p className="text-sm font-bold leading-tight text-slate-800">Changes Summary</p>
                        {(p as any)?.review?.submittedAt && (() => {
                          const d = new Date((p as any)?.review?.submittedAt);
                          const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                          const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                          return (
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              Last submitted on <span className="font-semibold text-slate-500">{date} at {time}</span>
                            </p>
                          );
                        })()}
                      </div>
                      {(() => {
                        const ch = (p?.review as any)?.changes || {};
                        const total = (ch.fieldsModified?.length || 0) + (ch.itemsAdded?.reduce((s: number, x: any) => s + x.count, 0) || 0) + (ch.itemsRemoved?.reduce((s: number, x: any) => s + x.count, 0) || 0);
                        return total > 0 ? <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-bold text-violet-700">{total} change{total !== 1 ? "s" : ""}</span> : null;
                      })()}
                    </div>

                    <div className="divide-y divide-slate-100">
                      {(() => {
                        const changes = (p?.review as any)?.changes || {};
                        const fieldsModified = changes.fieldsModified || [];
                        const itemsAdded = changes.itemsAdded || [];
                        const itemsRemoved = changes.itemsRemoved || [];

                        if (!fieldsModified.length && !itemsAdded.length && !itemsRemoved.length) {
                          return (
                            <div className="flex items-center gap-2 px-5 py-4 text-sm text-slate-500">
                              <span className="text-slate-300">—</span> No changes detected in this submission.
                            </div>
                          );
                        }

                        return (
                          <>
                            {/* Fields Modified */}
                            {fieldsModified.length > 0 && (
                              <div className="px-5 py-4">
                                <div className="mb-3 flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-blue-400" />
                                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Fields Modified</span>
                                  <span className="ml-auto rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600">{fieldsModified.length}</span>
                                </div>
                                <div className="space-y-2">
                                  {fieldsModified.slice(0, 5).map((mod: any, i: number) => (
                                    <div key={i} className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg bg-slate-50 px-3 py-2">
                                      <span className="min-w-[80px] text-[11px] font-bold text-slate-700">{mod.field}</span>
                                      <div className="flex flex-1 flex-wrap items-center gap-1.5 min-w-0">
                                        <span className="inline-block max-w-[160px] truncate rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-600 line-through">
                                          {mod.oldValue == null || mod.oldValue === "" ? "—" : String(mod.oldValue).substring(0, 40)}
                                        </span>
                                        <span className="text-slate-300">→</span>
                                        <span className="inline-block max-w-[160px] truncate rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                                          {mod.newValue == null || mod.newValue === "" ? "—" : String(mod.newValue).substring(0, 40)}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                  {fieldsModified.length > 5 && (
                                    <p className="pl-3 text-[11px] italic text-slate-400">+{fieldsModified.length - 5} more field(s) not shown</p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Items Added */}
                            {itemsAdded.length > 0 && (
                              <div className="px-5 py-4">
                                <div className="mb-3 flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Items Added</span>
                                  <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600">+{itemsAdded.reduce((sum: number, item: any) => sum + item.count, 0)}</span>
                                </div>
                                <div className="space-y-2">
                                  {itemsAdded.map((item: any, i: number) => (
                                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50/60 px-3 py-2">
                                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">+{item.count}</span>
                                      <span className="text-[11px] font-medium text-slate-700">{item.category}{item.count !== 1 ? "s" : ""}</span>
                                      {item.examples.length > 0 && (
                                        <span className="text-[11px] text-slate-400">e.g. {item.examples.slice(0, 2).join(", ")}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Items Removed */}
                            {itemsRemoved.length > 0 && (
                              <div className="px-5 py-4">
                                <div className="mb-3 flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-red-400" />
                                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Items Removed</span>
                                  <span className="ml-auto rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-500">{itemsRemoved.reduce((sum: number, item: any) => sum + item.count, 0)}</span>
                                </div>
                                <div className="space-y-2">
                                  {itemsRemoved.map((item: any, i: number) => (
                                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50/60 px-3 py-2">
                                      <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-600">-{item.count}</span>
                                      <span className="text-[11px] font-medium text-slate-700">{item.category}{item.count !== 1 ? "s" : ""}</span>
                                      {item.examples.length > 0 && (
                                        <span className="text-[11px] text-slate-400">e.g. {item.examples.slice(0, 2).join(", ")}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Audit Timeline */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm order-11 lg:col-span-2">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#02665e]/10 ring-1 ring-[#02665e]/20">
                      <CalendarClock className="h-4 w-4 text-[#02665e]" />
                    </span>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Submitted profile tracking</p>
                      <p className="text-sm font-bold leading-tight text-slate-800">Audit Timeline</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSubmittedProfileAuditReloadTick((n) => n + 1)}
                    className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Refresh
                  </button>
                </div>

                <div className="px-4 py-3">
                  {submittedProfileAuditLoading ? (
                    <div className="text-sm text-slate-500">Loading submitted profile audit trail...</div>
                  ) : submittedProfileAuditError ? (
                    <div className="text-sm text-rose-600">{submittedProfileAuditError}</div>
                  ) : submittedProfileAudit.length === 0 ? (
                    <div className="text-sm text-slate-500">No submitted profile activity found yet.</div>
                  ) : (
                    <ul className="space-y-2">
                      {submittedProfileAudit.map((item) => (
                        <li key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                              {formatAuditAction(item.action)}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500">{formatAuditTime(item.createdAt)}</span>
                          </div>
                          <p className="mt-1.5 text-xs text-slate-600">{getAuditDetail(item.details)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              </>
            )}
        </div>

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

