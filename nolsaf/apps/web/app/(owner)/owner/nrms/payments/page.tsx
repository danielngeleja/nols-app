"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";

import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type EditableField =
  | "legalName"
  | "tradingName"
  | "registrationNumber"
  | "tin"
  | "country"
  | "contactEmail"
  | "contactPhone";

/**
 * Fields the Owner may type. Email and phone are deliberately absent: they are
 * the provider account's security contacts and are taken from the verified
 * Owner account, never from this form.
 */
type OwnerEditableField = Exclude<EditableField, "contactEmail" | "contactPhone">;

type MerchantDetails = Record<EditableField, string | null> & {
  id: number;
  status: string;
};

/**
 * A merchant is a legal entity, not a property. One company that runs several
 * properties keeps one KYC package and one provider account, so a second
 * property joins an existing company rather than starting its own application.
 */
type ReusableMerchant = {
  merchantId: number;
  legalName: string;
  tradingName: string | null;
  status: string;
  applicationStatus: string | null;
  providerStatus: string | null;
  propertyCount: number;
};

type LinkedProperty = { propertyId: number; title: string | null };

type OwnerSecurityContact = {
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
};

type MerchantOverview = {
  ok: true;
  subscribed: boolean;
  merchant: MerchantDetails | null;
  application: {
    id: number;
    version: number;
    status: string;
    submittedAt: string | null;
    decisionReason: string | null;
  } | null;
  providerAccount: { status: string; statusReason: string | null; activatedAt: string | null } | null;
  ownerSecurityContact: OwnerSecurityContact;
  policy: { policyId: string; policyVersion: string; accepted: boolean } | null;
  reusableMerchants: ReusableMerchant[];
  linkedProperties: LinkedProperty[];
  documents: Array<{
    userDocumentId: number;
    documentType: string;
    status: string;
    uploadedAt: string | null;
    expiresAt: string | null;
  }>;
  checklist: {
    missingFields: EditableField[];
    missingDocuments: RequiredDocumentType[];
    policyAccepted: boolean;
    ownerTinStatus: OwnerTinStatus;
    canSubmit: boolean;
  };
};

type MerchantPolicy = {
  policyId: string;
  policyVersion: string;
  content: string;
};

/**
 * The policy is stored as a hard-wrapped plain text document. Rendering those
 * line breaks verbatim inside a responsive panel wraps the text twice and reads
 * badly, so the reader parses it into blocks and lets each one reflow.
 */
type PolicyBlock =
  | { kind: "paragraph"; text: string; indented: boolean }
  | { kind: "clause"; label: string; text: string }
  | { kind: "item"; label: string; text: string };

/** One numbered part of the policy, for the reader's contents list. */
type PolicySection = { key: string; title: string; blocks: PolicyBlock[] };

/** Policy documents are set in Trebuchet MS. The rest of the app is unchanged. */
const POLICY_FONT = '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", Tahoma, sans-serif';

type JourneyState = "done" | "current" | "waiting" | "attention" | "todo";
type JourneyStep = { key: string; label: string; done: boolean; state: JourneyState };

/**
 * Which setup steps have somewhere to go on this page. Review and provider
 * activation are carried out elsewhere, so they are deliberately absent and
 * render as plain markers rather than dead links.
 */
const SETUP_ANCHORS: Record<string, string | undefined> = {
  details: "setup-details",
  documents: "setup-documents",
  contact: "setup-contact",
  policy: "setup-policy",
  review: "setup-review",
};

const JOURNEY_TONES: Record<JourneyState, { tile: string; dot: string; word: string; label: string }> = {
  done: { tile: "bg-emerald-50 ring-emerald-200", dot: "bg-emerald-700 text-white", word: "Done", label: "text-emerald-800" },
  current: { tile: "bg-white ring-emerald-300 shadow-sm", dot: "bg-white text-emerald-700 ring-1 ring-emerald-400", word: "Your turn", label: "text-emerald-800" },
  waiting: { tile: "bg-blue-50 ring-blue-200", dot: "bg-white text-blue-700 ring-1 ring-blue-300", word: "With NoLSAF", label: "text-blue-800" },
  attention: { tile: "bg-amber-50 ring-amber-200", dot: "bg-amber-600 text-white", word: "Needs you", label: "text-amber-800" },
  todo: { tile: "bg-neutral-50 ring-neutral-200", dot: "bg-white text-neutral-400 ring-1 ring-neutral-300", word: "Pending", label: "text-neutral-400" },
};

type RequiredDocumentType = "BUSINESS_LICENCE" | "TIN_CERTIFICATE";
type OwnerTinStatus = "MATCH" | "MISMATCH" | "NOT_ON_FILE" | "NOT_ENTERED";
type TinCheckState = { status: OwnerTinStatus | "CHECKING" | "ERROR"; checkedTin: string };

type FormState = Record<OwnerEditableField, string>;
type FormErrors = Partial<Record<OwnerEditableField, string>>;

const EMPTY_FORM: FormState = {
  legalName: "",
  tradingName: "",
  registrationNumber: "",
  tin: "",
  country: "TZ",
};

const FIELD_CONFIG: Array<{
  key: OwnerEditableField;
  label: string;
  placeholder: string;
  required?: boolean;
  maxLength: number;
}> = [
  { key: "legalName", label: "Registered business name", placeholder: "Name on your registration documents", required: true, maxLength: 200 },
  { key: "tradingName", label: "Trading name", placeholder: "Property or brand name", maxLength: 200 },
  { key: "registrationNumber", label: "Registration number", placeholder: "Number on the company registration", required: true, maxLength: 60 },
  { key: "tin", label: "Company TIN", placeholder: "Company taxpayer identification number", required: true, maxLength: 20 },
  { key: "country", label: "Country code", placeholder: "TZ", required: true, maxLength: 2 },
];

/**
 * Covers every field the server can report as missing, including the two the
 * form does not collect, so the final check can name them accurately.
 */
const FIELD_LABELS: Record<EditableField, string> = {
  legalName: "Registered business name",
  tradingName: "Trading name",
  registrationNumber: "Registration number",
  tin: "Company TIN",
  country: "Country code",
  contactEmail: "Verified account email",
  contactPhone: "Verified account phone",
};

const DOCUMENTS: Array<{ type: RequiredDocumentType; label: string; description: string }> = [
  { type: "BUSINESS_LICENCE", label: "Business licence", description: "Your current business licence from My Profile" },
  { type: "TIN_CERTIFICATE", label: "TIN certificate", description: "Your taxpayer certificate from My Profile" },
];

function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.legalName.trim()) errors.legalName = "Enter the registered business name before saving.";
  if (!form.registrationNumber.trim()) errors.registrationNumber = "Enter the company registration number before saving.";
  if (!/^[A-Z]{2}$/.test(form.country.trim().toUpperCase())) errors.country = "Use a two-letter country code, such as TZ.";
  if (form.tin.trim() && !/^[A-Za-z0-9][A-Za-z0-9\s./-]{3,19}$/.test(form.tin.trim())) errors.tin = "Check the TIN format.";
  if (form.registrationNumber.trim() && !/^[A-Za-z0-9][A-Za-z0-9\s./-]{1,59}$/.test(form.registrationNumber.trim())) errors.registrationNumber = "Check the registration number format.";
  return errors;
}

