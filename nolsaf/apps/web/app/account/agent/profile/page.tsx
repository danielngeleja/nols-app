"use client";

import { Children, Fragment, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import Link from "next/link";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Globe,
  ImagePlus,
  Loader2,
  MapPin,
  PackagePlus,
  Plus,
  Save,
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

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function addUniqueItem(items: string[], value: string) {
  const clean = value.trim();
  if (!clean) return items;
  return items.includes(clean) ? items : [...items, clean];
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
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  const hasRequiredSuffix = /\*\s*$/.test(label);
  const cleanLabel = hasRequiredSuffix ? label.replace(/\s*\*\s*$/, "") : label;
  const showRequired = required ?? hasRequiredSuffix;

  return (
    <label className="block min-w-0">
      <span className="block text-xs font-semibold text-slate-700">
        {cleanLabel}
        {showRequired ? <span className="ml-0.5 text-red-500">*</span> : null}
      </span>
      {children}
    </label>
  );
}

const fieldBase =
  "mt-2 box-border block w-full max-w-full rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-[#02665e]/40 focus:bg-white focus:ring-4 focus:ring-[#02665e]/10";

function Segmented({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="mt-2 flex gap-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${value === o.value ? "bg-[#02665e] text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-900"}`}
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
      className={`${fieldBase} h-11 px-3.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${props.className ?? ""}`}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${fieldBase} min-h-[112px] resize-y px-3.5 py-2.5 leading-6 ${props.className ?? ""}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select
        {...props}
        className={`${fieldBase} h-11 !appearance-none [-webkit-appearance:none] pl-3.5 pr-10 disabled:bg-slate-100 disabled:text-slate-400 ${props.className ?? ""}`}
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </span>
  );
}

function Section({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <section className="box-border w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6 lg:p-7">
      <div className="lg:grid lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:gap-8">
        <div className="mb-6 lg:mb-0">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e] ring-1 ring-[#02665e]/15">
            {icon}
          </div>
          <h2 className="mt-4 text-lg font-black leading-snug tracking-tight text-slate-900">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>
        </div>
        <div className="min-w-0">
          {children}
        </div>
      </div>
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
    <div className={`grid w-full grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 ${className}`}>
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
      className={`flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-left text-sm font-normal leading-5 transition ${
        active
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
          : "border-slate-200 bg-white text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.03)] hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <span className="truncate">{label}</span>
      {active ? <Check className="h-4 w-4 shrink-0 text-emerald-700" /> : null}
    </button>
  );
}

function SelectedPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="grid min-h-10 grid-cols-[1fr_32px] items-start rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-800 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
      <span className="break-words px-3.5 py-2 leading-5">{label}</span>
      <button type="button" onClick={onRemove} className="m-1 mt-1.5 flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-slate-500 shadow-none ring-0 outline-none hover:bg-slate-100" aria-label={`Remove ${label}`}>
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSubmitSuccess, setShowSubmitSuccess] = useState(false);
  const [agent, setAgent] = useState<AgentMe["agent"] | null>(null);
  const [profile, setProfile] = useState<OperatorProfile>(emptyProfile);
  const [region, setRegion] = useState("");
  const [district, setDistrict] = useState("");
  const [customTool, setCustomTool] = useState("");
  const [customAddOn, setCustomAddOn] = useState("");
  const [tourismTypeInput, setTourismTypeInput] = useState("");
  const [serviceCategoryInput, setServiceCategoryInput] = useState("");
  const [partnershipServiceInput, setPartnershipServiceInput] = useState("");
  const [specializationInput, setSpecializationInput] = useState("");
  const [parkInput, setParkInput] = useState("");
  const [vehicleInput, setVehicleInput] = useState({ type: "", quantity: "", seatsPerVehicle: "", registrationNumber: "", ownedBy: "", serviceMode: "", notes: "" });
  const [tourismSites, setTourismSites] = useState<{ id: number; name: string }[]>([]);
  const [tourismSitesLoading, setTourismSitesLoading] = useState(false);
  const [includedDrafts, setIncludedDrafts] = useState<Record<string, string>>({});
  const [excludedDrafts, setExcludedDrafts] = useState<Record<string, string>>({});
  const [itineraryDrafts, setItineraryDrafts] = useState<Record<string, { title: string; description: string; events: ItineraryEvent[] }>>({});
  const [autosaveRetryTick, setAutosaveRetryTick] = useState(0);
  const [expandedPackageIds, setExpandedPackageIds] = useState<Record<string, boolean>>({});
  const [packageStep, setPackageStep] = useState<Record<string, number>>({});
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});
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

  const serviceOptionsForCategory = useMemo(() => {
    if (!serviceCategoryInput) return [] as string[];
    if (serviceCategoryInput === "COMMON") return COMMON_SERVICES;
    return TOURISM_TYPE_SERVICES[serviceCategoryInput as keyof typeof TOURISM_TYPE_SERVICES] ?? [];
  }, [serviceCategoryInput]);

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
          await api.patch("/api/agent/operator-profile", serializeProfileForApi(profileRef.current));
          // Silent autosave: keep current form state intact and only advance saved snapshot.
          lastSavedSnapshotRef.current = snapshotToSave;
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
      if (serviceCategoryInput === value) {
        setServiceCategoryInput("");
        setPartnershipServiceInput("");
      }
    } else {
      setProfile((p) => ({ ...p, tourismTypes: [...p.tourismTypes, value] }));
    }
  }

  function addClassifiedService() {
    const value = partnershipServiceInput.trim();
    if (!value || !serviceCategoryInput) return;
    if (!serviceOptionsForCategory.includes(value)) return;
    if (profile.services.includes(value)) {
      setPartnershipServiceInput("");
      return;
    }
    const categoryLabel = serviceCategoryInput === "COMMON" ? "Common Services" : serviceCategoryInput;
    setProfile((p) => ({
      ...p,
      services: [...p.services, value],
      serviceClassification: {
        ...(p.serviceClassification ?? {}),
        [categoryLabel]: Array.from(new Set([...((p.serviceClassification ?? {})[categoryLabel] ?? []), value])),
      },
    }));
    setPartnershipServiceInput("");
    setError(null);
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

  function addArea() {
    if (!region || !district) return;
    const label = `${region} / ${district}`;
    update("operatingRegions", profile.operatingRegions.includes(label) ? profile.operatingRegions : [...profile.operatingRegions, label]);
    setDistrict("");
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

  function addPackageListItem(packageId: string, key: "included" | "excluded") {
    const draftMap = key === "included" ? includedDrafts : excludedDrafts;
    const value = draftMap[packageId] ?? "";
    const clean = value.trim();
    if (!clean) return;

    update(
      "packageItems",
      profile.packageItems.map((pkg) =>
        pkg.id === packageId ? { ...pkg, [key]: addUniqueItem(pkg[key], clean) } : pkg,
      ),
    );

    if (key === "included") {
      setIncludedDrafts((drafts) => ({ ...drafts, [packageId]: "" }));
    } else {
      setExcludedDrafts((drafts) => ({ ...drafts, [packageId]: "" }));
    }
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
  const nextStep = readiness.steps.find((step) => !step.done);
  const heroStats = [
    { label: "Coverage", count: profile.operatingRegions.length, target: 3, hint: "regions" },
    { label: "Packages", count: profile.packageItems.length, target: 3, hint: "packages" },
    { label: "Photos", count: profile.gallery.length, target: 8, hint: "photos" },
  ];

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

      <div className="mx-auto w-full max-w-6xl py-6 sm:px-6 lg:px-8">
        <Link href="/account/agent" aria-label="Back to agent dashboard" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 no-underline hover:bg-white hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="relative overflow-hidden rounded-2xl bg-[#063f3b] p-5 text-white sm:p-6">
            <div className="flex flex-col gap-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3 sm:gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/10 text-base font-black text-cyan-50 sm:h-14 sm:w-14">
                    {profile.companyLogoUrl ? (
                      <img src={profile.companyLogoUrl} alt={heroTitle} className="h-full w-full object-cover" />
                    ) : heroInitials ? (
                      <span>{heroInitials}</span>
                    ) : (
                      <Building2 className="h-7 w-7" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-cyan-100">Company marketplace setup</p>
                    <h1 className="mt-1.5 text-xl font-black leading-tight tracking-normal text-white break-words sm:text-2xl">{heroTitle}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-cyan-50/80">
                      {tierLabel ? (
                        <span title={tierLabel} aria-label={tierLabel} className="inline-flex items-center">
                          <ShieldCheck className="h-5 w-5" style={{ color: tierColor }} />
                        </span>
                      ) : null}
                      {heroLocation ? (
                        <span className="inline-flex items-center gap-1.5 truncate">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{heroLocation}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <div className="relative h-[72px] w-[72px]">
                    <svg viewBox="0 0 72 72" className="h-[72px] w-[72px] -rotate-90">
                      <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="7" />
                      <circle cx="36" cy="36" r="30" fill="none" stroke="#5dcaa5" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(readiness.pct / 100) * 188.5} 188.5`} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-black leading-none">{readiness.pct}%</span>
                      <span className="text-[10px] text-cyan-50/60">{readiness.done}/{readiness.total}</span>
                    </div>
                  </div>
                  <div className="hidden max-w-[150px] sm:block">
                    <p className="text-[11px] font-black uppercase tracking-wide text-cyan-100">{readiness.pct === 100 ? "Ready to publish" : "Almost there"}</p>
                    <p className="mt-1 text-sm leading-5 text-cyan-50/85">{nextStep ? `Next: ${nextStep.label.toLowerCase()}` : "All sections complete."}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div className="grid grid-cols-3 gap-2">
                  {heroStats.map((stat) => {
                    const pct = Math.min(100, Math.round((stat.count / stat.target) * 100));
                    const reached = stat.count >= stat.target;
                    return (
                      <div key={stat.label} className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-3">
                        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-cyan-100/80">
                          <span>{stat.label}</span>
                          <span>{stat.count}/{stat.target}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
                          <div className="h-full rounded-full bg-[#5dcaa5]" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-2 text-[11px] text-cyan-50/55">{reached ? "Complete" : `Add ${stat.target - stat.count} more`}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 gap-2 min-[430px]:grid-cols-2 lg:w-64 lg:grid-cols-1">
                  <Link href="/account/agent/profile/preview" className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-slate-900 no-underline hover:bg-cyan-50">
                    <Eye className="h-4 w-4" />
                    <span className="truncate">Preview as customer</span>
                  </Link>
                  <Link href="/account/agent/card" className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] px-3 text-sm font-black text-white no-underline hover:bg-white/15">
                    <Eye className="h-4 w-4" />
                    <span className="truncate">Marketplace card</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Profile status</p>

            <div className={`mt-3 flex items-start gap-3 rounded-xl border p-3 ${statusMeta.tone}`}>
              <span className="mt-0.5 shrink-0">{statusMeta.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-black">{statusMeta.title}</p>
                <p className="mt-0.5 text-xs leading-5 opacity-80">{statusMeta.subtitle}</p>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-500">Readiness</span>
                <span className="text-slate-900">{readiness.done}/{readiness.total} · {readiness.pct}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${readiness.pct}%` }} />
              </div>
            </div>

            {readiness.done < readiness.total ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Still to complete</p>
                <div className="mt-2.5 space-y-2">
                  {readiness.steps.filter((step) => !step.done).map((step) => (
                    <div key={step.label} className="flex items-center gap-2 text-sm">
                      <span className="h-4 w-4 shrink-0 rounded-full border border-slate-300" />
                      <span className="font-semibold text-slate-800">{step.label}</span>
                    </div>
                  ))}
                </div>
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

        <div className="mt-5 space-y-5">
          <Section icon={<Users className="h-5 w-5" />} title="Contact Person Information" text="Your personal details as the primary contact for this operator profile.">
            <FieldGrid>
              <Field label="Full Name *">
                <Input value={profile.contactPersonName ?? ""} onChange={(e) => update("contactPersonName", e.target.value)} placeholder="John Doe" />
              </Field>
              <Field label="Email *">
                <Input value={profile.contactPersonEmail ?? ""} onChange={(e) => update("contactPersonEmail", e.target.value)} placeholder="john@example.com" type="email" />
              </Field>
              <Field label="Phone *">
                <Input value={profile.contactPersonPhone ?? ""} onChange={(e) => update("contactPersonPhone", e.target.value)} placeholder="+255..." />
              </Field>
              <Field label="Nationality *">
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

          <Section icon={<Building2 className="h-5 w-5" />} title="Partnership Company Information" text="Business details customers see before selecting an operator.">
            <div className="grid w-full max-w-[828px] grid-cols-1 gap-3 overflow-hidden md:grid-cols-2">
              <Field label="Company Name *">
                <Input value={profile.companyName} onChange={(e) => update("companyName", e.target.value)} placeholder="India Camel" />
              </Field>
              <Field label="Company Email (Optional)">
                <Input value={profile.companyEmail ?? ""} onChange={(e) => update("companyEmail", e.target.value)} placeholder="company@example.com" type="email" />
              </Field>
              <Field label="Company Phone *">
                <Input value={profile.companyPhone ?? ""} onChange={(e) => update("companyPhone", e.target.value)} placeholder="+255..." />
              </Field>
              <Field label="Company Website">
                <Input value={profile.companyWebsite ?? ""} onChange={(e) => update("companyWebsite", e.target.value)} placeholder="https://example.com" />
              </Field>
              <Field label="Business Address *">
                <Input value={profile.businessAddress} onChange={(e) => update("businessAddress", e.target.value)} placeholder="Registered business address" />
              </Field>
              <Field label="Years in Operation">
                <Input
                  type="number"
                  min="0"
                  value={profile.yearsInOperation ?? ""}
                  onChange={(e) => update("yearsInOperation", e.target.value === "" ? undefined : Number(e.target.value))}
                  placeholder="e.g. 5"
                />
              </Field>
              <Field label="Team Size *">
                <Input
                  type="number"
                  min="0"
                  value={profile.teamSize ?? ""}
                  onChange={(e) => update("teamSize", e.target.value === "" ? undefined : Number(e.target.value))}
                  placeholder="e.g. 20"
                />
              </Field>
              <Field label="Languages (Speak / Read / Write) *">
                <Input value={profile.languages ?? ""} onChange={(e) => update("languages", e.target.value)} placeholder="English, Swahili" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Describe your company and your team *">
                <Textarea value={profile.description} onChange={(e) => update("description", e.target.value)} placeholder="Briefly explain your operator style, experience, and service promise." />
              </Field>
            </div>
          </Section>

          <Section icon={<ShieldCheck className="h-5 w-5" />} title="Compliance And Company Records" text="Review and complete legal and permit details imported from the partnership application.">
            <FieldGrid>
              <Field label="Business registration number">
                <Input value={profile.businessRegistrationNumber ?? ""} onChange={(e) => update("businessRegistrationNumber", e.target.value)} placeholder="Registration number" />
              </Field>
              <Field label="TIN number">
                <Input value={profile.tinNumber ?? ""} onChange={(e) => update("tinNumber", e.target.value)} placeholder="TIN" />
              </Field>
              <Field label="Business license number">
                <Input value={profile.businessLicenseNumber ?? ""} onChange={(e) => update("businessLicenseNumber", e.target.value)} placeholder="Business license" />
              </Field>
              <Field label="Tourism permit number">
                <Input value={profile.tourismPermitNumber ?? ""} onChange={(e) => update("tourismPermitNumber", e.target.value)} placeholder="Tourism permit" />
              </Field>
              <Field label="Vehicle permit number">
                <Input value={profile.vehiclePermitNumber ?? ""} onChange={(e) => update("vehiclePermitNumber", e.target.value)} placeholder="Vehicle permit" />
              </Field>
              <Field label="Years in operation">
                <Input
                  type="number"
                  min="0"
                  value={profile.yearsInOperation ?? ""}
                  onChange={(e) => update("yearsInOperation", e.target.value === "" ? undefined : Number(e.target.value))}
                  placeholder="e.g. 5"
                />
              </Field>
              <Field label="Team size *">
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

          <Section icon={<Globe className="h-5 w-5" />} title="Tourism Serving" text="Classify the tourism types you serve, your categorised services, and your specializations.">
            {/* Tourism Types */}
            <div className="mb-5">
              <p className="mb-2 text-sm font-black text-slate-800">Tourism Types <span className="text-red-500">*</span></p>
              <p className="mb-3 text-xs text-slate-500">Select the tourism categories your company serves.</p>
              <div className="flex items-end gap-2">
                <Select value={tourismTypeInput} onChange={(e) => setTourismTypeInput(e.target.value)}>
                  <option value="">Select tourism type</option>
                  {tourismTypes.filter((t) => !profile.tourismTypes.includes(t)).map((type) => <option key={type} value={type}>{type}</option>)}
                </Select>
                <button
                  type="button"
                  disabled={!tourismTypeInput}
                  onClick={() => {
                    if (!tourismTypeInput || profile.tourismTypes.includes(tourismTypeInput)) return;
                    update("tourismTypes", [...profile.tourismTypes, tourismTypeInput]);
                    setTourismTypeInput("");
                  }}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
              {profile.tourismTypes.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {profile.tourismTypes.map((item) => (
                    <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 py-1.5 pl-3.5 pr-1.5 text-sm font-semibold text-emerald-800">
                      {item}
                      <button type="button" onClick={() => toggleTourismType(item)} aria-label={`Remove ${item}`} className="flex h-5 w-5 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-200/70 hover:text-emerald-900">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Company Services */}
            <div className="mb-5 border-t border-slate-100 pt-5">
              <p className="mb-2 text-sm font-black text-slate-800">Your Company Services <span className="text-red-500">*</span></p>
              <p className="mb-3 text-xs text-slate-500">Services are classified by category. Choose a tourism type (or common services), then choose the matching service.</p>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 sm:p-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <Field label="Service category">
                    <Select
                      value={serviceCategoryInput}
                      onChange={(e) => { setServiceCategoryInput(e.target.value); setPartnershipServiceInput(""); }}
                    >
                      <option value="">Select category…</option>
                      <option value="COMMON">Common Services</option>
                      {profile.tourismTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Service">
                    <Select
                      value={partnershipServiceInput}
                      onChange={(e) => setPartnershipServiceInput(e.target.value)}
                      disabled={!serviceCategoryInput}
                    >
                      <option value="">Select service…</option>
                      {serviceOptionsForCategory.map((s) => (
                        <option key={s} value={s} disabled={profile.services.includes(s)}>{s}</option>
                      ))}
                    </Select>
                  </Field>
                  <button
                    type="button"
                    onClick={addClassifiedService}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-black text-white shadow-sm hover:bg-emerald-800"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </div>
              {profile.services.length > 0 && (
                <div className="mt-5 space-y-5">
                  {Object.entries(profile.serviceClassification ?? {}).map(([category, catServices]) =>
                    catServices.length > 0 ? (
                      <div key={category}>
                        <p className="mb-2.5 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                          {category}
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{catServices.length}</span>
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {catServices.map((svc) => (
                            <div key={svc} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-colors hover:border-slate-300">
                              <span className="truncate font-medium text-slate-700">{svc}</span>
                              <button type="button" onClick={() => removeClassifiedService(svc)} aria-label={`Remove ${svc}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null
                  )}
                  {(() => {
                    const classified = new Set(Object.values(profile.serviceClassification ?? {}).flat());
                    const unclassified = profile.services.filter((s) => !classified.has(s));
                    if (unclassified.length === 0) return null;
                    return (
                      <div>
                        <p className="mb-2.5 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                          Uncategorized
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{unclassified.length}</span>
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {unclassified.map((svc) => (
                            <div key={svc} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-colors hover:border-slate-300">
                              <span className="truncate font-medium text-slate-700">{svc}</span>
                              <button type="button" onClick={() => removeClassifiedService(svc)} aria-label={`Remove ${svc}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Specializations */}
            <div className="border-t border-slate-100 pt-5">
              <p className="mb-2 text-sm font-black text-slate-800">Specializations <span className="text-red-500">*</span></p>
              <p className="mb-3 text-xs text-slate-500">Select the areas your company specializes in.</p>
              <div className="flex items-end gap-2">
                <Select value={specializationInput} onChange={(e) => setSpecializationInput(e.target.value)}>
                  <option value="">Select specialization</option>
                  {AGENT_SPECIALIZATIONS.filter((s) => !profile.specializations.includes(s)).map((spec) => <option key={spec} value={spec}>{spec}</option>)}
                </Select>
                <button
                  type="button"
                  disabled={!specializationInput}
                  onClick={() => {
                    if (!specializationInput || profile.specializations.includes(specializationInput)) return;
                    update("specializations", [...profile.specializations, specializationInput]);
                    setSpecializationInput("");
                  }}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
              {profile.specializations.length > 0 && (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {profile.specializations.map((spec) => (
                    <div key={spec} className="inline-flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm">
                      <span className="font-medium text-slate-900">{spec}</span>
                      <button type="button" onClick={() => toggleSpecialization(spec)} className="shrink-0 text-slate-400 hover:text-red-600 transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          <Section icon={<MapPin className="h-5 w-5" />} title="Area Of Operation" text="Set your company base and district before selecting permitted parks and sites.">
            <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-3 sm:p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <Field label="Region *">
                  <Select value={region} onChange={(e) => { setRegion(e.target.value); setDistrict(""); }}>
                    <option value="">Select region</option>
                    {REGIONS.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </Select>
                </Field>
                <Field label="District *">
                  <Select value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!selectedRegion}>
                    <option value="">Select district</option>
                    {selectedRegion?.districts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Field>
                <button type="button" onClick={addArea} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-black text-white shadow-sm hover:bg-emerald-800">
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
            </div>

            {profile.operatingRegions.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {profile.operatingRegions.map((area) => (
                  <span key={area} className={`inline-flex items-center justify-between gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800${area.length > 22 ? " col-span-2" : ""}`}>
                    <span className="truncate">{area}</span>
                    <button type="button" onClick={() => update("operatingRegions", profile.operatingRegions.filter((x) => x !== area))} className="shrink-0 hover:text-red-600">
                      <XCircle className="h-4 w-4" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="mb-1 text-sm font-black text-slate-800">Permitted Parks &amp; Tour Sites <span className="text-red-500">*</span></p>
              <p className="mb-3 text-xs text-slate-500">Select all parks and tour sites your company is permitted to operate in.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={parkInput}
                  onChange={(e) => setParkInput(e.target.value)}
                  disabled={tourismSitesLoading}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="">{tourismSitesLoading ? "Loading..." : "Select a permitted park or tour site"}</option>
                  {tourismSites
                    .filter((s) => !(profile.registeredParks ?? []).includes(s.name))
                    .map((s) => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!parkInput}
                  onClick={() => {
                    if (!parkInput || (profile.registeredParks ?? []).includes(parkInput)) return;
                    update("registeredParks", [...(profile.registeredParks ?? []), parkInput]);
                    setParkInput("");
                  }}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
              {(profile.registeredParks ?? []).length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(profile.registeredParks ?? []).map((park) => (
                    <span key={park} className={`inline-flex items-center justify-between gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800${park.length > 22 ? " col-span-2" : ""}`}>
                      <span className="truncate">{park}</span>
                      <button type="button" onClick={() => update("registeredParks", (profile.registeredParks ?? []).filter((x) => x !== park))} className="shrink-0 hover:text-red-600">
                        <XCircle className="h-4 w-4" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Section>

          <Section icon={<Wrench className="h-5 w-5" />} title="Tools &amp; Assets" text="Tell us what you use to support your tours and activities.">
            <p className="mb-2 text-sm font-black text-slate-800">Tools &amp; Assets <span className="text-red-500">*</span></p>
            <p className="mb-3 text-xs text-slate-500">Add at least one tool or asset your company uses for tour delivery.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={customTool}
                onChange={(e) => setCustomTool(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="">Select tool or asset</option>
                {toolOptions
                  .filter((item) => !profile.tools.includes(item))
                  .map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!customTool}
                onClick={() => { addCustom("tools", customTool, setCustomTool); }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>
            {profile.tools.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {profile.tools.map((tool) => (
                  <span key={tool} className={`inline-flex items-center justify-between gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700${tool.length > 22 ? " col-span-2" : ""}`}>
                    <span className="truncate">{tool}</span>
                    <button type="button" onClick={() => update("tools", profile.tools.filter((x) => x !== tool))} className="shrink-0 hover:text-red-600">
                      <XCircle className="h-4 w-4" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="mt-7 border-t border-slate-100 pt-5">
              <h3 className="flex flex-wrap items-center gap-2 text-base font-black text-slate-950">
                <span>Fleet &amp; Vehicles <span className="text-red-500">*</span></span>
                {profile.vehicles.length > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                    <Check className="h-3 w-3" />
                    {profile.vehicles.length} added
                  </span>
                ) : null}
              </h3>
              <div className="mt-3 flex items-center gap-4">
                <span className="text-sm text-slate-700">Does your company have vehicles for tours? <span className="text-red-500">*</span></span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => update("hasVehicles", true)}
                    className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${profile.hasVehicles ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-emerald-700"}`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => { update("hasVehicles", false); update("vehicles", []); }}
                    className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${!profile.hasVehicles ? "border-slate-300 bg-slate-200 text-slate-700" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}
                  >
                    No
                  </button>
                </div>
              </div>
            </div>

            {profile.hasVehicles && (
            <>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vehicle Type <span className="text-red-500">*</span></label>
                  <Select value={vehicleInput.type} onChange={(e) => setVehicleInput({ ...vehicleInput, type: e.target.value })}>
                    <option value="">Select type</option>
                    {vehicleTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Ownership <span className="text-red-500">*</span></label>
                  <Select value={vehicleInput.ownedBy} onChange={(e) => setVehicleInput({ ...vehicleInput, ownedBy: e.target.value })}>
                    <option value="">Select ownership</option>
                    <option value="Company owned">Company owned</option>
                    <option value="Partner owned">Partner owned</option>
                    <option value="Rented on demand">Rented on demand</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Number of Vehicles <span className="text-red-500">*</span></label>
                  <Input type="number" min="1" value={vehicleInput.quantity} onChange={(e) => setVehicleInput({ ...vehicleInput, quantity: e.target.value })} placeholder="e.g. 3" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Capacity per Vehicle (people) <span className="text-red-500">*</span></label>
                  <Input type="number" min="1" value={vehicleInput.seatsPerVehicle} onChange={(e) => setVehicleInput({ ...vehicleInput, seatsPerVehicle: e.target.value })} placeholder="e.g. 7" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Condition / Notes <span className="text-slate-400">(optional)</span></label>
                  <Textarea value={vehicleInput.notes} onChange={(e) => setVehicleInput({ ...vehicleInput, notes: e.target.value })} placeholder="e.g. 2022 model, well-maintained, roof hatch" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Registration Number</label>
                  <Input value={vehicleInput.registrationNumber} onChange={(e) => setVehicleInput({ ...vehicleInput, registrationNumber: e.target.value })} placeholder="e.g. T123 ABC" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Service Mode</label>
                  <Select value={vehicleInput.serviceMode} onChange={(e) => setVehicleInput({ ...vehicleInput, serviceMode: e.target.value })}>
                    <option value="">Select mode</option>
                    {VEHICLE_SERVICE_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </Select>
                </div>
              </div>
              <button type="button" onClick={addVehicle} disabled={!vehicleInput.type || !vehicleInput.quantity || !vehicleInput.seatsPerVehicle} className="w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed">
                Add Vehicle
              </button>
            </div>

            {profile.vehicles.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">Added vehicles ({profile.vehicles.length})</p>
                <div className="space-y-2">
                  {profile.vehicles.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900">{v.type}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {v.quantity} vehicle{v.quantity !== "1" ? "s" : ""} · {v.seatsPerVehicle} seat{v.seatsPerVehicle !== "1" ? "s" : ""} each · {v.ownedBy}
                          {v.registrationNumber ? ` · Reg: ${v.registrationNumber}` : ""}
                          {v.serviceMode ? ` · Mode: ${v.serviceMode}` : ""}
                          {v.notes ? ` · ${v.notes}` : ""}
                        </div>
                      </div>
                      <button type="button" onClick={() => update("vehicles", profile.vehicles.filter((x) => x.id !== v.id))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600" aria-label="Remove vehicle">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </>
            )}
          </Section>

          <Section icon={<Users className="h-5 w-5" />} title="Operating Capacity" text="Make availability and execution capacity clear before customers book.">
            <FieldGrid>
              <Field label="Max trips per day">
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

          <Section icon={<BriefcaseBusiness className="h-5 w-5" />} title="Packages And Pricing" text="Add tour packages, seasonal pricing, and add-ons.">
            <div className="mt-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xl font-black text-slate-950 sm:text-2xl">Tour packages</h3>
                <button type="button" onClick={addPackage} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#02665e] px-4 text-sm font-black text-white shadow-sm hover:bg-[#01544d]">
                  <PackagePlus className="h-4 w-4" />
                  Add package
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
                  <span className="font-black text-slate-900">{profile.packageItems.length}</span>
                  <span className="text-slate-500">packages</span>
                </span>
                <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
                  <span className="font-black text-slate-900">{profile.seasonalPrices.length}</span>
                  <span className="text-slate-500">seasons</span>
                </span>
                <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
                  <span className="font-black text-slate-900">{profile.addOns.length}</span>
                  <span className="text-slate-500">add-ons</span>
                </span>
              </div>
              <div className="mt-5 space-y-4">
                {profile.packageItems.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-emerald-300 bg-white p-5 text-center">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                      <PackagePlus className="h-7 w-7" />
                    </span>
                    <p className="mt-3 text-base font-black text-slate-950">No commercial package yet</p>
                    <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">Start with the package that has the strongest booking potential. Price, route, capacity, inclusions, and itinerary will appear here.</p>
                    <button type="button" onClick={addPackage} className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white shadow-sm hover:bg-emerald-800">
                  <PackagePlus className="h-4 w-4" />
                      Create first package
                    </button>
                  </div>
                )}
              {profile.packageItems.map((pkg, index) => {
                const includedSuggestions = packageIncludedSuggestions(pkg, profile.tourismTypes);
                const excludedSuggestions = packageExcludedSuggestions(includedSuggestions);
                const isExpanded = expandedPackageIds[pkg.id] ?? false;
                const isComplete = packageLooksComplete(pkg);
                const step = packageStep[pkg.id] ?? 1;
                const setStep = (s: number) => setPackageStep((m) => ({ ...m, [pkg.id]: Math.max(1, Math.min(4, s)) }));
                if (anyPackageExpanded && !isExpanded) return null;
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
                <div key={pkg.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="bg-[#02665e] px-4 py-4 text-white sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-cyan-100">Package {index + 1}</p>
                        <h4 className="mt-1 truncate text-lg font-black text-white">{pkg.name || "Untitled package"}</h4>
                        <p className="mt-1 truncate text-xs font-semibold text-cyan-50/75">{pkg.destination || "Destination not set"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                          isComplete
                            ? "border-emerald-200 bg-emerald-100/90 text-emerald-900"
                            : "border-amber-200 bg-amber-100/90 text-amber-900"
                        }`}>
                          {isComplete ? "Complete" : "Incomplete"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setExpandedPackageIds((prev) => ({ ...prev, [pkg.id]: !isExpanded }))}
                          className="inline-flex h-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-black text-white hover:bg-white/20"
                        >
                          {isExpanded ? "Done" : "Edit"}
                        </button>
                        <button type="button" onClick={() => removePackage(pkg.id)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white hover:bg-red-500/80" aria-label="Remove package">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-cyan-100/80">Price</p>
                        <p className="mt-1 truncate text-sm font-black text-white">{pkg.pricePerPerson ? `${pkg.currency} ${pkg.pricePerPerson}` : "Not set"}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-cyan-100/80">Duration</p>
                        <p className="mt-1 truncate text-sm font-black text-white">{pkg.duration || "Not set"}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-cyan-100/80">Mode</p>
                        <p className="mt-1 truncate text-sm font-black text-white">{pkg.mode || "Not set"}</p>
                      </div>
                    </div>
                  </div>
                  {isExpanded ? (
                  <div className="p-4 sm:p-5">
                    <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {packageStepDefs.map((s) => (
                        <button
                          key={s.n}
                          type="button"
                          onClick={() => setStep(s.n)}
                          className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${step === s.n ? "border-[#02665e] bg-[#02665e] text-white" : step > s.n ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
                        >
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step === s.n ? "bg-white/20 text-white" : step > s.n ? "bg-emerald-200 text-emerald-900" : "bg-slate-100 text-slate-500"}`}>{step > s.n ? "✓" : s.n}</span>
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    {step === 1 && (
                    <div>
                      <h4 className="text-lg font-black text-slate-900">The basics</h4>
                      <p className="mt-1 text-sm leading-6 text-slate-500">Name this package and where it goes, then add a short summary customers see first.</p>
                    <FieldGrid>
                    <Field label="Package name *"><Input value={pkg.name} onChange={(e) => patchPackage(pkg.id, { name: e.target.value })} placeholder="Serengeti classic safari" /></Field>
                    <Field label="Destination *"><Input value={pkg.destination} onChange={(e) => patchPackage(pkg.id, { destination: e.target.value })} placeholder="Serengeti, Ngorongoro" /></Field>
                  </FieldGrid>
                  <div className="mt-3">
                    <Field label="Short description *">
                      <Textarea value={pkg.description} onChange={(e) => patchPackage(pkg.id, { description: e.target.value })} placeholder="A brief marketing overview of this package that customers will see first." />
                    </Field>
                  </div>
                    </div>
                    )}

                    {step === 2 && (
                    <div>
                      <h4 className="text-lg font-black text-slate-900">Pricing &amp; tour details</h4>
                      <p className="mt-1 text-sm leading-6 text-slate-500">Tell customers how this trip runs and what it costs. Set its type, length, group size, price, and what the price includes.</p>
                  <FieldGrid className="mt-4">
                    <Field label="Tour category *">
                      <Select value={pkg.category} onChange={(e) => patchPackage(pkg.id, { category: e.target.value })}>
                        <option value="">Select category</option>
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
                    <Field label="Difficulty level">
                      <Segmented value={pkg.difficulty} onChange={(v) => patchPackage(pkg.id, { difficulty: v })} options={[{ value: "Easy", label: "Easy" }, { value: "Moderate", label: "Moderate" }, { value: "Challenging", label: "Challenging" }, { value: "Extreme", label: "Extreme" }]} />
                    </Field>
                    <Field label="Duration *"><Input value={pkg.duration} onChange={(e) => patchPackage(pkg.id, { duration: e.target.value })} placeholder="3 days / 2 nights" /></Field>
                    <Field label="Booking mode *"><Segmented value={pkg.mode} onChange={(v) => patchPackage(pkg.id, { mode: v })} options={[{ value: "Private", label: "Private" }, { value: "Shared", label: "Shared" }, { value: "Private and shared", label: "Both" }]} /></Field>
                    <Field label="Min group size (pax) *"><Input type="number" min="1" value={pkg.minPax} onChange={(e) => patchPackage(pkg.id, { minPax: e.target.value })} placeholder="1" /></Field>
                    <Field label="Max group size (pax) *"><Input type="number" min="1" value={pkg.maxPax} onChange={(e) => patchPackage(pkg.id, { maxPax: e.target.value })} placeholder="12" /></Field>
                    <Field label="Price per person *"><Input type="number" min="0" value={pkg.pricePerPerson} onChange={(e) => patchPackage(pkg.id, { pricePerPerson: e.target.value })} placeholder="450" /></Field>
                    <Field label="Currency *"><Segmented value={pkg.currency} onChange={(v) => patchPackage(pkg.id, { currency: v })} options={[{ value: "USD", label: "USD" }, { value: "TZS", label: "TZS" }, { value: "EUR", label: "EUR" }]} /></Field>
                    <Field label="Accommodation">
                      <Select value={pkg.accommodation} onChange={(e) => patchPackage(pkg.id, { accommodation: e.target.value })}>
                        <option value="">Select accommodation</option>
                        <option>Camping / Tented camp</option>
                        <option>Budget hotel</option>
                        <option>Mid-range hotel</option>
                        <option>Luxury lodge</option>
                        <option>Mixed (budget &amp; mid-range)</option>
                        <option>Mixed (mid-range &amp; luxury)</option>
                        <option>Not included</option>
                      </Select>
                    </Field>
                    <Field label="Meal plan">
                      <Select value={pkg.mealPlan} onChange={(e) => patchPackage(pkg.id, { mealPlan: e.target.value })}>
                        <option value="">Select meal plan</option>
                        <option>None (self-catered)</option>
                        <option>Breakfast only</option>
                        <option>Half board (B&amp;D)</option>
                        <option>Full board (B, L &amp; D)</option>
                        <option>All-inclusive</option>
                      </Select>
                    </Field>
                  </FieldGrid>
                  <div className="mt-3">
                    <Field label="Meeting / departure point"><Input value={pkg.meetingPoint} onChange={(e) => patchPackage(pkg.id, { meetingPoint: e.target.value })} placeholder="Arusha town centre or hotel pick-up" /></Field>
                  </div>
                  <div className="mt-6">
                    <h4 className="text-base font-black text-slate-900">Discount <span className="text-sm font-semibold text-slate-400">(optional)</span></h4>
                    <p className="mt-1 text-sm leading-6 text-slate-500">Add a price reduction only when there is a clear reason. Set what triggers it, the amount, and who qualifies.</p>
                    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                      Example: large group, USD 50 off when 6 or more travelers book together.
                    </div>
                    <FieldGrid className="mt-4">
                      <Field label="Discount trigger">
                        <Select value={pkg.discountFactor} onChange={(e) => patchPackage(pkg.id, { discountFactor: e.target.value })}>
                          <option value="">No discount defined</option>
                          <option>Early booking</option>
                          <option>Large group size</option>
                          <option>Low season</option>
                          <option>Promotional campaign</option>
                          <option>Returning customer</option>
                          <option>Custom</option>
                        </Select>
                      </Field>
                      <Field label="Discount method">
                        <Select value={pkg.discountType} onChange={(e) => patchPackage(pkg.id, { discountType: e.target.value })}>
                          <option value="">Select type</option>
                          <option>Percentage</option>
                          <option>Fixed amount</option>
                        </Select>
                      </Field>
                      <Field label="Discount amount">
                        <Input value={pkg.discountValue} onChange={(e) => patchPackage(pkg.id, { discountValue: e.target.value })} placeholder={pkg.discountType === "Fixed amount" ? "e.g. 50" : "e.g. 10"} />
                      </Field>
                      <Field label="Qualification unit">
                        <Select value={pkg.discountUnit} onChange={(e) => patchPackage(pkg.id, { discountUnit: e.target.value })}>
                          <option value="">Select unit (who/what)</option>
                          <option>Travelers</option>
                          <option>Days before travel</option>
                          <option>Completed previous bookings</option>
                          <option>Bookings</option>
                          <option>Nights</option>
                        </Select>
                      </Field>
                      <Field label="Qualification rule">
                        <Input value={pkg.discountCondition} onChange={(e) => patchPackage(pkg.id, { discountCondition: e.target.value })} placeholder="e.g. 6" />
                      </Field>
                    </FieldGrid>
                    {pkg.discountFactor && pkg.discountType && pkg.discountValue ? (
                      <div className="mt-4 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
                        <div className="bg-emerald-50/70 px-3 py-2">
                          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">Live discount preview</p>
                        </div>
                        <div className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-700">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{pkg.discountFactor}</span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{pkg.discountType === "Fixed amount" ? `${pkg.currency} ${pkg.discountValue} off` : `${pkg.discountValue}% off`}</span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{discountConditionText ? `When: ${discountConditionText}` : "Condition required"}</span>
                          </div>
                          <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                            Customers qualify for <span className="font-black text-slate-950">{pkg.discountType === "Fixed amount" ? `${pkg.currency} ${pkg.discountValue} off` : `${pkg.discountValue}% off`}</span> on this package
                            {discountConditionText ? <span>{` when ${discountConditionText}`}</span> : <span> once the qualification rule is met</span>}.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                    </div>
                    )}

                    {step === 3 && (
                    <div>
                      <h4 className="text-lg font-black text-slate-900">What's included</h4>
                      <p className="mt-1 text-sm leading-6 text-slate-500">List what the price covers and what it does not, so customers know exactly what they get.</p>
                  <FieldGrid className="mt-3">
                    <Field label="Included *">
                      <div className="space-y-2">
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <Select
                            value={includedDrafts[pkg.id] ?? ""}
                            onChange={(e) => setIncludedDrafts((drafts) => ({ ...drafts, [pkg.id]: e.target.value }))}
                          >
                            <option value="">Choose from common services</option>
                            {includedSuggestions.map((item) => (
                              <option key={`inc-${pkg.id}-${item}`} value={item} disabled={pkg.included.includes(item)}>
                                {item}
                              </option>
                            ))}
                          </Select>
                          <button
                            type="button"
                            onClick={() => addPackageListItem(pkg.id, "included")}
                            className="mt-1 rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                          >
                            Add
                          </button>
                        </div>
                        <Input
                          value={includedDrafts[pkg.id] ?? ""}
                          onChange={(e) => setIncludedDrafts((drafts) => ({ ...drafts, [pkg.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addPackageListItem(pkg.id, "included");
                            }
                          }}
                          placeholder="Or type custom service"
                        />
                      </div>
                      {pkg.included.length > 0 ? (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {pkg.included.map((item) => (
                            <SelectedPill key={item} label={item} onRemove={() => removePackageListItem(pkg.id, "included", item)} />
                          ))}
                        </div>
                      ) : null}
                    </Field>
                    <Field label="Not included">
                      <div className="space-y-2">
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <Select
                            value={excludedDrafts[pkg.id] ?? ""}
                            onChange={(e) => setExcludedDrafts((drafts) => ({ ...drafts, [pkg.id]: e.target.value }))}
                          >
                            <option value="">Choose common exclusions</option>
                            {excludedSuggestions.map((item) => (
                              <option key={`exc-${pkg.id}-${item}`} value={item} disabled={pkg.excluded.includes(item)}>
                                {item}
                              </option>
                            ))}
                          </Select>
                          <button
                            type="button"
                            onClick={() => addPackageListItem(pkg.id, "excluded")}
                            className="mt-1 rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                          >
                            Add
                          </button>
                        </div>
                        <Input
                          value={excludedDrafts[pkg.id] ?? ""}
                          onChange={(e) => setExcludedDrafts((drafts) => ({ ...drafts, [pkg.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addPackageListItem(pkg.id, "excluded");
                            }
                          }}
                          placeholder="Or type custom exclusion"
                        />
                      </div>
                      {pkg.excluded.length > 0 ? (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {pkg.excluded.map((item) => (
                            <SelectedPill key={item} label={item} onRemove={() => removePackageListItem(pkg.id, "excluded", item)} />
                          ))}
                        </div>
                      ) : null}
                    </Field>
                  </FieldGrid>
                  <div className="mt-3">
                    <Field label="Package notes">
                      <Textarea value={pkg.notes} onChange={(e) => patchPackage(pkg.id, { notes: e.target.value })} placeholder="Booking conditions, route notes, or extra customer guidance." />
                    </Field>
                  </div>
                    </div>
                    )}

                    {step === 4 && (
                  <div>
                    <h4 className="text-lg font-black text-slate-900">Day-by-day plan <span className="text-red-500">*</span></h4>
                    <p className="mt-1 mb-3 text-sm leading-6 text-slate-500">Lay out each day with its activities and times so travelers know what to expect.</p>
                    {pkg.itinerary.length > 0 && (
                      <div className="mb-3 space-y-3">
                        {pkg.itinerary.map((day) => (
                          <div key={day.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                            <div className="mb-3 flex items-center gap-2">
                              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#02665e] text-xs font-black text-white">{day.day}</span>
                              <Input
                                className="flex-1"
                                value={day.title}
                                onChange={(e) => patchItineraryDay(pkg.id, day.id, { title: e.target.value })}
                                placeholder={`Day ${day.day} title, e.g. Arrive Arusha`}
                              />
                              <button type="button" onClick={() => removeItineraryDay(pkg.id, day.id)} className="shrink-0 text-slate-400 hover:text-red-600" aria-label="Remove day">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <Textarea
                              value={day.description}
                              onChange={(e) => patchItineraryDay(pkg.id, day.id, { description: e.target.value })}
                              placeholder="Describe the day in general."
                            />
                            <div className="mt-2">
                              <Field label="Timetable events *">
                                <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-500">
                                  Add each activity with a time range. Example: 07:00 to 08:00, breakfast at lodge.
                                </div>
                                <div className="space-y-2">
                                  <div key={`${day.id}-header`} className="hidden sm:grid sm:grid-cols-[116px_116px_minmax(0,1fr)_130px_auto] sm:items-center sm:px-1">
                                    <span className="text-[11px] font-semibold text-slate-500">From time</span>
                                    <span className="text-[11px] font-semibold text-slate-500">To time</span>
                                    <span className="text-[11px] font-semibold text-slate-500">Event details</span>
                                    <span className="text-[11px] font-semibold text-slate-500">Experience Vibe</span>
                                    <span className="text-[11px] font-semibold text-slate-500">Remove</span>
                                  </div>
                                  {(day.events || []).map((evt) => {
                                    const isExpanded = expandedEventIds[evt.id] ?? true;
                                    const hasData = !!(evt.startTime && evt.endTime && evt.activity);
                                    
                                    return isExpanded ? (
                                      <div key={evt.id} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-[116px_116px_minmax(0,1fr)_130px_auto] sm:items-center">
                                        <div className="col-span-1 space-y-1">
                                          <p className="text-[11px] font-semibold text-slate-500 sm:hidden">From time</p>
                                          <Input
                                            type="time"
                                            value={evt.startTime}
                                            onChange={(e) => patchItineraryEvent(pkg.id, day.id, evt.id, { startTime: e.target.value })}
                                            placeholder="From"
                                            aria-label={`Day ${day.day} event start time`}
                                          />
                                        </div>
                                        <div className="col-span-1 space-y-1">
                                          <p className="text-[11px] font-semibold text-slate-500 sm:hidden">To time</p>
                                          <Input
                                            type="time"
                                            value={evt.endTime}
                                            onChange={(e) => patchItineraryEvent(pkg.id, day.id, evt.id, { endTime: e.target.value })}
                                            placeholder="To"
                                            aria-label={`Day ${day.day} event end time`}
                                          />
                                        </div>
                                        <div className="col-span-2 space-y-1 sm:col-span-1">
                                          <p className="text-[11px] font-semibold text-slate-500 sm:hidden">Event details</p>
                                          <Input
                                            value={evt.activity}
                                            onChange={(e) => patchItineraryEvent(pkg.id, day.id, evt.id, { activity: e.target.value })}
                                            placeholder="Event / activity (e.g. Breakfast at lodge)"
                                            aria-label={`Day ${day.day} event activity`}
                                          />
                                        </div>
                                        <div className="col-span-2 space-y-1 sm:col-span-1">
                                          <p className="text-[11px] font-semibold text-slate-500 sm:hidden">Experience Vibe</p>
                                          <Select
                                            value={evt.difficulty}
                                            onChange={(e) => patchItineraryEvent(pkg.id, day.id, evt.id, { difficulty: e.target.value as ItineraryEvent["difficulty"] })}
                                          aria-label={`Day ${day.day} experience vibe`}
                                        >
                                            <option value="">Select vibe</option>
                                            <option value="Easy">Easy</option>
                                            <option value="Normal">Normal</option>
                                            <option value="Difficult">Difficult</option>
                                            <option value="Funny">Funny</option>
                                            <option value="Delicious">Delicious</option>
                                          </Select>
                                        </div>
                                        <div className="col-span-2 flex justify-end gap-1 sm:col-span-1 sm:justify-center">
                                          {hasData && (
                                            <button
                                              type="button"
                                              onClick={() => setExpandedEventIds((prev) => ({ ...prev, [evt.id]: false }))}
                                              className="inline-flex h-9 w-10 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-white hover:text-slate-700 sm:w-full text-xs"
                                              aria-label="Collapse event"
                                              title="Collapse"
                                            >
                                              ✓
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => removeItineraryEvent(pkg.id, day.id, evt.id)}
                                            className="inline-flex h-9 w-10 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-white hover:text-red-600 sm:w-full"
                                            aria-label="Remove event"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <Fragment key={evt.id}>
                                        {/* Mobile view */}
                                        <div
                                          className="sm:hidden col-span-full cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-3"
                                        >
                                          <button
                                            type="button"
                                            onClick={() => setExpandedEventIds((prev) => ({ ...prev, [evt.id]: true }))}
                                            className="w-full text-left"
                                            aria-label={`Edit event: ${evt.startTime}-${evt.endTime} ${evt.activity}`}
                                          >
                                            <div className="flex items-start justify-between gap-2">
                                              <div className="min-w-0">
                                                <p className="text-xs font-semibold text-slate-500">
                                                  {evt.startTime} → {evt.endTime}
                                                </p>
                                                <p className="mt-1 text-sm text-slate-700 break-words">{evt.activity}</p>
                                              </div>
                                              <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 mt-1 ${
                                                evt.difficulty === "Easy" ? "bg-green-100 text-green-700" :
                                                evt.difficulty === "Difficult" ? "bg-red-100 text-red-700" :
                                                evt.difficulty === "Funny" ? "bg-yellow-100 text-yellow-700" :
                                                evt.difficulty === "Delicious" ? "bg-orange-100 text-orange-700" :
                                                "bg-slate-100 text-slate-700"
                                              }`}>
                                                {evt.difficulty || "Normal"}
                                              </span>
                                            </div>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              removeItineraryEvent(pkg.id, day.id, evt.id);
                                            }}
                                            className="mt-2 w-full inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-400 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition"
                                            aria-label="Remove event"
                                          >
                                            <Trash2 className="h-4 w-4 mr-1" />
                                            <span className="text-xs">Remove</span>
                                          </button>
                                        </div>

                                        {/* Desktop view */}
                                        <div
                                          className="hidden sm:grid col-span-full cursor-pointer sm:grid-cols-[116px_116px_minmax(0,1fr)_130px_auto] sm:items-center sm:px-1 gap-2 py-2"
                                        >
                                          <button
                                            type="button"
                                            onClick={() => setExpandedEventIds((prev) => ({ ...prev, [evt.id]: true }))}
                                            className="text-left"
                                            aria-label={`Edit event: ${evt.startTime}-${evt.endTime} ${evt.activity}`}
                                          >
                                            <p className="text-sm text-slate-900">{evt.startTime}</p>
                                          </button>
                                          <p className="text-sm text-slate-900">{evt.endTime}</p>
                                          <button
                                            type="button"
                                            onClick={() => setExpandedEventIds((prev) => ({ ...prev, [evt.id]: true }))}
                                            className="text-left"
                                            aria-label={`Edit event: ${evt.startTime}-${evt.endTime} ${evt.activity}`}
                                          >
                                            <p className="text-sm text-slate-700">{evt.activity}</p>
                                          </button>
                                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                                            evt.difficulty === "Easy" ? "bg-green-100 text-green-700" :
                                            evt.difficulty === "Difficult" ? "bg-red-100 text-red-700" :
                                            evt.difficulty === "Funny" ? "bg-yellow-100 text-yellow-700" :
                                            evt.difficulty === "Delicious" ? "bg-orange-100 text-orange-700" :
                                            "bg-slate-100 text-slate-700"
                                          }`}>
                                            {evt.difficulty || "Normal"}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              removeItineraryEvent(pkg.id, day.id, evt.id);
                                            }}
                                            className="inline-flex h-9 w-10 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-400 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition flex-shrink-0"
                                            aria-label="Remove event"
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </button>
                                        </div>
                                      </Fragment>
                                    );
                                  })}
                                  <button
                                    type="button"
                                    onClick={() => addItineraryEvent(pkg.id, day.id)}
                                    className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add event
                                  </button>
                                </div>
                              </Field>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Add a new day</p>
                      <p className="text-xs leading-5 text-slate-500">Needs a day title and at least one event with times, or times mentioned in the description.</p>
                      <Input
                        value={itineraryDrafts[pkg.id]?.title ?? ""}
                        onChange={(e) => setItineraryDrafts((d) => ({ ...d, [pkg.id]: { ...(d[pkg.id] ?? { title: "", description: "", events: [] }), title: e.target.value } }))}
                        placeholder={`Day ${pkg.itinerary.length + 1} title, e.g. Game drive in Serengeti`}
                      />
                      <Textarea
                        value={itineraryDrafts[pkg.id]?.description ?? ""}
                        onChange={(e) => setItineraryDrafts((d) => ({ ...d, [pkg.id]: { ...(d[pkg.id] ?? { title: "", description: "", events: [] }), description: e.target.value } }))}
                        placeholder="Describe the day in general."
                      />
                      <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
                        <p className="text-[11px] font-semibold text-slate-500">Add events for day {pkg.itinerary.length + 1} <span className="text-red-500">*</span></p>
                        <div key={`${pkg.id}-draft-header`} className="hidden sm:grid sm:grid-cols-[116px_116px_minmax(0,1fr)_130px_auto] sm:items-center sm:px-1">
                          <span className="text-[11px] font-semibold text-slate-500">From time</span>
                          <span className="text-[11px] font-semibold text-slate-500">To time</span>
                          <span className="text-[11px] font-semibold text-slate-500">Event details</span>
                          <span className="text-[11px] font-semibold text-slate-500">Experience Vibe</span>
                          <span className="text-[11px] font-semibold text-slate-500">Remove</span>
                        </div>
                        {(itineraryDrafts[pkg.id]?.events ?? []).map((evt) => {
                          const isExpanded = expandedEventIds[evt.id] ?? true;
                          const hasData = !!(evt.startTime && evt.endTime && evt.activity);
                          
                          return isExpanded ? (
                            <div key={evt.id} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-[116px_116px_minmax(0,1fr)_130px_auto] sm:items-center">
                              <div className="col-span-1 space-y-1">
                                <p className="text-[11px] font-semibold text-slate-500 sm:hidden">From time</p>
                                <Input
                                  type="time"
                                  value={evt.startTime}
                                  onChange={(e) => patchDraftItineraryEvent(pkg.id, evt.id, { startTime: e.target.value })}
                                  placeholder="From"
                                  aria-label={`Draft day ${pkg.itinerary.length + 1} event start time`}
                                />
                              </div>
                              <div className="col-span-1 space-y-1">
                                <p className="text-[11px] font-semibold text-slate-500 sm:hidden">To time</p>
                                <Input
                                  type="time"
                                  value={evt.endTime}
                                  onChange={(e) => patchDraftItineraryEvent(pkg.id, evt.id, { endTime: e.target.value })}
                                  placeholder="To"
                                  aria-label={`Draft day ${pkg.itinerary.length + 1} event end time`}
                                />
                              </div>
                              <div className="col-span-2 space-y-1 sm:col-span-1">
                                <p className="text-[11px] font-semibold text-slate-500 sm:hidden">Event details</p>
                                <Input
                                  value={evt.activity}
                                  onChange={(e) => patchDraftItineraryEvent(pkg.id, evt.id, { activity: e.target.value })}
                                  placeholder="Event / activity (e.g. Breakfast at lodge)"
                                  aria-label={`Draft day ${pkg.itinerary.length + 1} event activity`}
                                />
                              </div>
                              <div className="col-span-2 space-y-1 sm:col-span-1">
                                <p className="text-[11px] font-semibold text-slate-500 sm:hidden">Experience Vibe</p>
                                <Select
                                  value={evt.difficulty}
                                  onChange={(e) => patchDraftItineraryEvent(pkg.id, evt.id, { difficulty: e.target.value as ItineraryEvent["difficulty"] })}
                                  aria-label={`Draft day ${pkg.itinerary.length + 1} experience vibe`}
                                >
                                  <option value="">Select vibe</option>
                                  <option value="Easy">Easy</option>
                                  <option value="Normal">Normal</option>
                                  <option value="Difficult">Difficult</option>
                                  <option value="Funny">Funny</option>
                                  <option value="Delicious">Delicious</option>
                                </Select>
                              </div>
                              <div className="col-span-2 flex justify-end gap-1 sm:col-span-1 sm:justify-center">
                                {hasData && (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedEventIds((prev) => ({ ...prev, [evt.id]: false }))}
                                    className="inline-flex h-9 w-10 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-white hover:text-slate-700 sm:w-full text-xs"
                                    aria-label="Collapse event"
                                    title="Collapse"
                                  >
                                    ✓
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeDraftItineraryEvent(pkg.id, evt.id)}
                                  className="inline-flex h-9 w-10 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-white hover:text-red-600 sm:w-full"
                                  aria-label="Remove draft event"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <Fragment key={evt.id}>
                              {/* Mobile view */}
                              <div
                                className="sm:hidden col-span-full cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-3"
                              >
                                <button
                                  type="button"
                                  onClick={() => setExpandedEventIds((prev) => ({ ...prev, [evt.id]: true }))}
                                  className="w-full text-left"
                                  aria-label={`Edit event: ${evt.startTime}-${evt.endTime} ${evt.activity}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-slate-500">
                                        {evt.startTime} → {evt.endTime}
                                      </p>
                                      <p className="mt-1 text-sm text-slate-700 break-words">{evt.activity}</p>
                                    </div>
                                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 mt-1 ${
                                      evt.difficulty === "Easy" ? "bg-green-100 text-green-700" :
                                      evt.difficulty === "Difficult" ? "bg-red-100 text-red-700" :
                                      evt.difficulty === "Funny" ? "bg-yellow-100 text-yellow-700" :
                                      evt.difficulty === "Delicious" ? "bg-orange-100 text-orange-700" :
                                      "bg-slate-100 text-slate-700"
                                    }`}>
                                      {evt.difficulty || "Normal"}
                                    </span>
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeDraftItineraryEvent(pkg.id, evt.id);
                                  }}
                                  className="mt-2 w-full inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-400 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition"
                                  aria-label="Remove event"
                                >
                                  <Trash2 className="h-4 w-4 mr-1" />
                                  <span className="text-xs">Remove</span>
                                </button>
                              </div>

                              {/* Desktop view */}
                              <div
                                className="hidden sm:grid col-span-full cursor-pointer sm:grid-cols-[116px_116px_minmax(0,1fr)_130px_auto] sm:items-center sm:px-1 gap-2 py-2"
                              >
                                <button
                                  type="button"
                                  onClick={() => setExpandedEventIds((prev) => ({ ...prev, [evt.id]: true }))}
                                  className="text-left"
                                  aria-label={`Edit event: ${evt.startTime}-${evt.endTime} ${evt.activity}`}
                                >
                                  <p className="text-sm text-slate-900">{evt.startTime}</p>
                                </button>
                                <p className="text-sm text-slate-900">{evt.endTime}</p>
                                <button
                                  type="button"
                                  onClick={() => setExpandedEventIds((prev) => ({ ...prev, [evt.id]: true }))}
                                  className="text-left"
                                  aria-label={`Edit event: ${evt.startTime}-${evt.endTime} ${evt.activity}`}
                                >
                                  <p className="text-sm text-slate-700">{evt.activity}</p>
                                </button>
                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                                  evt.difficulty === "Easy" ? "bg-green-100 text-green-700" :
                                  evt.difficulty === "Difficult" ? "bg-red-100 text-red-700" :
                                  evt.difficulty === "Funny" ? "bg-yellow-100 text-yellow-700" :
                                  evt.difficulty === "Delicious" ? "bg-orange-100 text-orange-700" :
                                  "bg-slate-100 text-slate-700"
                                }`}>
                                  {evt.difficulty || "Normal"}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeDraftItineraryEvent(pkg.id, evt.id);
                                  }}
                                  className="inline-flex h-9 w-10 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-400 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition flex-shrink-0"
                                  aria-label="Remove event"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </Fragment>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => addDraftItineraryEvent(pkg.id)}
                          className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add event
                        </button>
                      </div>
                      {(() => {
                        const draft = itineraryDrafts[pkg.id];
                        const hasTitle = !!(draft?.title ?? "").trim();
                        const hasEvents = (draft?.events ?? []).length > 0;
                        const eventsValid = hasEvents && (draft?.events ?? []).every(e => e.startTime && e.endTime && e.activity);
                        const hasDescriptionWithTimes = hasTitle && /\d{1,2}:\d{2}|am|pm|morning|afternoon|evening/i.test(draft?.description ?? "");
                        const canSave = hasTitle && (eventsValid || hasDescriptionWithTimes);
                        
                        return (
                          <div className="space-y-2">
                            {!hasTitle && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">⚠️ Add day title</p>}
                            {hasTitle && !eventsValid && !hasDescriptionWithTimes && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">⚠️ Add event times or mention times in description</p>}
                            <button
                              type="button"
                              onClick={() => addItineraryDay(pkg.id)}
                              disabled={!canSave}
                              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${canSave ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800" : "border-slate-300 bg-slate-100 text-slate-400 cursor-not-allowed"}`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add day {pkg.itinerary.length + 1}
                            </button>
                          </div>
                        );
                      })()} 
                    </div>
                  </div>
                    )}
                    </div>
                    <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                      <button type="button" onClick={() => setStep(step - 1)} disabled={step <= 1} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                        <ChevronLeft className="h-4 w-4" />
                        Back
                      </button>
                      <p className="text-xs font-bold text-slate-500">Step {step} of 4 · {packageStepDefs[step - 1].label}</p>
                      {step < 4 ? (
                        <button type="button" onClick={() => setStep(step + 1)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#02665e] px-4 text-sm font-black text-white hover:bg-[#01544d]">
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      ) : (
                        <button type="button" onClick={() => setExpandedPackageIds((prev) => ({ ...prev, [pkg.id]: false }))} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-black text-white hover:bg-emerald-800">
                          <Check className="h-4 w-4" />
                          Done
                        </button>
                      )}
                    </div>
                  </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-5">
                      <p className="text-xs font-semibold text-slate-600">Package form is collapsed for a cleaner view.</p>
                      <button
                        type="button"
                        onClick={() => setExpandedPackageIds((prev) => ({ ...prev, [pkg.id]: true }))}
                        className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-100"
                      >
                        Open details
                      </button>
                    </div>
                  )}
                </div>
              );
              })}
              </div>
            </div>

            {!anyPackageExpanded && (
            <>
            <div className="mt-7 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-base font-black text-slate-950">Seasonal pricing</h3>
              <button type="button" onClick={addSeason} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-black text-slate-800 sm:justify-start">
                <Plus className="h-4 w-4" />
                Add season
              </button>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {profile.seasonalPrices.map((season) => (
                <div key={season.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex justify-end">
                    <button type="button" onClick={() => update("seasonalPrices", profile.seasonalPrices.filter((p) => p.id !== season.id))} className="text-slate-500 hover:text-red-600" aria-label="Remove season">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <FieldGrid className="gap-y-4">
                    <Field label="Season name"><Input value={season.seasonName} onChange={(e) => patchSeason(season.id, { seasonName: e.target.value })} placeholder="High season" /></Field>
                    <Field label="Price per person"><Input type="number" min="0" value={season.pricePerPerson} onChange={(e) => patchSeason(season.id, { pricePerPerson: e.target.value })} placeholder="650" /></Field>
                    <Field label="Start month">
                      <Select value={season.startMonth} onChange={(e) => patchSeason(season.id, { startMonth: e.target.value })}>
                        <option value="">Select month</option>
                        {months.map((month) => <option key={month} value={month}>{month}</option>)}
                      </Select>
                    </Field>
                    <Field label="End month">
                      <Select value={season.endMonth} onChange={(e) => patchSeason(season.id, { endMonth: e.target.value })}>
                        <option value="">Select month</option>
                        {months.map((month) => <option key={month} value={month}>{month}</option>)}
                      </Select>
                    </Field>
                    <Field label="Currency"><Select value={season.currency} onChange={(e) => patchSeason(season.id, { currency: e.target.value })}><option>USD</option><option>TZS</option><option>EUR</option></Select></Field>
                    <Field label="Notes"><Input value={season.notes} onChange={(e) => patchSeason(season.id, { notes: e.target.value })} placeholder="Migration window, holiday rate, or low season" /></Field>
                  </FieldGrid>
                </div>
              ))}
            </div>

            <div className="mt-7 border-t border-slate-100 pt-5">
              <h3 className="text-base font-black text-slate-950">Add-ons</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {addOnOptions.map((item) => (
                  <Chip key={item} label={item} active={profile.addOns.includes(item)} onClick={() => toggle("addOns", item)} />
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                <Input value={customAddOn} onChange={(e) => setCustomAddOn(e.target.value)} placeholder="Add another add-on" />
                <button type="button" onClick={() => addCustom("addOns", customAddOn, setCustomAddOn)} className="mt-1 rounded-md border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">Add</button>
              </div>
            </div>
            </>
            )}
          </Section>

          <Section icon={<Camera className="h-5 w-5" />} title="Gallery" text="Upload photos by category so every image appears in the correct customer-facing area.">
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
              {photoHelpText}
              <p className="mt-1 text-xs font-bold text-slate-600">Required uploads: Logo <span className="text-red-500">*</span>, Vehicles <span className="text-red-500">*</span>, and Attractions <span className="text-red-500">*</span>.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {photoCategories.map((cat) => {
                const urls = profile.classifiedPhotos[cat.key] ?? [];
                const activeIndex = urls.length > 0 ? Math.min(Math.max(photoSlideIndex[cat.key] ?? 0, 0), urls.length - 1) : 0;
                const activeUrl = urls[activeIndex] ?? "";
                const isRequiredCategory = cat.key === "logo" || cat.key === "vehicles" || cat.key === "attractions";
                return (
                  <div key={cat.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-black text-slate-950">{cat.title}{isRequiredCategory ? <span className="ml-1 text-red-500">*</span> : null}</h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{cat.text}</p>
                      </div>
                      <button type="button" onClick={() => fileRefs.current[cat.key]?.click()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-white hover:text-emerald-700" aria-label={`Upload ${cat.title}`}>
                        {uploading === cat.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                      </button>
                    </div>
                    <input ref={(node) => { fileRefs.current[cat.key] = node; }} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple={cat.key !== "logo"} className="hidden" onChange={(e) => uploadPhotos(cat.key, e.target.files)} />
                    {urls.length > 0 ? (
                      <div className="mt-4">
                        <div className="relative overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                          <div
                            className="relative h-40 touch-pan-y sm:h-44"
                            onTouchStart={(e) => onPhotoTouchStart(cat.key, e.changedTouches[0]?.clientX ?? 0)}
                            onTouchEnd={(e) => onPhotoTouchEnd(cat.key, urls.length, e.changedTouches[0]?.clientX ?? 0)}
                          >
                            {cat.key === "logo" ? (
                              <div className="flex h-full w-full items-center justify-center p-4">
                                <div className="h-28 w-28 overflow-hidden rounded-full bg-white ring-1 ring-slate-200 sm:h-32 sm:w-32">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={activeUrl} alt={`${cat.title} ${activeIndex + 1}`} className="h-full w-full object-contain p-2" />
                                </div>
                              </div>
                            ) : (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={activeUrl} alt={`${cat.title} ${activeIndex + 1}`} className="h-full w-full object-cover" />
                              </>
                            )}
                          </div>
                          <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">
                            {activeIndex + 1} / {urls.length}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setProfile((p) => {
                                const nextUrls = urls.filter((x) => x !== activeUrl);
                                return {
                                  ...p,
                                  companyLogoUrl: p.companyLogoUrl === activeUrl ? "" : p.companyLogoUrl,
                                  gallery: p.gallery.filter((x) => x !== activeUrl),
                                  classifiedPhotos: { ...p.classifiedPhotos, [cat.key]: nextUrls },
                                };
                              });
                              setPhotoSlideIndex((prev) => ({
                                ...prev,
                                [cat.key]: Math.max(0, Math.min(prev[cat.key] ?? activeIndex, urls.length - 2)),
                              }));
                            }}
                            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-700 shadow"
                            aria-label="Remove photo"
                          >
                            <X className="h-4 w-4" />
                          </button>

                          {urls.length > 1 ? (
                            <>
                              <button
                                type="button"
                                onClick={() => goToPhoto(cat.key, urls.length, -1)}
                                className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white"
                                aria-label="Previous photo"
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => goToPhoto(cat.key, urls.length, 1)}
                                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white"
                                aria-label="Next photo"
                              >
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            </>
                          ) : null}
                        </div>

                        {urls.length > 1 ? (
                          <>
                            <div className="mt-2 text-center text-[11px] font-medium text-slate-500">
                              {urls.length} photo{urls.length === 1 ? "" : "s"} uploaded
                            </div>
                            <div className="mt-1 flex justify-center gap-1.5" aria-label={`${urls.length} uploaded photos`}>
                              {urls.map((_, idx) => (
                                <button
                                  key={`${cat.key}-dot-${idx}`}
                                  type="button"
                                  onClick={() => setPhotoSlideIndex((prev) => ({ ...prev, [cat.key]: idx }))}
                                  className={idx === activeIndex ? "h-1.5 w-4 rounded-full bg-emerald-600" : "h-1.5 w-4 rounded-full bg-slate-300"}
                                  aria-label={`Go to photo ${idx + 1}`}
                                />
                              ))}
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileRefs.current[cat.key]?.click()}
                        className="mt-4 flex h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-500 hover:border-emerald-300 hover:bg-emerald-50/40 hover:text-emerald-800"
                      >
                        <ImagePlus className="mb-2 h-5 w-5" />
                        Upload {cat.title.toLowerCase()}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="sticky bottom-0 mt-6 border-t border-slate-200 bg-slate-50/90 py-4 backdrop-blur">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="text-center text-sm font-semibold text-slate-500">
              Save as draft. Submit for admin review.
              <p className="mt-1 text-xs font-semibold text-slate-400">Autosave is on and runs silently in background.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={save} disabled={saving || submitting} className="inline-flex h-10 items-center justify-center gap-2 self-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-black text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:px-5 sm:text-sm sm:self-auto">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save draft
              </button>
              <button type="button" onClick={submitForReview} disabled={submitting || saving || !canSubmit} className="inline-flex h-10 items-center justify-center gap-2 self-center rounded-lg bg-emerald-700 px-4 text-xs font-black text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:px-5 sm:text-sm sm:self-auto">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Submit for review
              </button>
            </div>
            {(() => {
              const submittedAt = profile?.review?.submittedAt || (profile as any)?.submittedAt;
              if (!submittedAt) return null;
              const d = new Date(submittedAt);
              const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
              const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
              return (
                <p className="text-[11px] text-slate-400">
                  Last submitted: <span className="font-semibold text-slate-500">{date} at {time}</span>
                </p>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
