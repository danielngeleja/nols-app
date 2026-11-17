"use client";

import InfoTip from "@/components/sales/InfoTip";
import { Children, Fragment, cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  ArrowLeft,
  Building2,
  Car,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  IdCard,
  Globe,
  ImagePlus,
  Loader2,
  RotateCcw,
  MapPin,
  PackagePlus,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import {
  COMMON_SERVICES,
  getServiceOptionsForTypes,
  TOOLS_ASSETS_OPTIONS,
  TOURISM_TYPE_SERVICES,
  TOURISM_TYPES,
  VEHICLE_SERVICE_MODES,
} from "@/components/careers/partnershipProfile";
import { AGENT_SPECIALIZATIONS } from "@nolsaf/shared";
import apiClient from "@/lib/apiClient";
import { REGIONS } from "@/lib/tzRegions";
import { announceAgentLogo } from "@/lib/agentLogo";
import { createPortal } from "react-dom";

/** A package removed through the remove action, kept by the server for restore. */
type RemovedPackageEntry = { item: { id?: string; name?: string; destination?: string; pricePerPerson?: string | number; currency?: string }; removedAt: string; liveItem?: unknown };
const PACKAGE_RESTORE_DAYS = 30;
const normaliseTyped = (v: unknown) => String(v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

const api = apiClient;

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
  difficulty: "" | "Easy" | "Normal" | "Difficult" | "Funny" | "Delicious";
};

type ValidationIssue = {
  path?: Array<string | number>;
  message?: string;
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

type OperatorProfile = {
  contactPersonName?: string;
  contactPersonEmail?: string;
  contactPersonPhone?: string;
  contactPersonNationality?: string;
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyLogoUrl: string;
  businessAddress: string;
  companyWebsite?: string;
  businessRegistrationNumber?: string;
  tinNumber?: string;
  businessLicenseNumber?: string;
  tourismPermitNumber?: string;
  vehiclePermitNumber?: string;
  yearsInOperation?: number;
  teamSize?: number;
  languages?: string;
  physicalLocation: string;
  operatingRegions: string[];
  registeredParks?: string[];
  contactPhone: string;
  contactEmail: string;
  whatsapp: string;
  description: string;
  tourismTypes: string[];
  tools: string[];
  vehicles: VehicleAsset[];
  services: string[];
  serviceClassification?: Record<string, string[]>;
  hasVehicles?: boolean;
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
  reviewStatus?: string;
  reviewReason?: string | null;
  submittedAt?: string;
  reviewedAt?: string;
  approvedAt?: string;
  [key: string]: any;
};

type AgentMe = {
  ok: boolean;
  agent?: {
    id: number;
    status?: string | null;
    level?: string | null;
    operatorProfile?: Partial<OperatorProfile> | null;
    user?: { name?: string | null; fullName?: string | null; email?: string | null; phone?: string | null };
  };
};

type CloudinarySig = {
  timestamp: number;
  signature: string;
  folder: string;
  cloudName: string;
  apiKey: string;
};

const emptyProfile: OperatorProfile = {
  contactPersonName: "",
  contactPersonEmail: "",
  contactPersonPhone: "",
  contactPersonNationality: "",
  companyName: "",
  companyEmail: "",
  companyPhone: "",
  companyLogoUrl: "",
  businessAddress: "",
  companyWebsite: "",
  businessRegistrationNumber: "",
  tinNumber: "",
  businessLicenseNumber: "",
  tourismPermitNumber: "",
  vehiclePermitNumber: "",
  yearsInOperation: undefined,
  teamSize: undefined,
  languages: "",
  physicalLocation: "",
  operatingRegions: [],
  registeredParks: [],
  contactPhone: "",
  contactEmail: "",
  whatsapp: "",
  description: "",
  tourismTypes: [],
  tools: [],
  vehicles: [],
  services: [],
  serviceClassification: {},
  hasVehicles: false,
  specializations: [],
  addOns: [],
  seasonalPricing: "",
  packages: "",
  packageItems: [],
  seasonalPrices: [],
  capacityNotes: "",
  maxTripsPerDay: "",
  minimumBookingNotice: "",
  guidesAvailable: "",
  peakSeasonAvailability: "",
  blockedPeriods: "",
  gallery: [],
  classifiedPhotos: {},
};

const tourismTypes = TOURISM_TYPES;

const toolOptions = TOOLS_ASSETS_OPTIONS;

const addOnOptions = [
  "Balloon safari",
  "Photography guide",
  "Private chef",
  "Luxury picnic",
  "Child seat",
  "Extra luggage support",
  "SIM card support",
  "Travel insurance support",
];

const COMMON_INCLUDED_SUGGESTIONS = [
  "Professional guide",
  "Park fees",
  "Accommodation",
  "Meals",
  "Transport",
  "Airport transfer",
  "Drinking water",
  "Government taxes",
  "Emergency support",
];

const COMMON_EXCLUDED_SUGGESTIONS = [
  "Flights",
  "Visa fees",
  "Travel insurance",
  "Tips and gratuities",
  "Personal expenses",
  "Alcoholic drinks",
  "Laundry services",
  "Optional activities",
];

function normalizedToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function packageIncludedSuggestions(pkg: PackageItem, tourismTypes: string[]): string[] {
  const selectedTypeServices = getServiceOptionsForTypes(tourismTypes);
  const byCategory = Object.entries(TOURISM_TYPE_SERVICES)
    .filter(([type]) => {
      const normalizedType = normalizedToken(type);
      const normalizedCategory = normalizedToken(pkg.category || "");
      if (!normalizedCategory) return false;
      return normalizedCategory.includes(normalizedType) || normalizedType.includes(normalizedCategory);
    })
    .flatMap(([, services]) => services);

  return Array.from(new Set([
    ...COMMON_INCLUDED_SUGGESTIONS,
    ...COMMON_SERVICES,
    ...selectedTypeServices,
    ...byCategory,
  ])).sort((a, b) => a.localeCompare(b));
}

function packageExcludedSuggestions(includedSuggestions: string[]): string[] {
  return Array.from(new Set([
    ...COMMON_EXCLUDED_SUGGESTIONS,
    ...includedSuggestions,
  ])).sort((a, b) => a.localeCompare(b));
}

const packageStepDefs = [
  { n: 1, label: "Basics" },
  { n: 2, label: "Pricing & terms" },
  { n: 3, label: "Inclusions" },
  { n: 4, label: "Itinerary" },
] as const;

const AUTO_SAVE_DELAY_MS = 5000;
const AUTO_SAVE_RETRY_AFTER_429_MS = 15000;

const vehicleTypes = [
  "Safari 4x4 Land Cruiser",
  "Safari van",
  "Private SUV",
  "Minibus",
  "Coaster bus",
  "Boat transfer",
];

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const seasonalRateNames = [
  "High Season",
  "Low Season",
  "Peak Season",
  "Shoulder Season",
  "Festive Season",
  "Migration Season",
  "Special Offer Season",
];

const peakSeasonOptions = [
  "Available",
  "Limited availability",
  "Available on request",
  "Not available",
];

const maxPhotoBytes = 2 * 1024 * 1024;
const acceptedPhotoTypes = ["image/jpeg", "image/png", "image/webp"];
const photoHelpText = "JPG, PNG, or WEBP. Max 2MB per photo.";

const photoCategories = [
  { key: "logo", title: "Logo", text: "Company mark shown on customer profile." },
  { key: "vehicles", title: "Vehicles", text: "Fleet photos customers can inspect." },
  { key: "team", title: "Team", text: "Guides, drivers, and support staff." },
  { key: "office", title: "Office", text: "Physical office or meeting location." },
  { key: "attractions", title: "Attractions", text: "Real destinations and trip moments." },
  { key: "proof", title: "Proof", text: "Permits, awards, quality proof, or certificates." },
] as const;

/** Same rule as the API (lib/operatorPhotoLimits.ts): a few strong photos per group. */
function photoLimit(category: string): number {
  return category === "logo" ? 1 : category === "proof" ? 8 : 3;
}

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function makeItineraryEvent(seed?: Partial<ItineraryEvent>): ItineraryEvent {
  return {
    id: seed?.id || id(),
    startTime: seed?.startTime ?? "",
    endTime: seed?.endTime ?? "",
    activity: seed?.activity ?? "",
    difficulty: normalizeExperienceVibe(seed?.difficulty),
  };
}

function normalizeExperienceVibe(value: unknown): ItineraryEvent["difficulty"] {
  const vibe = String(value || "").trim();
  if (!vibe) return "";
  return vibe === "Easy" || vibe === "Normal" || vibe === "Difficult" || vibe === "Funny" || vibe === "Delicious"
    ? vibe
    : "";
}

function parseLegacyTimelineToEvents(input: unknown): ItineraryEvent[] {
  const parseLineText = (line: string) => {
    const trimmed = String(line || "").trim();
    if (!trimmed) return null;

    const rangeMatch = trimmed.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*[-–]\s*(.+)$/);
    if (rangeMatch) {
      return makeItineraryEvent({
        startTime: rangeMatch[1],
        endTime: rangeMatch[2],
        activity: rangeMatch[3].trim(),
        difficulty: "",
      });
    }

    const startMatch = trimmed.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(.+)$/);
    if (startMatch) {
      return makeItineraryEvent({
        startTime: startMatch[1],
        activity: startMatch[2].trim(),
        difficulty: "",
      });
    }

    return makeItineraryEvent({ activity: trimmed, difficulty: "" });
  };

  if (Array.isArray(input)) {
    return input
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const rawTime = String((entry as any)?.time || "").trim();
          const timeParts = rawTime.split(/\s*[-–]\s*/).map((x) => x.trim()).filter(Boolean);
          const startTime = timeParts[0] || "";
          const endTime = timeParts[1] || "";
          const label = String((entry as any)?.label || "").trim();
          const description = String((entry as any)?.description || "").trim();
          const activity = label || description;
          if (!startTime && !endTime && !activity) return null;

          return makeItineraryEvent({
            id: String((entry as any)?.id || "") || id(),
            startTime,
            endTime,
            activity,
            difficulty: normalizeExperienceVibe((entry as any)?.experienceVibe || (entry as any)?.difficulty),
          });
        }

        return parseLineText(String(entry || ""));
      })
      .filter((evt): evt is ItineraryEvent => Boolean(evt && (evt.activity || evt.startTime || evt.endTime)));
  }

  return String(input || "")
    .split(/\n+/)
    .map((line) => parseLineText(line))
    .filter((evt): evt is ItineraryEvent => Boolean(evt && (evt.activity || evt.startTime || evt.endTime)));
}

function normalizeItineraryDay(rawDay: any, index: number): ItineraryDay {
  const rawEvents = Array.isArray(rawDay?.events) ? rawDay.events : [];
  const mappedEvents = rawEvents
    .map((evt: any) =>
      makeItineraryEvent({
        id: String(evt?.id || "") || id(),
        startTime: String(evt?.startTime || "").trim(),
        endTime: String(evt?.endTime || "").trim(),
        activity: String(evt?.activity || "").trim(),
        difficulty: normalizeExperienceVibe(evt?.experienceVibe || evt?.difficulty),
      })
    )
    .filter((evt: ItineraryEvent) => evt.activity || evt.startTime || evt.endTime);

  const events = mappedEvents.length > 0 ? mappedEvents : parseLegacyTimelineToEvents(rawDay?.timeline);

  return {
    id: String(rawDay?.id || "") || id(),
    day: Number(rawDay?.day) > 0 ? Number(rawDay.day) : index + 1,
    title: String(rawDay?.title || ""),
    description: String(rawDay?.description || ""),
    events,
  };
}

function profileFrom(raw: Partial<OperatorProfile> | null | undefined, agent?: AgentMe["agent"]): OperatorProfile {
  return {
    ...emptyProfile,
    ...(raw ?? {}),
    contactPersonName: (raw as any)?.contactPersonName ?? agent?.user?.fullName ?? agent?.user?.name ?? "",
    contactPersonEmail: (raw as any)?.contactPersonEmail ?? agent?.user?.email ?? "",
    contactPersonPhone: (raw as any)?.contactPersonPhone ?? agent?.user?.phone ?? "",
    contactPersonNationality: (raw as any)?.contactPersonNationality ?? "",
    companyEmail: raw?.companyEmail ?? agent?.user?.email ?? "",
    companyPhone: raw?.companyPhone ?? agent?.user?.phone ?? "",
    languages: (raw as any)?.languages ?? "",
    contactEmail: raw?.contactEmail ?? agent?.user?.email ?? "",
    contactPhone: raw?.contactPhone ?? agent?.user?.phone ?? "",
    operatingRegions: strings(raw?.operatingRegions),
    registeredParks: strings((raw as any)?.registeredParks),
    tourismTypes: strings(raw?.tourismTypes),
    tools: strings(raw?.tools),
    services: strings(raw?.services),
    specializations: strings((raw as any)?.specializations),
    addOns: strings(raw?.addOns),
    gallery: strings(raw?.gallery),
    vehicles: Array.isArray(raw?.vehicles) ? raw.vehicles : [],
    packageItems: Array.isArray(raw?.packageItems)
      ? raw.packageItems.map((pkg) => ({
          ...pkg,
          name: (pkg as any)?.name ?? "",
          description: (pkg as any)?.description ?? "",
          destination: (pkg as any)?.destination ?? "",
          category: (pkg as any)?.category ?? "",
          duration: (pkg as any)?.duration ?? "",
          minPax: (pkg as any)?.minPax ?? "",
          maxPax: (pkg as any)?.maxPax ?? "",
          pricePerPerson: (pkg as any)?.pricePerPerson ?? "",
          currency: (pkg as any)?.currency ?? "USD",
          discountFactor: (pkg as any)?.discountFactor ?? "",
          discountType: (pkg as any)?.discountType ?? "",
          discountValue: (pkg as any)?.discountValue ?? "",
          discountCondition: (pkg as any)?.discountCondition ?? "",
          discountUnit: (pkg as any)?.discountUnit ?? "",
          mode: (pkg as any)?.mode ?? "Private",
          accommodation: (pkg as any)?.accommodation ?? "",
          mealPlan: (pkg as any)?.mealPlan ?? "",
          difficulty: (pkg as any)?.difficulty ?? "",
          meetingPoint: (pkg as any)?.meetingPoint ?? "",
          included: strings((pkg as any)?.included),
          excluded: strings((pkg as any)?.excluded),
          itinerary: Array.isArray((pkg as any)?.itinerary)
            ? (pkg as any).itinerary.map((day: any, idx: number) => normalizeItineraryDay(day, idx))
            : [],
        }))
      : [],
    seasonalPrices: Array.isArray(raw?.seasonalPrices) ? raw.seasonalPrices : [],
    classifiedPhotos: raw?.classifiedPhotos && typeof raw.classifiedPhotos === "object" ? raw.classifiedPhotos : {},
    yearsInOperation: Number.isFinite(Number((raw as any)?.yearsInOperation)) ? Number((raw as any).yearsInOperation) : undefined,
    teamSize: Number.isFinite(Number((raw as any)?.teamSize)) ? Number((raw as any).teamSize) : undefined,
    serviceClassification: (raw as any)?.serviceClassification && typeof (raw as any).serviceClassification === "object" ? (raw as any).serviceClassification : {},
    hasVehicles: typeof (raw as any)?.hasVehicles === "boolean" ? (raw as any).hasVehicles : undefined,
  };
}

function serializeProfileForApi(source: OperatorProfile): OperatorProfile {
  const packageItems = (source.packageItems || []).map((pkg) => ({
    ...pkg,
    itinerary: (pkg.itinerary || []).map((day) => {
      const timeline = (day.events || [])
        .map((evt) => {
          const start = String(evt.startTime || "").trim();
          const end = String(evt.endTime || "").trim();
          const label = String(evt.activity || "").trim();
          const time = start && end ? `${start}-${end}` : start || end;
          return {
            id: String(evt.id || "") || id(),
            time,
            label,
            description: "",
            experienceVibe: normalizeExperienceVibe(evt.difficulty),
          };
        })
        .filter((entry) => entry.time && (entry.label || entry.description));

      return {
        ...day,
        title: String(day.title || "").trim(),
        description: String(day.description || "").trim(),
        timeline,
      };
    }),
  }));

  return {
    ...source,
    packageItems,
  };
}

function Field({
  label,
  children,
  required,
  info,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  /** Short "why we ask / who sees it" note behind an (i). */
  info?: React.ReactNode;
}) {
  const hasRequiredSuffix = /\*\s*$/.test(label);
  const cleanLabel = hasRequiredSuffix ? label.replace(/\s*\*\s*$/, "") : label;
  const showRequired = required ?? hasRequiredSuffix;

  // The label points at the field by id (tap the words, the field focuses) and
  // the (i) sits right after the words, outside the label, so it never steals focus.
  const fieldId = useId();
  const control = isValidElement<{ id?: string }>(children) && !children.props.id
    ? cloneElement(children, { id: fieldId })
    : children;
  const targetId = isValidElement<{ id?: string }>(control) ? control.props.id : undefined;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <label htmlFor={targetId} className="min-w-0 truncate text-[12.5px] font-medium text-neutral-700">
          {cleanLabel.charAt(0).toUpperCase() + cleanLabel.slice(1)}
          {showRequired ? <span className="ml-0.5 text-red-500">*</span> : null}
        </label>
        {info ? <InfoTip label={`About ${cleanLabel.toLowerCase()}`}>{info}</InfoTip> : null}
      </div>
      {control}
    </div>
  );
}

const fieldBase =
  "mt-1.5 box-border block w-full max-w-full rounded-md border border-solid border-neutral-300 bg-white font-sans text-sm text-neutral-900 outline-none transition placeholder:font-sans placeholder:text-neutral-400 hover:border-neutral-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15";

function Segmented({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="mt-1.5 flex gap-1 overflow-x-auto rounded-md border border-solid border-neutral-300 bg-neutral-50 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`shrink-0 cursor-pointer appearance-none whitespace-nowrap rounded border-0 px-3.5 py-1.5 text-[12.5px] font-semibold transition ${value === o.value ? "bg-emerald-700 text-white" : "bg-transparent text-neutral-600 hover:bg-white hover:text-neutral-900"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`${fieldBase} h-10 px-3 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${props.className ?? ""}`}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${fieldBase} min-h-[104px] resize-y px-3 py-2.5 leading-6 ${props.className ?? ""}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select
        {...props}
        className={`${fieldBase} h-10 !appearance-none [-webkit-appearance:none] pl-3 pr-9 disabled:bg-neutral-50 disabled:text-neutral-400 ${props.className ?? ""}`}
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
    </span>
  );
}

/**
 * One step of the partnership profile. Numbered so the page reads as a flow,
 * with a plain "why we ask" note behind (i) and an honest done / to-do state.
 */
function Section({
  id,
  step,
  total,
  icon,
  title,
  text,
  info,
  done,
  todo,
  children,
}: {
  id?: string;
  step?: number;
  total?: number;
  icon: React.ReactNode;
  title: string;
  text: string;
  info?: React.ReactNode;
  done?: boolean;
  /** What is still missing, shown when not done. */
  todo?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="box-border w-full min-w-0 scroll-mt-24 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
      <header className="flex flex-wrap items-start gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4 sm:px-6">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md [&>svg]:h-4 [&>svg]:w-4 ${done ? "bg-emerald-700 text-white" : "bg-emerald-50 text-emerald-700"}`}>
          {done ? <Check className="h-4 w-4" /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          {step ? (
            <p className="m-0 text-[11.5px] font-medium text-neutral-400">Step {step}{total ? ` of ${total}` : ""}</p>
          ) : null}
          <div className="flex items-center gap-1.5">
            <h2 className="m-0 text-[16px] font-semibold leading-snug text-neutral-900">{title}</h2>
            {info ? <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip> : null}
          </div>
          <p className="m-0 mt-0.5 text-[12.5px] leading-5 text-neutral-500">{text}</p>
        </div>
        {typeof done === "boolean" ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded border border-solid px-2 py-0.5 text-[11.5px] font-semibold ${
              done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {done ? <Check className="h-3 w-3" aria-hidden /> : null}
            {done ? "Complete" : todo || "To do"}
          </span>
        ) : null}
      </header>
      <div className="min-w-0 p-5 sm:p-6">{children}</div>
    </section>
  );
}

function SubSection({
  title,
  text,
  required,
  count,
  info,
  children,
}: {
  title: string;
  text?: string;
  required?: boolean;
  count?: number;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-solid border-neutral-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 bg-neutral-50/60 px-4 py-2.5">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-1 text-[13px] font-semibold text-neutral-800">
            {title.charAt(0).toUpperCase() + title.slice(1)}
            {required ? <span className="text-red-500">*</span> : null}
            {info ? <InfoTip label={`About ${title.replace(/^\d+\.\s*/, "").toLowerCase()}`}>{info}</InfoTip> : null}
          </p>
          {text ? <p className="m-0 mt-0.5 text-[12px] leading-4 text-neutral-500">{text}</p> : null}
        </div>
        {typeof count === "number" ? (
          <span className={`shrink-0 rounded px-2 py-0.5 text-[11.5px] font-semibold ${count > 0 ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100 text-neutral-500"}`}>
            {count > 0 ? `${count} selected` : "None yet"}
          </span>
        ) : null}
      </header>
      <div className="min-w-0 p-4">{children}</div>
    </section>
  );
}