function normalizedTin(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formFromMerchant(merchant: MerchantDetails | null): FormState {
  if (!merchant) return EMPTY_FORM;
  return {
    legalName: merchant.legalName ?? "",
    tradingName: merchant.tradingName ?? "",
    registrationNumber: merchant.registrationNumber ?? "",
    tin: merchant.tin ?? "",
    country: merchant.country ?? "TZ",
  };
}

function requestMessage(error: unknown, fallback: string): string {
  const requestError = error as { response?: { data?: { error?: unknown; message?: unknown } } };
  const serverMessage = requestError.response?.data?.message ?? requestError.response?.data?.error;
  return typeof serverMessage === "string" && serverMessage.trim() ? serverMessage : fallback;
}

function rateLimitRetrySeconds(error: unknown): number | null {
  const response = (error as {
    response?: {
      status?: number;
      data?: { retryAfterSeconds?: unknown };
      headers?: Record<string, unknown>;
    };
  }).response;
  if (Number(response?.status) !== 429) return null;
  const bodySeconds = Number(response?.data?.retryAfterSeconds);
  const headerSeconds = Number(response?.headers?.["retry-after"]);
  const seconds = bodySeconds > 0 ? bodySeconds : headerSeconds > 0 ? headerSeconds : 60;
  return Math.min(30 * 60, Math.max(1, Math.ceil(seconds)));
}

function retryCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function isServiceUnavailable(error: unknown): boolean {
  return Number((error as { response?: { status?: number } }).response?.status) === 503;
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type StatusPresentation = {
  label: string;
  description: string;
  tone: "neutral" | "amber" | "blue" | "emerald" | "red";
  Icon: typeof Clock3;
};

function statusPresentation(overview: MerchantOverview): StatusPresentation {
  if (!overview.subscribed) {
    return { label: "Not set up", description: "Start a private application when you are ready.", tone: "neutral", Icon: CircleDollarSign };
  }

  const provider = String(overview.providerAccount?.status ?? "").toUpperCase();
  const application = String(overview.application?.status ?? "DRAFT").toUpperCase();

  if (provider === "ACTIVE") {
    return { label: "Active", description: "This property is approved to receive supported online payments.", tone: "emerald", Icon: BadgeCheck };
  }
  if (provider === "SUSPENDED") {
    return { label: "Suspended", description: "New online payment collection is paused. Other NRMS services remain available.", tone: "red", Icon: AlertTriangle };
  }
  if (application === "ACTION_REQUIRED") {
    return { label: "Action required", description: "Review the feedback, correct the application, and submit it again.", tone: "amber", Icon: AlertTriangle };
  }
  if (["ADMIN_REJECTED", "PROVIDER_REJECTED", "REJECTED"].includes(application) || ["ADMIN_REJECTED", "PROVIDER_REJECTED", "REJECTED"].includes(provider)) {
    return { label: "Not approved", description: "The application cannot move forward in its current form.", tone: "red", Icon: AlertTriangle };
  }
  if (application === "READY_FOR_ADMIN_REVIEW") {
    return { label: "Under NoLSAF review", description: "Your submitted details and linked documents are being reviewed.", tone: "blue", Icon: Clock3 };
  }
  if (application === "SUBMISSION_QUEUED" || provider === "SUBMISSION_QUEUED") {
    return { label: "Preparing provider review", description: "NoLSAF approved the local application. Secure provider submission is queued.", tone: "blue", Icon: Clock3 };
  }
  if (["PROVIDER_REVIEW", "SUBMITTED", "PENDING_PROVIDER"].includes(application) || ["PROVIDER_REVIEW", "SUBMITTED", "PENDING_PROVIDER"].includes(provider)) {
    return { label: "Submitted to provider", description: "The payment provider is reviewing the merchant application.", tone: "blue", Icon: ShieldCheck };
  }
  return { label: "Setup in progress", description: "Complete the business details, documents, and policy acceptance.", tone: "amber", Icon: FileText };
}

const TONE_CLASSES: Record<StatusPresentation["tone"], { panel: string; icon: string; badge: string }> = {
  neutral: { panel: "bg-neutral-50 ring-neutral-200", icon: "bg-white text-neutral-600 ring-neutral-200", badge: "bg-white text-neutral-600 ring-neutral-200" },
  amber: { panel: "bg-amber-50 ring-amber-200", icon: "bg-white text-amber-700 ring-amber-200", badge: "bg-white text-amber-700 ring-amber-200" },
  blue: { panel: "bg-blue-50 ring-blue-200", icon: "bg-white text-blue-700 ring-blue-200", badge: "bg-white text-blue-700 ring-blue-200" },
  emerald: { panel: "bg-emerald-50 ring-emerald-200", icon: "bg-white text-emerald-700 ring-emerald-200", badge: "bg-white text-emerald-700 ring-emerald-200" },
  red: { panel: "bg-red-50 ring-red-200", icon: "bg-white text-red-700 ring-red-200", badge: "bg-white text-red-700 ring-red-200" },
};

const HEADER_STATUS_CLASSES: Record<StatusPresentation["tone"], { shell: string; dot: string }> = {
  neutral: { shell: "bg-white text-neutral-600 ring-neutral-200", dot: "bg-neutral-400" },
  amber: { shell: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  blue: { shell: "bg-blue-50 text-blue-800 ring-blue-200", dot: "bg-blue-500" },
  emerald: { shell: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500" },
  red: { shell: "bg-red-50 text-red-800 ring-red-200", dot: "bg-red-500" },
};

function PaymentsBackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex min-h-9 w-fit appearance-none items-center gap-2 rounded-lg border-0 bg-white px-3 text-xs font-bold text-neutral-600 shadow-sm ring-1 ring-neutral-200 transition hover:bg-neutral-50 hover:text-neutral-950 hover:ring-neutral-300"
    >
      <ArrowLeft className="h-4 w-4" /> Back to payments
    </button>
  );
}

function PaymentsHeader({
  propertyName,
  statusLabel,
  tone,
  onBack,
  onDetach,
  detaching,
}: {
  propertyName: string;
  statusLabel: string;
  tone: StatusPresentation["tone"];
  onBack: () => void;
  onDetach?: () => void;
  detaching?: boolean;
}) {
  const statusClass = HEADER_STATUS_CLASSES[tone];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PaymentsBackButton onBack={onBack} />
        {/* Changing the attached company mutates onboarding data. Keep it
            visually and semantically separate from ordinary back navigation. */}
        {onDetach && (
          <button
            type="button"
            onClick={onDetach}
            disabled={detaching}
            className="inline-flex min-h-9 appearance-none items-center gap-2 rounded-lg border-0 bg-white px-3 text-xs font-bold text-neutral-600 shadow-sm ring-1 ring-neutral-200 transition hover:bg-neutral-50 hover:text-neutral-950 disabled:opacity-50"
          >
            {detaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />} Choose a different company
          </button>
        )}
      </div>
      <header className="flex flex-col gap-4 pb-5 shadow-[inset_0_-1px_0_0_#e5e7eb] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><CircleDollarSign className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NoLSAF Payments</p>
            <h1 className="mb-0 mt-1 text-2xl font-bold tracking-tight text-neutral-950">Property payments</h1>
            <p className="mb-0 mt-1 text-sm text-neutral-500">Direct payment setup for <span className="font-semibold text-neutral-700">{propertyName}</span></p>
          </div>
        </div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ring-1 ${statusClass.shell}`}><span className={`h-2 w-2 rounded-full ${statusClass.dot}`} />{statusLabel}</span>
      </header>
    </>
  );
}

type PaymentHomeProperty = {
  id: number;
  title: string;
  status: string;
  nrmsActivatedAt: string | null;
};

type PaymentHomeStatus = {
  status: string | null;
  providerStatus?: string | null;
  actionRequired: number;
  total: number;
};

type PaymentHomeCategory = "loading" | "unavailable" | "not_started" | "in_progress" | "waiting" | "active" | "attention";
type PaymentHomeFilter = "all" | Exclude<PaymentHomeCategory, "loading" | "unavailable">;

function paymentHomeStatus(summary: PaymentHomeStatus | null | undefined): {
  category: PaymentHomeCategory;
  label: string;
  detail: string;
  badge: string;
  dot: string;
  card: string;
  icon: string;
  action: string;
} {
  if (summary === undefined) {
    return { category: "loading", label: "Checking setup", detail: "Loading the current payment status.", badge: "bg-white/80 text-neutral-500 ring-neutral-200", dot: "bg-neutral-300", card: "bg-neutral-50/60 ring-neutral-200", icon: "bg-white text-neutral-500 ring-neutral-200", action: "text-neutral-600" };
  }
  if (summary === null) {
    return { category: "unavailable", label: "Status unavailable", detail: "Open the property to try again.", badge: "bg-white/80 text-rose-700 ring-rose-200", dot: "bg-rose-500", card: "bg-rose-50/60 ring-rose-200", icon: "bg-white text-rose-700 ring-rose-200", action: "text-rose-700" };
  }
  if (summary.actionRequired > 0) {
    return { category: "attention", label: "Needs your attention", detail: "Open the application to complete the requested changes.", badge: "bg-white/80 text-amber-900 ring-amber-300", dot: "bg-amber-500", card: "bg-amber-50/75 ring-amber-300", icon: "bg-white text-amber-700 ring-amber-200", action: "text-amber-800" };
  }

  const status = String(summary.status ?? "").toUpperCase();
  const providerStatus = String(summary.providerStatus ?? "").toUpperCase();
  if (providerStatus === "ACTIVE") {
    return { category: "active", label: "Payments active", detail: "This property is approved to receive supported online payments.", badge: "bg-white/80 text-green-800 ring-green-300", dot: "bg-green-500", card: "bg-green-50/70 ring-green-300", icon: "bg-white text-green-700 ring-green-200", action: "text-green-800" };
  }
  if (!status) {
    return { category: "not_started", label: "Not started", detail: "No payment application has been started for this property.", badge: "bg-white/80 text-violet-800 ring-violet-300", dot: "bg-violet-500", card: "bg-violet-50/70 ring-violet-300", icon: "bg-white text-violet-700 ring-violet-200", action: "text-violet-800" };
  }
  if (status === "DRAFT") {
    return { category: "in_progress", label: "Setup in progress", detail: "Continue the private payment application.", badge: "bg-white/80 text-emerald-800 ring-emerald-300", dot: "bg-emerald-500", card: "bg-emerald-50/65 ring-emerald-300", icon: "bg-white text-emerald-700 ring-emerald-200", action: "text-emerald-800" };
  }
  if (status === "READY_FOR_ADMIN_REVIEW") {
    return { category: "waiting", label: "With NoLSAF", detail: "The application is waiting for NoLSAF review.", badge: "bg-white/80 text-blue-800 ring-blue-300", dot: "bg-blue-500", card: "bg-blue-50/70 ring-blue-300", icon: "bg-white text-blue-700 ring-blue-200", action: "text-blue-800" };
  }
  if (status === "SUBMISSION_QUEUED") {
    return { category: "waiting", label: "Preparing provider review", detail: "NoLSAF approved the application for provider submission.", badge: "bg-white/80 text-blue-800 ring-blue-300", dot: "bg-blue-500", card: "bg-blue-50/70 ring-blue-300", icon: "bg-white text-blue-700 ring-blue-200", action: "text-blue-800" };
  }
  return { category: "in_progress", label: titleCase(status), detail: "Open the property to view the full payment status.", badge: "bg-white/80 text-emerald-800 ring-emerald-300", dot: "bg-emerald-500", card: "bg-emerald-50/65 ring-emerald-300", icon: "bg-white text-emerald-700 ring-emerald-200", action: "text-emerald-800" };
}

function PaymentsHome({
  properties,
  onOpen,
}: {
  properties: PaymentHomeProperty[];
  onOpen: (propertyId: number) => void;
}) {
  const eligibleProperties = useMemo(
    () => properties.filter((property) => property.status === "APPROVED" && property.nrmsActivatedAt),
    [properties],
  );
  const [summaries, setSummaries] = useState<Record<number, PaymentHomeStatus | null>>({});
  const [filter, setFilter] = useState<PaymentHomeFilter>("all");

  useEffect(() => {
    let active = true;
    setSummaries({});
    void apiClient.get<{ properties: Array<PaymentHomeStatus & { propertyId: number }> }>("/api/owner/payments/merchant/live-counts")
      .then((response) => {
        if (!active) return;
        const rows = response.data.properties.map((property) => [property.propertyId, property] as const);
        setSummaries(Object.fromEntries(rows));
      })
      .catch(() => {
        if (!active) return;
        setSummaries(Object.fromEntries(eligibleProperties.map((property) => [property.id, null])));
      });
    return () => { active = false; };
  }, [eligibleProperties]);

  const propertyRows = eligibleProperties.map((property) => ({
    property,
    presentation: paymentHomeStatus(
      Object.prototype.hasOwnProperty.call(summaries, property.id) ? summaries[property.id] : undefined,
    ),
  }));
  const filterOptions: Array<{ key: PaymentHomeFilter; label: string; dot: string; selected: string }> = [
    { key: "all", label: "All", dot: "bg-neutral-500", selected: "bg-neutral-900 text-white ring-neutral-900" },
    { key: "attention", label: "Needs attention", dot: "bg-amber-500", selected: "bg-amber-100 text-amber-900 ring-amber-300" },
    { key: "in_progress", label: "In progress", dot: "bg-emerald-500", selected: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
    { key: "waiting", label: "Waiting", dot: "bg-blue-500", selected: "bg-blue-100 text-blue-900 ring-blue-300" },
    { key: "active", label: "Active", dot: "bg-green-500", selected: "bg-green-100 text-green-900 ring-green-300" },
    { key: "not_started", label: "Not started", dot: "bg-violet-500", selected: "bg-violet-100 text-violet-900 ring-violet-300" },
  ];
  const countFor = (key: PaymentHomeFilter) => key === "all"
    ? propertyRows.length
    : propertyRows.filter((row) => row.presentation.category === key).length;
  const visibleRows = filter === "all"
    ? propertyRows
    : propertyRows.filter((row) => row.presentation.category === filter);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
      <header className="flex flex-col gap-4 pb-5 shadow-[inset_0_-1px_0_0_#e5e7eb] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><CircleDollarSign className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NoLSAF Payments</p>
            <h1 className="mb-0 mt-1 text-2xl font-bold tracking-tight text-neutral-950">Payments</h1>
            <p className="mb-0 mt-1 text-sm text-neutral-500">Set up online payment providers across your active properties.</p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center rounded-lg bg-white px-3 py-2 text-xs font-bold text-neutral-600 ring-1 ring-neutral-200">
          {eligibleProperties.length} {eligibleProperties.length === 1 ? "property" : "properties"}
        </span>
      </header>

      <section className="overflow-hidden rounded-2xl bg-white shadow-[0_14px_38px_-32px_rgba(15,23,42,0.5)] ring-1 ring-neutral-200">
        <div className="px-5 py-4 shadow-[inset_0_-1px_0_0_#f1f5f9] sm:px-6">
          <h2 className="m-0 text-base font-bold text-neutral-950">Property payment setup</h2>
          <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">Each color represents a setup stage. Filter the portfolio, then select a property to open its application, documents and provider status.</p>
        </div>

        {eligibleProperties.length > 0 ? (
          <>
            <div className="bg-neutral-50/80 px-4 py-4 shadow-[inset_0_-1px_0_0_#e5e7eb] sm:px-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Setup journey</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                    <span className="rounded-md bg-violet-100 px-2 py-1 text-violet-800">Not started</span><ChevronRight className="h-3 w-3 text-neutral-300" />
                    <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-800">In progress</span><ChevronRight className="h-3 w-3 text-neutral-300" />
                    <span className="rounded-md bg-blue-100 px-2 py-1 text-blue-800">Review &amp; provider</span><ChevronRight className="h-3 w-3 text-neutral-300" />
                    <span className="rounded-md bg-green-100 px-2 py-1 text-green-800">Active</span>
                  </div>
                </div>
                <nav aria-label="Filter properties by payment status" className="flex flex-wrap gap-2">
                  {filterOptions.map((option) => {
                    const selected = filter === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setFilter(option.key)}
                        aria-pressed={selected}
                        className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border-0 px-2.5 text-[10px] font-bold ring-1 transition ${selected ? option.selected : "bg-white text-neutral-600 ring-neutral-200 hover:ring-neutral-300"}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${option.dot}`} />{option.label}
                        <span className={`min-w-4 rounded px-1 py-0.5 text-center text-[9px] ${selected ? "bg-white/60" : "bg-neutral-100"}`}>{countFor(option.key)}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            </div>

            {visibleRows.length > 0 ? (
              <ul className="m-0 grid list-none gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
                {visibleRows.map(({ property, presentation }) => (
                  <li key={property.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(property.id)}
                    className={`group flex min-h-36 w-full appearance-none flex-col items-stretch rounded-2xl border-0 p-4 text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-2 ${presentation.card}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ${presentation.icon}`}><Building2 className="h-5 w-5" /></span>
                      <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold ring-1 ${presentation.badge}`}><span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />{presentation.label}</span>
                    </div>
                    <h3 className="mb-0 mt-4 truncate text-sm font-bold text-neutral-950">{property.title}</h3>
                    <p className="mb-0 mt-1 flex-1 text-[11px] leading-5 text-neutral-600">{presentation.detail}</p>
                    <span className={`mt-4 inline-flex items-center gap-1.5 text-xs font-bold ${presentation.action}`}>Open payment setup <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
                  </button>
                </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="m-0 text-sm font-bold text-neutral-800">No properties match this filter</p>
                <p className="mb-0 mt-1 text-xs text-neutral-500">Choose another status or return to all properties.</p>
                <button type="button" onClick={() => setFilter("all")} className="mt-4 min-h-9 rounded-lg border-0 bg-neutral-900 px-3 text-xs font-bold text-white">Show all properties</button>
              </div>
            )}
          </>
        ) : (
          <div className="px-5 py-12 text-center sm:px-6">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-50 text-neutral-400 ring-1 ring-neutral-200"><Building2 className="h-5 w-5" /></span>
            <h3 className="mb-0 mt-4 text-sm font-bold text-neutral-900">No active properties yet</h3>
            <p className="mb-0 mt-1 text-xs text-neutral-500">Activate an approved NRMS property before setting up payments.</p>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * How far an existing company has already got, and what joining it means for
 * the property being set up. An active company makes the new property payable
 * without a second review; a draft one simply shares the same application.
 */
function reusableMerchantState(merchant: ReusableMerchant): {
  label: string;
  effect: string;
  badge: string;
  dot: string;
  icon: string;
  canJoin: boolean;
} {
  const application = String(merchant.applicationStatus ?? "").toUpperCase();
  const provider = String(merchant.providerStatus ?? "").toUpperCase();

  if (provider === "ACTIVE") {
    return {
      label: "Active",
      effect: "This property can take payments as soon as it is linked.",
      badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      dot: "bg-emerald-500",
      icon: "bg-emerald-50 text-emerald-700",
      canJoin: true,
    };
  }
  if (application === "SUBMISSION_QUEUED" || provider === "SUBMISSION_QUEUED") {
    return {
      label: "Approved by NoLSAF",
      effect: "This property joins the company already waiting on the provider.",
      badge: "bg-blue-50 text-blue-700 ring-blue-200",
      dot: "bg-blue-500",
      icon: "bg-blue-50 text-blue-700",
      canJoin: true,
    };
  }
  if (application === "READY_FOR_ADMIN_REVIEW") {
    return {
      label: "Under review",
      effect: "This property joins the review already in progress. No second review.",
      badge: "bg-blue-50 text-blue-700 ring-blue-200",
      dot: "bg-blue-500",
      icon: "bg-blue-50 text-blue-700",
      canJoin: true,
    };
  }
  if (application === "ACTION_REQUIRED") {
    return {
      label: "Needs correction",
      effect: "Correct the returned application once and it covers this property too.",
      badge: "bg-amber-50 text-amber-700 ring-amber-200",
      dot: "bg-amber-500",
      icon: "bg-amber-50 text-amber-700",
      canJoin: true,
    };
  }
  if (["ADMIN_REJECTED", "PROVIDER_REJECTED", "REJECTED"].includes(application) || ["ADMIN_REJECTED", "PROVIDER_REJECTED", "REJECTED"].includes(provider)) {
    return {
      label: "Not approved",
      effect: "This company cannot take on payments. Contact NoLSAF support.",
      badge: "bg-red-50 text-red-700 ring-red-200",
      dot: "bg-red-500",
      icon: "bg-red-50 text-red-700",
      canJoin: false,
    };
  }
  return {
    label: "Draft",
    effect: "You complete one application that covers every property on it.",
    badge: "bg-violet-50 text-violet-700 ring-violet-200",
    dot: "bg-violet-500",
    icon: "bg-violet-50 text-violet-700",
    canJoin: true,
  };
}

function documentStatus(status: string | undefined, missing: boolean, expired: boolean) {
  const value = String(status ?? "").toUpperCase();
  if (expired) return { label: "Expired", cls: "bg-red-50 text-red-700", Icon: AlertTriangle };
  if (value === "APPROVED") return { label: "Approved", cls: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2 };
  if (value === "PENDING") return { label: "On file", cls: "bg-blue-50 text-blue-700", Icon: Clock3 };
  if (value === "REJECTED") return { label: "Replace", cls: "bg-red-50 text-red-700", Icon: AlertTriangle };
  if (missing) return { label: "Required", cls: "bg-amber-50 text-amber-700", Icon: AlertTriangle };
  return { label: "Not uploaded", cls: "bg-neutral-100 text-neutral-600", Icon: FileText };
}

export default function NrmsPaymentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { properties, setSelectedPropertyId } = useNrms();
  const propertyParam = searchParams.get("property");
  const requestedPropertyId = Number(propertyParam);
  const detailProperty = propertyParam && Number.isInteger(requestedPropertyId)
    ? properties.find((property) => property.id === requestedPropertyId) ?? null
    : null;
  const detailPropertyId = detailProperty?.id ?? null;
  const [overview, setOverview] = useState<MerchantOverview | null>(null);
  const [overviewPropertyId, setOverviewPropertyId] = useState<number | null>(null);
  const [policy, setPolicy] = useState<MerchantPolicy | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [busy, setBusy] = useState<"subscribe" | "detach" | "save" | "accept" | "submit" | null>(null);
  const [subscribeTarget, setSubscribeTarget] = useState<number | "new" | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [policyUnavailable, setPolicyUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"policy" | "submit" | null>(null);
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
  const [tinCheck, setTinCheck] = useState<TinCheckState>({ status: "NOT_ENTERED", checkedTin: "" });
  const [showTinConfirmation, setShowTinConfirmation] = useState(false);
  const [policyReaderOpen, setPolicyReaderOpen] = useState(false);
  /**
   * Which policy version the owner has actually opened and read to the end.
   * Held as a version rather than a boolean so a policy update resets it and
   * the new text has to be read before it can be accepted again.
   */
  const [policyReadVersion, setPolicyReadVersion] = useState<string | null>(null);
  const policyArticleRef = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    if (detailPropertyId) setSelectedPropertyId(detailPropertyId);
  }, [detailPropertyId, setSelectedPropertyId]);

  useEffect(() => {
    if (propertyParam && !detailProperty) router.replace("/owner/nrms/payments");
  }, [detailProperty, propertyParam, router]);

  useEffect(() => {
    if (!rateLimitUntil) return;
    const updateCountdown = () => {
      setRetrySeconds(Math.max(0, Math.ceil((rateLimitUntil - Date.now()) / 1000)));
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [rateLimitUntil]);

  const loadPolicy = useCallback(async (propertyId: number) => {
    setPolicyLoading(true);
    setPolicyUnavailable(null);
    try {
      const response = await apiClient.get<MerchantPolicy>(`/api/owner/payments/merchant/${propertyId}/policy`);
      setPolicy(response.data);
    } catch (requestError: unknown) {
      setPolicy(null);
      setPolicyUnavailable(
        requestMessage(requestError, "The payment policy is not available yet. You cannot submit until it is ready."),
      );
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  const loadOverview = useCallback(async () => {
    if (!detailPropertyId) {
      setOverview(null);
      setOverviewPropertyId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setOverview(null);
    setError(null);
    setRateLimitUntil(null);
    setRetrySeconds(0);
    setUnavailable(null);
    setPolicy(null);
    setPolicyUnavailable(null);
    setPolicyReaderOpen(false);
    try {
      const response = await apiClient.get<MerchantOverview>(`/api/owner/payments/merchant/${detailPropertyId}`);
      setOverview(response.data);
      setForm(formFromMerchant(response.data.merchant));
      setTinCheck({
        status: response.data.checklist.ownerTinStatus,
        checkedTin: response.data.merchant?.tin ?? "",
      });
      setShowTinConfirmation(false);
      if (response.data.subscribed) void loadPolicy(detailPropertyId);
    } catch (requestError: unknown) {
      setOverview(null);
      const retryAfter = rateLimitRetrySeconds(requestError);
      if (retryAfter !== null) {
        setRateLimitUntil(Date.now() + retryAfter * 1000);
        setRetrySeconds(retryAfter);
      } else if (isServiceUnavailable(requestError)) {
        setUnavailable(requestMessage(requestError, "Online payment is not available yet."));
      } else {
        setError(requestMessage(requestError, "Payment setup could not be loaded."));
      }
    } finally {
      setOverviewPropertyId(detailPropertyId);
      setLoading(false);
    }
  }, [detailPropertyId, loadPolicy]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const editable = ["DRAFT", "ACTION_REQUIRED"].includes(String(overview?.application?.status ?? "").toUpperCase());
  const initialForm = useMemo(() => formFromMerchant(overview?.merchant ?? null), [overview?.merchant]);
  const formChanged = JSON.stringify(form) !== JSON.stringify(initialForm);
  const formErrors = useMemo(() => validateForm(form), [form]);
  const status = overview ? statusPresentation(overview) : null;
  const reviewReason = overview?.application?.decisionReason ?? overview?.providerAccount?.statusReason ?? null;
  const backToPayments = () => {
    if (formChanged && editable && !window.confirm("Discard the unsaved business detail changes?")) return;
    router.replace("/owner/nrms/payments");
  };

  // Read-only, and read from the Owner account rather than the application, so
  // the page cannot present a contact the provider would not actually use.
  const securityContact = overview?.ownerSecurityContact ?? null;
  const securityContactReady = Boolean(securityContact?.emailVerified && securityContact?.phoneVerified);
  const securityContactRows: Array<{ label: string; value: string | null; verified: boolean }> = [
    { label: "Account email", value: securityContact?.email ?? null, verified: Boolean(securityContact?.emailVerified) },
    { label: "Account phone", value: securityContact?.phone ?? null, verified: Boolean(securityContact?.phoneVerified) },
  ];

  /** The security contact has its own indicator, so it is not repeated here. */
  const missingOwnerFields = (overview?.checklist.missingFields ?? []).filter(
    (field): field is OwnerEditableField => field !== "contactEmail" && field !== "contactPhone",
  );

  const applicationStatus = String(overview?.application?.status ?? "").toUpperCase();
  const providerStatus = String(overview?.providerAccount?.status ?? "").toUpperCase();
  const returnedForCorrection = applicationStatus === "ACTION_REQUIRED";
  const wasRejected =
    ["ADMIN_REJECTED", "PROVIDER_REJECTED", "REJECTED"].includes(applicationStatus) ||
    ["ADMIN_REJECTED", "PROVIDER_REJECTED", "REJECTED"].includes(providerStatus);

  /**
   * The six things that have to happen, in order, before a property can take a
   * guest payment. Derived from the same checklist the server enforces, so the
   * rail can never claim progress the API would refuse.
   */
  const journey: JourneyStep[] = (() => {
    if (!overview?.subscribed) return [];

    const reviewDone =
      applicationStatus === "SUBMISSION_QUEUED" ||
      providerStatus === "SUBMISSION_QUEUED" ||
      providerStatus === "ACTIVE";

    const steps: Array<{ key: string; label: string; done: boolean }> = [
      { key: "details", label: "Business details", done: missingOwnerFields.length === 0 && overview.checklist.ownerTinStatus === "MATCH" },
      { key: "documents", label: "Documents", done: overview.checklist.missingDocuments.length === 0 },
      { key: "contact", label: "Account contact", done: securityContactReady },
      { key: "policy", label: "Policy accepted", done: overview.checklist.policyAccepted },
      { key: "review", label: "NoLSAF review", done: reviewDone },
      { key: "provider", label: "Provider activation", done: providerStatus === "ACTIVE" },
    ];

    let currentTaken = false;
    return steps.map((step): JourneyStep => {
      if (step.done) return { ...step, state: "done" };
      if (currentTaken) return { ...step, state: "todo" };
      currentTaken = true;
      if (step.key === "review" && returnedForCorrection) return { ...step, state: "attention" };
      if (wasRejected) return { ...step, state: "attention" };
      // Under review the owner has nothing to do, so it is not "in progress"
      // for them; it is a wait.
      if (step.key === "review" && applicationStatus === "READY_FOR_ADMIN_REVIEW") {
        return { ...step, state: "waiting" };
      }
      return { ...step, state: "current" };
    });
  })();

  const journeyDone = journey.filter((step) => step.state === "done").length;
  const journeyPercent = journey.length > 0 ? Math.round((journeyDone / journey.length) * 100) : 0;
  const journeyProgress = journeyPercent >= 100
    ? { bar: "bg-emerald-600", track: "bg-emerald-100", text: "text-emerald-700", label: "Setup complete" }
    : journeyPercent >= 67
      ? { bar: "bg-teal-600", track: "bg-teal-100", text: "text-teal-700", label: "Almost ready" }
      : journeyPercent >= 34
        ? { bar: "bg-indigo-600", track: "bg-indigo-100", text: "text-indigo-700", label: "In progress" }
        : journeyPercent > 0
          ? { bar: "bg-blue-600", track: "bg-blue-100", text: "text-blue-700", label: "Getting started" }
          : { bar: "bg-neutral-300", track: "bg-neutral-100", text: "text-neutral-600", label: "Not started" };
  const nextStep = journey.find((step) => step.state !== "done" && step.state !== "todo") ?? null;

  /**
   * Once NoLSAF approves, the legal identity is the package the provider was
   * given, and the service refuses every further write to it. Review is a
   * temporary lock because the application can still be returned; approval and
   * rejection are permanent. The distinction is spelled out because "locked"
   * alone reads as "locked for now".
   */
  /**
   * The pre-submit checklist, with the specific reason a row is not ready.
   * These are the same four conditions the submit endpoint enforces, so the
   * panel never invites a submission the service would refuse.
   */
  const submitChecklist: Array<{ label: string; ready: boolean; detail: string }> = overview?.subscribed
    ? [
        {
          label: "Business details",
          ready: missingOwnerFields.length === 0 && overview.checklist.ownerTinStatus === "MATCH",
          detail:
            missingOwnerFields.length > 0
              ? `Missing ${missingOwnerFields.map((field) => FIELD_LABELS[field].toLowerCase()).join(", ")}`
              : overview.checklist.ownerTinStatus === "MATCH"
                ? "Complete and matched"
                : overview.checklist.ownerTinStatus === "NOT_ON_FILE"
                  ? "Add your Company TIN in My Profile"
                  : "Company TIN must match Owner Workspace",
        },
        {
          label: "Account security contact",
          ready: securityContactReady,
          detail: securityContactReady
            ? "Email and phone verified"
            : !securityContact?.emailVerified && !securityContact?.phoneVerified
              ? "Verify your email and phone in My Profile"
              : !securityContact?.emailVerified
                ? "Verify your email in My Profile"
                : "Verify your phone in My Profile",
        },
        {
          label: "Required documents",
          ready: overview.checklist.missingDocuments.length === 0,
          detail:
            overview.checklist.missingDocuments.length === 0
              ? "Business licence and TIN certificate linked"
              : `Needed: ${overview.checklist.missingDocuments.map((type) => (type === "BUSINESS_LICENCE" ? "business licence" : "TIN certificate")).join(", ")}`,
        },
        {
          label: "Payment policy",
          ready: overview.checklist.policyAccepted,
          detail: overview.checklist.policyAccepted
            ? `Version ${policy?.policyVersion ?? ""} accepted`.trim()
            : "Read the policy and accept it",
        },
      ]
    : [];

  const approvedOrBeyond =
    applicationStatus === "SUBMISSION_QUEUED" ||
    ["SUBMISSION_QUEUED", "PROVIDER_REVIEW", "SUBMITTED", "PENDING_PROVIDER", "ACTIVE", "SUSPENDED"].includes(providerStatus);
  const detailsLock: { permanent: boolean; title: string; body: string } | null = !overview?.subscribed || editable
    ? null
    : approvedOrBeyond
      ? {
          permanent: true,
          title: "Locked permanently",
          body: "These are the details NoLSAF approved and sent to the payment provider. They cannot be changed from here at any point after approval. If something is wrong, contact NoLSAF support.",
        }
      : wasRejected
        ? {
            permanent: true,
            title: "Locked",
            body: "This application was not approved, so its details can no longer be edited. Contact NoLSAF support to discuss the next available step.",
          }
        : {
            permanent: false,
            title: "Locked while under review",
            body: "NoLSAF is reviewing this exact version. If anything needs correcting, the application is returned to you and a new version is opened.",
          };

  /**
   * Turns the plain text policy into sections of reflowable blocks.
   *
   * A numbered heading is "N. TITLE"; a clause is "N.N text"; a lettered item
   * is an indented "(a) text". Anything else continues the block above it, so
   * the document's own 80 column wrapping is undone rather than rendered.
   */
  const policySections = useMemo<PolicySection[]>(() => {
    if (!policy) return [];

    const sections: PolicySection[] = [];
    let current: PolicySection = { key: "opening", title: "Opening", blocks: [] };
    let open: PolicyBlock | null = null;

    const closeBlock = () => {
      if (open) current.blocks.push(open);
      open = null;
    };
    const closeSection = () => {
      closeBlock();
      if (current.blocks.length > 0) sections.push(current);
    };

    for (const raw of policy.content.split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) {
        closeBlock();
        continue;
      }

      // The masthead lines are already shown in the reader's header.
      if (
        current.key === "opening" &&
        /^(NOLSAF MERCHANT PAYMENT POLICY|Policy ID:|Version:|Issued:)/.test(line)
      ) {
        continue;
      }

      const heading = /^(\d{1,2})\.\s+([A-Z].*)$/.exec(line);
      if (heading) {
        closeSection();
        current = { key: `section-${heading[1]}`, title: `${heading[1]}. ${heading[2]}`, blocks: [] };
        continue;
      }

      const clause = /^(\d{1,2}\.\d{1,2})\s+(.*)$/.exec(line);
      if (clause) {
        closeBlock();
        open = { kind: "clause", label: clause[1], text: clause[2].trim() };
        continue;
      }

      const item = /^\s{4,}\(([a-z])\)\s+(.*)$/.exec(line);
      if (item) {
        closeBlock();
        open = { kind: "item", label: `(${item[1]})`, text: item[2].trim() };
        continue;
      }

      if (open) {
        open.text = `${open.text} ${line.trim()}`;
        continue;
      }
      // A paragraph that was indented in the source belongs with the clause
      // above it, so it keeps that alignment instead of falling to the margin.
      open = { kind: "paragraph", text: line.trim(), indented: /^\s{4,}/.test(line) };
    }

    closeSection();
    return sections;
  }, [policy]);

  /** The opening block carries the title and has no number of its own. */
  const numberedSections = policySections.filter((section) => section.key !== "opening");

  const policyRead = Boolean(policy && policyReadVersion === policy.policyVersion);

  /**
   * Marks the policy read once the reader is scrolled to the bottom.
   *
   * This is a consent affordance, not a security control: it makes "I have read
   * this" mean something in the ordinary case rather than being a checkbox on
   * an unopened document. The binding evidence is still the version and content
   * hash recorded server side when acceptance is submitted.
   */
  const markPolicyReadIfAtEnd = useCallback(
    (element: HTMLElement | null) => {
      if (!element || !policy) return;
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining <= 24) setPolicyReadVersion(policy.policyVersion);
    },
    [policy],
  );

  /** Highlights the section the reader is currently looking at. */
  const trackActiveSection = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const boundary = element.getBoundingClientRect().top + 12;
    let current: string | null = null;
    for (const child of Array.from(element.querySelectorAll<HTMLElement>("[data-policy-section]"))) {
      if (child.getBoundingClientRect().top <= boundary) current = child.id;
    }
    setActiveSection(current);
  }, []);

  useEffect(() => {
    if (!policyReaderOpen) return;
    // A short document, or a tall window, may not scroll at all. Opening it is
    // then the whole of reading it.
    markPolicyReadIfAtEnd(policyArticleRef.current);
    trackActiveSection(policyArticleRef.current);
  }, [markPolicyReadIfAtEnd, policyReaderOpen, trackActiveSection]);

  useEffect(() => {
    if (!policyReaderOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPolicyReaderOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [policyReaderOpen]);

  useEffect(() => {
    if (!formChanged || !editable) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const warnBeforeLink = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      if (!window.confirm("Discard the unsaved business detail changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", warnBeforeLink, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", warnBeforeLink, true);
    };
  }, [editable, formChanged]);

  const perform = async (
    action: NonNullable<typeof busy>,
    request: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      await request();
      setMessage(success);
      await loadOverview();
    } catch (requestError: unknown) {
      setError(requestMessage(requestError, "The action could not be completed."));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Back to the company choice. Picking a company was a one-click decision
   * with no way back: choose wrong and the property was tied to that legal
   * entity for good. The server refuses once anything has been submitted.
   */
  const detach = () => {
    if (!detailPropertyId) return;
    void perform(
      "detach",
      () => apiClient.post(`/api/owner/payments/merchant/${detailPropertyId}/detach`, {}),
      "Choose which company operates this property.",
    );
  };

  const subscribe = (merchantId?: number) => {
    if (!detailPropertyId) return;
    setSubscribeTarget(merchantId ?? "new");
    void perform(
      "subscribe",
      () =>
        apiClient.post(
          `/api/owner/payments/merchant/${detailPropertyId}/subscribe`,
          merchantId ? { merchantId } : {},
        ),
      merchantId
        ? "This property now uses your existing company."
        : "Your private payment application is ready to complete.",
    ).finally(() => setSubscribeTarget(null));
  };

  const saveDraft = () => {
    if (!detailPropertyId) return;
    const firstError = Object.values(formErrors)[0];
    if (firstError) {
      setError(firstError);
      setMessage(null);
      return;
    }
    const payload = {
      legalName: form.legalName.trim(),
      tradingName: form.tradingName.trim() || null,
      registrationNumber: form.registrationNumber.trim() || null,
      tin: form.tin.trim(),
      country: form.country.trim().toUpperCase(),
    };
    void perform(
      "save",
      () => apiClient.put(`/api/owner/payments/merchant/${detailPropertyId}/draft`, payload),
      "Business details saved.",
    );
  };

  const checkCompanyTin = async () => {
    if (!detailPropertyId || !editable) return;
    const candidate = form.tin.trim();
    if (!candidate || formErrors.tin) return;
    if (normalizedTin(candidate) === normalizedTin(tinCheck.checkedTin) && tinCheck.status !== "ERROR") return;

    setTinCheck({ status: "CHECKING", checkedTin: candidate });
    try {
      const response = await apiClient.post<{ status: OwnerTinStatus }>(
        `/api/owner/payments/merchant/${detailPropertyId}/tin-match`,
        { tin: candidate },
      );
      setTinCheck({ status: response.data.status, checkedTin: candidate });
      if (response.data.status === "MATCH") setShowTinConfirmation(true);
    } catch {
      setTinCheck({ status: "ERROR", checkedTin: candidate });
    }
  };

  const acceptPolicy = () => {
    if (!detailPropertyId || !policy) return;
    // Also checked here, not only on the buttons, so no stale dialog can submit
    // an acceptance for a document that was never opened.
    if (!policyRead) {
      setConfirmation(null);
      setPolicyReaderOpen(true);
      return;
    }
    setConfirmation(null);
    setPolicyConfirmed(false);
    void perform(
      "accept",
      () => apiClient.post(`/api/owner/payments/merchant/${detailPropertyId}/policy-acceptance`, { policyVersion: policy.policyVersion }),
      `Payment policy ${policy.policyVersion} accepted.`,
    );
  };

  const submitApplication = () => {
    if (!detailPropertyId) return;
    setConfirmation(null);
    void perform(
      "submit",
      () => apiClient.post(`/api/owner/payments/merchant/${detailPropertyId}/submit`, {}),
      "Application submitted for NoLSAF review.",
    );
  };

  const renderBusinessField = (field: (typeof FIELD_CONFIG)[number]) => {
    const missing = overview?.checklist.missingFields.includes(field.key) ?? false;
    const fieldError = formErrors[field.key];
    const describedBy = field.key === "tin" ? "company-tin-status" : fieldError ? `${field.key}-error` : undefined;

    return (
      <label key={field.key} className="block text-xs font-bold text-neutral-700">
        {field.label}{field.required && <span className="ml-1 text-red-500">*</span>}
        <input
          type="text"
          value={form[field.key]}
          onChange={(event) => {
            const nextValue = field.key === "country" ? event.target.value.toUpperCase() : event.target.value;
            setForm((current) => ({ ...current, [field.key]: nextValue }));
            if (field.key === "tin" && normalizedTin(nextValue) !== normalizedTin(tinCheck.checkedTin)) {
              setTinCheck({ status: "NOT_ENTERED", checkedTin: "" });
            }
          }}
          onBlur={field.key === "tin" ? () => void checkCompanyTin() : undefined}
          disabled={!editable || busy !== null}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          aria-invalid={Boolean(fieldError || missing) || undefined}
          aria-describedby={describedBy}
          className={`mt-1.5 box-border h-11 w-full rounded-lg border-0 bg-white px-3 text-sm font-medium text-neutral-950 outline-none ring-1 transition placeholder:font-normal placeholder:text-neutral-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 ${fieldError ? "ring-red-300 focus:ring-red-400" : missing ? "ring-amber-300 focus:ring-amber-400" : "ring-neutral-200 focus:ring-emerald-400"}`}
        />
        {fieldError && <span id={`${field.key}-error`} className="mt-1.5 block text-[10px] font-medium leading-4 text-red-600">{fieldError}</span>}
        {field.key === "tin" && !fieldError && (
          <span id="company-tin-status" className="mt-1.5 block text-[10px] font-medium leading-4">
            {tinCheck.status === "CHECKING" && <span className="inline-flex items-center gap-1.5 text-neutral-500"><Loader2 className="h-3 w-3 animate-spin" />Checking Owner Workspace</span>}
            {tinCheck.status === "MATCH" && <span className="inline-flex items-center gap-1.5 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" />Matches Owner Workspace</span>}
            {tinCheck.status === "MISMATCH" && <span className="text-amber-700">Does not match the Company TIN in Owner Workspace. Check the number or <Link href="/owner/profile" className="font-bold text-amber-800 underline">update My Profile</Link>.</span>}
            {tinCheck.status === "NOT_ON_FILE" && <span className="text-amber-700">No Company TIN is saved in Owner Workspace. <Link href="/owner/profile" className="font-bold text-amber-800 underline">Add it in My Profile</Link> before submitting.</span>}
            {tinCheck.status === "ERROR" && <span className="text-red-600">The match could not be checked. Leave the field and try again.</span>}
            {tinCheck.status === "NOT_ENTERED" && form.tin.trim() && <span className="text-neutral-500">Leave this field to match it with Owner Workspace.</span>}
          </span>
        )}
      </label>
    );
  };

  if (!detailProperty) {
    return (
      <PaymentsHome
        properties={properties}
        onOpen={(propertyId) => {
          setSelectedPropertyId(propertyId);
          router.push(`/owner/nrms/payments?property=${propertyId}`);
        }}
      />
    );
  }

  if (loading || overviewPropertyId !== detailPropertyId) {
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
        <PaymentsBackButton onBack={backToPayments} />
        <div className="flex min-h-[20rem] items-center justify-center">
          <div className="flex items-center gap-3 text-sm font-semibold text-neutral-500">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />Loading payment setup
          </div>
        </div>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
        <PaymentsBackButton onBack={backToPayments} />
        <section className="overflow-hidden rounded-2xl bg-white shadow-[0_14px_38px_-32px_rgba(15,23,42,0.5)] ring-1 ring-neutral-200">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-4 px-5 py-4 sm:px-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200"><Clock3 className="h-5 w-5" /></span>
            <div className="min-w-[16rem] flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.17em] text-emerald-700">NRMS property payments</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-amber-800 ring-1 ring-amber-200"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Setup unavailable</span>
              </div>
              <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">Guest payment setup</h1>
              <p className="mb-0 mt-1 max-w-3xl text-xs leading-5 text-neutral-500">Payment onboarding is currently disabled for {detailProperty.title}. Guest payment collection remains off, and no setup action is required from the property.</p>
              {unavailable.trim().toLowerCase() !== "online payment is not available yet." && <p className="mb-0 mt-1 text-[11px] leading-5 text-neutral-400">{unavailable}</p>}
            </div>
            <button type="button" onClick={() => void loadOverview()} className="inline-flex h-10 appearance-none items-center gap-2 rounded-xl border-0 bg-white px-3.5 text-xs font-bold text-neutral-600 shadow-sm ring-1 ring-neutral-200 transition hover:bg-emerald-50 hover:text-emerald-800 hover:ring-emerald-300">
              <RefreshCw className="h-4 w-4" />Check access
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-neutral-50/70 px-5 py-3 shadow-[inset_0_1px_0_0_#e5e7eb] sm:px-6">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold text-emerald-800"><CheckCircle2 className="h-4 w-4" />NRMS continues normally</span>
            <span className="hidden h-4 w-px bg-neutral-200 sm:block" aria-hidden="true" />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-neutral-500">
              <span>Front desk</span><span>Reservations</span><span>Restaurant and bar</span><span>Current payment methods</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!overview) {
    if (rateLimitUntil !== null) {
      const waiting = retrySeconds > 0;
      return (
        <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
          <PaymentsBackButton onBack={backToPayments} />
          <section aria-live="polite" className="mx-auto max-w-4xl overflow-hidden rounded-2xl bg-white shadow-[0_14px_38px_-32px_rgba(15,23,42,0.5)] ring-1 ring-amber-200">
            <div className="flex flex-col gap-5 bg-amber-50/80 px-5 py-6 sm:flex-row sm:items-center sm:px-7">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-amber-700 shadow-sm ring-1 ring-amber-200">
                <Clock3 className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-800">Temporary request limit</p>
                  {waiting && <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold tabular-nums text-amber-800 ring-1 ring-amber-200">Available in {retryCountdown(retrySeconds)}</span>}
                </div>
                <h1 className="mb-0 mt-2 text-lg font-bold text-neutral-950">{waiting ? "Please wait before trying again" : "You can try again now"}</h1>
                <p className="mb-0 mt-1 max-w-2xl text-sm leading-6 text-neutral-600">
                  {waiting
                    ? "Several payment-status requests were received in a short time. Nothing is wrong with your application—access will reopen automatically when the timer reaches zero."
                    : "The temporary wait has finished. Reload the payment setup when you are ready."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadOverview()}
                disabled={waiting}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border-0 bg-amber-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-amber-800 disabled:cursor-wait disabled:bg-amber-200 disabled:text-amber-700"
              >
                {waiting ? <Clock3 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                {waiting ? `Try again in ${retryCountdown(retrySeconds)}` : "Try again now"}
              </button>
            </div>
            <div className="flex items-start gap-2 px-5 py-3 text-[11px] leading-5 text-neutral-500 sm:px-7">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
              Your saved payment setup, documents and provider-review progress are unchanged.
            </div>
          </section>
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
        <PaymentsBackButton onBack={backToPayments} />
        <section className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><h1 className="m-0 text-base font-bold text-red-900">Payment setup could not be loaded</h1><p className="mb-0 mt-1 text-sm text-red-700">{error ?? "Try again in a moment."}</p><button type="button" onClick={() => void loadOverview()} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700"><RefreshCw className="h-3.5 w-3.5" />Try again</button></div></div>
        </section>
      </div>
    );
  }

  const StatusIcon = status!.Icon;
  const tone = TONE_CLASSES[status!.tone];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
      <PaymentsHeader
        propertyName={detailProperty.title}
        statusLabel={status!.label}
        tone={status!.tone}
        onBack={backToPayments}
        // Offered only while the draft is untouched by review, matching the
        // rule the server enforces.
        onDetach={overview.subscribed && String(overview.application?.status ?? "DRAFT").toUpperCase() === "DRAFT" && !overview.application?.submittedAt ? detach : undefined}
        detaching={busy === "detach"}
      />

      {message && <div role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>}
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 ring-1 ring-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      <section className={`rounded-2xl p-4 ring-1 sm:p-5 ${tone.panel}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ${tone.icon}`}><StatusIcon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Application status</p><h2 className="mb-0 mt-1 text-lg font-bold text-neutral-950">{status!.label}</h2><p className="mb-0 mt-1 text-sm text-neutral-600">{status!.description}</p></div>
          {nextStep && (
            <span className={`w-fit shrink-0 rounded-lg px-3 py-2 shadow-sm ring-1 ${tone.badge}`}>
              <span className="block text-[9px] font-bold uppercase tracking-[0.12em] opacity-70">{nextStep.state === "waiting" ? "Waiting on" : "Next step"}</span>
              <span className="mt-0.5 block text-xs font-bold">{nextStep.state === "waiting" ? "NoLSAF review" : nextStep.label}</span>
            </span>
          )}
        </div>
        {reviewReason && (["ACTION_REQUIRED", "ADMIN_REJECTED", "PROVIDER_REJECTED", "REJECTED"].includes(String(overview.application?.status ?? "").toUpperCase()) || ["SUSPENDED", "ADMIN_REJECTED", "PROVIDER_REJECTED", "REJECTED"].includes(String(overview.providerAccount?.status ?? "").toUpperCase())) && (
          <div className="mt-4 pt-4 shadow-[inset_0_1px_0_0_rgba(15,23,42,0.06)]"><p className="m-0 text-xs font-bold text-neutral-800">Review note</p><p className="mb-0 mt-1 text-sm leading-6 text-neutral-600">{reviewReason}</p></div>
        )}
      </section>

      {journey.length > 0 && (
        <section className="rounded-2xl bg-white p-4 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ring-1 ring-neutral-200 sm:p-5">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Setup progress</p>
            <div className="text-right">
              <p className={`m-0 text-sm font-extrabold tabular-nums ${journeyProgress.text}`}>{journeyPercent}% complete</p>
              <p className="mb-0 mt-0.5 text-[10px] font-medium text-neutral-500">{journeyDone} of {journey.length} steps · {journeyProgress.label}</p>
            </div>
          </div>
          <div
            className={`mb-3 h-1.5 w-full overflow-hidden rounded-full ${journeyProgress.track}`}
            role="progressbar"
            aria-label="Payment setup progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={journeyPercent}
            aria-valuetext={`${journeyPercent}% complete, ${journeyDone} of ${journey.length} steps`}
          >
            <div className={`h-full rounded-full transition-[width,background-color] duration-500 ${journeyProgress.bar}`} style={{ width: `${journeyPercent}%` }} />
          </div>
          <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {journey.map((step, index) => {
              const stepTone = JOURNEY_TONES[step.state];
              // A completed step had nowhere to go back to. Every step that has
              // a section on this page is now a jump link, so an owner can
              // reread what they entered instead of scrolling to find it.
              // "NoLSAF review" and "Provider activation" happen off this page
              // and stay inert rather than pretending to lead somewhere.
              const target = SETUP_ANCHORS[step.key];
              const body = (
                <>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${stepTone.dot}`}>
                    {step.state === "done" ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[11px] font-bold text-neutral-900">{step.label}</span>
                    <span className={`block text-[10px] font-bold ${stepTone.label}`}>{stepTone.word}</span>
                  </span>
                  {target && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-500" />}
                </>
              );
              return (
                <li key={step.key}>
                  {target ? (
                    <a
                      href={`#${target}`}
                      title={`Go to ${step.label}`}
                      className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 no-underline ring-1 transition hover:shadow-sm hover:no-underline ${stepTone.tile}`}
                    >
                      {body}
                    </a>
                  ) : (
                    <span className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 ring-1 ${stepTone.tile}`}>{body}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {!overview.subscribed ? (
        overview.reusableMerchants.length > 0 ? (
          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ring-1 ring-neutral-200 sm:p-7">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Building2 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 className="m-0 text-xl font-bold text-neutral-950">Which company operates this property?</h2>
                <p className="mb-0 mt-2 max-w-3xl text-sm leading-6 text-neutral-500">Select an existing company only when this property uses the same registered business and TIN. The properties will share one application and payment account.</p>
                <p className="mb-0 mt-2 flex items-center gap-1.5 text-[11px] font-medium text-neutral-600"><ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />Company details can be reviewed before submission.</p>
              </div>
            </div>

            <ul className="m-0 mt-6 grid list-none gap-4 p-0 lg:grid-cols-2">
              {overview.reusableMerchants.map((merchant) => {
                const state = reusableMerchantState(merchant);
                const companyName = merchant.legalName?.trim() || merchant.tradingName?.trim() || "Company application draft";
                const isJoining = busy === "subscribe" && subscribeTarget === merchant.merchantId;
                return (
                  <li key={merchant.merchantId} className="group flex min-h-[14rem] flex-col rounded-2xl bg-white p-5 shadow-[0_10px_30px_-28px_rgba(15,23,42,0.5)] ring-1 ring-neutral-200 transition hover:-translate-y-0.5 hover:shadow-[0_18px_38px_-28px_rgba(15,23,42,0.38)] hover:ring-neutral-300 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${state.icon}`}><Building2 className="h-5 w-5" /></span>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${state.badge}`}><span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />{state.label}</span>
                    </div>

                    <div className="mt-4 min-w-0">
                      <h3 className="m-0 truncate text-base font-bold text-neutral-950">{companyName}</h3>
                      <p className="mb-0 mt-1 text-[11px] leading-5 text-neutral-500">
                        {merchant.tradingName && merchant.tradingName.trim() !== companyName ? `Trading as ${merchant.tradingName}` : "Registered company account"}
                      </p>
                      <p className="mb-0 mt-3 text-xs leading-5 text-neutral-700">{state.effect}</p>
                    </div>

                    <div className="mt-auto flex flex-col gap-3 border-t border-neutral-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500"><Building2 className="h-3.5 w-3.5" />{merchant.propertyCount} connected {merchant.propertyCount === 1 ? "property" : "properties"}</span>
                      <button type="button" onClick={() => subscribe(merchant.merchantId)} disabled={busy !== null || !state.canJoin} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400">
                        {isJoining ? <Loader2 className="h-4 w-4 animate-spin" /> : state.canJoin ? <ArrowRight className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                        {isJoining ? "Connecting..." : state.canJoin ? "Choose company" : "Unavailable"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 flex flex-col gap-4 border-t border-neutral-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-50 text-neutral-600"><Building2 className="h-4 w-4" /></span>
                <div><p className="m-0 text-sm font-bold text-neutral-900">Registered under a different company?</p><p className="mb-0 mt-1 max-w-2xl text-[11px] leading-5 text-neutral-500">Start a separate application when this property has a different legal entity or TIN. It will receive its own review and payment account.</p></div>
              </div>
              <button type="button" onClick={() => subscribe()} disabled={busy !== null} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border-0 bg-white px-4 text-xs font-bold text-neutral-800 ring-1 ring-neutral-300 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400">
                {busy === "subscribe" && subscribeTarget === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {busy === "subscribe" && subscribeTarget === "new" ? "Starting setup..." : "Start separate setup"}
              </button>
            </div>
          </section>
        ) : (
        <section className="rounded-2xl bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ring-1 ring-neutral-200 sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:items-center">
            <div><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CircleDollarSign className="h-5 w-5" /></span><h2 className="mb-0 mt-4 text-xl font-bold text-neutral-950">Set up property payments</h2><p className="mb-0 mt-2 max-w-2xl text-sm leading-6 text-neutral-500">Create a private application for this property. You will review the business details, link the documents already held in My Profile, and accept the payment policy before submitting.</p></div>
            <div className="rounded-xl bg-neutral-50 p-4 ring-1 ring-neutral-200"><p className="m-0 text-xs font-bold text-neutral-800">Safe starting point</p><p className="mb-0 mt-1 text-[11px] leading-5 text-neutral-500">This creates a draft only. It does not open a wallet, enable checkout, or move money.</p><button type="button" onClick={() => subscribe()} disabled={busy !== null} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">{busy === "subscribe" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{busy === "subscribe" ? "Creating draft" : "Start setup"}</button></div>
          </div>
        </section>
        )
      ) : (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.7fr)]">
            <section id="setup-details" className="scroll-mt-24 overflow-hidden rounded-xl bg-white ring-1 ring-neutral-200">
              <div className="flex items-start gap-3 px-5 py-4 shadow-[inset_0_-1px_0_0_#e5e7eb] sm:px-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Building2 className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 text-base font-bold text-neutral-950">Business details</h2>
                    {overview.linkedProperties.length > 1 && (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100">
                        <Building2 className="h-3 w-3" />Shared by {overview.linkedProperties.length} properties
                      </span>
                    )}
                  </div>
                  <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">
                    {overview.linkedProperties.length > 1
                      ? `One company, one payment account. These details cover ${overview.linkedProperties.map((entry) => entry.title ?? `Property ${entry.propertyId}`).join(", ")}.`
                      : "The legal identity and account contact that will be reviewed for this property."}
                  </p>
                </div>
              </div>
              <div className="p-5 sm:p-6">
                {detailsLock && (
                  <div className={`mb-5 flex items-start gap-3 rounded-xl p-3.5 ring-1 ${detailsLock.permanent ? "bg-neutral-100 ring-neutral-300" : "bg-blue-50 ring-blue-200"}`}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${detailsLock.permanent ? "bg-white text-neutral-700 ring-1 ring-neutral-300" : "bg-white text-blue-700 ring-1 ring-blue-200"}`}><Lock className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <p className={`m-0 text-xs font-bold ${detailsLock.permanent ? "text-neutral-900" : "text-blue-900"}`}>{detailsLock.title}</p>
                      <p className={`mb-0 mt-1 text-[11px] leading-5 ${detailsLock.permanent ? "text-neutral-600" : "text-blue-800"}`}>{detailsLock.body}</p>
                    </div>
                  </div>
                )}
                <section>
                  <div className="mb-4"><h3 className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-neutral-800">Legal identity</h3><p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-500">Enter the details exactly as they appear on the company registration and tax records.</p></div>
                  <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">{FIELD_CONFIG.map(renderBusinessField)}</div>
                </section>
                <section id="setup-contact" className="mt-6 scroll-mt-24 pt-5 shadow-[inset_0_1px_0_0_#e5e7eb]">
                  <div className="mb-4"><h3 className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-neutral-800">Account security contact</h3><p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-500">Taken from your verified Owner account. The payment provider uses these for sign-in checks, recovery, and payment account notices, so they cannot be typed here or pointed at a staff member.</p></div>
                  <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                    {securityContactRows.map((row) => (
                      <div key={row.label} className="rounded-lg bg-neutral-50 px-3 py-2.5 ring-1 ring-neutral-200">
                        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">{row.label}</p>
                        <p className="mb-0 mt-1 truncate text-sm font-semibold text-neutral-950">{row.value ?? "Not on file"}</p>
                        <span className={`mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold ${row.verified ? "text-emerald-700" : "text-amber-700"}`}>
                          {row.verified ? <BadgeCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                          {row.verified ? "Verified" : row.value ? "Not verified" : "Not on file"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {!securityContactReady && (
                    <p className="mb-0 mt-3 text-[11px] leading-5 text-amber-800">
                      Submission stays blocked until both are verified. <Link href="/owner/profile" className="font-bold text-amber-900 underline">Verify them in My Profile</Link>.
                    </p>
                  )}
                </section>
              </div>
              <div className="flex flex-col gap-3 bg-neutral-50/70 px-5 py-4 shadow-[inset_0_1px_0_0_#f1f5f9] sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="m-0 text-[11px] text-neutral-500">{editable ? "Required fields are marked with an asterisk." : detailsLock?.permanent ? "These details are final and cannot be edited." : "Details are locked while this version is under review."}</p><button type="button" onClick={saveDraft} disabled={!editable || !formChanged || busy !== null} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{busy === "save" ? "Saving" : formChanged ? "Save details" : "Details saved"}</button></div>
            </section>

            <section id="setup-documents" className="scroll-mt-24 rounded-2xl bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ring-1 ring-neutral-200">
              <div className="px-5 py-4 shadow-[inset_0_-1px_0_0_#f1f5f9]"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><FileCheck2 className="h-5 w-5" /></span><div><h2 className="m-0 text-base font-bold text-neutral-950">Required documents</h2><p className="mb-0 mt-1 text-xs text-neutral-500">Linked securely from My Profile</p></div></div></div>
              <div className="px-5 [&>div+div]:shadow-[inset_0_1px_0_0_#f1f5f9]">
                {DOCUMENTS.map((required) => {
                  const document = overview.documents.find((item) => item.documentType === required.type);
                  const missing = overview.checklist.missingDocuments.includes(required.type);
                  const expiresAt = document?.expiresAt ? new Date(document.expiresAt) : null;
                  const expired = Boolean(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now());
                  const presentation = documentStatus(document?.status, missing, expired);
                  const DocumentIcon = presentation.Icon;
                  return <div key={required.type} className="py-4"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-neutral-500"><FileText className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="m-0 text-xs font-bold text-neutral-900">{required.label}</p><p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-500">{expired ? "This document has expired. Replace it in My Profile." : expiresAt ? `Expires ${expiresAt.toLocaleDateString()}` : required.description}</p></div><span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold ${presentation.cls}`}><DocumentIcon className="h-3 w-3" />{presentation.label}</span></div></div>;
                })}
              </div>
              <div className="bg-neutral-50/70 px-5 py-4 shadow-[inset_0_1px_0_0_#f1f5f9]"><Link href="/owner/profile" className="inline-flex min-h-9 items-center gap-2 rounded-lg border-0 bg-white px-3 text-xs font-bold text-neutral-700 no-underline ring-1 ring-neutral-200 transition hover:bg-neutral-50 hover:text-neutral-950 hover:no-underline">Open My Profile <ExternalLink className="h-3.5 w-3.5" /></Link></div>
            </section>
          </div>

          <section id="setup-policy" className="scroll-mt-24 rounded-2xl bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ring-1 ring-neutral-200">
            <div className="flex flex-col gap-3 px-5 py-4 shadow-[inset_0_-1px_0_0_#f1f5f9] sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><ShieldCheck className="h-5 w-5" /></span><div><h2 className="m-0 text-base font-bold text-neutral-950">Payment policy</h2><p className="mb-0 mt-1 text-xs text-neutral-500">Read the current terms before submitting.</p></div></div>{overview.checklist.policyAccepted && <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100"><Check className="h-3.5 w-3.5" />Current version accepted</span>}</div>
            <div className="p-5 sm:p-6">
              {policyLoading ? <div className="flex min-h-32 items-center justify-center text-xs font-semibold text-neutral-500"><Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-700" />Loading policy</div> : policyUnavailable ? <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" /><div><p className="m-0 text-xs font-bold text-amber-900">Policy not ready</p><p className="mb-0 mt-1 text-xs leading-5 text-amber-800">{policyUnavailable}</p></div></div></div> : policy ? (
                <>
                  <button type="button" onClick={() => setPolicyReaderOpen(true)} className="flex w-full items-center gap-3.5 rounded-xl border-0 bg-neutral-50 p-4 text-left ring-1 ring-neutral-200 transition hover:bg-emerald-50 hover:ring-emerald-300">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 ring-1 ring-neutral-200"><FileText className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-neutral-950" style={{ fontFamily: POLICY_FONT }}>NoLSAF Merchant Payment Policy</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-neutral-500">Version {policy.policyVersion} · {policy.policyId} · {numberedSections.length} sections</span>
                      <span className="mt-1 block text-[11px] leading-4 text-neutral-500">What the payment capability does, what it never does, and where NRMS keeps working without it.</span>
                      {!overview.checklist.policyAccepted && (
                        <span className={`mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold ${policyRead ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          {policyRead ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          {policyRead ? "Read to the end" : "Not read yet"}
                        </span>
                      )}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">{policyRead ? "Open policy" : "Read full policy"}<ArrowRight className="h-3.5 w-3.5" /></span>
                  </button>
                  {!overview.checklist.policyAccepted && (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="m-0 max-w-2xl text-[11px] leading-5 text-neutral-500">{policyRead ? "Your acceptance is recorded against this exact version." : "Open the policy and read it to the end. Acceptance stays locked until you do."}</p>
                      <button type="button" onClick={() => { if (!policyRead) { setPolicyReaderOpen(true); return; } setPolicyConfirmed(false); setConfirmation("policy"); }} disabled={busy !== null} className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border-0 px-4 text-xs font-bold transition disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 ${policyRead ? "bg-emerald-700 text-white hover:bg-emerald-800" : "bg-white text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-50"}`}>{policyRead ? <><Check className="h-4 w-4" />Accept current policy</> : <><FileText className="h-4 w-4" />Read the policy first</>}</button>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </section>

          <section id="setup-review" className="scroll-mt-24 rounded-2xl bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ring-1 ring-neutral-200 sm:p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,23rem)] lg:items-start">
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Final check</p>
                <h2 className="mb-0 mt-2 text-lg font-bold text-neutral-950">Submit for NoLSAF review</h2>
                <p className="mb-0 mt-2 max-w-2xl text-sm leading-6 text-neutral-500">Submission freezes this application version for review. It does not activate online payments or create permission to collect money.</p>
                <ul className="m-0 mt-4 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
                  {submitChecklist.map((entry) => (
                    <li key={entry.label} className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1 ${entry.ready ? "bg-emerald-50/70 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
                      <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${entry.ready ? "bg-emerald-700 text-white" : "bg-amber-600 text-white"}`}>
                        {entry.ready ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-bold leading-4 text-neutral-900">{entry.label}</span>
                        <span className={`mt-0.5 block text-[10px] font-semibold leading-4 ${entry.ready ? "text-emerald-700" : "text-amber-800"}`}>{entry.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-neutral-50 p-4 ring-1 ring-neutral-200">
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 text-xs font-bold text-neutral-800">Application version {overview.application?.version ?? 1}</p>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${overview.checklist.canSubmit ? "bg-emerald-100 text-emerald-800" : "bg-white text-neutral-500 ring-1 ring-neutral-200"}`}>
                    {submitChecklist.filter((entry) => entry.ready).length} of {submitChecklist.length} ready
                  </span>
                </div>
                <p className="mb-0 mt-1.5 text-[11px] leading-5 text-neutral-500">{overview.checklist.canSubmit ? "Everything required for local review is ready." : editable ? "Complete every item on the left before submitting." : `This application is ${titleCase(overview.application?.status ?? "in review")}.`}</p>
                <button type="button" onClick={() => setConfirmation("submit")} disabled={!overview.checklist.canSubmit || busy !== null} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"><ShieldCheck className="h-4 w-4" />Submit for review</button>
                <p className="mb-0 mt-3 flex items-start gap-1.5 text-[10px] font-semibold leading-4 text-neutral-500"><Lock className="mt-px h-3 w-3 shrink-0" />Once NoLSAF approves, these business details are final and cannot be edited here.</p>
              </div>
            </div>
          </section>
        </>
      )}

      {policyReaderOpen && policy && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-6">
          <button type="button" aria-label="Close the payment policy" onClick={() => setPolicyReaderOpen(false)} className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm" />
          <section role="dialog" aria-modal="true" aria-labelledby="policy-reader-title" className="relative flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-neutral-200">
            <div className="flex items-start gap-3 px-5 py-4 shadow-[inset_0_-1px_0_0_#e5e7eb] sm:px-6">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><ShieldCheck className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h2 id="policy-reader-title" className="m-0 text-base font-bold text-neutral-950" style={{ fontFamily: POLICY_FONT }}>NoLSAF Merchant Payment Policy</h2>
                <p className="mb-0 mt-1 text-[11px] text-neutral-500">Version {policy.policyVersion} · {policy.policyId}</p>
              </div>
              {overview.checklist.policyAccepted && <span className="hidden w-fit items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100 sm:inline-flex"><Check className="h-3.5 w-3.5" />Accepted</span>}
              <button type="button" onClick={() => setPolicyReaderOpen(false)} className="inline-flex h-9 shrink-0 items-center rounded-lg border-0 bg-white px-3 text-xs font-bold text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-100">Close</button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
              <nav aria-label="Policy contents" className="hidden min-h-0 overflow-y-auto bg-neutral-50/70 px-3 py-4 shadow-[inset_-1px_0_0_0_#e5e7eb] lg:block" style={{ fontFamily: POLICY_FONT }}>
                <p className="m-0 px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">Contents</p>
                {numberedSections.map((section) => {
                  const split = section.title.indexOf(". ");
                  const active = activeSection === section.key;
                  return (
                    <button
                      key={section.key}
                      type="button"
                      aria-current={active || undefined}
                      onClick={() => document.getElementById(section.key)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className={`flex w-full items-baseline gap-2.5 rounded-lg border-0 px-2 py-[7px] text-left transition ${active ? "bg-white shadow-sm ring-1 ring-emerald-200" : "bg-transparent hover:bg-white/70"}`}
                    >
                      <span className={`w-3.5 shrink-0 text-right text-[11px] font-bold leading-[1.35] ${active ? "text-emerald-700" : "text-neutral-400"}`}>{section.title.slice(0, split)}</span>
                      <span className={`flex-1 text-[12px] leading-[1.35] ${active ? "font-bold text-emerald-900" : "font-semibold text-neutral-600"}`}>{section.title.slice(split + 2)}</span>
                    </button>
                  );
                })}
              </nav>

              <article
                ref={policyArticleRef}
                onScroll={(event) => { markPolicyReadIfAtEnd(event.currentTarget); trackActiveSection(event.currentTarget); }}
                className="min-h-0 overflow-y-auto px-5 py-6 sm:px-8"
                style={{ fontFamily: POLICY_FONT }}
              >
                <div className="mx-auto max-w-[38rem]">
                  {policySections.map((section) => (
                    <section key={section.key} id={section.key} data-policy-section className="scroll-mt-6 pb-8">
                      {section.key !== "opening" && (
                        <h3 className="m-0 mb-3.5 text-[15px] font-bold leading-6 text-neutral-950">{section.title}</h3>
                      )}
                      <div className="space-y-3">
                        {section.blocks.map((block, index) => {
                          const key = `${section.key}-${index}`;
                          if (block.kind === "clause") {
                            return (
                              <div key={key} className="flex gap-3">
                                <span className="w-9 shrink-0 text-[13px] font-bold leading-[1.7] text-neutral-900">{block.label}</span>
                                <p className="m-0 flex-1 text-[13px] leading-[1.7] text-neutral-700">{block.text}</p>
                              </div>
                            );
                          }
                          if (block.kind === "item") {
                            return (
                              <div key={key} className="flex gap-2.5 pl-9">
                                <span className="w-5 shrink-0 text-[13px] font-semibold leading-[1.7] text-neutral-500">{block.label}</span>
                                <p className="m-0 flex-1 text-[13px] leading-[1.7] text-neutral-700">{block.text}</p>
                              </div>
                            );
                          }
                          return <p key={key} className={`m-0 text-[13px] leading-[1.7] text-neutral-700 ${block.indented ? "pl-12" : ""}`}>{block.text}</p>;
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            </div>

            <div className="flex flex-col gap-3 bg-neutral-50/80 px-5 py-3 shadow-[inset_0_1px_0_0_#e5e7eb] sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="m-0 text-[11px] leading-4 text-neutral-500">{overview.checklist.policyAccepted ? `You accepted version ${policy.policyVersion} of this policy.` : policyRead ? "You have reached the end. Accepting records your consent against this exact version." : "Scroll to the end of the document to unlock acceptance."}</p>
              {!overview.checklist.policyAccepted && (
                <button type="button" onClick={() => { setPolicyReaderOpen(false); setPolicyConfirmed(false); setConfirmation("policy"); }} disabled={busy !== null || !policyRead} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">{policyRead ? <><Check className="h-4 w-4" />Accept current policy</> : <>Keep reading to accept</>}</button>
              )}
            </div>
          </section>
        </div>
      )}

      {showTinConfirmation && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <button type="button" aria-label="Close Company TIN confirmation" onClick={() => setShowTinConfirmation(false)} className="absolute inset-0 border-0 bg-neutral-950/35 backdrop-blur-[2px]" />
          <section role="dialog" aria-modal="true" aria-labelledby="tin-confirmation-title" className="relative w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-neutral-200">
            <div className="flex items-start gap-3 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><BadgeCheck className="h-5 w-5" /></span>
              <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">Owner Workspace match</p><h2 id="tin-confirmation-title" className="mb-0 mt-1 text-base font-bold text-neutral-950">Company TIN confirmed</h2><p className="mb-0 mt-2 text-xs leading-5 text-neutral-600">This number matches the Company TIN saved in Owner Workspace. The application will use the same business identity.</p></div>
            </div>
            <div className="flex justify-end bg-neutral-50 px-5 py-3 shadow-[inset_0_1px_0_0_#e5e7eb]"><button type="button" onClick={() => setShowTinConfirmation(false)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 text-xs font-bold text-white hover:bg-emerald-800"><Check className="h-4 w-4" />Continue</button></div>
          </section>
        </div>
      )}

      {confirmation && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <button type="button" aria-label="Close confirmation" onClick={() => { setConfirmation(null); setPolicyConfirmed(false); }} className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm" />
          <section role="dialog" aria-modal="true" aria-labelledby="payment-confirmation-title" className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-neutral-200">
            <div className="flex items-start gap-3 px-5 py-4 shadow-[inset_0_-1px_0_0_#e5e7eb]">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${confirmation === "policy" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}>{confirmation === "policy" ? <FileText className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}</span>
              <div><h2 id="payment-confirmation-title" className="m-0 text-base font-bold text-neutral-950">{confirmation === "policy" ? "Accept this payment policy?" : "Submit this application?"}</h2><p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">{confirmation === "policy" ? `Your acceptance will be recorded against policy version ${policy?.policyVersion ?? "shown above"}.` : "This application version will be frozen and sent to NoLSAF for review. It cannot be edited while under review."}</p></div>
            </div>
            <div className="px-5 py-4">
              {confirmation === "policy" ? (
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl p-3.5 ring-1 transition ${policyConfirmed ? "bg-emerald-50/60 ring-emerald-300" : "bg-white ring-neutral-200 hover:ring-emerald-300"}`}>
                  {/* The native box renders as a near invisible grey square with
                      preflight disabled, so it is drawn below and the input is
                      kept, visually hidden, for keyboard and screen readers. */}
                  <input type="checkbox" checked={policyConfirmed} onChange={(event) => setPolicyConfirmed(event.target.checked)} className="peer sr-only" />
                  <span aria-hidden="true" className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 transition peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 ${policyConfirmed ? "bg-emerald-700 ring-emerald-700" : "bg-white ring-neutral-400"}`}>
                    {policyConfirmed && <Check className="h-3.5 w-3.5 text-white" />}
                  </span>
                  <span className="text-xs leading-5 text-neutral-700">I have read this policy and I am authorized to accept it for this business.</span>
                </label>
              ) : (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 ring-1 ring-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Submitting does not activate payment collection. Activation requires a successful provider review.</div>
              )}
            </div>
            <div className="flex justify-end gap-2 bg-neutral-50/80 px-5 py-3 shadow-[inset_0_1px_0_0_#e5e7eb]">
              <button type="button" onClick={() => { setConfirmation(null); setPolicyConfirmed(false); }} className="inline-flex h-9 items-center rounded-lg border-0 bg-white px-3.5 text-xs font-bold text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-100">Cancel</button>
              <button type="button" onClick={confirmation === "policy" ? acceptPolicy : submitApplication} disabled={confirmation === "policy" && !policyConfirmed} className="inline-flex h-9 items-center gap-2 rounded-lg border-0 bg-emerald-700 px-3.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">{confirmation === "policy" ? <Check className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}{confirmation === "policy" ? "Accept policy" : "Submit application"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