function FieldGrid({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {Children.map(children, (child) => (
        <div className="min-w-0">
          {child}
        </div>
      ))}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex min-h-10 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-solid px-3.5 py-2 text-left text-sm font-normal leading-5 transition ${
        active
          ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800"
          : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50"
      }`}
    >
      <span className="truncate">{label}</span>
      {active ? <Check className="h-4 w-4 shrink-0 text-emerald-700" /> : null}
    </button>
  );
}

function SelectedPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="grid min-h-10 grid-cols-[1fr_32px] items-start rounded-md border border-solid border-emerald-200 bg-emerald-50/50 text-[13px] font-medium text-neutral-800">
      <span className="break-words px-3.5 py-2 leading-5">{label}</span>
      <button type="button" onClick={onRemove} className="m-1 mt-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-neutral-500 shadow-none ring-0 outline-none hover:bg-white hover:text-red-600" aria-label={`Remove ${label}`}>
        <X className="h-4 w-4" />
      </button>
    </span>
  );
}

function parseFriendlyValidationErrors(payload: any): string[] {
  const messages: string[] = [];

  const issues = Array.isArray(payload?.issues) ? (payload.issues as ValidationIssue[]) : [];
  for (const issue of issues) {
    const path = Array.isArray(issue?.path) ? issue.path : [];
    const message = String(issue?.message || "").trim();
    if (!message) continue;

    const pkgIndex = path.findIndex((p) => p === "packageItems");
    const dayIndex = path.findIndex((p) => p === "itinerary");

    let prefix = "";
    if (pkgIndex >= 0 && typeof path[pkgIndex + 1] === "number") {
      prefix += `Package ${Number(path[pkgIndex + 1]) + 1}`;
    }
    if (dayIndex >= 0 && typeof path[dayIndex + 1] === "number") {
      const dayNumber = Number(path[dayIndex + 1]) + 1;
      prefix += prefix ? `, Day ${dayNumber}` : `Day ${dayNumber}`;
    }

    messages.push(prefix ? `${prefix}: ${message}` : message);
  }

  const details = payload?.details || {};
  const formErrors = Array.isArray(details?.formErrors) ? details.formErrors : [];
  const fieldErrors = details?.fieldErrors && typeof details.fieldErrors === "object" ? details.fieldErrors : {};

  for (const msg of formErrors) {
    const m = String(msg || "").trim();
    if (m) messages.push(m);
  }

  for (const key of Object.keys(fieldErrors)) {
    const arr = Array.isArray(fieldErrors[key]) ? fieldErrors[key] : [];
    for (const msg of arr) {
      const m = String(msg || "").trim();
      if (m) messages.push(m);
    }
  }

  return Array.from(new Set(messages));
}

export default function AgentOperatorProfileEditor() {
  const searchParams = useSearchParams();
  const isPackagesView = searchParams.get("view") === "packages";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSubmitSuccess, setShowSubmitSuccess] = useState(false);
  const [agent, setAgent] = useState<AgentMe["agent"] | null>(null);
  // Safe package removal: a confirm card, a server check for live bookings, and restore.
  const [removedPackages, setRemovedPackages] = useState<RemovedPackageEntry[]>([]);
  const [removeTarget, setRemoveTarget] = useState<PackageItem | null>(null);
  const [removeTyped, setRemoveTyped] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  useEffect(() => {
    const list = (agent as any)?.operatorProfile?.removedPackages;
    setRemovedPackages(Array.isArray(list) ? list : []);
  }, [agent]);
  const [profile, setProfile] = useState<OperatorProfile>(emptyProfile);
  const [region, setRegion] = useState("");
  const [customAddOn, setCustomAddOn] = useState("");
  const [parkInput, setParkInput] = useState("");
  const [vehicleInput, setVehicleInput] = useState({ type: "", quantity: "", seatsPerVehicle: "", registrationNumber: "", ownedBy: "", serviceMode: "", notes: "" });
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);
  const [tourismSites, setTourismSites] = useState<{ id: number; name: string }[]>([]);
  const [tourismSitesLoading, setTourismSitesLoading] = useState(false);
  const [includedDrafts, setIncludedDrafts] = useState<Record<string, string>>({});
  const [excludedDrafts, setExcludedDrafts] = useState<Record<string, string>>({});
  const [itineraryDrafts, setItineraryDrafts] = useState<Record<string, { title: string; description: string; events: ItineraryEvent[] }>>({});
  const [autosaveRetryTick, setAutosaveRetryTick] = useState(0);
  const [expandedPackageIds, setExpandedPackageIds] = useState<Record<string, boolean>>({});
  const [packageStep, setPackageStep] = useState<Record<string, number>>({});
  const [packageSort, setPackageSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "number", direction: "asc" });
  const [photoSlideIndex, setPhotoSlideIndex] = useState<Record<string, number>>({});
  const touchStartXRef = useRef<Record<string, number | null>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const hasLoadedProfileRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);
  const autosaveBlockedUntilRef = useRef(0);
  const lastSavedSnapshotRef = useRef("");
  const profileRef = useRef(profile);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Serializes all operator-profile PATCH requests (autosave + manual save/submit)
  // so they never run concurrently and each one always reflects the latest profile
  // state at the moment it executes. Without this, an in-flight autosave carrying
  // an older snapshot can resolve after a newer save/submit and silently overwrite it.
  function queueProfileSave<T>(task: () => Promise<T>): Promise<T> {
    const run = saveChainRef.current.then(task, task);
    saveChainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await api.get("/api/agent/me", { params: { _t: Date.now() } });
        if (!alive) return;
        const nextAgent = (res.data as AgentMe)?.agent ?? null;
        const nextProfile = profileFrom(nextAgent?.operatorProfile, nextAgent ?? undefined);
        setAgent(nextAgent);
        setProfile(nextProfile);
        lastSavedSnapshotRef.current = JSON.stringify(nextProfile);
        hasLoadedProfileRef.current = true;
      } catch (e: any) {
        if (alive) setError(e?.response?.data?.message || "Unable to load operator profile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selectedRegion = REGIONS.find((r) => r.name === region);

  useEffect(() => {
    setTourismSitesLoading(true);
    api.get("/api/public/tourism-sites")
      .then((res) => setTourismSites(Array.isArray(res.data?.items) ? res.data.items : []))
      .catch(() => setTourismSites([]))
      .finally(() => setTourismSitesLoading(false));
  }, []);

  const profileSnapshot = useMemo(() => JSON.stringify(profile), [profile]);

  const readiness = useMemo(() => {
    const steps = [
      { label: "Company name", done: Boolean(profile.companyName) },
      { label: "Contact email", done: Boolean(profile.contactEmail) },
      { label: "Contact phone", done: Boolean(profile.contactPhone) },
      { label: "Business address", done: Boolean(profile.businessAddress) },
      { label: "Physical location", done: Boolean(profile.physicalLocation) },
      { label: "Operating regions", done: profile.operatingRegions.length > 0 },
      { label: "Tourism types", done: profile.tourismTypes.length > 0 },
      { label: "Services", done: profile.services.length > 0 },
      { label: "Fleet or tools", done: profile.vehicles.length > 0 || profile.tools.length > 0 },
      { label: "Packages or pricing", done: profile.packageItems.length > 0 || profile.seasonalPrices.length > 0 },
      { label: "Photos", done: Object.values(profile.classifiedPhotos).some((items) => Array.isArray(items) && items.length > 0) },
      { label: "Description", done: Boolean(profile.description) },
      { label: "Capacity details", done: Boolean(profile.guidesAvailable || profile.minimumBookingNotice || profile.maxTripsPerDay) },
    ];
    const done = steps.filter((step) => step.done).length;
    return { steps, done, total: steps.length, pct: Math.round((done / steps.length) * 100) };
  }, [profile]);

  // The page as a flow: one entry per section, in page order, with what is
  // still missing. Drives the step badges, the flow bar and the side guide.
  const sectionFlow = useMemo(() => {
    const has = (value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim()));
    const section = (id: string, title: string, checks: Array<[string, boolean]>) => {
      const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
      return {
        id,
        title,
        done: missing.length === 0,
        missing,
        todo: missing.length === 1 ? `Add ${missing[0]}` : `${missing.length} to add`,
      };
    };
    return [
      section("profile-contact", "Contact person", [
        ["your name", has(profile.contactPersonName)],
        ["your email", has(profile.contactPersonEmail)],
        ["your phone", has(profile.contactPersonPhone)],
      ]),
      section("profile-company", "Company", [
        ["company name", has(profile.companyName)],
        ["company phone", has(profile.companyPhone)],
        ["business address", has(profile.businessAddress)],
        ["company story", has(profile.description)],
        ["languages", has(profile.languages)],
      ]),
      section("profile-compliance", "Compliance", [
        ["registration number", has(profile.businessRegistrationNumber)],
        ["TIN", has(profile.tinNumber)],
        ["tourism permit", has(profile.tourismPermitNumber)],
      ]),
      section("profile-tourism", "Tourism you serve", [
        ["tourism types", has(profile.tourismTypes)],
        ["services", has(profile.services)],
        ["specializations", has(profile.specializations)],
      ]),
      section("profile-area", "Area of operation", [
        ["operating regions", has(profile.operatingRegions)],
        ["permitted parks", has(profile.registeredParks)],
      ]),
      section("profile-tools", "Tools and fleet", [
        ["a tool or vehicle", has(profile.tools) || has(profile.vehicles)],
      ]),
      section("profile-capacity", "Operating capacity", [
        ["capacity details", has(profile.guidesAvailable) || has(profile.minimumBookingNotice) || has(profile.maxTripsPerDay)],
      ]),
    ];
  }, [profile]);
  const flowDone = sectionFlow.filter((item) => item.done).length;
  const flowById = useMemo(() => Object.fromEntries(sectionFlow.map((item, i) => [item.id, { ...item, step: i + 1 }])), [sectionFlow]);

  useEffect(() => {
    if (!hasLoadedProfileRef.current) return;
    if (loading || saving || submitting || autosaveInFlightRef.current) return;
    if (profileSnapshot === lastSavedSnapshotRef.current) return;
    if (Date.now() < autosaveBlockedUntilRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        autosaveInFlightRef.current = true;
        setValidationErrors([]);
        await queueProfileSave(async () => {
          const snapshotToSave = JSON.stringify(profileRef.current);
          const savedLogo = profileRef.current.companyLogoUrl;
          await api.patch("/api/agent/operator-profile", serializeProfileForApi(profileRef.current));
          // Silent autosave: keep current form state intact and only advance saved snapshot.
          lastSavedSnapshotRef.current = snapshotToSave;
          announceAgentLogo(savedLogo);
        });
        console.log("✓ Autosave successful");
      } catch (e: any) {
        const status = Number(e?.response?.status || 0);
        if (status === 429) {
          const retryAfterSeconds = Number(e?.response?.headers?.["retry-after"]);
          const retryMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : AUTO_SAVE_RETRY_AFTER_429_MS;
          autosaveBlockedUntilRef.current = Date.now() + retryMs;
          setTimeout(() => setAutosaveRetryTick((t) => t + 1), retryMs + 100);
          console.warn("⏳ Autosave paused by rate limit. Will retry automatically.");
          return;
        }
        // Silent autosave: no user-facing feedback on errors, but log for debugging
        const friendly = parseFriendlyValidationErrors(e?.response?.data);
        console.warn("❌ Autosave failed - validation errors:", friendly);
        console.debug("Full error:", e?.response?.data);
      } finally {
        autosaveInFlightRef.current = false;
      }
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [autosaveRetryTick, loading, profile, profileSnapshot, saving, submitting]);

  function update<K extends keyof OperatorProfile>(key: K, value: OperatorProfile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  function toggle(key: "tourismTypes" | "tools" | "services" | "addOns", value: string) {
    setProfile((p) => {
      const list = p[key];
      return { ...p, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] };
    });
  }

  function toggleTourismType(value: string) {
    const isRemoving = profile.tourismTypes.includes(value);
    if (isRemoving) {
      const remainingTypes = profile.tourismTypes.filter((t) => t !== value);
      const allowedServices = getServiceOptionsForTypes(remainingTypes);
      const nextClassification: Record<string, string[]> = {};
      Object.entries(profile.serviceClassification ?? {}).forEach(([k, v]) => {
        if (k === value) return;
        const filtered = v.filter((s) => allowedServices.includes(s));
        if (filtered.length > 0) nextClassification[k] = filtered;
      });
      setProfile((p) => ({
        ...p,
        tourismTypes: remainingTypes,
        services: p.services.filter((s) => allowedServices.includes(s)),
        serviceClassification: nextClassification,
      }));
    } else {
      setProfile((p) => ({ ...p, tourismTypes: [...p.tourismTypes, value] }));
    }
  }

  function removeClassifiedService(value: string) {
    const nextClassification: Record<string, string[]> = {};
    Object.entries(profile.serviceClassification ?? {}).forEach(([cat, services]) => {
      const filtered = services.filter((s) => s !== value);
      if (filtered.length > 0) nextClassification[cat] = filtered;
    });
    setProfile((p) => ({
      ...p,
      services: p.services.filter((s) => s !== value),
      serviceClassification: nextClassification,
    }));
  }

  /** Tick or untick a service inside one group; it stays listed while any group still holds it. */
  function toggleClassifiedService(category: string, service: string) {
    setProfile((p) => {
      const current = { ...(p.serviceClassification ?? {}) };
      const inGroup = (current[category] ?? []).includes(service);
      if (inGroup) {
        current[category] = (current[category] ?? []).filter((s) => s !== service);
        if (!current[category].length) delete current[category];
      } else {
        current[category] = Array.from(new Set([...(current[category] ?? []), service]));
      }
      const stillHeld = Object.values(current).some((list) => list.includes(service));
      return {
        ...p,
        serviceClassification: current,
        services: stillHeld ? Array.from(new Set([...p.services, service])) : p.services.filter((s) => s !== service),
      };
    });
    setError(null);
  }

  function toggleSpecialization(value: string) {
    setProfile((p) => ({
      ...p,
      specializations: p.specializations.includes(value)
        ? p.specializations.filter((s) => s !== value)
        : [...p.specializations, value],
    }));
  }

  function addCustom(key: "tools" | "services" | "addOns", value: string, clear: (v: string) => void) {
    const clean = value.trim();
    if (!clean) return;
    setProfile((p) => ({ ...p, [key]: p[key].includes(clean) ? p[key] : [...p[key], clean] }));
    clear("");
  }

  function addVehicle() {
    if (!vehicleInput.type || !vehicleInput.quantity || !vehicleInput.seatsPerVehicle) return;
    update("vehicles", [
      ...profile.vehicles,
      {
        id: id(),
        type: vehicleInput.type,
        quantity: vehicleInput.quantity,
        seatsPerVehicle: vehicleInput.seatsPerVehicle,
        registrationNumber: vehicleInput.registrationNumber,
        ownedBy: vehicleInput.ownedBy,
        serviceMode: vehicleInput.serviceMode,
        notes: vehicleInput.notes,
      },
    ]);
    setVehicleInput({ type: "", quantity: "", seatsPerVehicle: "", registrationNumber: "", ownedBy: "", serviceMode: "", notes: "" });
    setVehicleFormOpen(false);
  }

  function addPackage() {
    const newPackageId = id();
    update("packageItems", [
      ...profile.packageItems,
      {
        id: newPackageId,
        name: "",
        description: "",
        destination: "",
        category: "",
        duration: "",
        minPax: "",
        maxPax: "",
        pricePerPerson: "",
        currency: "USD",
        discountFactor: "",
        discountType: "",
        discountValue: "",
        discountCondition: "",
        discountUnit: "",
        mode: "Private",
        accommodation: "",
        mealPlan: "",
        difficulty: "",
        meetingPoint: "",
        included: [],
        excluded: [],
        itinerary: [],
        notes: "",
      },
    ]);
    setExpandedPackageIds((prev) => ({ ...prev, [newPackageId]: true }));
  }

  function patchPackage(packageId: string, patch: Partial<PackageItem>) {
    update("packageItems", profile.packageItems.map((p) => (p.id === packageId ? { ...p, ...patch } : p)));
  }

  function removePackage(packageId: string) {
    update("packageItems", profile.packageItems.filter((p) => p.id !== packageId));
    setExpandedPackageIds((prev) => {
      const next = { ...prev };
      delete next[packageId];
      return next;
    });
  }

  function askRemovePackage(pkg: PackageItem) {
    setRemoveTarget(pkg);
    setRemoveTyped("");
    setRemoveError(null);
  }

  /** Removal goes through the server, which refuses while travellers are booked on the package. */
  async function confirmRemovePackage() {
    const target = removeTarget;
    if (!target || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      const res = await api.post(`/api/agent/operator-profile/packages/${encodeURIComponent(target.id)}/remove`, { confirmName: removeTyped });
      const list = (res.data as any)?.agent?.operatorProfile?.removedPackages;
      setRemovedPackages(Array.isArray(list) ? list : []);
      removePackage(target.id);
      setRemoveTarget(null);
      setSuccess(`"${target.name || "Package"}" removed. You can restore it for ${PACKAGE_RESTORE_DAYS} days below.`);
    } catch (e: any) {
      const code = e?.response?.data?.error;
      if (code === "PACKAGE_NOT_FOUND") {
        // Never saved to the server: it only exists in this editor.
        removePackage(target.id);
        setRemoveTarget(null);
        return;
      }
      setRemoveError(e?.response?.data?.message || "The package could not be removed. Try again.");
    } finally {
      setRemoveBusy(false);
    }
  }

  async function restoreRemovedPackage(entry: RemovedPackageEntry) {
    const id = String(entry.item?.id || "");
    if (!id || restoringId) return;
    setRestoringId(id);
    setError(null);
    try {
      const res = await api.post(`/api/agent/operator-profile/packages/${encodeURIComponent(id)}/restore`);
      const op = (res.data as any)?.agent?.operatorProfile;
      setRemovedPackages(Array.isArray(op?.removedPackages) ? op.removedPackages : []);
      const restored = profileFrom(op, agent ?? undefined).packageItems.find((p) => p.id === id);
      if (restored && !profile.packageItems.some((p) => p.id === id)) update("packageItems", [...profile.packageItems, restored]);
      setSuccess(`"${entry.item?.name || "Package"}" is back${(res.data as any)?.live ? " and live again" : ". It goes live after NoLSAF reviews your profile"}.`);
    } catch (e: any) {
      setError(e?.response?.data?.message || "The package could not be restored. Try again.");
    } finally {
      setRestoringId(null);
    }
  }

  function togglePackageSort(key: string) {
    setPackageSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function packageLooksComplete(pkg: PackageItem) {
    const coreFilled = [
      pkg.name,
      pkg.destination,
      pkg.description,
      pkg.category,
      pkg.duration,
      pkg.mode,
      pkg.minPax,
      pkg.maxPax,
      pkg.pricePerPerson,
      pkg.currency,
    ].every((v) => String(v || "").trim().length > 0);

    const hasIncluded = (pkg.included || []).length > 0;
    const hasItinerary = (pkg.itinerary || []).length > 0;
    return coreFilled && hasIncluded && hasItinerary;
  }

  function removePackageListItem(packageId: string, key: "included" | "excluded", item: string) {
    update(
      "packageItems",
      profile.packageItems.map((pkg) =>
        pkg.id === packageId ? { ...pkg, [key]: pkg[key].filter((x) => x !== item) } : pkg,
      ),
    );
  }

  function buildItineraryDayFromDraft(draft: { title: string; description: string; events: ItineraryEvent[] }, dayNumber: number): ItineraryDay | null {
    const cleanTitle = String(draft.title || "").trim();
    const cleanDesc = String(draft.description || "").trim();
    const completeEvents: ItineraryEvent[] = (draft.events || []).reduce<ItineraryEvent[]>((acc, evt) => {
      const startTime = String(evt.startTime || "").trim();
      const endTime = String(evt.endTime || "").trim();
      const activity = String(evt.activity || "").trim();
      if (!(startTime && endTime && activity)) return acc;

      const difficulty: ItineraryEvent["difficulty"] =
        evt.difficulty === "Easy" ||
        evt.difficulty === "Normal" ||
        evt.difficulty === "Difficult" ||
        evt.difficulty === "Funny" ||
        evt.difficulty === "Delicious"
          ? evt.difficulty
          : "Normal";

      acc.push({
        id: String(evt.id || "") || id(),
        startTime,
        endTime,
        activity,
        difficulty,
      });
      return acc;
    }, []);

    const hasDescriptionWithTimes = /\d{1,2}:\d{2}|am|pm|morning|afternoon|evening/i.test(cleanDesc);
    const canPersist = !!cleanTitle && (completeEvents.length > 0 || hasDescriptionWithTimes);
    if (!canPersist) return null;

    return {
      id: id(),
      day: dayNumber,
      title: cleanTitle,
      description: cleanDesc,
      events: completeEvents,
    };
  }

  function mergeValidItineraryDrafts(baseProfile: OperatorProfile) {
    const consumedPackageIds = new Set<string>();
    const nextPackageItems = baseProfile.packageItems.map((pkg) => {
      const draft = itineraryDrafts[pkg.id];
      if (!draft) return pkg;

      const nextDayNumber = (pkg.itinerary.length > 0 ? Math.max(...pkg.itinerary.map((d) => d.day)) : 0) + 1;
      const draftDay = buildItineraryDayFromDraft(draft, nextDayNumber);
      if (!draftDay) return pkg;

      consumedPackageIds.add(pkg.id);
      return { ...pkg, itinerary: [...pkg.itinerary, draftDay] };
    });

    const nextDrafts = { ...itineraryDrafts };
    for (const pkgId of consumedPackageIds) {
      nextDrafts[pkgId] = { title: "", description: "", events: [] };
    }

    return {
      nextProfile: { ...baseProfile, packageItems: nextPackageItems },
      nextDrafts,
    };
  }

  function addItineraryDay(packageId: string) {
    const draft: { title: string; description: string; events: ItineraryEvent[] } =
      itineraryDrafts[packageId] ?? { title: "", description: "", events: [] };
    const cleanTitle = draft.title.trim();
    const cleanDesc = draft.description.trim();
    const cleanEvents: ItineraryEvent[] = (draft.events || []).reduce<ItineraryEvent[]>((acc, evt) => {
      const startTime = String(evt.startTime || "").trim();
      const endTime = String(evt.endTime || "").trim();
      const activity = String(evt.activity || "").trim();
      if (!startTime && !endTime && !activity) return acc;

      const difficulty = normalizeExperienceVibe(evt.difficulty);

      acc.push({
        id: String(evt.id || "") || id(),
        startTime,
        endTime,
        activity,
        difficulty,
      });
      return acc;
    }, []);

    if (!cleanTitle && !cleanDesc && cleanEvents.length === 0) return;
    const pkg = profile.packageItems.find((p) => p.id === packageId);
    if (!pkg) return;
    const nextDay = (pkg.itinerary.length > 0 ? Math.max(...pkg.itinerary.map((d) => d.day)) : 0) + 1;
    const newDay: ItineraryDay = {
      id: id(),
      day: nextDay,
      title: cleanTitle,
      description: cleanDesc,
      events: cleanEvents,
    };
    update("packageItems", profile.packageItems.map((p) =>
      p.id === packageId ? { ...p, itinerary: [...p.itinerary, newDay] } : p,
    ));
    setItineraryDrafts((d) => ({ ...d, [packageId]: { title: "", description: "", events: [] } }));
  }

  function addItineraryEvent(packageId: string, dayId: string) {
    update(
      "packageItems",
      profile.packageItems.map((pkg) =>
        pkg.id === packageId
          ? {
              ...pkg,
              itinerary: pkg.itinerary.map((day) =>
                day.id === dayId ? { ...day, events: [...(day.events || []), makeItineraryEvent()] } : day,
              ),
            }
          : pkg,
      ),
    );
  }

  function patchItineraryEvent(packageId: string, dayId: string, eventId: string, patch: Partial<ItineraryEvent>) {
    update(
      "packageItems",
      profile.packageItems.map((pkg) =>
        pkg.id === packageId
          ? {
              ...pkg,
              itinerary: pkg.itinerary.map((day) =>
                day.id === dayId
                  ? {
                      ...day,
                      events: (day.events || []).map((evt) => (evt.id === eventId ? { ...evt, ...patch } : evt)),
                    }
                  : day,
              ),
            }
          : pkg,
      ),
    );
  }

  function removeItineraryEvent(packageId: string, dayId: string, eventId: string) {
    update(
      "packageItems",
      profile.packageItems.map((pkg) =>
        pkg.id === packageId
          ? {
              ...pkg,
              itinerary: pkg.itinerary.map((day) =>
                day.id === dayId
                  ? { ...day, events: (day.events || []).filter((evt) => evt.id !== eventId) }
                  : day,
              ),
            }
          : pkg,
      ),
    );
  }

  function addDraftItineraryEvent(packageId: string) {
    setItineraryDrafts((drafts) => {
      const existing = drafts[packageId] ?? { title: "", description: "", events: [] };
      return {
        ...drafts,
        [packageId]: { ...existing, events: [...(existing.events || []), makeItineraryEvent()] },
      };
    });
  }

  function patchDraftItineraryEvent(packageId: string, eventId: string, patch: Partial<ItineraryEvent>) {
    setItineraryDrafts((drafts) => {
      const existing = drafts[packageId] ?? { title: "", description: "", events: [] };
      return {
        ...drafts,
        [packageId]: {
          ...existing,
          events: (existing.events || []).map((evt) => (evt.id === eventId ? { ...evt, ...patch } : evt)),
        },
      };
    });
  }

  function removeDraftItineraryEvent(packageId: string, eventId: string) {
    setItineraryDrafts((drafts) => {
      const existing = drafts[packageId] ?? { title: "", description: "", events: [] };
      return {
        ...drafts,
        [packageId]: {
          ...existing,
          events: (existing.events || []).filter((evt) => evt.id !== eventId),
        },
      };
    });
  }

  function patchItineraryDay(packageId: string, dayId: string, patch: Partial<ItineraryDay>) {
    update("packageItems", profile.packageItems.map((p) =>
      p.id === packageId
        ? { ...p, itinerary: p.itinerary.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) }
        : p,
    ));
  }

  function removeItineraryDay(packageId: string, dayId: string) {
    update("packageItems", profile.packageItems.map((p) =>
      p.id === packageId
        ? { ...p, itinerary: p.itinerary.filter((d) => d.id !== dayId).map((d, i) => ({ ...d, day: i + 1 })) }
        : p,
    ));
  }

  function addSeason() {
    update("seasonalPrices", [
      ...profile.seasonalPrices,
      { id: id(), seasonName: "", startMonth: "", endMonth: "", pricePerPerson: "", currency: "USD", notes: "" },
    ]);
  }

  function patchSeason(seasonId: string, patch: Partial<SeasonalPrice>) {
    update("seasonalPrices", profile.seasonalPrices.map((p) => (p.id === seasonId ? { ...p, ...patch } : p)));
  }

  async function uploadToCloudinary(file: File, category: string) {
    const sig = await api.get(`/api/uploads/cloudinary/sign?folder=${encodeURIComponent(`agent-operator/${category}`)}`);
    const sigData = sig.data as CloudinarySig;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("timestamp", String(sigData.timestamp));
    fd.append("api_key", sigData.apiKey);
    fd.append("signature", sigData.signature);
    fd.append("folder", sigData.folder);
    fd.append("overwrite", "true");
    const resp = await axios.post(`https://api.cloudinary.com/v1_1/${sigData.cloudName}/auto/upload`, fd);
    return (resp.data as { secure_url: string }).secure_url;
  }

  async function uploadPhotos(category: string, files: FileList | null) {
    if (!files?.length) return;
    try {
      setUploading(category);
      setError(null);
      const selectedFiles = Array.from(files);
      if (category === "logo" && selectedFiles.length > 1) {
        setError("Logo allows only one photo. Please upload a single image.");
        return;
      }
      // Photo policy (enforced by the API too): logo 1, proof 8, every other group 3.
      if (category !== "logo") {
        const limit = photoLimit(category);
        const room = limit - (profile.classifiedPhotos[category] ?? []).length;
        if (room <= 0) {
          setError(`This group already has its ${limit} photos. Remove one to add another.`);
          return;
        }
        if (selectedFiles.length > room) {
          setError(`You can add ${room} more photo${room === 1 ? "" : "s"} here (${limit} per group). Choose your best ${room === 1 ? "one" : room}.`);
          return;
        }
      }
      const invalidType = selectedFiles.find((file) => !acceptedPhotoTypes.includes(file.type));
      if (invalidType) {
        setError("Only JPG, PNG, or WEBP photos are allowed.");
        return;
      }
      const tooLarge = selectedFiles.find((file) => file.size > maxPhotoBytes);
      if (tooLarge) {
        setError("Each photo must be 2MB or smaller.");
        return;
      }
      const urls: string[] = [];
      for (const file of selectedFiles) urls.push(await uploadToCloudinary(file, category));
      setProfile((p) => {
        const existing = p.classifiedPhotos[category] ?? [];
        const nextCategoryUrls = category === "logo" ? (urls[0] ? [urls[0]] : existing) : [...existing, ...urls];
        const galleryWithoutOldLogo =
          category === "logo"
            ? p.gallery.filter((x) => !existing.includes(x))
            : p.gallery;
        const classifiedPhotos = { ...p.classifiedPhotos, [category]: nextCategoryUrls };
        return {
          ...p,
          companyLogoUrl: category === "logo" && urls[0] ? urls[0] : p.companyLogoUrl,
          gallery: [...galleryWithoutOldLogo, ...urls],
          classifiedPhotos,
        };
      });
    } catch (e: any) {
      setError(e?.response?.data?.message || "Photo upload failed.");
    } finally {
      setUploading(null);
      const input = fileRefs.current[category];
      if (input) input.value = "";
    }
  }

async function persistProfileDraft(showSuccessMessage = true) {
      return queueProfileSave(async () => {
        const { nextProfile: profileToSave, nextDrafts } = mergeValidItineraryDrafts(profileRef.current);
        const res = await api.patch("/api/agent/operator-profile", serializeProfileForApi(profileToSave));
        const nextAgent = (res.data as AgentMe)?.agent ?? null;
        const nextProfile = profileFrom(nextAgent?.operatorProfile, nextAgent ?? agent ?? undefined);
        setProfile(nextProfile);
        setItineraryDrafts(nextDrafts);
        if (nextAgent) setAgent(nextAgent);
        lastSavedSnapshotRef.current = JSON.stringify(nextProfile);
        hasLoadedProfileRef.current = true;
        announceAgentLogo(nextProfile.companyLogoUrl);
        if (showSuccessMessage) {
          setSuccess("Operator profile saved.");
        }
        return nextProfile;
      });
    }

    async function save() {
      try {
        setSaving(true);
        setError(null);
        setValidationErrors([]);
        setSuccess(null);
        autosaveBlockedUntilRef.current = 0;
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        await persistProfileDraft(true);
      } catch (e: any) {
        const status = Number(e?.response?.status || 0);
        const friendly = parseFriendlyValidationErrors(e?.response?.data);
        setValidationErrors(friendly);
        setError(status === 429
          ? "Too many save requests right now. Please wait a few seconds and try Save draft again."
          : e?.response?.data?.message || e?.response?.data?.error || "Unable to save operator profile.");
      } finally {
        setSaving(false);
      }
    }

    async function submitForReview() {
      try {
        setSubmitting(true);
        setError(null);
        setValidationErrors([]);
        setSuccess(null);
        if (JSON.stringify(profile) !== lastSavedSnapshotRef.current) {
          await persistProfileDraft(false);
        }
      const res = await api.post("/api/agent/operator-profile/submit");
      const nextAgent = (res.data as AgentMe)?.agent ?? null;
      if (nextAgent?.operatorProfile) {
        const nextProfile = profileFrom(nextAgent.operatorProfile, nextAgent ?? agent ?? undefined);
        setProfile(nextProfile);
        lastSavedSnapshotRef.current = JSON.stringify(nextProfile);
      }
      if (nextAgent) setAgent(nextAgent);
      setSuccess("Operator profile submitted to admin for review.");
      setShowSubmitSuccess(true);
      setTimeout(() => setShowSubmitSuccess(false), 10000);
    } catch (e: any) {
      const missing = e?.response?.data?.missing;
      const missingText = Array.isArray(missing) && missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
      setError((e?.response?.data?.message || e?.response?.data?.error || "Unable to submit operator profile.") + missingText);
    } finally {
      setSubmitting(false);
    }
  }

  function goToPhoto(categoryKey: string, total: number, direction: -1 | 1) {
    if (total <= 1) return;
    setPhotoSlideIndex((prev) => {
      const current = Math.min(Math.max(prev[categoryKey] ?? 0, 0), total - 1);
      return { ...prev, [categoryKey]: (current + direction + total) % total };
    });
  }

  function onPhotoTouchStart(categoryKey: string, clientX: number) {
    touchStartXRef.current[categoryKey] = clientX;
  }

  function onPhotoTouchEnd(categoryKey: string, total: number, clientX: number) {
    const startX = touchStartXRef.current[categoryKey];
    touchStartXRef.current[categoryKey] = null;
    if (startX == null || total <= 1) return;

    const delta = clientX - startX;
    const threshold = 30;
    if (Math.abs(delta) < threshold) return;

    if (delta < 0) {
      goToPhoto(categoryKey, total, 1);
    } else {
      goToPhoto(categoryKey, total, -1);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto w-full max-w-6xl animate-pulse py-6 sm:px-6 lg:px-8">
          <div className="h-9 w-9 rounded-lg bg-slate-200" />

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(2,32,29,0.08)] sm:p-6">
              <div className="h-5 w-40 rounded bg-slate-200" />
              <div className="mt-3 h-10 w-64 rounded bg-slate-200" />
              <div className="mt-3 h-4 w-full max-w-2xl rounded bg-slate-200" />
              <div className="mt-2 h-4 w-full max-w-xl rounded bg-slate-200" />
              <div className="mt-6 grid grid-cols-3 gap-2">
                <div className="h-16 rounded-xl bg-slate-200" />
                <div className="h-16 rounded-xl bg-slate-200" />
                <div className="h-16 rounded-xl bg-slate-200" />
              </div>
            </div>

            <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_35px_rgba(15,23,42,0.08)]">
              <div className="h-4 w-24 rounded bg-slate-200" />
              <div className="mt-3 h-10 w-20 rounded bg-slate-200" />
              <div className="mt-4 h-2 w-full rounded bg-slate-200" />
              <div className="mt-4 h-20 rounded-xl bg-slate-200" />
            </aside>
          </div>

          <div className="mt-5 space-y-5">
            {[1, 2, 3, 4].map((idx) => (
              <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_35px_rgba(15,23,42,0.08)]">
                <div className="h-4 w-40 rounded bg-slate-200" />
                <div className="mt-2 h-3 w-64 rounded bg-slate-200" />
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="h-10 rounded-lg bg-slate-200" />
                  <div className="h-10 rounded-lg bg-slate-200" />
                  <div className="h-10 rounded-lg bg-slate-200" />
                  <div className="h-10 rounded-lg bg-slate-200" />
                </div>
              </div>
            ))}
          </div>

          <div className="sticky bottom-0 mt-6 border-t border-slate-200 bg-slate-50/90 py-4 backdrop-blur">
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="h-4 w-56 rounded bg-slate-200" />
              <div className="flex gap-2">
                <div className="h-12 w-36 rounded-lg bg-slate-200" />
                <div className="h-12 w-44 rounded-lg bg-slate-200" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const reviewStatus = String(profile.reviewStatus || profile.review?.status || "DRAFT").toUpperCase();
  const reviewReason = String(profile.reviewReason || profile.review?.reason || "").trim();
  const canSubmit = readiness.pct === 100 && !["SUBMITTED", "RESUBMITTED"].includes(reviewStatus);
  const anyPackageExpanded = profile.packageItems.some((p) => expandedPackageIds[p.id]);
  const statusMeta = (() => {
    switch (reviewStatus) {
      case "APPROVED":
        return { tone: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: <ShieldCheck className="h-4 w-4" />, title: "Approved", subtitle: "Your profile is live for customers." };
      case "SUBMITTED":
      case "RESUBMITTED":
        return { tone: "border-sky-200 bg-sky-50 text-sky-800", icon: <ShieldCheck className="h-4 w-4" />, title: "Under review", subtitle: "We will notify you once it is reviewed." };
      case "CHANGES_REQUESTED":
        return { tone: "border-amber-200 bg-amber-50 text-amber-900", icon: <XCircle className="h-4 w-4" />, title: "Changes requested", subtitle: reviewReason || "Update the noted details and resubmit." };
      case "REJECTED":
        return { tone: "border-red-200 bg-red-50 text-red-800", icon: <XCircle className="h-4 w-4" />, title: "Rejected", subtitle: reviewReason || "Review the feedback and resubmit." };
      default:
        return { tone: "border-slate-200 bg-slate-50 text-slate-700", icon: <Save className="h-4 w-4" />, title: "Draft", subtitle: readiness.pct === 100 ? "Ready to submit for review." : "Complete all sections to submit." };
    }
  })();

  const heroTitle = profile.companyName?.trim() || "Operator profile";
  const heroLocation = [profile.physicalLocation, profile.businessAddress].find((value) => value?.trim())?.trim() || "";
  const heroInitials = (profile.companyName?.trim() || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "";
  const tierLevel = String(agent?.level || "").toUpperCase();
  const tierLabel = tierLevel ? `${tierLevel.charAt(0)}${tierLevel.slice(1).toLowerCase()} operator` : "";
  const tierColor =
    tierLevel === "PLATINUM" ? "#cdd8dc"
      : tierLevel === "GOLD" ? "#e0b341"
        : tierLevel === "SILVER" ? "#c3ccd4"
          : tierLevel === "BRONZE" ? "#cd7f32"
            : "#ffffff";
  const heroStats = [
    { label: "Coverage", count: profile.operatingRegions.length, target: 3, hint: "regions" },
    { label: "Packages", count: profile.packageItems.length, target: 3, hint: "packages" },
    { label: "Photos", count: profile.gallery.length, target: 8, hint: "photos" },
  ];
  const sortedPackageItems = [...profile.packageItems].sort((a, b) => {
    const value = (pkg: PackageItem) => {
      switch (packageSort.key) {
        case "package": return pkg.name || "";
        case "price": return Number(pkg.pricePerPerson) || 0;
        case "duration": return Number.parseInt(pkg.duration, 10) || 0;
        case "guests": return Number(pkg.maxPax) || 0;
        case "booking": return pkg.mode || "";
        case "status": return packageLooksComplete(pkg) ? 1 : 0;
        default: return profile.packageItems.indexOf(pkg);
      }
    };
    const left = value(a);
    const right = value(b);
    const comparison = typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right));
    return packageSort.direction === "asc" ? comparison : -comparison;
  });

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Submit success overlay ── */}
      {showSubmitSuccess && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={() => setShowSubmitSuccess(false)}
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-3xl shadow-2xl"
            style={{ background: "linear-gradient(135deg, #0a2825 0%, #02665e 55%, #0d3b36 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dot grid */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            />
            {/* Top shimmer */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

            <div className="relative px-8 py-10 text-center">
              {/* Animated check circle */}
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/20 bg-white/10 backdrop-blur-sm">
                <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <h2 className="text-xl font-extrabold text-white">Submitted for Review</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/70">
                Your operator profile has been sent to the admin team. You will be notified once it is reviewed and approved.
              </p>

              {/* Progress bar (10 second countdown) */}
              <div className="mt-6 overflow-hidden rounded-full bg-white/10 h-1.5">
                <div
                  className="h-full rounded-full bg-white/70"
                  style={{ animation: "shrink-progress 10s linear forwards" }}
                />
              </div>
              <p className="mt-2 text-[11px] text-white/40">This message closes automatically</p>

              <button
                type="button"
                onClick={() => setShowSubmitSuccess(false)}
                className="mt-6 inline-flex h-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 px-6 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes shrink-progress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>

      <div className="min-w-0 max-w-full pb-28">
        {!isPackagesView ? <Link
          href="/account/agent"
          aria-label="Back to agent dashboard"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 no-underline transition hover:text-emerald-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to dashboard
        </Link> : null}

        <div className={isPackagesView ? "hidden" : "grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start"}>
          <div className="min-w-0 space-y-4">
            {/* Partnership header: whose profile, where it stands, and the
                seven steps as one clickable flow. */}
            <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
              <div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6">
                <div className="flex min-w-0 flex-1 gap-3.5">
                  <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-solid border-neutral-200 bg-neutral-50 text-sm font-bold text-neutral-500">
                    {profile.companyLogoUrl ? (
                      <img src={profile.companyLogoUrl} alt={heroTitle} className="h-full w-full object-cover" />
                    ) : heroInitials ? (
                      <span>{heroInitials}</span>
                    ) : (
                      <Building2 className="h-5 w-5" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 flex items-center gap-1 text-[12.5px] font-medium text-emerald-700">
                      Your partnership profile
                      <InfoTip label="About the partnership profile">
                        This is how NoLSAF verifies your company and how travellers get to know you. Everything here is reviewed by NoLSAF; the company details, services, area and photos appear on your public page once approved.
                      </InfoTip>
                    </p>
                    <h1 className="m-0 mt-0.5 break-words text-[22px] font-bold leading-tight tracking-tight text-neutral-900">{heroTitle}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-neutral-600">
                      <span className={`inline-flex items-center gap-1.5 rounded border border-solid px-2 py-0.5 font-semibold ${statusMeta.tone}`}>
                        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{statusMeta.icon}</span>
                        {statusMeta.title}
                      </span>
                      {tierLabel ? (
                        <span className="inline-flex items-center gap-1.5 rounded border border-solid border-neutral-200 bg-white px-2 py-0.5 font-medium">
                          <ShieldCheck className="h-3.5 w-3.5" style={{ color: tierColor }} aria-hidden />
                          {tierLabel}
                        </span>
                      ) : null}
                      {heroLocation ? (
                        <span className="inline-flex min-w-0 items-center gap-1.5 rounded border border-solid border-neutral-200 bg-white px-2 py-0.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
                          <span className="truncate">{heroLocation.replace(/\s*-\s*/g, ", ")}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* How travellers see you: two icon tiles in one small card, top right. */}
                <nav aria-label="See your profile as travellers do" className="flex shrink-0 items-stretch overflow-hidden rounded-md border border-solid border-neutral-200 bg-neutral-50/70">
                  {[
                    { href: "/account/agent/profile/preview", label: "Preview", hint: "Your public page, as a traveller sees it", Icon: Eye },
                    { href: "/account/agent/card", label: "Card", hint: "Your card in the marketplace list", Icon: IdCard },
                  ].map(({ href, label, hint, Icon }, i) => (
                    <Link
                      key={href}
                      href={href}
                      title={hint}
                      aria-label={hint}
                      className={`group flex w-[4.5rem] flex-col items-center justify-center gap-1 px-2 py-2 text-neutral-600 no-underline transition hover:bg-white hover:text-[#02665e] hover:no-underline ${i ? "border-0 border-l border-solid border-neutral-200" : ""}`}
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-md bg-white text-neutral-700 ring-1 ring-neutral-200 transition group-hover:text-[#02665e] group-hover:ring-[#02665e]/30">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="text-[11px] font-semibold">{label}</span>
                    </Link>
                  ))}
                </nav>
              </div>

              {/* The flow: seven steps, done or not, each a jump link. */}
              <div className="border-0 border-t border-solid border-neutral-100 px-5 py-4 sm:px-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 text-[13px] font-semibold text-neutral-900">
                    {flowDone === sectionFlow.length ? "Every step is complete" : `${flowDone} of ${sectionFlow.length} steps complete`}
                  </p>
                  <span className="text-[12px] text-neutral-500">Changes save automatically</span>
                </div>
                <ol className="m-0 mt-3 flex list-none gap-0 overflow-x-auto p-0 pb-1 [scrollbar-width:thin]">
                  {sectionFlow.map((item, i) => (
                    <li key={item.id} className="relative min-w-[7.5rem] flex-1">
                      {i < sectionFlow.length - 1 ? (
                        <span aria-hidden className={`absolute left-[26px] right-0 top-[13px] h-0.5 ${item.done ? "bg-emerald-600" : "bg-neutral-200"}`} />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        className="group relative flex w-full cursor-pointer appearance-none flex-col items-start gap-1.5 border-0 bg-transparent p-0 pr-3 text-left"
                      >
                        <span
                          className={`relative z-[1] inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${
                            item.done ? "bg-emerald-700 text-white" : "border-2 border-solid border-neutral-300 bg-white text-neutral-500 group-hover:border-emerald-600 group-hover:text-emerald-700"
                          }`}
                        >
                          {item.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                        </span>
                        <span className="block text-[12.5px] font-semibold leading-tight text-neutral-800 group-hover:text-emerald-800">{item.title}</span>
                        <span className={`block text-[11.5px] leading-tight ${item.done ? "text-emerald-700" : "text-amber-700"}`}>
                          {item.done ? "Complete" : item.todo}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Marketplace targets: what makes a strong public page. */}
              <div className="grid grid-cols-1 gap-px border-0 border-t border-solid border-neutral-100 bg-neutral-100 sm:grid-cols-3">
                {heroStats.map((stat) => {
                  const pct = Math.min(100, Math.round((stat.count / stat.target) * 100));
                  const reached = stat.count >= stat.target;
                  return (
                    <div key={stat.label} className="min-w-0 bg-white px-5 py-3.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1 truncate text-[12.5px] font-medium text-neutral-600">
                          {stat.label}
                          <InfoTip label={`About ${stat.label.toLowerCase()}`}>
                            {`Strong operator pages show at least ${stat.target} ${stat.hint}. Travellers compare operators on this before they book.`}
                          </InfoTip>
                        </span>
                        <span className={`shrink-0 text-[13px] font-bold tabular-nums ${reached ? "text-emerald-700" : "text-neutral-700"}`}>
                          {stat.count}/{stat.target}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                        <div className={`h-full rounded-full ${reached ? "bg-emerald-600" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className={`m-0 mt-1.5 text-[11.5px] font-medium ${reached ? "text-emerald-700" : "text-amber-700"}`}>
                        {reached ? "Target reached" : `Add ${stat.target - stat.count} more ${stat.hint}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Side guide: status, overall progress, and every step as a link. */}
          <aside id="profile-status" className="min-w-0 scroll-mt-4 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white xl:sticky xl:top-3">
            <div className="px-5 py-4">
              <div className="flex items-center gap-4">
                <div className="relative h-[64px] w-[64px] shrink-0">
                  <svg viewBox="0 0 68 68" className="h-[64px] w-[64px] -rotate-90" aria-hidden>
                    <circle cx="34" cy="34" r="29" fill="none" stroke="#eef0ef" strokeWidth="6" />
                    <circle
                      cx="34"
                      cy="34"
                      r="29"
                      fill="none"
                      stroke={flowDone === sectionFlow.length ? "#047857" : "#f59e0b"}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${(flowDone / sectionFlow.length) * 182.2} 182.2`}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[15px] font-bold tabular-nums text-neutral-900">
                    {flowDone}/{sectionFlow.length}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="m-0 text-[14px] font-semibold text-neutral-900">
                    {flowDone === sectionFlow.length ? "Profile complete" : "Keep going"}
                  </p>
                  <p className="m-0 mt-0.5 text-[12px] leading-4 text-neutral-500">{statusMeta.subtitle}</p>
                </div>
              </div>
            </div>

            <nav aria-label="Profile steps" className="border-0 border-t border-solid border-neutral-100 px-2 py-2">
              {sectionFlow.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="flex w-full cursor-pointer appearance-none items-center gap-2.5 rounded-md border-0 bg-transparent px-3 py-2 text-left transition hover:bg-neutral-50"
                >
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold ${
                      item.done ? "bg-emerald-700 text-white" : "border border-solid border-neutral-300 text-neutral-500"
                    }`}
                  >
                    {item.done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{item.title}</span>
                  {item.done ? null : <span className="shrink-0 text-[11px] font-medium text-amber-700">{item.missing.length}</span>}
                </button>
              ))}
            </nav>

            <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3">
              <button
                type="button"
                onClick={submitForReview}
                disabled={submitting || saving || !canSubmit}
                className="inline-flex h-10 w-full cursor-pointer appearance-none items-center justify-center gap-2 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Submit for review
              </button>
              <p className="m-0 mt-1.5 text-center text-[11.5px] text-neutral-500">{canSubmit ? "Changes save automatically." : "Finish the steps above to submit."}</p>
            </div>

            {readiness.done < readiness.total ? (
              <div className="border-0 border-t border-solid border-neutral-100 px-5 py-3.5">
                <p className="m-0 flex items-center gap-1 text-[12.5px] font-medium text-neutral-600">
                  Before publishing
                  <InfoTip label="About publishing">
                    Your public page also needs at least one package or price and some photos. Add them under My packages.
                  </InfoTip>
                </p>
                <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                  {readiness.steps.filter((step) => !step.done).slice(0, 5).map((step) => (
                    <li key={step.label} className="flex items-center gap-2 text-[12.5px] text-neutral-700">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                      {step.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>

        {validationErrors.length > 0 ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-black">Please fix these package details before saving:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 font-semibold">
              {validationErrors.map((msg, idx) => (
                <li key={`${msg}-${idx}`}>{msg}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
        {success ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{success}</div> : null}

        <div className={isPackagesView ? "hidden" : "mt-5 space-y-5"}>
          <Section id="profile-contact" step={flowById["profile-contact"]?.step} total={sectionFlow.length} done={flowById["profile-contact"]?.done} todo={flowById["profile-contact"]?.todo} icon={<Users className="h-5 w-5" />} title="Contact person" text="The person NoLSAF calls about this partnership." info="Only NoLSAF sees these details. We use them to verify your company, reach you about bookings and cases, and send your payouts notices. Travellers never see them.">
            <FieldGrid className="xl:grid-cols-4">
              <Field label="Full name *">
                <Input value={profile.contactPersonName ?? ""} onChange={(e) => update("contactPersonName", e.target.value)} placeholder="John Doe" />
              </Field>
              <Field label="Email *">
                <Input value={profile.contactPersonEmail ?? ""} onChange={(e) => update("contactPersonEmail", e.target.value)} placeholder="john@example.com" type="email" />
              </Field>
              <Field label="Phone *" info="Your direct number. NoLSAF calls this for urgent booking or safety matters. Travellers never see it.">
                <Input value={profile.contactPersonPhone ?? ""} onChange={(e) => update("contactPersonPhone", e.target.value)} placeholder="+255..." />
              </Field>
              <Field label="Nationality *" info="Used only for identity verification of the contact person.">
                <Select value={profile.contactPersonNationality ?? ""} onChange={(e) => update("contactPersonNationality", e.target.value)}>
                  <option value="">Select nationality...</option>
                  <option value="Tanzanian">Tanzanian</option>
                  <option value="Kenyan">Kenyan</option>
                  <option value="Ugandan">Ugandan</option>
                  <option value="Other">Other</option>
                </Select>
              </Field>
            </FieldGrid>
          </Section>

          <Section id="profile-company" step={flowById["profile-company"]?.step} total={sectionFlow.length} done={flowById["profile-company"]?.done} todo={flowById["profile-company"]?.todo} icon={<Building2 className="h-5 w-5" />} title="Your company" info="This is your public face. The company name, story, languages, team size and years in business appear on your operator page and help travellers choose you." text="Business details customers see before selecting an operator.">
            <div className="grid w-full grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Company name *" info="The name travellers see. Use the trading name on your licence so NoLSAF can match your documents.">
                <Input value={profile.companyName} onChange={(e) => update("companyName", e.target.value)} placeholder="India Camel" />
              </Field>
              <Field label="Company email" info="Optional. Used for booking notices if you prefer them to go to a shared inbox.">
                <Input value={profile.companyEmail ?? ""} onChange={(e) => update("companyEmail", e.target.value)} placeholder="company@example.com" type="email" />
              </Field>
              <Field label="Company phone *" info="Your business line. Shown to travellers only after they book.">
                <Input value={profile.companyPhone ?? ""} onChange={(e) => update("companyPhone", e.target.value)} placeholder="+255..." />
              </Field>
              <Field label="Company website" info="Optional. Shown on your public page as a link.">
                <Input value={profile.companyWebsite ?? ""} onChange={(e) => update("companyWebsite", e.target.value)} placeholder="https://example.com" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Business address *" info="Your registered office address. NoLSAF checks it against your business registration.">
                <Input value={profile.businessAddress} onChange={(e) => update("businessAddress", e.target.value)} placeholder="Registered business address" />
              </Field>
              </div>
              <Field label="Years in operation" info="Shown on your public page as experience, for example &quot;7+ years operating&quot;.">
                <Input
                  type="number"
                  min="0"
                  value={profile.yearsInOperation ?? ""}
                  onChange={(e) => update("yearsInOperation", e.target.value === "" ? undefined : Number(e.target.value))}
                  placeholder="e.g. 5"
                />
              </Field>
              <Field label="Team size *" info="How many people work on your tours, including guides and drivers. Shown on your public page.">
                <Input
                  type="number"
                  min="0"
                  value={profile.teamSize ?? ""}
                  onChange={(e) => update("teamSize", e.target.value === "" ? undefined : Number(e.target.value))}
                  placeholder="e.g. 20"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Languages your team speaks *" info="Travellers filter by language. List only languages a guide on your team can lead a tour in.">
                <Input value={profile.languages ?? ""} onChange={(e) => update("languages", e.target.value)} placeholder="English, Swahili" />
              </Field>
              </div>
            </div>
            <div className="mt-4">
              <Field label="Describe your company and your team *" info="Shown on your public page. Say what makes your team good: experience, guides, safety, the trips you know best. Plain words work better than slogans.">
                <Textarea value={profile.description} onChange={(e) => update("description", e.target.value)} placeholder="Briefly explain your operator style, experience, and service promise." />
              </Field>
            </div>
          </Section>

          <Section id="profile-compliance" step={flowById["profile-compliance"]?.step} total={sectionFlow.length} done={flowById["profile-compliance"]?.done} todo={flowById["profile-compliance"]?.todo} icon={<ShieldCheck className="h-5 w-5" />} title="Compliance and records" info="NoLSAF checks these numbers against your uploaded documents before approval. They are never shown to travellers; your page only shows that NoLSAF verified them." text="Review and complete legal and permit details imported from the partnership application.">
            <FieldGrid>
              <Field label="Business registration number" info="Your BRELA registration. Checked against the certificate you upload; never shown to travellers.">
                <Input value={profile.businessRegistrationNumber ?? ""} onChange={(e) => update("businessRegistrationNumber", e.target.value)} placeholder="Registration number" />
              </Field>
              <Field label="TIN number" info="Your tax identification number. Needed for payouts and checked against your TIN certificate.">
                <Input value={profile.tinNumber ?? ""} onChange={(e) => update("tinNumber", e.target.value)} placeholder="TIN" />
              </Field>
              <Field label="Business licence number" info="From your business licence. Checked by NoLSAF during review.">
                <Input value={profile.businessLicenseNumber ?? ""} onChange={(e) => update("businessLicenseNumber", e.target.value)} placeholder="Business license" />
              </Field>
              <Field label="Tourism permit number" info="Your TALA or tourism permit. Required to sell tours on NoLSAF; checked against the permit you upload.">
                <Input value={profile.tourismPermitNumber ?? ""} onChange={(e) => update("tourismPermitNumber", e.target.value)} placeholder="Tourism permit" />
              </Field>
              <Field label="Vehicle permit number" info="Needed if you carry travellers in your own vehicles.">
                <Input value={profile.vehiclePermitNumber ?? ""} onChange={(e) => update("vehiclePermitNumber", e.target.value)} placeholder="Vehicle permit" />
              </Field>
              <Field label="Years in operation" info="Shown on your public page as experience, for example &quot;7+ years operating&quot;.">
                <Input
                  type="number"
                  min="0"
                  value={profile.yearsInOperation ?? ""}
                  onChange={(e) => update("yearsInOperation", e.target.value === "" ? undefined : Number(e.target.value))}
                  placeholder="e.g. 5"
                />
              </Field>
              <Field label="Team size *" info="How many people work on your tours, including guides and drivers. Shown on your public page.">
                <Input
                  type="number"
                  min="0"
                  value={profile.teamSize ?? ""}
                  onChange={(e) => update("teamSize", e.target.value === "" ? undefined : Number(e.target.value))}
                  placeholder="e.g. 20"
                />
              </Field>
            </FieldGrid>
          </Section>

          <Section id="profile-tourism" step={flowById["profile-tourism"]?.step} total={sectionFlow.length} done={flowById["profile-tourism"]?.done} todo={flowById["profile-tourism"]?.todo} icon={<Globe className="h-5 w-5" />} title="Tourism you serve" info="Travellers filter operators by these. Pick only what your team truly delivers: each tourism type needs at least one matching service." text="Three quick steps: the trips you run, what you deliver in each, and what you are best at.">
            {/* Tick to select, three steps. Nothing looks chosen until it is. */}
            <SubSection
              title="1. Tourism types"
              info="The kinds of trips you run. Travellers browse operators by these."
              text="Tick every kind of trip your company runs."
              required
              count={profile.tourismTypes.length}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Tourism types">
                {tourismTypes.map((type) => {
                  const on = profile.tourismTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleTourismType(type)}
                      className={`flex w-full min-w-0 cursor-pointer appearance-none items-center gap-2 rounded-md border border-solid px-3 py-2 text-left text-[13px] transition ${
                        on ? "border-emerald-700 bg-emerald-700 font-semibold text-white" : "border-neutral-300 bg-white text-neutral-700 hover:border-emerald-600/60"
                      }`}
                    >
                      <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-solid ${on ? "border-white bg-white text-emerald-700" : "border-neutral-300 bg-white"}`}>
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 truncate" title={type}>{type}</span>
                    </button>
                  );
                })}
              </div>
            </SubSection>

            <SubSection
              title="2. Your services"
              info="What you deliver inside each tourism type. Every type you tick needs at least one service."
              text="Tick at least one service for each tourism type you chose."
              required
              count={profile.services.length}
            >
              <div className="space-y-3">
                {[
                  { key: "Common Services", label: "Common services", options: COMMON_SERVICES as readonly string[], required: false },
                  ...profile.tourismTypes.map((type) => ({
                    key: type,
                    label: type,
                    options: (TOURISM_TYPE_SERVICES[type as keyof typeof TOURISM_TYPE_SERVICES] ?? []) as readonly string[],
                    required: true,
                  })),
                ].map((group) => {
                  const picked = (profile.serviceClassification ?? {})[group.key] ?? [];
                  const missing = group.required && picked.length === 0;
                  return (
                    <fieldset
                      key={group.key}
                      className={`m-0 min-w-0 rounded-md border border-solid p-3.5 ${missing ? "border-amber-300 bg-amber-50/40" : "border-neutral-200 bg-white"}`}
                    >
                      <legend className="sr-only">{group.label}</legend>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold text-neutral-900">{group.label}</span>
                        <span className={`text-[12px] ${missing ? "font-semibold text-amber-700" : "text-neutral-500"}`}>
                          {missing ? "Tick at least one" : picked.length ? `${picked.length} ticked` : "Optional"}
                        </span>
                      </div>
                      {group.options.length ? (
                        <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {group.options.map((service) => {
                            const on = picked.includes(service);
                            return (
                              <button
                                key={service}
                                type="button"
                                role="checkbox"
                                aria-checked={on}
                                onClick={() => toggleClassifiedService(group.key, service)}
                                className={`flex w-full min-w-0 cursor-pointer appearance-none items-center gap-2 rounded-md border border-solid px-3 py-2 text-left text-[13px] transition ${
                                  on ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                                }`}
                              >
                                {on ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-solid border-neutral-300" />}
                                <span className="min-w-0 truncate" title={service}>{service}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="m-0 mt-1 text-[12px] text-neutral-500">No services listed for this type yet.</p>
                      )}
                    </fieldset>
                  );
                })}
                {profile.tourismTypes.length === 0 ? (
                  <p className="m-0 text-[12.5px] text-neutral-500">Tick a tourism type above to see its services here.</p>
                ) : null}
                {(() => {
                  // Services saved before categories existed: shown so they can be removed.
                  const classified = new Set(Object.values(profile.serviceClassification ?? {}).flat());
                  const unclassified = profile.services.filter((s) => !classified.has(s));
                  if (!unclassified.length) return null;
                  return (
                    <div className="rounded-md border border-solid border-neutral-200 p-3.5">
                      <p className="m-0 text-[13px] font-semibold text-neutral-800">Older services without a group</p>
                      <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Tick them again in a group above, or remove them here.</p>
                      <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {unclassified.map((svc) => (
                          <span key={svc} className="inline-flex items-center gap-1 rounded border border-solid border-neutral-200 bg-neutral-50 py-1 pl-2.5 pr-1 text-[13px] text-neutral-700">
                            {svc}
                            <button type="button" onClick={() => removeClassifiedService(svc)} aria-label={`Remove ${svc}`} className="grid h-5 w-5 cursor-pointer place-items-center rounded border-0 bg-transparent text-neutral-400 hover:bg-red-50 hover:text-red-600">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </SubSection>

            <SubSection
              title="3. Specializations"
              info="What your company is known for. Shown as highlights on your public page."
              text="Tick what your company does best."
              required
              count={profile.specializations.length}
            >
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Specializations">
                {AGENT_SPECIALIZATIONS.map((spec) => {
                  const on = profile.specializations.includes(spec);
                  return (
                    <button
                      key={spec}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleSpecialization(spec)}
                      className={`flex w-full min-w-0 cursor-pointer appearance-none items-center gap-2 rounded-md border border-solid px-3 py-2 text-left text-[13px] transition ${
                        on ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                      }`}
                    >
                      {on ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-solid border-neutral-300" />}
                      <span className="min-w-0 truncate" title={spec}>{spec}</span>
                    </button>
                  );
                })}
              </div>
            </SubSection>
          </Section>

          <Section id="profile-area" step={flowById["profile-area"]?.step} total={sectionFlow.length} done={flowById["profile-area"]?.done} todo={flowById["profile-area"]?.todo} icon={<MapPin className="h-5 w-5" />} title="Area of operation" info="Your base, the regions you cover and the parks you hold permits for. NoLSAF only offers your tours where you are allowed to operate." text="Where you run tours: the regions and districts you cover, and the parks you hold permits for.">
            {(() => {
              // Coverage is stored as "REGION / District" or "Region" strings.
              // Read them back grouped by region, in normal casing.
              const nice = (value: string) =>
                value
                  .toLocaleLowerCase("en")
                  .split(/\s+/)
                  .map((w, i) => (i > 0 && ["es", "wa", "ya", "na", "la"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
                  .join(" ");
              const parse = (entry: string) => {
                const [r, d] = entry.split(/\s*\/\s*/);
                return { region: (r || "").trim(), district: (d || "").trim() };
              };
              const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
              const covered = profile.operatingRegions;
              const regionEntry = (r: string) => covered.find((e) => !parse(e).district && sameText(parse(e).region, r));
              const districtEntry = (r: string, d: string) =>
                covered.find((e) => sameText(parse(e).region, r) && sameText(parse(e).district, d));
              const toggleWholeRegion = (r: string) => {
                const existing = regionEntry(r);
                update("operatingRegions", existing ? covered.filter((e) => e !== existing) : [...covered, r]);
              };
              const toggleDistrict = (r: string, d: string) => {
                const existing = districtEntry(r, d);
                update("operatingRegions", existing ? covered.filter((e) => e !== existing) : [...covered, `${r} / ${d}`]);
              };
              const groups = covered.reduce<Record<string, string[]>>((acc, entry) => {
                const { region: r, district: d } = parse(entry);
                const key = nice(r);
                (acc[key] ||= []).push(d ? nice(d) : "Whole region");
                return acc;
              }, {});
              const tick = (on: boolean) =>
                on ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-solid border-neutral-300" />;
              const choice = (on: boolean) =>
                `flex w-full min-w-0 cursor-pointer appearance-none items-center gap-2 rounded-md border border-solid px-3 py-2 text-left text-[13px] transition ${
                  on ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                }`;

              return (
                <SubSection
                  title="1. Regions you cover"
                  info="Choose a region, then tick the districts you operate in, or the whole region. Travellers in these areas see your tours first."
                  text="Pick a region, then tick its districts."
                  required
                  count={covered.length}
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:items-end">
                    <Field label="Region">
                      <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                        <option value="">Choose a region</option>
                        {REGIONS.map((r) => <option key={r.id} value={r.name}>{nice(r.name)}</option>)}
                      </Select>
                    </Field>
                    <p className="m-0 pb-2.5 text-[12.5px] text-neutral-500">
                      {selectedRegion ? `Tick the districts in ${nice(selectedRegion.name)} you cover.` : "Its districts appear below."}
                    </p>
                  </div>

                  {selectedRegion ? (
                    <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={`Districts in ${nice(selectedRegion.name)}`}>
                      <button type="button" role="checkbox" aria-checked={Boolean(regionEntry(selectedRegion.name))} onClick={() => toggleWholeRegion(selectedRegion.name)} className={choice(Boolean(regionEntry(selectedRegion.name)))}>
                        {tick(Boolean(regionEntry(selectedRegion.name)))}
                        <span className="min-w-0 truncate">All of {nice(selectedRegion.name)}</span>
                      </button>
                      {selectedRegion.districts.map((d) => {
                        const on = Boolean(districtEntry(selectedRegion.name, d));
                        return (
                          <button key={d} type="button" role="checkbox" aria-checked={on} onClick={() => toggleDistrict(selectedRegion.name, d)} className={choice(on)}>
                            {tick(on)}
                            <span className="min-w-0 truncate" title={nice(d)}>{nice(d)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {covered.length ? (
                    <div className="mt-4 rounded-md border border-solid border-neutral-200">
                      <p className="m-0 border-0 border-b border-solid border-neutral-100 bg-neutral-50/60 px-3.5 py-2 text-[12.5px] font-semibold text-neutral-700">Your coverage</p>
                      <ul className="m-0 list-none p-0">
                        {Object.entries(groups).map(([r, districts], i) => (
                          <li key={r} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 ${i ? "border-0 border-t border-solid border-neutral-100" : ""}`}>
                            <span className="w-32 shrink-0 text-[13px] font-semibold text-neutral-900">{r}</span>
                            <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                              {districts.map((d) => {
                                const entry = d === "Whole region"
                                  ? covered.find((e) => !parse(e).district && sameText(nice(parse(e).region), r))
                                  : covered.find((e) => sameText(nice(parse(e).region), r) && sameText(nice(parse(e).district), d));
                                return (
                                  <span key={d} className="inline-flex items-center gap-1 rounded border border-solid border-emerald-200 bg-emerald-50 py-0.5 pl-2 pr-0.5 text-[12.5px] text-emerald-800">
                                    {d}
                                    <button
                                      type="button"
                                      aria-label={`Remove ${d}, ${r}`}
                                      onClick={() => entry && update("operatingRegions", covered.filter((e) => e !== entry))}
                                      className="grid h-5 w-5 cursor-pointer place-items-center rounded border-0 bg-transparent text-emerald-600 hover:bg-white hover:text-red-600"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </span>
                                );
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </SubSection>
              );
            })()}

            <div className="h-4" aria-hidden />

            {(() => {
              const parks = profile.registeredParks ?? [];
              const query = parkInput.trim().toLowerCase();
              const list = tourismSites.filter((s) => s.name && (!query || s.name.toLowerCase().includes(query)));
              const toggle = (name: string) =>
                update("registeredParks", parks.includes(name) ? parks.filter((p) => p !== name) : [...parks, name]);
              return (
                <SubSection
                  title="2. Permitted parks and tour sites"
                  info="Only parks you hold a valid permit for. NoLSAF will not sell tours into parks missing from this list."
                  text="Tick every park and site your company is permitted to operate in."
                  required
                  count={parks.length}
                >
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
                    <input
                      value={parkInput}
                      onChange={(e) => setParkInput(e.target.value)}
                      placeholder={tourismSitesLoading ? "Loading parks and sites..." : "Search parks and sites"}
                      aria-label="Search parks and sites"
                      className={`${fieldBase} !mt-0 h-10 pl-9 pr-3`}
                    />
                  </div>
                  {!tourismSitesLoading && tourismSites.length === 0 ? (
                    <p className="m-0 mt-3 text-[12.5px] text-amber-700">No parks or sites are listed on NoLSAF yet. Contact support so we can add yours.</p>
                  ) : (
                    <div className="mt-3 grid max-h-80 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Parks and sites">
                      {list.map((site) => {
                        const on = parks.includes(site.name);
                        return (
                          <button
                            key={site.id}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            onClick={() => toggle(site.name)}
                            className={`flex w-full min-w-0 cursor-pointer appearance-none items-center gap-2 rounded-md border border-solid px-3 py-2 text-left text-[13px] transition ${
                              on ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                            }`}
                          >
                            {on ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-solid border-neutral-300" />}
                            <span className="min-w-0 truncate" title={site.name}>{site.name}</span>
                          </button>
                        );
                      })}
                      {query && list.length === 0 ? (
                        <p className="m-0 text-[12.5px] text-neutral-500">No park or site matches “{parkInput.trim()}”.</p>
                      ) : null}
                    </div>
                  )}
                  {/* Saved parks no longer in NoLSAF's list stay visible so they can be removed. */}
                  {parks.filter((p) => !tourismSites.some((s) => s.name === p)).length && tourismSites.length ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-neutral-500">
                      Not in the list any more:
                      {parks.filter((p) => !tourismSites.some((s) => s.name === p)).map((p) => (
                        <span key={p} className="inline-flex items-center gap-1 rounded border border-solid border-neutral-200 bg-neutral-50 py-0.5 pl-2 pr-0.5 text-neutral-700">
                          {p}
                          <button type="button" aria-label={`Remove ${p}`} onClick={() => toggle(p)} className="grid h-5 w-5 cursor-pointer place-items-center rounded border-0 bg-transparent text-neutral-400 hover:text-red-600">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </SubSection>
              );
            })()}
          </Section>

          <Section id="profile-tools" step={flowById["profile-tools"]?.step} total={sectionFlow.length} done={flowById["profile-tools"]?.done} todo={flowById["profile-tools"]?.todo} icon={<Wrench className="h-5 w-5" />} title="Tools and fleet" text="What your team uses to deliver tours: vehicles, equipment and gear." info="Your fleet and tools show travellers what to expect on the day, and help NoLSAF match you to group sizes and trip types.">
            {(() => {
              // Saved tools that are no longer in the standard list still show, ticked, so nothing is lost.
              const options = Array.from(new Set([...toolOptions, ...profile.tools]));
              const toggleTool = (tool: string) =>
                update("tools", profile.tools.includes(tool) ? profile.tools.filter((x) => x !== tool) : [...profile.tools, tool]);
              return (
                <SubSection
                  title="1. Tools and equipment"
                  info="Equipment and support you bring on tours, such as guides, camping gear, first aid or radios. Shown on your public page."
                  text="Tick everything your team brings to a tour."
                  required
                  count={profile.tools.length}
                >
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Tools and equipment">
                    {options.map((tool) => {
                      const on = profile.tools.includes(tool);
                      return (
                        <button
                          key={tool}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => toggleTool(tool)}
                          className={`flex w-full min-w-0 cursor-pointer appearance-none items-center gap-2 rounded-md border border-solid px-3 py-2 text-left text-[13px] transition ${
                            on ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                          }`}
                        >
                          {on ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-solid border-neutral-300" />}
                          <span className="min-w-0 truncate" title={tool}>{tool}</span>
                        </button>
                      );
                    })}
                  </div>
                </SubSection>
              );
            })()}

            <div className="h-4" aria-hidden />

            <SubSection
              title="2. Fleet and vehicles"
              info="Vehicles you own, share or rent for tours. Travellers see the vehicle types and seats; registration numbers stay private to NoLSAF."
              text="Tell us whether your company runs vehicles, then add each type."
              required
              count={profile.vehicles.length}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[13px] font-medium text-neutral-800">Does your company have vehicles for tours?</span>
                <div className="inline-flex overflow-hidden rounded-md border border-solid border-neutral-300" role="radiogroup" aria-label="Has vehicles">
                  {[
                    { value: true, label: "Yes" },
                    { value: false, label: "No" },
                  ].map((opt, i) => {
                    const on = Boolean(profile.hasVehicles) === opt.value;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          update("hasVehicles", opt.value);
                          if (!opt.value) update("vehicles", []);
                        }}
                        className={`cursor-pointer appearance-none border-0 px-5 py-2 text-[13px] font-semibold transition ${i ? "border-l border-solid border-neutral-300" : ""} ${
                          on ? "bg-emerald-700 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {profile.hasVehicles ? (() => {
                const units = profile.vehicles.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0);
                const seats = profile.vehicles.reduce((sum, v) => sum + (Number(v.quantity) || 0) * (Number(v.seatsPerVehicle) || 0), 0);
                const largest = profile.vehicles.reduce((max, v) => Math.max(max, Number(v.seatsPerVehicle) || 0), 0);
                const formOpen = vehicleFormOpen || profile.vehicles.length === 0;
                const qty = Number(vehicleInput.quantity) || 0;
                const perSeat = Number(vehicleInput.seatsPerVehicle) || 0;
                const ready = Boolean(vehicleInput.type && qty > 0 && perSeat > 0);
                return (
                  <>
                    {profile.vehicles.length > 0 ? (
                      <>
                        {/* Fleet at a glance: what NoLSAF can match a group to. */}
                        <dl className="m-0 mt-4 grid grid-cols-3 overflow-hidden rounded-md border border-solid border-neutral-200">
                          {[
                            { label: "Vehicles", value: units },
                            { label: "Traveller seats", value: seats },
                            { label: "Largest vehicle", value: largest ? `${largest} seats` : "None" },
                          ].map((stat, i) => (
                            <div key={stat.label} className={`min-w-0 bg-neutral-50/60 px-4 py-3 ${i ? "border-0 border-l border-solid border-neutral-200" : ""}`}>
                              <dt className="text-[12px] text-neutral-500">{stat.label}</dt>
                              <dd className="m-0 mt-0.5 text-[18px] font-bold leading-tight tabular-nums text-neutral-900">{stat.value}</dd>
                            </div>
                          ))}
                        </dl>

                        <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2">
                          {profile.vehicles.map((v) => {
                            const vq = Number(v.quantity) || 0;
                            const vs = Number(v.seatsPerVehicle) || 0;
                            const tags = [v.ownedBy, v.serviceMode].filter(Boolean);
                            return (
                              <li key={v.id} className="flex items-start gap-3 rounded-md border border-solid border-neutral-200 bg-white p-3.5">
                                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-700 text-white">
                                  <Car className="h-5 w-5" aria-hidden />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="m-0 truncate text-[14px] font-semibold text-neutral-900">{v.type}</p>
                                  <p className="m-0 mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12.5px] text-neutral-600">
                                    <span><strong className="text-neutral-900 tabular-nums">{vq}</strong> vehicle{vq === 1 ? "" : "s"}</span>
                                    <span><strong className="text-neutral-900 tabular-nums">{vs}</strong> seats each</span>
                                    <span className="text-emerald-800"><strong className="tabular-nums">{vq * vs}</strong> seats in total</span>
                                  </p>
                                  {tags.length || v.registrationNumber ? (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {tags.map((tag) => (
                                        <span key={tag} className="rounded border border-solid border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[11.5px] text-neutral-600">{tag}</span>
                                      ))}
                                      {v.registrationNumber ? (
                                        <span className="rounded border border-solid border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[11.5px] text-neutral-600" title="Private to NoLSAF">
                                          {v.registrationNumber}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {v.notes ? <p className="m-0 mt-1.5 text-[12px] italic text-neutral-500">{v.notes}</p> : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => update("vehicles", profile.vehicles.filter((x) => x.id !== v.id))}
                                  className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                                  aria-label={`Remove ${v.type}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    ) : null}

                    {formOpen ? (
                      <div className="mt-4 overflow-hidden rounded-md border border-solid border-neutral-200">
                        <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 bg-neutral-50/60 px-4 py-2.5">
                          <p className="m-0 text-[13.5px] font-semibold text-neutral-900">{profile.vehicles.length ? "Add a vehicle type" : "Add your first vehicle type"}</p>
                          {profile.vehicles.length ? (
                            <button type="button" onClick={() => setVehicleFormOpen(false)} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-neutral-500 hover:text-neutral-800">
                              Cancel
                            </button>
                          ) : null}
                        </div>
                        <div className="p-4">
                          <p className="m-0 mb-2 text-[12px] font-semibold text-neutral-500">The vehicle</p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                            <Field label="Vehicle type *">
                              <Select value={vehicleInput.type} onChange={(e) => setVehicleInput({ ...vehicleInput, type: e.target.value })}>
                                <option value="">Choose a type</option>
                                {vehicleTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                              </Select>
                            </Field>
                            <Field label="How many *">
                              <Input type="number" min="1" value={vehicleInput.quantity} onChange={(e) => setVehicleInput({ ...vehicleInput, quantity: e.target.value })} placeholder="e.g. 3" />
                            </Field>
                            <Field label="Seats each *" info="Traveller seats only, not counting the driver. NoLSAF uses this to match group sizes.">
                              <Input type="number" min="1" value={vehicleInput.seatsPerVehicle} onChange={(e) => setVehicleInput({ ...vehicleInput, seatsPerVehicle: e.target.value })} placeholder="e.g. 7" />
                            </Field>
                          </div>

                          <p className="m-0 mb-2 mt-4 text-[12px] font-semibold text-neutral-500">How you run it <span className="font-normal">(optional)</span></p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <Field label="Ownership">
                              <Select value={vehicleInput.ownedBy} onChange={(e) => setVehicleInput({ ...vehicleInput, ownedBy: e.target.value })}>
                                <option value="">Choose</option>
                                <option value="Company owned">Company owned</option>
                                <option value="Partner owned">Partner owned</option>
                                <option value="Rented on demand">Rented on demand</option>
                              </Select>
                            </Field>
                            <Field label="Service mode">
                              <Select value={vehicleInput.serviceMode} onChange={(e) => setVehicleInput({ ...vehicleInput, serviceMode: e.target.value })}>
                                <option value="">Choose</option>
                                {VEHICLE_SERVICE_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                              </Select>
                            </Field>
                            <Field label="Registration number" info="Private to NoLSAF. Used to verify the vehicle, never shown to travellers.">
                              <Input value={vehicleInput.registrationNumber} onChange={(e) => setVehicleInput({ ...vehicleInput, registrationNumber: e.target.value })} placeholder="e.g. T123 ABC" />
                            </Field>
                          </div>
                          <div className="mt-3">
                            <Field label="Condition or notes">
                              <Input value={vehicleInput.notes} onChange={(e) => setVehicleInput({ ...vehicleInput, notes: e.target.value })} placeholder="e.g. 2022 model, pop-up roof, fridge" />
                            </Field>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-3">
                          <p className="m-0 text-[12.5px] text-neutral-600">
                            {ready ? (
                              <>Adds <strong className="text-neutral-900">{qty} × {vehicleInput.type}</strong>, <strong className="text-emerald-800">{qty * perSeat} seats</strong> in total.</>
                            ) : (
                              "Choose a type, how many and seats each to add it."
                            )}
                          </p>
                          <button
                            type="button"
                            onClick={addVehicle}
                            disabled={!ready}
                            className="inline-flex h-10 cursor-pointer appearance-none items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                          >
                            <Plus className="h-4 w-4" />
                            Add vehicle
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setVehicleFormOpen(true)}
                        className="mt-3 flex h-11 w-full cursor-pointer appearance-none items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 bg-white text-[13px] font-semibold text-neutral-700 transition hover:border-emerald-500 hover:bg-emerald-50/40 hover:text-emerald-800"
                      >
                        <Plus className="h-4 w-4" />
                        Add another vehicle type
                      </button>
                    )}
                  </>
                );
              })() : (
                <p className="m-0 mt-3 text-[12.5px] text-neutral-500">No vehicles. That is fine if you use partner transport; your tools above still count.</p>
              )}
            </SubSection>
          </Section>

          <Section id="profile-capacity" step={flowById["profile-capacity"]?.step} total={sectionFlow.length} done={flowById["profile-capacity"]?.done} todo={flowById["profile-capacity"]?.todo} icon={<Users className="h-5 w-5" />} title="Operating capacity" text="How much you can take on, so travellers only book what you can deliver." info="NoLSAF uses notice periods, daily trip limits and blocked dates to stop bookings you cannot serve. Travellers see the booking notice you set.">
            <FieldGrid>
              <Field label="Max trips per day" info="NoLSAF stops accepting bookings for a day once you reach this number.">
                <Input type="number" min="0" value={profile.maxTripsPerDay} onChange={(e) => update("maxTripsPerDay", e.target.value)} placeholder="e.g. 3" />
              </Field>
              <Field label="Guides available">
                <Input type="number" min="0" value={profile.guidesAvailable} onChange={(e) => update("guidesAvailable", e.target.value)} placeholder="e.g. 5" />
              </Field>
              <Field label="Minimum booking notice">
                <Input value={profile.minimumBookingNotice} onChange={(e) => update("minimumBookingNotice", e.target.value)} placeholder="e.g. 48 hours" />
              </Field>
              <Field label="Peak season availability">
                <Select value={profile.peakSeasonAvailability} onChange={(e) => update("peakSeasonAvailability", e.target.value)}>
                  <option value="">Select availability</option>
                  {peakSeasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </Select>
              </Field>
            </FieldGrid>
            <FieldGrid className="mt-3">
              <Field label="Blocked periods">
                <Textarea value={profile.blockedPeriods} onChange={(e) => update("blockedPeriods", e.target.value)} placeholder="Periods when bookings should not be accepted." />
              </Field>
              <Field label="Capacity notes">
                <Textarea value={profile.capacityNotes} onChange={(e) => update("capacityNotes", e.target.value)} placeholder="Large group capacity, field team notes, or operational conditions." />
              </Field>
            </FieldGrid>
          </Section>
        </div>

        {isPackagesView ? (
          <div id="my-packages" className="box-border mt-5 w-full min-w-0 max-w-full scroll-mt-4 space-y-4 overflow-x-hidden px-4 sm:px-6">
            {/* Packages header: what you sell, at a glance. */}
            {(() => {
              const items = profile.packageItems;
              const ready = items.filter((p) => packageLooksComplete(p)).length;
              const prices = items.map((p) => ({ v: Number(p.pricePerPerson) || 0, c: p.currency || "USD" })).filter((p) => p.v > 0);
              const from = prices.length ? prices.reduce((min, p) => (p.v < min.v ? p : min)) : null;
              return (
                <div className="min-w-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6">
                    <div className="min-w-0">
                      <p className="m-0 flex items-center gap-1 text-[12.5px] font-medium text-emerald-700">
                        Your tours on NoLSAF
                        <InfoTip label="About packages">
                          Each package is one bookable trip. Travellers compare them on price, length and the day-by-day plan, then book and pay through NoLSAF. A package goes live once it is complete and your profile is approved.
                        </InfoTip>
                      </p>
                      <h1 className="m-0 mt-0.5 text-[24px] font-bold tracking-tight text-neutral-900">My packages</h1>
                      <p className="m-0 mt-1 text-[13px] text-neutral-500">Build each trip in four steps: basics, pricing, what is included, and the day-by-day plan.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href="/account/agent/profile?view=status"
                        className="inline-flex h-10 items-center rounded-md border border-solid border-neutral-300 bg-white px-3.5 text-[13px] font-semibold text-neutral-700 no-underline transition hover:border-emerald-300 hover:text-emerald-800 hover:no-underline"
                      >
                        Profile steps
                      </Link>
                      <button
                        type="button"
                        onClick={addPackage}
                        className="inline-flex h-10 cursor-pointer appearance-none items-center justify-center gap-2 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white transition hover:bg-emerald-800"
                      >
                        <PackagePlus className="h-4 w-4" aria-hidden />
                        New package
                      </button>
                    </div>
                  </div>
                  <dl className="m-0 grid grid-cols-2 border-0 border-t border-solid border-neutral-200 sm:grid-cols-4">
                    {[
                      { label: "Packages", value: String(items.length), note: items.length ? "Bookable trips" : "None yet" },
                      { label: "Ready to sell", value: `${ready}/${items.length || 0}`, note: ready === items.length && items.length ? "All complete" : "Finish the rest" },
                      { label: "From", value: from ? `${from.c} ${from.v.toLocaleString("en-US")}` : "None", note: "Lowest price per person" },
                      { label: "Seasonal rates", value: String(profile.seasonalPrices.length), note: "High and low season" },
                    ].map((stat, i) => (
                      <div
                        key={stat.label}
                        className={`min-w-0 px-5 py-3.5 ${i % 2 ? "border-0 border-l border-solid border-neutral-200" : ""} ${i >= 2 ? "border-0 border-t border-solid border-neutral-200 sm:border-t-0" : ""} ${i === 2 ? "sm:border-l sm:border-solid sm:border-neutral-200" : ""}`}
                      >
                        <dt className="text-[12px] text-neutral-500">{stat.label}</dt>
                        <dd className="m-0 mt-0.5 truncate text-[18px] font-bold tabular-nums text-neutral-900">{stat.value}</dd>
                        <dd className="m-0 text-[11.5px] text-neutral-400">{stat.note}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })()}
          <section className="space-y-4">
              <div className="overflow-hidden rounded-md border border-solid border-neutral-200 bg-white">
                {profile.packageItems.length === 0 && (
                  <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50/50 px-5 py-8 text-center">
                    <span className="mx-auto grid h-11 w-11 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                      <PackagePlus className="h-5 w-5" aria-hidden />
                    </span>
                    <p className="m-0 mt-3 text-sm font-bold text-neutral-900">No package added yet</p>
                    <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-neutral-500">Create your strongest bookable trip first, then add pricing, inclusions, and an itinerary.</p>
                    <button type="button" onClick={addPackage} className="mt-4 inline-flex h-10 cursor-pointer appearance-none items-center justify-center gap-2 rounded-md border-0 bg-emerald-700 px-3.5 text-xs font-bold text-white outline-none transition hover:bg-emerald-800">
                      <PackagePlus className="h-4 w-4" aria-hidden />
                      Create first package
                    </button>
                  </div>
                )}
              {profile.packageItems.length > 1 && !anyPackageExpanded ? (
                <div className="flex flex-wrap items-center gap-1.5 border-0 border-b border-solid border-neutral-200 bg-neutral-50/60 px-4 py-2.5 text-[12px] text-neutral-500 sm:px-5">
                  <span className="mr-1">Sort by</span>
                  {[
                    { key: "number", label: "Order" },
                    { key: "package", label: "Name" },
                    { key: "price", label: "Price" },
                    { key: "duration", label: "Length" },
                    { key: "status", label: "Progress" },
                  ].map((opt) => {
                    const on = packageSort.key === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => togglePackageSort(opt.key)}
                        className={`inline-flex cursor-pointer appearance-none items-center gap-1 rounded border border-solid px-2 py-1 font-medium transition ${on ? "border-emerald-600 bg-white text-emerald-800" : "border-transparent bg-transparent text-neutral-600 hover:bg-white"}`}
                      >
                        {opt.label}
                        {on ? <ArrowUpDown className="h-3 w-3" aria-hidden /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {sortedPackageItems.map((pkg, index) => {
                const includedSuggestions = packageIncludedSuggestions(pkg, profile.tourismTypes);
                const excludedSuggestions = packageExcludedSuggestions(includedSuggestions);
                const isExpanded = expandedPackageIds[pkg.id] ?? false;
                const isComplete = packageLooksComplete(pkg);
                const step = packageStep[pkg.id] ?? 1;
                const setStep = (s: number) => setPackageStep((m) => ({ ...m, [pkg.id]: Math.max(1, Math.min(4, s)) }));
                const packageChecklist = [
                  { n: 1, label: "Basics", done: Boolean(pkg.name && pkg.destination && pkg.description) },
                  { n: 2, label: "Pricing", done: Boolean(pkg.category && pkg.duration && pkg.mode && pkg.minPax && pkg.maxPax && pkg.pricePerPerson && pkg.currency) },
                  { n: 3, label: "Inclusions", done: (pkg.included || []).length > 0 },
                  { n: 4, label: "Itinerary", done: (pkg.itinerary || []).length > 0 },
                ];
                const completedPackageSteps = packageChecklist.filter((item) => item.done).length;
                const packageCompletion = Math.round((completedPackageSteps / packageChecklist.length) * 100);
                const nextPackageStep = packageChecklist.find((item) => !item.done);
                if (anyPackageExpanded && !isExpanded) return null;
                const normalizedDiscountCondition = String(pkg.discountCondition || "").trim();
                const normalizedDiscountUnit = String(pkg.discountUnit || "").trim();
                const isNumericCondition = /^\d+$/.test(normalizedDiscountCondition);
                const discountConditionText = (() => {
                  if (!normalizedDiscountCondition) return "";
                  if (!isNumericCondition) return normalizedDiscountCondition;

                  if (normalizedDiscountUnit === "Travelers") return `${normalizedDiscountCondition}+ travellers book together`;
                  if (normalizedDiscountUnit === "Days before travel") return `${normalizedDiscountCondition}+ days before travel`;
                  if (normalizedDiscountUnit === "Completed previous bookings") return `${normalizedDiscountCondition}+ completed previous bookings`;
                  if (normalizedDiscountUnit === "Bookings") return `${normalizedDiscountCondition}+ bookings`;
                  if (normalizedDiscountUnit === "Nights") return `${normalizedDiscountCondition}+ nights`;

                  if (pkg.discountFactor === "Large group size") return `${normalizedDiscountCondition}+ travellers book together`;
                  if (pkg.discountFactor === "Early booking") return `${normalizedDiscountCondition}+ days before travel`;
                  if (pkg.discountFactor === "Returning customer") return `${normalizedDiscountCondition}+ completed previous bookings`;

                  return normalizedDiscountCondition;
                })();

                return (
                <div key={pkg.id} className="min-w-0 border-0 border-b border-solid border-neutral-200 bg-white last:border-b-0">
                  {/* Package row: identity, the facts travellers compare, setup progress, actions. */}
                  <div className={`grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,11rem)_auto] lg:items-center ${isExpanded ? "bg-emerald-50/40" : ""}`}>
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md text-[13px] font-bold ${isComplete ? "bg-emerald-700 text-white" : "bg-neutral-100 text-neutral-500"}`}>
                        {isComplete ? <Check className="h-4 w-4" strokeWidth={3} /> : index + 1}
                      </span>
                      <div className="min-w-0">
                        <h4 className="m-0 truncate text-[15px] font-semibold text-neutral-900">{pkg.name || "Untitled package"}</h4>
                        <p className="m-0 mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-neutral-500">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
                          {pkg.destination || "Destination not set"}
                        </p>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-neutral-700">
                      <span className="rounded border border-solid border-neutral-200 bg-neutral-50 px-1.5 py-0.5">{pkg.duration || "No duration"}</span>
                      <span className="rounded border border-solid border-neutral-200 bg-neutral-50 px-1.5 py-0.5">{pkg.minPax && pkg.maxPax ? `${pkg.minPax} to ${pkg.maxPax} guests` : "Group not set"}</span>
                      {pkg.mode ? <span className="rounded border border-solid border-neutral-200 bg-neutral-50 px-1.5 py-0.5">{pkg.mode}</span> : null}
                      <span className="ml-auto text-[14px] font-bold tabular-nums text-neutral-900 lg:ml-0">
                        {pkg.pricePerPerson ? `${pkg.currency} ${Number(pkg.pricePerPerson).toLocaleString("en-US")}` : "No price"}
                        {pkg.pricePerPerson ? <span className="ml-1 text-[11.5px] font-normal text-neutral-500">per person</span> : null}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex max-w-[9rem] gap-0.5" aria-label={`${completedPackageSteps} of 4 setup steps done`}>
                        {packageChecklist.map((item) => (
                          <span key={item.n} title={`${item.label}: ${item.done ? "done" : "to do"}`} className={`h-1 flex-1 rounded-full ${item.done ? "bg-emerald-600" : "bg-neutral-200"}`} />
                        ))}
                      </div>
                      <p className={`m-0 mt-1 text-[11.5px] ${isComplete ? "font-medium text-emerald-700" : "text-amber-700"}`}>
                        {isComplete ? "Ready to sell" : nextPackageStep ? `${completedPackageSteps} of 4 done · next ${nextPackageStep.label.toLowerCase()}` : `${packageCompletion}% set up`}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          if (!isExpanded && nextPackageStep) setStep(nextPackageStep.n);
                          setExpandedPackageIds((prev) => ({ ...prev, [pkg.id]: !isExpanded }));
                        }}
                        className={`inline-flex h-9 min-w-[5.5rem] cursor-pointer appearance-none items-center justify-center gap-1.5 rounded-md border border-solid px-3 text-[13px] font-semibold transition ${
                          isExpanded ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800" : "border-neutral-300 bg-white text-neutral-700 hover:border-emerald-300 hover:text-emerald-800"
                        }`}
                      >
                        {isExpanded ? <><Check className="h-4 w-4" />Done</> : isComplete ? "Edit" : "Continue"}
                      </button>
                      <button
                        type="button"
                        onClick={() => askRemovePackage(pkg)}
                        className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove ${pkg.name || "package"}`}
                        title="Remove package"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {isExpanded ? (
                  <div className="border-0 border-t border-solid border-neutral-200 p-4 sm:p-5">
                    {/* The four steps, joined: done, current, still to do. */}
                    <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
                      {packageStepDefs.map((s) => {
                        const doneStep = packageChecklist.find((c) => c.n === s.n)?.done;
                        const current = step === s.n;
                        return (
                          <li key={s.n}>
                            <button
                              type="button"
                              onClick={() => setStep(s.n)}
                              aria-current={current ? "step" : undefined}
                              className={`flex w-full cursor-pointer appearance-none items-center gap-2 rounded-md border border-solid px-3 py-2 text-left text-[13px] font-semibold transition ${
                                current ? "border-emerald-700 bg-emerald-700 text-white" : doneStep ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                              }`}
                            >
                              <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${current ? "bg-white/20 text-white" : doneStep ? "bg-emerald-700 text-white" : "border border-solid border-neutral-300 text-neutral-500"}`}>
                                {doneStep && !current ? <Check className="h-3 w-3" strokeWidth={3} /> : s.n}
                              </span>
                              <span className="min-w-0 truncate">{s.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                    <div className="mt-4 rounded-md border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                    {step === 1 && (
                    <div>
                      <h4 className="m-0 text-[16px] font-semibold text-neutral-900">The basics</h4>
                      <p className="m-0 mt-1 mb-4 text-[13px] leading-6 text-neutral-500">Name this package and where it goes, then add a short summary customers see first.</p>
                    <FieldGrid>
                    <Field label="Package name *" info="The title travellers see in search and on your page. Say the trip and its length, for example &quot;3-day Serengeti classic safari&quot;."><Input value={pkg.name} onChange={(e) => patchPackage(pkg.id, { name: e.target.value })} placeholder="Serengeti classic safari" /></Field>
                    <Field label="Destination *" info="The parks, towns or areas the trip visits. Travellers search by these names."><Input value={pkg.destination} onChange={(e) => patchPackage(pkg.id, { destination: e.target.value })} placeholder="Serengeti, Ngorongoro" /></Field>
                  </FieldGrid>
                  <div className="mt-3">
                    <Field label="Short description *" info="Two or three sentences shown first on the package. Say what makes this trip worth booking.">
                      <Textarea value={pkg.description} onChange={(e) => patchPackage(pkg.id, { description: e.target.value })} placeholder="A brief marketing overview of this package that customers will see first." />
                    </Field>
                  </div>
                    </div>
                    )}

                    {step === 2 && (() => {
                      const minP = Number(pkg.minPax) || 0;
                      const maxP = Number(pkg.maxPax) || 0;
                      const price = Number(pkg.pricePerPerson) || 0;
                      const cur = pkg.currency || "USD";
                      const money = (v: number) => `${cur} ${v.toLocaleString("en-US")}`;
                      const groupBad = minP > 0 && maxP > 0 && minP > maxP;
                      const discountOn = Boolean(pkg.discountFactor);
                      const panel = (icon: React.ReactNode, title: string, hint: string, body: React.ReactNode, aside?: React.ReactNode) => (
                        <section className="min-w-0 overflow-hidden rounded-md border border-solid border-neutral-200 bg-white">
                          <header className="flex items-start justify-between gap-3 border-0 border-b border-solid border-neutral-100 bg-neutral-50/60 px-4 py-3">
                            <div className="flex min-w-0 items-start gap-2.5">
                              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
                              <div className="min-w-0">
                                <p className="m-0 text-[14px] font-semibold text-neutral-900">{title}</p>
                                <p className="m-0 mt-0.5 text-[12px] leading-4 text-neutral-500">{hint}</p>
                              </div>
                            </div>
                            {aside}
                          </header>
                          <div className="p-4">{body}</div>
                        </section>
                      );
                      return (
                        <div className="space-y-4">
                          <div>
                            <h4 className="m-0 text-[16px] font-semibold text-neutral-900">Pricing and tour details</h4>
                            <p className="m-0 mt-1 text-[13px] leading-6 text-neutral-500">How the trip runs, who it is for, and what it costs.</p>
                          </div>

                          {panel(
                            <Globe />,
                            "How the trip runs",
                            "The type, length and pace travellers compare first.",
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field label="Tour category *" info="Where this package is listed. Pick the closest match; travellers filter by it.">
                                <Select value={pkg.category} onChange={(e) => patchPackage(pkg.id, { category: e.target.value })}>
                                  <option value="">Choose a category</option>
                                  <option>Safari</option>
                                  <option>Beach &amp; Island</option>
                                  <option>Cultural &amp; Heritage</option>
                                  <option>Mountain &amp; Hiking</option>
                                  <option>Adventure</option>
                                  <option>Birdwatching</option>
                                  <option>City Tour</option>
                                  <option>Fishing</option>
                                  <option>Photography</option>
                                  <option>Other</option>
                                </Select>
                              </Field>
                              <Field label="Duration *" info="How long the trip runs, for example &quot;3 days / 2 nights&quot; or &quot;6 hours&quot;. Shown on the package card.">
                                <Input value={pkg.duration} onChange={(e) => patchPackage(pkg.id, { duration: e.target.value })} placeholder="3 days / 2 nights" />
                              </Field>
                              <Field label="Difficulty" info="How demanding the trip is physically. Helps families and older travellers choose well.">
                                <Segmented value={pkg.difficulty} onChange={(v) => patchPackage(pkg.id, { difficulty: v })} options={[{ value: "Easy", label: "Easy" }, { value: "Moderate", label: "Moderate" }, { value: "Challenging", label: "Challenging" }, { value: "Extreme", label: "Extreme" }]} />
                              </Field>
                              <Field label="Booking mode *" info="Private: one group per booking. Shared: travellers can join others. Both: you offer either.">
                                <Segmented value={pkg.mode} onChange={(v) => patchPackage(pkg.id, { mode: v })} options={[{ value: "Private", label: "Private" }, { value: "Shared", label: "Shared" }, { value: "Private and shared", label: "Both" }]} />
                              </Field>
                            </div>,
                          )}

                          {panel(
                            <Users />,
                            "Group and price",
                            "Who can book and what each traveller pays.",
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
                              <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Smallest group *" info="The smallest group you will run this trip for. Bookings below it are not accepted.">
                                  <Input type="number" min="1" value={pkg.minPax} onChange={(e) => patchPackage(pkg.id, { minPax: e.target.value })} placeholder="1" />
                                </Field>
                                <Field label="Largest group *" info="The largest group one booking can hold. Make sure your vehicles have the seats.">
                                  <Input type="number" min="1" value={pkg.maxPax} onChange={(e) => patchPackage(pkg.id, { maxPax: e.target.value })} placeholder="12" />
                                </Field>
                                <Field label="Currency *" info="The currency you are paid in. Travellers can view an estimate in their own currency.">
                                  <Segmented value={pkg.currency} onChange={(v) => patchPackage(pkg.id, { currency: v })} options={[{ value: "USD", label: "USD" }, { value: "TZS", label: "TZS" }, { value: "EUR", label: "EUR" }]} />
                                </Field>
                                <Field label="Price per person *" info="What one traveller pays. NoLSAF shows it as the headline price and multiplies it by the group size at checkout.">
                                  <span className="relative block">
                                    <span className="pointer-events-none absolute left-3 top-[calc(50%+3px)] -translate-y-1/2 text-[13px] font-semibold text-neutral-400">{cur}</span>
                                    <Input type="number" min="0" value={pkg.pricePerPerson} onChange={(e) => patchPackage(pkg.id, { pricePerPerson: e.target.value })} placeholder="450" className="!pl-12" />
                                  </span>
                                </Field>
                                {groupBad ? (
                                  <p className="m-0 text-[12.5px] font-medium text-red-600 sm:col-span-2">The smallest group is larger than the largest group.</p>
                                ) : null}
                              </div>

                              {/* What travellers will see, worked out live. */}
                              <div className="rounded-md border border-solid border-emerald-200 bg-emerald-50/50 p-3.5">
                                <p className="m-0 text-[12px] font-medium text-emerald-800">Travellers will see</p>
                                <p className="m-0 mt-1 text-[22px] font-bold leading-tight tabular-nums text-neutral-900">
                                  {price ? money(price) : `${cur} 0`}
                                  <span className="ml-1 text-[12px] font-medium text-neutral-500">per person</span>
                                </p>
                                <dl className="m-0 mt-3 space-y-1.5 border-0 border-t border-solid border-emerald-200 pt-3 text-[12.5px]">
                                  <div className="flex justify-between gap-2">
                                    <dt className="text-neutral-600">Group size</dt>
                                    <dd className="m-0 font-semibold text-neutral-900">{minP && maxP ? `${minP} to ${maxP} guests` : "Not set"}</dd>
                                  </div>
                                  <div className="flex justify-between gap-2">
                                    <dt className="text-neutral-600">Smallest group pays</dt>
                                    <dd className="m-0 font-semibold tabular-nums text-neutral-900">{price && minP ? money(price * minP) : "None"}</dd>
                                  </div>
                                  <div className="flex justify-between gap-2">
                                    <dt className="text-neutral-600">Largest group pays</dt>
                                    <dd className="m-0 font-semibold tabular-nums text-neutral-900">{price && maxP ? money(price * maxP) : "None"}</dd>
                                  </div>
                                </dl>
                              </div>
                            </div>,
                          )}

                          {panel(
                            <Building2 />,
                            "Stay, meals and start",
                            "What is arranged for the nights, and where the trip begins.",
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                              <Field label="Accommodation" info="The standard of places travellers sleep in. Choose Not included if they book their own.">
                                <Select value={pkg.accommodation} onChange={(e) => patchPackage(pkg.id, { accommodation: e.target.value })}>
                                  <option value="">Choose accommodation</option>
                                  <option>Camping / Tented camp</option>
                                  <option>Budget hotel</option>
                                  <option>Mid-range hotel</option>
                                  <option>Luxury lodge</option>
                                  <option>Mixed (budget &amp; mid-range)</option>
                                  <option>Mixed (mid-range &amp; luxury)</option>
                                  <option>Not included</option>
                                </Select>
                              </Field>
                              <Field label="Meal plan" info="Which meals the price covers during the trip.">
                                <Select value={pkg.mealPlan} onChange={(e) => patchPackage(pkg.id, { mealPlan: e.target.value })}>
                                  <option value="">Choose a meal plan</option>
                                  <option>None (self-catered)</option>
                                  <option>Breakfast only</option>
                                  <option>Half board (B&amp;D)</option>
                                  <option>Full board (B, L &amp; D)</option>
                                  <option>All-inclusive</option>
                                </Select>
                              </Field>
                              <Field label="Meeting or departure point" info="Where the trip starts. The exact pickup is confirmed with the traveller after booking.">
                                <Input value={pkg.meetingPoint} onChange={(e) => patchPackage(pkg.id, { meetingPoint: e.target.value })} placeholder="Arusha town or hotel pickup" />
                              </Field>
                            </div>,
                          )}

                          {(() => {
                            // Reason decides what the rule counts; amount is checked against the price.
                            const REASONS: Array<{ value: string; label: string; unit: string; rule: string }> = [
                              { value: "Large group size", label: "Large group", unit: "Travelers", rule: "travellers in one booking" },
                              { value: "Early booking", label: "Early booking", unit: "Days before travel", rule: "days before travel" },
                              { value: "Returning customer", label: "Returning traveller", unit: "Completed previous bookings", rule: "past trips with you" },
                              { value: "Low season", label: "Low season", unit: "Nights", rule: "nights" },
                              { value: "Promotional campaign", label: "Promotion", unit: "Bookings", rule: "bookings" },
                              { value: "Custom", label: "Other", unit: "", rule: "" },
                            ];
                            const reason = REASONS.find((r) => r.value === pkg.discountFactor);
                            const isPct = pkg.discountType !== "Fixed amount";
                            const amount = Number(pkg.discountValue) || 0;
                            const after = price && amount ? Math.max(0, isPct ? price * (1 - amount / 100) : price - amount) : 0;
                            const warn = !amount ? "" : isPct && amount > 50 ? "That is more than half off. Most discounts are 5% to 20%." : !isPct && price && amount >= price ? "The discount is as much as the price itself." : "";
                            const choice = (on: boolean) =>
                              `inline-flex cursor-pointer appearance-none items-center gap-1.5 rounded-md border border-solid px-3 py-1.5 text-[13px] transition ${on ? "border-emerald-700 bg-emerald-700 font-semibold text-white" : "border-neutral-300 bg-white text-neutral-700 hover:border-emerald-500"}`;
                            return panel(
                              <Check />,
                              "Discount",
                              "Optional. Only when there is a clear reason, such as a large group or early booking.",
                              discountOn ? (
                                <div className="space-y-4">
                                  {/* 1. Why */}
                                  <div>
                                    <p className="m-0 flex items-center gap-1 text-[12.5px] font-medium text-neutral-700">
                                      1. Why you offer it
                                      <InfoTip label="About the reason">
                                        The reason is shown to travellers next to the discount, so it reads as a fair offer, not a price cut.
                                      </InfoTip>
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Discount reason">
                                      {REASONS.map((r) => (
                                        <button
                                          key={r.value}
                                          type="button"
                                          role="radio"
                                          aria-checked={pkg.discountFactor === r.value}
                                          onClick={() => patchPackage(pkg.id, { discountFactor: r.value, discountUnit: r.unit || pkg.discountUnit })}
                                          className={choice(pkg.discountFactor === r.value)}
                                        >
                                          {pkg.discountFactor === r.value ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                                          {r.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="grid gap-4 md:grid-cols-2">
                                    {/* 2. How much */}
                                    <div>
                                      <p className="m-0 flex items-center gap-1 text-[12.5px] font-medium text-neutral-700">
                                        2. How much
                                        <InfoTip label="About the amount">
                                          A percentage scales with the price. A fixed amount takes the same sum off each traveller.
                                        </InfoTip>
                                      </p>
                                      <div className="mt-2 flex gap-2">
                                        <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-solid border-neutral-300" role="radiogroup" aria-label="Discount type">
                                          {[
                                            { value: "Percentage", label: "%" },
                                            { value: "Fixed amount", label: cur },
                                          ].map((t, i) => {
                                            const on = (t.value === "Percentage") === isPct;
                                            return (
                                              <button
                                                key={t.value}
                                                type="button"
                                                role="radio"
                                                aria-checked={on}
                                                onClick={() => patchPackage(pkg.id, { discountType: t.value })}
                                                className={`h-10 min-w-[3rem] cursor-pointer appearance-none border-0 px-3 text-[13px] font-semibold transition ${i ? "border-l border-solid border-neutral-300" : ""} ${on ? "bg-emerald-700 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
                                              >
                                                {t.label}
                                              </button>
                                            );
                                          })}
                                        </div>
                                        <span className="relative block flex-1">
                                          <Input
                                            type="number"
                                            min="0"
                                            value={pkg.discountValue}
                                            onChange={(e) => patchPackage(pkg.id, { discountValue: e.target.value })}
                                            placeholder={isPct ? "10" : "50"}
                                            aria-label="Discount amount"
                                            className="!mt-0 !pr-16"
                                          />
                                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] text-neutral-500">{isPct ? "% off" : `${cur} off`}</span>
                                        </span>
                                      </div>
                                    </div>

                                    {/* 3. When */}
                                    <div>
                                      <p className="m-0 flex items-center gap-1 text-[12.5px] font-medium text-neutral-700">
                                        3. When it applies
                                        <InfoTip label="About the rule">
                                          NoLSAF applies the discount at checkout only when the booking meets this rule.
                                        </InfoTip>
                                      </p>
                                      <div className="mt-2 flex items-center gap-2">
                                        <span className="shrink-0 text-[13px] text-neutral-600">At least</span>
                                        <Input
                                          type="number"
                                          min="1"
                                          value={pkg.discountCondition}
                                          onChange={(e) => patchPackage(pkg.id, { discountCondition: e.target.value })}
                                          placeholder="6"
                                          aria-label="Minimum to qualify"
                                          className="!mt-0 !w-20 shrink-0"
                                        />
                                        {reason && reason.unit ? (
                                          <span className="min-w-0 truncate text-[13px] text-neutral-700">{reason.rule}</span>
                                        ) : (
                                          <Select value={pkg.discountUnit} onChange={(e) => patchPackage(pkg.id, { discountUnit: e.target.value })} aria-label="Counted in" className="!mt-0">
                                            <option value="">Counted in</option>
                                            <option>Travelers</option>
                                            <option>Days before travel</option>
                                            <option>Completed previous bookings</option>
                                            <option>Bookings</option>
                                            <option>Nights</option>
                                          </Select>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* What the traveller is offered, with the real numbers. */}
                                  <div className={`rounded-md border border-solid px-4 py-3 ${amount ? (warn ? "border-amber-300 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/50") : "border-neutral-200 bg-neutral-50"}`}>
                                    {amount ? (
                                      <>
                                        <p className="m-0 text-[13.5px] text-neutral-800">
                                          Travellers get <strong className="text-emerald-800">{isPct ? `${amount}% off` : `${cur} ${amount.toLocaleString("en-US")} off`}</strong>
                                          {discountConditionText ? <> when {discountConditionText}</> : " once the rule is met"}.
                                        </p>
                                        {price ? (
                                          <p className="m-0 mt-1 text-[13px] text-neutral-600">
                                            <span className="tabular-nums text-neutral-400 line-through">{money(price)}</span>
                                            <span className="mx-1.5">to</span>
                                            <strong className="tabular-nums text-neutral-900">{money(Math.round(after))}</strong> per person
                                          </p>
                                        ) : null}
                                        {warn ? <p className="m-0 mt-1.5 text-[12.5px] font-medium text-amber-800">{warn}</p> : null}
                                      </>
                                    ) : (
                                      <p className="m-0 text-[13px] text-neutral-500">Choose an amount to see what travellers are offered.</p>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <p className="m-0 text-[12.5px] text-neutral-500">No discount on this package. Most packages do not need one.</p>
                              ),
                            <button
                              type="button"
                              role="switch"
                              aria-checked={discountOn}
                              onClick={() => patchPackage(pkg.id, discountOn
                                ? { discountFactor: "", discountType: "", discountValue: "", discountCondition: "", discountUnit: "" }
                                : { discountFactor: "Large group size", discountType: "Percentage", discountUnit: "Travelers" })}
                              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition ${discountOn ? "bg-emerald-700" : "bg-neutral-300"}`}
                              aria-label={discountOn ? "Remove the discount" : "Add a discount"}
                            >
                              <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${discountOn ? "translate-x-5" : ""}`} />
                            </button>,
                            );
                          })()}
                        </div>
                      );
                    })()}

                    {step === 3 && (() => {
                      // "Meal" and "Meals" are the same thing: compare without case, spaces or a trailing s.
                      const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ").replace(/s$/, "");
                      const has = (list: string[], v: string) => list.some((x) => norm(x) === norm(v));
                      const setLists = (included: string[], excluded: string[]) => patchPackage(pkg.id, { included, excluded });
                      const add = (key: "included" | "excluded", raw: string) => {
                        const value = raw.trim();
                        if (!value) return;
                        const other = key === "included" ? "excluded" : "included";
                        const next = { included: [...pkg.included], excluded: [...pkg.excluded] };
                        // Adding to one side takes it off the other: an item cannot be both.
                        next[other] = next[other].filter((x) => norm(x) !== norm(value));
                        if (!has(next[key], value)) next[key] = [...next[key], value];
                        setLists(next.included, next.excluded);
                        if (key === "included") setIncludedDrafts((d) => ({ ...d, [pkg.id]: "" }));
                        else setExcludedDrafts((d) => ({ ...d, [pkg.id]: "" }));
                      };
                      const move = (from: "included" | "excluded", item: string) => {
                        const to = from === "included" ? "excluded" : "included";
                        const next = { included: [...pkg.included], excluded: [...pkg.excluded] };
                        next[from] = next[from].filter((x) => x !== item);
                        if (!has(next[to], item)) next[to] = [...next[to], item];
                        setLists(next.included, next.excluded);
                      };
                      const conflicts = pkg.included.filter((x) => has(pkg.excluded, x));

                      const column = (key: "included" | "excluded") => {
                        const inc = key === "included";
                        const list = pkg[key];
                        const draft = (inc ? includedDrafts : excludedDrafts)[pkg.id] ?? "";
                        const setDraft = (v: string) => (inc ? setIncludedDrafts : setExcludedDrafts)((d) => ({ ...d, [pkg.id]: v }));
                        const suggestions = (inc ? includedSuggestions : excludedSuggestions).filter((s) => !has(pkg.included, s) && !has(pkg.excluded, s));
                        return (
                          <section className={`min-w-0 overflow-hidden rounded-md border border-solid ${inc ? "border-emerald-200" : "border-neutral-200"}`}>
                            <header className={`flex items-center justify-between gap-2 border-0 border-b border-solid px-4 py-3 ${inc ? "border-emerald-100 bg-emerald-50/60" : "border-neutral-100 bg-neutral-50/70"}`}>
                              <p className="m-0 flex items-center gap-2 text-[14px] font-semibold text-neutral-900">
                                <span className={`grid h-6 w-6 place-items-center rounded-full ${inc ? "bg-emerald-700 text-white" : "bg-rose-100 text-rose-700"}`}>
                                  {inc ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <X className="h-3.5 w-3.5" strokeWidth={3} />}
                                </span>
                                {inc ? "Included in the price" : "Not included"}
                                {inc ? <span className="text-red-500">*</span> : null}
                                <InfoTip label={inc ? "About what is included" : "About what is not included"}>
                                  {inc
                                    ? "Everything the price covers. Be specific: travellers trust packages that list park fees, meals and transport clearly."
                                    : "Costs the traveller pays separately, such as flights, visas or tips. Listing them avoids disputes later."}
                                </InfoTip>
                              </p>
                              <span className="text-[12px] text-neutral-500">{list.length || "None"}</span>
                            </header>

                            <div className="p-4">
                              {list.length ? (
                                <ul className="m-0 list-none space-y-1.5 p-0">
                                  {list.map((item) => {
                                    const clash = has(inc ? pkg.excluded : pkg.included, item);
                                    return (
                                      <li key={item} className={`group flex items-center gap-2 rounded-md border border-solid px-3 py-2 ${clash ? "border-amber-300 bg-amber-50/60" : "border-neutral-200 bg-white"}`}>
                                        {inc ? <Check className="h-4 w-4 shrink-0 text-emerald-700" strokeWidth={3} /> : <X className="h-4 w-4 shrink-0 text-rose-600" strokeWidth={3} />}
                                        <span className="min-w-0 flex-1 truncate text-[13.5px] text-neutral-800" title={item}>{item}</span>
                                        <button
                                          type="button"
                                          onClick={() => move(key, item)}
                                          className="shrink-0 cursor-pointer rounded border-0 bg-transparent px-1.5 py-0.5 text-[11.5px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                                          title={inc ? "Move to not included" : "Move to included"}
                                        >
                                          {inc ? "Not included" : "Include"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => removePackageListItem(pkg.id, key, item)}
                                          aria-label={`Remove ${item}`}
                                          className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent text-neutral-400 hover:bg-red-50 hover:text-red-600"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : (
                                <p className="m-0 text-[12.5px] text-neutral-500">{inc ? "Nothing listed yet. Add what the price covers." : "Nothing listed. Add costs travellers pay themselves."}</p>
                              )}

                              <div className="mt-3 flex gap-2">
                                <Input
                                  value={draft}
                                  onChange={(e) => setDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      add(key, draft);
                                    }
                                  }}
                                  placeholder={inc ? "Add something included, e.g. park fees" : "Add something not included, e.g. tips"}
                                  aria-label={inc ? "Add an included item" : "Add an item not included"}
                                  className="!mt-0"
                                />
                                <button
                                  type="button"
                                  onClick={() => add(key, draft)}
                                  disabled={!draft.trim()}
                                  className="inline-flex h-10 shrink-0 cursor-pointer appearance-none items-center gap-1 rounded-md border-0 bg-emerald-700 px-3.5 text-[13px] font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                                >
                                  <Plus className="h-4 w-4" />
                                  Add
                                </button>
                              </div>

                              {suggestions.length ? (
                                <div className="mt-3">
                                  <p className="m-0 text-[12px] text-neutral-500">Common for this trip, tap to add</p>
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {suggestions.slice(0, 10).map((s) => (
                                      <button
                                        key={s}
                                        type="button"
                                        onClick={() => add(key, s)}
                                        className="inline-flex cursor-pointer appearance-none items-center gap-1 rounded border border-dashed border-neutral-300 bg-white px-2 py-1 text-[12.5px] text-neutral-700 transition hover:border-emerald-500 hover:text-emerald-800"
                                      >
                                        <Plus className="h-3 w-3" />
                                        {s}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </section>
                        );
                      };

                      return (
                        <div className="space-y-4">
                          <div>
                            <h4 className="m-0 text-[16px] font-semibold text-neutral-900">What is included</h4>
                            <p className="m-0 mt-1 text-[13px] leading-6 text-neutral-500">What the price covers and what it does not, so travellers know exactly what they get.</p>
                          </div>

                          {conflicts.length ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-solid border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
                              <span>
                                Listed on both sides: <strong>{conflicts.join(", ")}</strong>. A traveller cannot tell which is true.
                              </span>
                              <button
                                type="button"
                                onClick={() => setLists(pkg.included, pkg.excluded.filter((x) => !has(conflicts, x)))}
                                className="cursor-pointer rounded border border-solid border-amber-400 bg-white px-2.5 py-1 text-[12.5px] font-semibold text-amber-900 hover:bg-amber-100"
                              >
                                Keep them as included
                              </button>
                            </div>
                          ) : null}

                          <div className="grid gap-4 lg:grid-cols-2">
                            {column("included")}
                            {column("excluded")}
                          </div>

                          <Field label="Notes for travellers" info="Booking conditions, what to bring, or route notes. Shown on the package page under the inclusions.">
                            <Textarea value={pkg.notes} onChange={(e) => patchPackage(pkg.id, { notes: e.target.value })} placeholder="For example: bring warm clothes for the crater rim; children under 6 are not allowed on walking safaris." />
                          </Field>
                        </div>
                      );
                    })()}

                    {step === 4 && (() => {
                      const VIBES: Array<{ value: ItineraryEvent["difficulty"]; label: string }> = [
                        { value: "", label: "Mood" },
                        { value: "Easy", label: "Easy" },
                        { value: "Normal", label: "Normal" },
                        { value: "Difficult", label: "Demanding" },
                        { value: "Funny", label: "Fun" },
                        { value: "Delicious", label: "Food" },
                      ];
                      const mins = (t: string) => {
                        const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
                        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
                      };
                      const badRange = (e: ItineraryEvent) => {
                        const a = mins(e.startTime);
                        const b = mins(e.endTime);
                        return a != null && b != null && b <= a;
                      };
                      const totalActivities = pkg.itinerary.reduce((n, d) => n + (d.events?.length || 0), 0);
                      const draft = itineraryDrafts[pkg.id] ?? { title: "", description: "", events: [] as ItineraryEvent[] };
                      const setDraft = (patch: Partial<typeof draft>) =>
                        setItineraryDrafts((d) => ({ ...d, [pkg.id]: { ...(d[pkg.id] ?? { title: "", description: "", events: [] }), ...patch } }));
                      const nextDay = pkg.itinerary.length + 1;

                      // One activity row, used for saved days and for the day being drafted.
                      const activityRow = (evt: ItineraryEvent, patch: (p: Partial<ItineraryEvent>) => void, remove: () => void, dayLabel: string) => {
                        const bad = badRange(evt);
                        return (
                          <li key={evt.id} className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 rounded-md border border-solid p-2 sm:grid-cols-[7rem_7rem_minmax(0,1fr)_8.5rem_auto] sm:items-center ${bad ? "border-red-300 bg-red-50/40" : "border-neutral-200 bg-white"}`}>
                            <Input type="time" value={evt.startTime} onChange={(e) => patch({ startTime: e.target.value })} aria-label={`${dayLabel} start time`} className="!mt-0" />
                            <Input type="time" value={evt.endTime} onChange={(e) => patch({ endTime: e.target.value })} aria-label={`${dayLabel} end time`} className={`!mt-0 ${bad ? "!border-red-400" : ""}`} />
                            <button
                              type="button"
                              onClick={remove}
                              aria-label={`Remove this activity from ${dayLabel}`}
                              className="grid h-10 w-10 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-neutral-400 transition hover:bg-red-50 hover:text-red-600 sm:order-last"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            <Input
                              value={evt.activity}
                              onChange={(e) => patch({ activity: e.target.value })}
                              placeholder="What happens, e.g. Morning game drive"
                              aria-label={`${dayLabel} activity`}
                              className="!mt-0 col-span-3 sm:col-span-1"
                            />
                            <Select
                              value={evt.difficulty}
                              onChange={(e) => patch({ difficulty: e.target.value as ItineraryEvent["difficulty"] })}
                              aria-label={`${dayLabel} activity mood`}
                              className="!mt-0"
                            >
                              {VIBES.map((v) => <option key={v.label} value={v.value}>{v.label}</option>)}
                            </Select>
                            {bad ? <p className="col-span-3 m-0 text-[12px] font-medium text-red-600 sm:col-span-5">The end time is before the start time.</p> : null}
                          </li>
                        );
                      };

                      const draftHasTitle = Boolean(draft.title.trim());
                      const draftEvents = draft.events || [];
                      const draftEventsOk = draftEvents.length > 0 && draftEvents.every((e) => e.startTime && e.endTime && e.activity && !badRange(e));
                      const draftTimesInText = /\d{1,2}:\d{2}|am|pm|morning|afternoon|evening/i.test(draft.description || "");
                      const canAddDay = draftHasTitle && (draftEventsOk || draftTimesInText);

                      return (
                        <div>
                          <div className="flex flex-wrap items-end justify-between gap-3">
                            <div className="min-w-0">
                              <h4 className="m-0 flex items-center gap-1 text-[16px] font-semibold text-neutral-900">
                                Day-by-day plan <span className="text-red-500">*</span>
                                <InfoTip label="About the day-by-day plan">
                                  Travellers read this before they book and follow it live during the trip in their NoLSAF account. Give every day a title and its timed activities.
                                </InfoTip>
                              </h4>
                              <p className="m-0 mt-1 text-[13px] leading-6 text-neutral-500">Each day, its activities and their times, so travellers know what to expect.</p>
                            </div>
                            <p className="m-0 rounded border border-solid border-neutral-200 bg-neutral-50 px-2 py-1 text-[12px] text-neutral-600">
                              <strong className="text-neutral-900">{pkg.itinerary.length}</strong> day{pkg.itinerary.length === 1 ? "" : "s"} · <strong className="text-neutral-900">{totalActivities}</strong> activit{totalActivities === 1 ? "y" : "ies"}
                            </p>
                          </div>

                          <ol className="m-0 mt-4 list-none p-0">
                            {pkg.itinerary.map((day, i) => {
                              const events = day.events || [];
                              const first = events.map((e) => e.startTime).filter(Boolean).sort()[0];
                              const last = events.map((e) => e.endTime).filter(Boolean).sort().slice(-1)[0];
                              return (
                                <li key={day.id} className="relative pb-4 pl-12">
                                  {/* the line joining the days */}
                                  <span aria-hidden className="absolute bottom-0 left-[17px] top-10 w-0.5 bg-neutral-200" />
                                  <span className="absolute left-0 top-0 grid h-9 w-9 place-items-center rounded-md bg-emerald-700 text-[13px] font-bold text-white">{day.day}</span>
                                  <div className="overflow-hidden rounded-md border border-solid border-neutral-200 bg-white">
                                    <div className="flex items-center gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2.5">
                                      <span className="shrink-0 text-[12px] font-semibold text-neutral-500">Day {day.day}</span>
                                      <input
                                        value={day.title}
                                        onChange={(e) => patchItineraryDay(pkg.id, day.id, { title: e.target.value })}
                                        placeholder={i === 0 ? "e.g. Arrive in Arusha" : "Title for this day"}
                                        aria-label={`Day ${day.day} title`}
                                        className="min-w-0 flex-1 rounded border-0 bg-transparent px-1.5 py-1 text-[15px] font-semibold text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 hover:bg-neutral-50 focus:bg-neutral-50 focus:ring-2 focus:ring-emerald-600/20"
                                      />
                                      {first ? <span className="hidden shrink-0 text-[12px] tabular-nums text-neutral-500 sm:inline">{first}{last ? ` to ${last}` : ""}</span> : null}
                                      <button
                                        type="button"
                                        onClick={() => removeItineraryDay(pkg.id, day.id)}
                                        aria-label={`Remove day ${day.day}`}
                                        className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                    <div className="space-y-3 p-3">
                                      <Textarea
                                        value={day.description}
                                        onChange={(e) => patchItineraryDay(pkg.id, day.id, { description: e.target.value })}
                                        placeholder="A short summary of the day, in a sentence or two."
                                        aria-label={`Day ${day.day} summary`}
                                        className="!mt-0 !min-h-[64px]"
                                      />
                                      <div>
                                        <p className="m-0 mb-1.5 flex items-center gap-1 text-[12.5px] font-medium text-neutral-600">
                                          Activities
                                          <span className="text-neutral-400">({events.length})</span>
                                        </p>
                                        {events.length ? (
                                          <ul className="m-0 list-none space-y-1.5 p-0">
                                            {events.map((evt) =>
                                              activityRow(
                                                evt,
                                                (p) => patchItineraryEvent(pkg.id, day.id, evt.id, p),
                                                () => removeItineraryEvent(pkg.id, day.id, evt.id),
                                                `Day ${day.day}`,
                                              ),
                                            )}
                                          </ul>
                                        ) : (
                                          <p className="m-0 text-[12.5px] text-amber-700">No activities yet. Add at least one with its times.</p>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => addItineraryEvent(pkg.id, day.id)}
                                          className="mt-2 inline-flex h-9 cursor-pointer appearance-none items-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-white px-3 text-[13px] font-semibold text-neutral-700 transition hover:border-emerald-500 hover:text-emerald-800"
                                        >
                                          <Plus className="h-4 w-4" />
                                          Add activity
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </li>
                              );
                            })}

                            {/* The next day, drafted at the end of the line. */}
                            <li className="relative pl-12">
                              <span className="absolute left-0 top-0 grid h-9 w-9 place-items-center rounded-md border-2 border-dashed border-emerald-600/50 bg-emerald-50 text-[13px] font-bold text-emerald-800">{nextDay}</span>
                              <div className="overflow-hidden rounded-md border border-dashed border-neutral-300 bg-neutral-50/40">
                                <div className="border-0 border-b border-dashed border-neutral-200 px-3 py-2.5">
                                  <p className="m-0 text-[13.5px] font-semibold text-neutral-900">{pkg.itinerary.length ? `Add day ${nextDay}` : "Plan your first day"}</p>
                                </div>
                                <div className="space-y-3 p-3">
                                  <Input
                                    value={draft.title}
                                    onChange={(e) => setDraft({ title: e.target.value })}
                                    placeholder={`Day ${nextDay} title, e.g. Game drive in Serengeti`}
                                    aria-label={`Day ${nextDay} title`}
                                    className="!mt-0"
                                  />
                                  <Textarea
                                    value={draft.description}
                                    onChange={(e) => setDraft({ description: e.target.value })}
                                    placeholder="A short summary of the day."
                                    aria-label={`Day ${nextDay} summary`}
                                    className="!mt-0 !min-h-[64px]"
                                  />
                                  {draftEvents.length ? (
                                    <ul className="m-0 list-none space-y-1.5 p-0">
                                      {draftEvents.map((evt) =>
                                        activityRow(
                                          evt,
                                          (p) => patchDraftItineraryEvent(pkg.id, evt.id, p),
                                          () => removeDraftItineraryEvent(pkg.id, evt.id),
                                          `Day ${nextDay}`,
                                        ),
                                      )}
                                    </ul>
                                  ) : null}
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <button
                                      type="button"
                                      onClick={() => addDraftItineraryEvent(pkg.id)}
                                      className="inline-flex h-9 cursor-pointer appearance-none items-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-white px-3 text-[13px] font-semibold text-neutral-700 transition hover:border-emerald-500 hover:text-emerald-800"
                                    >
                                      <Plus className="h-4 w-4" />
                                      Add activity
                                    </button>
                                    <div className="flex flex-wrap items-center gap-3">
                                      <span className="flex items-center gap-3 text-[12px]">
                                        <span className={`inline-flex items-center gap-1 ${draftHasTitle ? "text-emerald-700" : "text-neutral-500"}`}>
                                          {draftHasTitle ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <span className="h-3 w-3 rounded-full border border-solid border-neutral-300" />}
                                          Title
                                        </span>
                                        <span className={`inline-flex items-center gap-1 ${draftEventsOk || draftTimesInText ? "text-emerald-700" : "text-neutral-500"}`}>
                                          {draftEventsOk || draftTimesInText ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <span className="h-3 w-3 rounded-full border border-solid border-neutral-300" />}
                                          A timed activity
                                        </span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => addItineraryDay(pkg.id)}
                                        disabled={!canAddDay}
                                        className="inline-flex h-9 cursor-pointer appearance-none items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-3.5 text-[13px] font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                                      >
                                        <Check className="h-4 w-4" />
                                        Save day {nextDay}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </li>
                          </ol>
                        </div>
                      );
                    })()}
                    </div>
                    <div className="mt-5 flex items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 pt-4">
                      <button type="button" onClick={() => setStep(step - 1)} disabled={step <= 1} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-neutral-300 bg-white px-4 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40">
                        <ChevronLeft className="h-4 w-4" />
                        Back
                      </button>
                      <p className="m-0 text-[12.5px] text-neutral-500">Step {step} of 4 · {packageStepDefs[step - 1].label}</p>
                      {step < 4 ? (
                        <button type="button" onClick={() => setStep(step + 1)} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white hover:bg-emerald-800">
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      ) : (
                        <button type="button" onClick={() => setExpandedPackageIds((prev) => ({ ...prev, [pkg.id]: false }))} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white hover:bg-emerald-800">
                          <Check className="h-4 w-4" />
                          Done
                        </button>
                      )}
                    </div>
                  </div>
                  ) : null}
                </div>
              );
              })}
              </div>

            {/* Removed packages stay restorable for a while; nothing is lost on one tap. */}
            {removedPackages.length > 0 && !anyPackageExpanded ? (
              <div className="mt-3 overflow-hidden rounded-md border border-solid border-neutral-200 bg-white">
                <p className="m-0 flex items-center gap-1.5 border-0 border-b border-solid border-neutral-100 bg-neutral-50/70 px-4 py-2 text-[12px] font-semibold text-neutral-600 sm:px-5">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Recently removed
                  <span className="font-normal text-neutral-400">· restore within {PACKAGE_RESTORE_DAYS} days</span>
                </p>
                <ul className="m-0 list-none divide-y divide-solid divide-neutral-100 p-0">
                  {removedPackages.map((entry) => {
                    const id = String(entry.item?.id || "");
                    const daysLeft = Math.max(0, PACKAGE_RESTORE_DAYS - Math.floor((Date.now() - new Date(entry.removedAt).getTime()) / 86_400_000));
                    return (
                      <li key={`${id}-${entry.removedAt}`} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate text-[13px] font-medium text-neutral-500 line-through decoration-neutral-300">{entry.item?.name || "Untitled package"}</p>
                          <p className="m-0 text-[11.5px] text-neutral-400">{daysLeft} day{daysLeft === 1 ? "" : "s"} left to restore</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void restoreRemovedPackage(entry)}
                          disabled={Boolean(restoringId)}
                          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 transition hover:border-emerald-300 hover:text-emerald-800 disabled:opacity-50"
                        >
                          {restoringId === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                          Restore
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {removeTarget && typeof document !== "undefined"
              ? createPortal(
                  <div
                    className="fixed inset-0 z-[120] flex items-end justify-center bg-neutral-950/50 sm:items-center sm:p-4"
                    style={{ boxSizing: "border-box" }}
                    onMouseDown={(e) => { if (e.target === e.currentTarget && !removeBusy) setRemoveTarget(null); }}
                    onKeyDown={(e) => { if (e.key === "Escape" && !removeBusy) setRemoveTarget(null); }}
                  >
                    <div role="dialog" aria-modal="true" aria-labelledby="remove-package-title" className="w-full max-w-[440px] overflow-hidden rounded-t-lg bg-white shadow-2xl sm:rounded-lg [&_*]:box-border">
                      <div className="flex items-start gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-red-50 text-red-600">
                          <Trash2 className="h-5 w-5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h2 id="remove-package-title" className="m-0 text-base font-semibold text-neutral-900">Remove this package?</h2>
                          <p className="m-0 mt-0.5 text-[13px] leading-5 text-neutral-600">It comes off your public page at once and travellers can no longer book it.</p>
                        </div>
                      </div>

                      <div className="space-y-4 px-5 py-4">
                        <div className="rounded-md bg-neutral-50 px-3.5 py-3">
                          <p className="m-0 text-[14px] font-semibold text-neutral-900">{removeTarget.name || "Untitled package"}</p>
                          <p className="m-0 mt-0.5 text-[12px] text-neutral-500">
                            {[removeTarget.destination, removeTarget.duration, removeTarget.pricePerPerson ? `${removeTarget.currency} ${Number(removeTarget.pricePerPerson).toLocaleString("en-US")} per person` : ""].filter(Boolean).join(" · ")}
                          </p>
                        </div>

                        <ul className="m-0 space-y-1.5 pl-4 text-[12.5px] leading-5 text-neutral-600">
                          <li>A package with travellers booked on it cannot be removed until those trips are completed or cancelled.</li>
                          <li>Past bookings keep their own copy of the package and are not affected.</li>
                          <li>You can restore it from Recently removed for {PACKAGE_RESTORE_DAYS} days.</li>
                        </ul>

                        {removeTarget.name ? (
                          <div>
                            <label htmlFor="remove-package-name" className="block text-[13px] font-medium text-neutral-800">
                              Type <span className="font-semibold">{removeTarget.name}</span> to confirm
                            </label>
                            <input
                              id="remove-package-name"
                              type="text"
                              value={removeTyped}
                              onChange={(e) => setRemoveTyped(e.target.value)}
                              disabled={removeBusy}
                              autoComplete="off"
                              spellCheck={false}
                              autoFocus
                              className="mt-1.5 w-full rounded-md border border-solid border-neutral-300 bg-white px-3 py-2.5 text-[14px] text-neutral-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                            />
                          </div>
                        ) : null}

                        {removeError ? (
                          <p role="alert" className="m-0 rounded-md border border-solid border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800">{removeError}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-col-reverse gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50 px-5 py-3 sm:flex-row sm:justify-end">
                        <button type="button" onClick={() => setRemoveTarget(null)} disabled={removeBusy} className="h-10 cursor-pointer rounded-md border border-solid border-neutral-300 bg-white px-4 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50">
                          Keep it
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmRemovePackage()}
                          disabled={removeBusy || (Boolean(removeTarget.name) && normaliseTyped(removeTyped) !== normaliseTyped(removeTarget.name))}
                          className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-red-600 px-4 text-[13px] font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
                        >
                          {removeBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                          {removeBusy ? "Removing" : "Remove package"}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body,
                )
              : null}

            {!anyPackageExpanded && (
            <>
            <div className="mt-6 space-y-4">
              {(() => {
                const rates = profile.seasonalPrices;
                const SWATCH = ["bg-emerald-600", "bg-sky-600", "bg-violet-600", "bg-teal-500", "bg-indigo-500", "bg-rose-500"];
                const swatch = (i: number) => SWATCH[i % SWATCH.length];
                const short = (m: string) => m.slice(0, 3);
                const label = (name: string) => (name ? name.charAt(0) + name.slice(1).toLowerCase() : "");
                // A season can run across the new year, for example November to March.
                const span = (s: SeasonalPrice): number[] => {
                  const a = months.indexOf(s.startMonth);
                  const b = months.indexOf(s.endMonth);
                  if (a < 0 || b < 0) return [];
                  const out: number[] = [];
                  for (let i = a; ; i = (i + 1) % 12) {
                    out.push(i);
                    if (i === b || out.length === 12) break;
                  }
                  return out;
                };
                const cover: number[][] = months.map(() => []);
                rates.forEach((s, i) => span(s).forEach((m) => cover[m].push(i)));
                const overlap = months.filter((_, m) => cover[m].length > 1);
                const uncovered = months.filter((_, m) => cover[m].length === 0);
                const missing = (s: SeasonalPrice) => {
                  const out: string[] = [];
                  if (!s.seasonName) out.push("season");
                  if (!s.startMonth || !s.endMonth) out.push("months");
                  if (!(Number(s.pricePerPerson) > 0)) out.push("price");
                  return out;
                };
                const small = "!mt-0 !h-9 !text-[13px]";
                return (
                  <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
                    <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 sm:px-6">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                          <CalendarDays className="h-5 w-5" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <h3 className="m-0 flex items-center gap-1.5 text-base font-bold text-neutral-900">
                            Seasonal pricing
                            <InfoTip label="About seasonal pricing">
                              A seasonal rate replaces the package price per person for the months it covers. Months with no rate use the normal package price.
                            </InfoTip>
                          </h3>
                          <p className="m-0 mt-1 text-[13px] leading-5 text-neutral-500">Charge more in busy months and less in quiet ones. Optional.</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={addSeason}
                        className="inline-flex h-9 shrink-0 cursor-pointer appearance-none items-center justify-center gap-1.5 rounded-md border-0 bg-emerald-700 px-3.5 text-[13px] font-semibold text-white outline-none transition hover:bg-emerald-800"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Add rate
                      </button>
                    </div>

                    {/* The year at a glance: which rate covers each month. */}
                    <div className="border-0 border-t border-solid border-neutral-100 px-5 py-4 sm:px-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="m-0 text-[12.5px] font-medium text-neutral-700">Your year</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-neutral-500">
                          {rates.map((s, i) => (
                            <span key={s.id} className="inline-flex items-center gap-1.5">
                              <span className={`h-2.5 w-2.5 rounded-sm ${swatch(i)}`} aria-hidden />
                              {label(s.seasonName) || `Rate ${i + 1}`}
                            </span>
                          ))}
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-sm border border-solid border-neutral-300 bg-white" aria-hidden />
                            Package price
                          </span>
                        </div>
                      </div>
                      <div className="mt-2.5 grid grid-cols-6 gap-1 sm:grid-cols-12">
                        {months.map((m, mi) => {
                          const who = cover[mi];
                          const clash = who.length > 1;
                          return (
                            <div
                              key={m}
                              title={clash ? `${m}: more than one rate` : who.length ? `${m}: ${label(rates[who[0]].seasonName) || `Rate ${who[0] + 1}`}` : `${m}: package price`}
                              className={`flex h-11 flex-col justify-between overflow-hidden rounded border border-solid ${clash ? "border-amber-400 bg-amber-50" : who.length ? "border-neutral-100 bg-neutral-50" : "border-neutral-200 bg-white"}`}
                            >
                              <span className={`px-1.5 pt-1 text-[11px] font-medium ${clash ? "text-amber-800" : "text-neutral-600"}`}>{short(m)}</span>
                              <span className="flex h-1.5">
                                {who.map((i) => (
                                  <span key={i} className={`flex-1 ${swatch(i)}`} />
                                ))}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {overlap.length ? (
                        <p className="m-0 mt-2 text-[12.5px] font-medium text-amber-800">
                          {overlap.map(short).join(", ")} {overlap.length === 1 ? "is" : "are"} in more than one rate. Travellers cannot tell which price applies.
                        </p>
                      ) : rates.length && uncovered.length && uncovered.length < 12 ? (
                        <p className="m-0 mt-2 text-[12.5px] text-neutral-500">{uncovered.map(short).join(", ")} use the normal package price.</p>
                      ) : null}
                    </div>

                    <div className="border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 p-4 sm:p-5">
                      {rates.length === 0 ? (
                        <div className="rounded-md border border-dashed border-neutral-300 bg-white px-5 py-6 text-center">
                          <p className="m-0 text-sm font-semibold text-neutral-800">No seasonal rates</p>
                          <p className="m-0 mt-1 text-[12.5px] leading-5 text-neutral-500">Every month uses the normal package price. Add a rate for busy or quiet months.</p>
                        </div>
                      ) : (
                        <ol className="m-0 list-none space-y-2.5 p-0">
                          {rates.map((season, index) => {
                            const gaps = missing(season);
                            const n = span(season).length;
                            return (
                              <li key={season.id} className="min-w-0 overflow-hidden rounded-md border border-solid border-neutral-200 bg-white">
                                <div className="flex">
                                  <span className={`w-1 shrink-0 ${swatch(index)}`} aria-hidden />
                                  <div className="min-w-0 flex-1 p-3.5">
                                    <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]">
                                      <label className="block min-w-0">
                                        <span className="text-[12px] font-medium text-neutral-600">Season</span>
                                        <Select value={season.seasonName} onChange={(e) => patchSeason(season.id, { seasonName: e.target.value })} className={`${small} !mt-1`} aria-label="Season">
                                          <option value="">Choose a season</option>
                                          {season.seasonName && !seasonalRateNames.includes(season.seasonName) ? <option value={season.seasonName}>{season.seasonName}</option> : null}
                                          {seasonalRateNames.map((name) => <option key={name} value={name}>{label(name)}</option>)}
                                        </Select>
                                      </label>
                                      <div className="min-w-0">
                                        <span className="flex items-center justify-between text-[12px] font-medium text-neutral-600">
                                          Months
                                          {n ? <span className="font-normal text-neutral-400">{n} month{n === 1 ? "" : "s"}</span> : null}
                                        </span>
                                        <div className="mt-1 flex items-center gap-1.5">
                                          <Select value={season.startMonth} onChange={(e) => patchSeason(season.id, { startMonth: e.target.value })} className={small} aria-label="From month">
                                            <option value="">From</option>
                                            {months.map((month) => <option key={month} value={month}>{month}</option>)}
                                          </Select>
                                          <span className="shrink-0 text-[12.5px] text-neutral-400">to</span>
                                          <Select value={season.endMonth} onChange={(e) => patchSeason(season.id, { endMonth: e.target.value })} className={small} aria-label="To month">
                                            <option value="">To</option>
                                            {months.map((month) => <option key={month} value={month}>{month}</option>)}
                                          </Select>
                                        </div>
                                      </div>
                                      <div className="min-w-0">
                                        <span className="text-[12px] font-medium text-neutral-600">Price per person</span>
                                        <div className="mt-1 flex h-9 overflow-hidden rounded-md border border-solid border-neutral-300 bg-white focus-within:border-emerald-600">
                                          <select
                                            value={season.currency}
                                            onChange={(e) => patchSeason(season.id, { currency: e.target.value })}
                                            aria-label="Currency"
                                            className="h-full shrink-0 cursor-pointer appearance-none border-0 border-r border-solid border-neutral-200 bg-neutral-50 px-2.5 text-[12.5px] font-semibold text-neutral-700 outline-none"
                                          >
                                            <option>USD</option>
                                            <option>TZS</option>
                                            <option>EUR</option>
                                          </select>
                                          <input
                                            type="number"
                                            min="0"
                                            value={season.pricePerPerson}
                                            onChange={(e) => patchSeason(season.id, { pricePerPerson: e.target.value })}
                                            placeholder="650"
                                            aria-label="Price per person"
                                            className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-[13px] tabular-nums text-neutral-900 outline-none"
                                          />
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => update("seasonalPrices", rates.filter((p) => p.id !== season.id))}
                                        className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center justify-self-end rounded-md border border-solid border-neutral-200 bg-white text-neutral-400 outline-none transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                                        aria-label="Remove this rate"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                                      <span className="block min-w-0 flex-1">
                                        <Input
                                          value={season.notes}
                                          onChange={(e) => patchSeason(season.id, { notes: e.target.value })}
                                          placeholder="Note for travellers, e.g. wildebeest migration in the north"
                                          aria-label="Note"
                                          className={small}
                                        />
                                      </span>
                                      {gaps.length ? (
                                        <span className="shrink-0 text-[12px] font-medium text-amber-700">Add the {gaps.join(", ")}</span>
                                      ) : (
                                        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-emerald-700">
                                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                          Ready
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  </section>
                );
              })()}

              <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
                <div className="flex flex-wrap items-start justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4 sm:px-6">
                  <div>
                    <p className="m-0 text-[12.5px] font-medium text-emerald-700">Booking extras</p>
                    <h3 className="m-0 mt-1 text-base font-bold text-neutral-900">Add-ons</h3>
                    <p className="m-0 mt-1 text-xs leading-5 text-neutral-500">Select useful extras that customers can add when booking a package.</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{profile.addOns.length} selected</span>
                </div>

                <div className="space-y-4 p-4 sm:p-5">
                  <div>
                    <p className="m-0 text-[11px] font-bold text-neutral-700">Available extras</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {addOnOptions.map((item) => (
                        <Chip key={item} label={item} active={profile.addOns.includes(item)} onClick={() => toggle("addOns", item)} />
                      ))}
                    </div>
                  </div>

                  <div className="border-0 border-t border-solid border-neutral-100 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="m-0 text-[11px] font-bold text-neutral-700">Selected extras</p>
                      <p className="m-0 text-[10px] text-neutral-400">Click × to remove an extra</p>
                    </div>
                    {profile.addOns.length > 0 ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {profile.addOns.map((item) => <SelectedPill key={item} label={item} onRemove={() => toggle("addOns", item)} />)}
                      </div>
                    ) : (
                      <p className="m-0 mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">No booking extras selected yet.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-solid border-neutral-200 bg-neutral-50/70 p-3.5">
                    <p className="m-0 text-[11px] font-bold text-neutral-700">Add a custom extra</p>
                    <p className="m-0 mt-0.5 text-[10px] text-neutral-500">Use this for an offer not listed above.</p>
                    <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <Input value={customAddOn} onChange={(e) => setCustomAddOn(e.target.value)} placeholder="e.g. Airport transfer or balloon safari" />
                      <button type="button" onClick={() => addCustom("addOns", customAddOn, setCustomAddOn)} className="inline-flex h-10 cursor-pointer appearance-none items-center justify-center rounded-md border border-solid border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-700 outline-none transition hover:border-emerald-200 hover:text-emerald-800">Add extra</button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
            </>
            )}
          </section>
          </div>
        ) : null}

        <div className={isPackagesView ? "hidden" : "mt-5 space-y-5"}>
          {(() => {
            const REQUIRED = ["logo", "vehicles", "attractions"];
            const WHY: Record<string, string> = {
              logo: "Shown beside your name across NoLSAF. A square image on a plain background works best.",
              vehicles: "Travellers look at vehicles before they book a safari. Show the outside and the seats.",
              team: "Real guides and drivers build trust. Smiling faces in uniform or at work are ideal.",
              office: "Shows you are an established business with a real address.",
              attractions: "The trips themselves: wildlife, beaches, mountains, camps. These sell your tours.",
              proof: "Permits, awards or certificates. Seen by NoLSAF during review; only proof you choose to share is public.",
            };
            const requiredDone = REQUIRED.filter((key) => (profile.classifiedPhotos[key] ?? []).length > 0).length;
            const removePhoto = (key: string, url: string, count: number, index: number) => {
              setProfile((p) => ({
                ...p,
                companyLogoUrl: p.companyLogoUrl === url ? "" : p.companyLogoUrl,
                gallery: p.gallery.filter((x) => x !== url),
                classifiedPhotos: { ...p.classifiedPhotos, [key]: (p.classifiedPhotos[key] ?? []).filter((x) => x !== url) },
              }));
              setPhotoSlideIndex((prev) => ({ ...prev, [key]: Math.max(0, Math.min(prev[key] ?? index, count - 2)) }));
            };
            return (
              <Section
                icon={<Camera className="h-5 w-5" />}
                title="Photos"
                text="Your photos, by where they appear on your public page."
                info="Travellers decide with their eyes. Each group below fills a specific place on your operator page, so put every photo in the right group."
                done={requiredDone === REQUIRED.length}
                todo={`${REQUIRED.length - requiredDone} required to add`}
              >
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-solid border-neutral-200 bg-neutral-50/60 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <span className="font-semibold text-neutral-800">Required</span>
                    {REQUIRED.map((key) => {
                      const has = (profile.classifiedPhotos[key] ?? []).length > 0;
                      const title = photoCategories.find((c) => c.key === key)?.title ?? key;
                      return (
                        <span
                          key={key}
                          className={`inline-flex items-center gap-1 rounded border border-solid px-2 py-0.5 font-medium ${has ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                        >
                          {has ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                          {title}
                        </span>
                      );
                    })}
                  </div>
                  <span className="text-[12px] text-neutral-500">Up to 3 photos per group, 1 logo. {photoHelpText}</span>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {photoCategories.map((cat) => {
                    const urls = profile.classifiedPhotos[cat.key] ?? [];
                    const activeIndex = urls.length > 0 ? Math.min(Math.max(photoSlideIndex[cat.key] ?? 0, 0), urls.length - 1) : 0;
                    const activeUrl = urls[activeIndex] ?? "";
                    const required = REQUIRED.includes(cat.key);
                    const isLogo = cat.key === "logo";
                    const busy = uploading === cat.key;
                    const openPicker = () => fileRefs.current[cat.key]?.click();
                    return (
                      <article key={cat.key} className={`flex min-w-0 flex-col overflow-hidden rounded-md border border-solid bg-white ${required && !urls.length ? "border-amber-300" : "border-neutral-200"}`}>
                        <header className="flex items-start justify-between gap-2 px-4 pb-3 pt-3.5">
                          <div className="min-w-0">
                            <p className="m-0 flex items-center gap-1 text-[14px] font-semibold text-neutral-900">
                              {cat.title}
                              <InfoTip label={`About ${cat.title.toLowerCase()} photos`}>{WHY[cat.key] ?? cat.text}</InfoTip>
                            </p>
                            <p className="m-0 mt-0.5 text-[12px] leading-4 text-neutral-500">{cat.text}</p>
                          </div>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                              urls.length ? "bg-emerald-50 text-emerald-800" : required ? "bg-amber-50 text-amber-800" : "bg-neutral-100 text-neutral-500"
                            }`}
                          >
                            {urls.length ? `${urls.length} of ${photoLimit(cat.key)}` : required ? "Required" : "Optional"}
                          </span>
                        </header>

                        <input
                          ref={(node) => { fileRefs.current[cat.key] = node; }}
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                          multiple={!isLogo}
                          className="hidden"
                          onChange={(e) => uploadPhotos(cat.key, e.target.files)}
                        />

                        {urls.length ? (
                          <div className="px-4 pb-4">
                            {/* Cover: the photo travellers see first in this group. */}
                            <div className={`relative overflow-hidden rounded-md border border-solid border-neutral-200 ${isLogo ? "bg-neutral-50" : "bg-neutral-100"}`}>
                              <div
                                className="aspect-[16/10] w-full touch-pan-y"
                                onTouchStart={(e) => onPhotoTouchStart(cat.key, e.changedTouches[0]?.clientX ?? 0)}
                                onTouchEnd={(e) => onPhotoTouchEnd(cat.key, urls.length, e.changedTouches[0]?.clientX ?? 0)}
                              >
                                {isLogo ? (
                                  <div className="flex h-full w-full items-center justify-center p-5">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={activeUrl} alt={`${cat.title}`} className="max-h-full max-w-[60%] object-contain" />
                                  </div>
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={activeUrl} alt={`${cat.title} ${activeIndex + 1}`} className="h-full w-full object-cover" />
                                )}
                              </div>
                              {!isLogo && urls.length > 1 ? (
                                <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                                  {activeIndex === 0 ? "Cover" : `${activeIndex + 1} of ${urls.length}`}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => removePhoto(cat.key, activeUrl, urls.length, activeIndex)}
                                className="absolute right-2 top-2 inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border-0 bg-white/95 px-2 text-[12px] font-semibold text-neutral-700 shadow-sm transition hover:text-red-600"
                                aria-label={`Remove this ${cat.title.toLowerCase()} photo`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove
                              </button>
                            </div>

                            {/* Thumbnails: tap to view; the last tile adds more. */}
                            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
                              {(isLogo ? [] : urls).map((url, idx) => (
                                <button
                                  key={`${cat.key}-${idx}`}
                                  type="button"
                                  onClick={() => setPhotoSlideIndex((prev) => ({ ...prev, [cat.key]: idx }))}
                                  className={`relative h-12 w-16 shrink-0 cursor-pointer overflow-hidden rounded border-2 border-solid p-0 ${idx === activeIndex ? "border-emerald-600" : "border-transparent opacity-80 hover:opacity-100"}`}
                                  aria-label={`View photo ${idx + 1}`}
                                  aria-pressed={idx === activeIndex}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                </button>
                              ))}
                              {!isLogo && urls.length >= photoLimit(cat.key) ? (
                                <span className="flex h-12 shrink-0 items-center px-2 text-[11.5px] text-neutral-500">Full. Remove one to swap.</span>
                              ) : (
                              <button
                                type="button"
                                onClick={openPicker}
                                disabled={busy}
                                className={`flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed border-neutral-300 bg-white text-[12px] font-semibold text-neutral-600 transition hover:border-emerald-500 hover:text-emerald-700 disabled:cursor-wait ${isLogo ? "h-9 px-3" : "h-12 w-16 flex-col gap-0.5"}`}
                                aria-label={isLogo ? "Replace logo" : `Add ${cat.title.toLowerCase()} photos`}
                              >
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                                <span className={isLogo ? "" : "text-[10.5px]"}>{isLogo ? "Replace logo" : "Add"}</span>
                              </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="px-4 pb-4">
                            <button
                              type="button"
                              onClick={openPicker}
                              disabled={busy}
                              className={`flex aspect-[16/10] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-neutral-50/60 text-center transition hover:border-emerald-500 hover:bg-emerald-50/40 disabled:cursor-wait ${required ? "border-amber-300" : "border-neutral-300"}`}
                            >
                              <span className="grid h-10 w-10 place-items-center rounded-md bg-white text-emerald-700 shadow-sm">
                                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                              </span>
                              <span className="text-[13px] font-semibold text-neutral-800">{isLogo ? "Upload your logo" : `Add ${cat.title.toLowerCase()} photos`}</span>
                              <span className="text-[11.5px] text-neutral-500">{isLogo ? "One square image" : `Up to ${photoLimit(cat.key)} of your best`}</span>
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </Section>
            );
          })()}
        </div>

        {/* Save bar at the end of the page, not pinned: changes autosave, so it
            does not need to follow the reader and cover the form. On desktop the
            side guide carries Submit for review while scrolling. */}
        <div className="mt-6 rounded-lg border border-solid border-neutral-200 bg-white">
          <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${canSubmit ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                <ShieldCheck className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[13.5px] font-semibold leading-tight text-neutral-900">
                  {canSubmit ? "Ready to submit for review" : "Profile setup in progress"}
                </p>
                <p className="m-0 mt-0.5 text-[12px] leading-snug text-neutral-500">
                  {(() => {
                    const submittedAt = profile?.review?.submittedAt || (profile as any)?.submittedAt;
                    if (!submittedAt) return "Changes save automatically.";
                    const d = new Date(submittedAt);
                    const when = d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" });
                    return <>Changes save automatically. Last submitted {when} EAT.</>;
                  })()}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
              <button
                type="button"
                onClick={save}
                disabled={saving || submitting}
                className="inline-flex h-10 cursor-pointer appearance-none items-center justify-center gap-2 rounded-md border border-solid border-neutral-300 bg-white px-4 text-[13px] font-semibold text-neutral-700 outline-none transition hover:border-emerald-300 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save draft
              </button>
              <button
                type="button"
                onClick={submitForReview}
                disabled={submitting || saving || !canSubmit}
                className="inline-flex h-10 cursor-pointer appearance-none items-center justify-center gap-2 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white outline-none transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Submit for review
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
