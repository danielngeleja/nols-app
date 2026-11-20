"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  PauseCircle,
  Phone,
  Save,
  Send,
  ShieldCheck,
  Target,
  UserRound,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesLeadForm, { toSalesLeadPayload, type SalesLeadFormValue } from "@/components/sales/SalesLeadForm";
import SalesDateTimeField from "@/components/sales/SalesDateTimeField";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import VisitCheckIn from "@/components/sales/VisitCheckIn";
import AssistedListingCard, { type AssistedListingSummary } from "@/components/sales/AssistedListingCard";

type ActivityRecord = {
  id: number;
  type: string;
  description: string;
  fileUrl: string | null;
  createdAt: string;
  createdBy: { id: number; name: string | null; fullName: string | null };
};

type Lead = {
  id: number;
  propertyName: string;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  location: string | null;
  region: string | null;
  district: string | null;
  ward: string | null;
  propertyType: string | null;
  estimatedRooms: number | null;
  registrationNumber: string | null;
  taxNumber: string | null;
  proposedProduct: "NRMS" | "MARKETPLACE" | "NRMS_AND_MARKETPLACE";
  status: string;
  duplicateReviewStatus: string;
  nextFollowUpAt: string | null;
  notes: string | null;
  lostReason: string | null;
  protectionExpiresAt: string | null;
  conversionRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  activities: ActivityRecord[];
};

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function displayDate(value: string | null): string {
  if (!value) return "Not set";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function activityIcon(type: string) {
  if (type === "CALL") return Phone;
  if (type === "EMAIL") return Mail;
  if (type === "MEETING") return UserRound;
  if (type === "VISIT") return MapPin;
  if (type === "FOLLOW_UP") return CalendarClock;
  if (type === "DOCUMENT_RECEIVED") return FileText;
  if (type === "PROPOSAL_SENT") return Send;
  if (type === "STATUS_CHANGED") return Activity;
  return MessageSquare;
}

const CONTACT_TYPES = ["VISIT", "CALL", "MEETING", "EMAIL"];

type NextAction = { label: string; primary?: boolean; href?: string; onClick?: () => void };
type NextStep = { tone: "go" | "wait" | "warn" | "done" | "closed"; title: string; text: string; actions: NextAction[] };

const NEXT_TONE: Record<NextStep["tone"], { box: string; icon: string; Icon: typeof Target }> = {
  go: { box: "border-emerald-200 bg-emerald-50/60", icon: "bg-[#073c35] text-white", Icon: Target },
  wait: { box: "border-sky-200 bg-sky-50/60", icon: "bg-sky-600 text-white", Icon: Clock3 },
  warn: { box: "border-amber-200 bg-amber-50/70", icon: "bg-amber-500 text-white", Icon: AlertTriangle },
  done: { box: "border-emerald-200 bg-emerald-50/60", icon: "bg-emerald-600 text-white", Icon: CheckCircle2 },
  closed: { box: "border-slate-200 bg-slate-50", icon: "bg-slate-400 text-white", Icon: PauseCircle },
};

function scrollToId(elementId: string) {
  document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function LeadDetailSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading lead details">
      <section className="animate-pulse overflow-hidden rounded-[26px] border border-emerald-100 bg-white">
        <div className="flex items-start gap-4 px-6 py-6">
          <span className="h-14 w-14 rounded-2xl bg-emerald-100" />
          <div className="flex-1 space-y-3">
            <span className="block h-3 w-44 rounded bg-emerald-100" />
            <span className="block h-7 w-72 max-w-full rounded bg-slate-200" />
            <span className="block h-3 w-56 rounded bg-slate-100" />
          </div>
        </div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="h-16 border-b border-slate-100 bg-slate-50/50" />
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="space-y-3 bg-white p-5">
              <span className="block h-3 w-24 rounded bg-slate-100" />
              <span className="block h-4 w-36 max-w-full rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function SalesLeadDetailPage() {
  const params = useParams<{ id: string }>();
  // An opaque lead reference (sl_…), never a row id.
  const id = String(params.id || "");
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activityType, setActivityType] = useState("NOTE");
  const [activityDescription, setActivityDescription] = useState("");
  const [activityFollowUp, setActivityFollowUp] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [conversionConfirm, setConversionConfirm] = useState(false);
  const [statusEdit, setStatusEdit] = useState("NEW");
  const [lostReason, setLostReason] = useState("");
  const [assisted, setAssisted] = useState<AssistedListingSummary | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await apiClient.get(`/api/sales/leads/${id}`);
      const nextLead = response.data?.lead || null;
      setLead(nextLead);
      if (nextLead) {
        setStatusEdit(nextLead.status);
        setLostReason(nextLead.lostReason || "");
      }
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load this lead.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (/^sl_[A-Za-z0-9_-]{22}$/.test(id)) void load();
    else setLoading(false);
  }, [id, load]);

  const save = async (value: SalesLeadFormValue) => {
    setSaving(true);
    setError("");
    try {
      const response = await apiClient.patch(`/api/sales/leads/${id}`, toSalesLeadPayload(value));
      setLead((current) => current ? { ...current, ...response.data.lead } : response.data.lead);
      setEditing(false);
      setNotice(response.data?.warning?.message || "Lead updated.");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not update the lead.");
    } finally {
      setSaving(false);
    }
  };

  const addActivity = async () => {
    setSaving(true);
    setError("");
    try {
      await apiClient.post(`/api/sales/leads/${id}/activities`, {
        type: activityType,
        description: activityDescription,
        nextFollowUpAt: activityFollowUp ? new Date(activityFollowUp).toISOString() : undefined,
        ...(documentUrl.trim() ? { fileUrl: documentUrl.trim() } : {}),
      });
      setActivityDescription("");
      setActivityFollowUp("");
      setDocumentUrl("");
      setNotice("Activity recorded.");
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not record the activity.");
    } finally {
      setSaving(false);
    }
  };

  const requestConversion = async () => {
    setSaving(true);
    setError("");
    try {
      await apiClient.post(`/api/sales/leads/${id}/request-conversion`, {});
      setConversionConfirm(false);
      setNotice("Conversion request sent for administrator verification.");
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not request conversion.");
    } finally {
      setSaving(false);
    }
  };

  const saveStatus = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await apiClient.patch(`/api/sales/leads/${id}`, {
        status: statusEdit,
        ...(statusEdit === "LOST" ? { lostReason } : {}),
      });
      setLead((current) => current ? { ...current, ...response.data.lead } : response.data.lead);
      setNotice("Lead status updated.");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not update lead status.");
    } finally {
      setSaving(false);
    }
  };


  const hasContact = Boolean(lead?.activities.some((activity) => CONTACT_TYPES.includes(activity.type)));
  const hasVisit = Boolean(lead?.activities.some((activity) => activity.type === "VISIT")) || Boolean(assisted?.hasVerifiedVisit);
  const listing = assisted?.listingStatus && assisted.listingStatus !== "CANCELLED" ? assisted.listingStatus : null;
  const sentToNolsaf = Boolean(lead && (["CONVERSION_REQUESTED", "CONVERTED"].includes(lead.status) || (listing && listing !== "DRAFTING")));
  const openActivity = () => {
    setActivityOpen(true);
    window.setTimeout(() => { scrollToId("lead-record-activity"); document.getElementById("lead-activity-description")?.focus(); }, 50);
  };

  const nextStep: NextStep | null = !lead ? null
    : ["LOST", "CANCELLED"].includes(lead.status)
      ? { tone: "closed", title: `This lead is ${lead.status === "LOST" ? "lost" : "cancelled"}`, text: lead.lostReason || "If the owner comes back, change its status in Lead details to reopen it.", actions: [] }
    : lead.status === "CONVERTED"
      ? { tone: "done", title: "Converted", text: "NoLSAF verified this property for you. Earnings start once the attribution is active.", actions: [{ label: "Open my properties", href: "/sales/properties", primary: true }] }
    : listing === "DRAFTING"
      ? { tone: "go", title: "Finish the listing for the owner", text: "Complete the listing steps and submit. The owner has already been told by SMS.", actions: [{ label: "Continue the listing", href: `/sales/leads/${id}/listing`, primary: true }] }
    : listing === "RETURNED"
      ? { tone: "warn", title: "NoLSAF asked for changes", text: assisted?.returnReasons || "Open the listing, fix what was asked and submit again.", actions: [{ label: "Fix and resubmit", href: `/sales/leads/${id}/listing`, primary: true }] }
    : listing === "SUBMITTED"
      ? { tone: "wait", title: "With NoLSAF for review", text: "The listing is locked while NoLSAF checks it. You get a notification when it is approved or returned.", actions: [] }
    : listing === "PAUSED_OBJECTION"
      ? { tone: "warn", title: "Paused: the owner queried it", text: "The owner said they were not expecting this listing. NoLSAF will call them, then resume or cancel it.", actions: [] }
    : listing === "APPROVED"
      ? { tone: "wait", title: "Live on NoLSAF", text: "The owner has been told by SMS. Your attribution is now checked in the conversion review.", actions: [] }
    : lead.status === "CONVERSION_REQUESTED"
      ? { tone: "wait", title: "Waiting for NoLSAF to verify", text: "NoLSAF checks the property and your attribution. You get a notification when it is decided.", actions: [] }
    : !hasContact
      ? { tone: "go", title: "Log your first contact", text: "Record a call, meeting or email with the owner, or check in at the property.", actions: [
          { label: "Record activity", onClick: openActivity, primary: true },
          { label: "Check in here", onClick: () => scrollToId("visit-mode") },
        ] }
    : { tone: "go", title: "Owner agreed? Send it to NoLSAF", text: assisted?.granted
          ? "If the owner has no time, list it for them. If they list it themselves, ask NoLSAF to verify it."
          : "When the owner has listed the property on NoLSAF, ask NoLSAF to verify it for you.",
        actions: [
          ...(assisted?.granted && !assisted.paused ? [{ label: "List it for the owner", onClick: () => scrollToId("assisted-listing"), primary: true }] : []),
          { label: "Owner listed it: request conversion", onClick: () => setConversionConfirm(true), primary: !(assisted?.granted && !assisted.paused) },
        ] };

  const progress = [
    { label: "Contacted", done: hasContact },
    { label: "Visited", done: hasVisit, optional: true },
    { label: "Sent to NoLSAF", done: sentToNolsaf },
    { label: "Verified", done: lead?.status === "CONVERTED" },
  ];
  // Mirrors conversionEvidenceMissing in the API, which has the final say.
  const conversionMissing: string[] = [];
  if (lead) {
    if (!lead.contactPhone?.trim() && !lead.contactEmail?.trim()) conversionMissing.push("Add the owner's phone or email.");
    if (!lead.activities.some((activity) => ["VISIT", "CALL", "MEETING", "EMAIL"].includes(activity.type))) {
      conversionMissing.push("Log at least one call, meeting, email or visit with the owner.");
    }
    if (Date.now() - new Date(lead.createdAt).getTime() < 24 * 60 * 60 * 1000) {
      conversionMissing.push("Wait until the lead is 24 hours old.");
    }
  }
  const canChangeStatus = lead ?!["CONVERSION_REQUESTED", "CONVERTED"].includes(lead.status) : false;
  const statusSaveDisabled = !lead || saving || statusEdit === lead.status || (statusEdit === "LOST" && lostReason.trim().length < 2);

  return (
    <SalesShell>
      <div id="sales-lead-detail">
        {loading ? <LeadDetailSkeleton /> : null}

        {error ? (
          <p className="mb-0 mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mb-0 mt-4 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </p>
        ) : null}

        {lead ? (
          <>
            <SalesPageHeader
              icon={Target}
              eyebrow={`${formatLabel(lead.proposedProduct)} prospect`}
              title={lead.propertyName}
              description={lead.location || lead.region || "Location not recorded"}
              actions={(
                <div
                  role="toolbar"
                  aria-label="Lead actions"
                  className="flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:justify-end"
                >
                  <span className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[10px] font-black uppercase tracking-wide ${statusTone(lead.status)}`}>
                    {formatLabel(lead.status)}
                  </span>
                  {lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" ? (
                    <span className="inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full bg-amber-50 px-3 text-[10px] font-black uppercase tracking-wide text-amber-800">
                      Duplicate review
                    </span>
                  ) : null}
                  <Link
                    href="/sales/leads"
                    className="inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 hover:no-underline"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Leads
                  </Link>
                  <button
                    type="button"
                    onClick={() => setEditing((value) => !value)}
                    className="inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                  >
                    {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                    {editing ? "Close editor" : "Edit lead"}
                  </button>
                </div>
              )}
            />

            {nextStep ? (() => {
              const tone = NEXT_TONE[nextStep.tone];
              return (
                <section id="lead-next-step" className={`mt-5 rounded-2xl border border-solid p-4 sm:p-5 ${tone.box}`}>
                  <div className="flex flex-wrap items-start gap-4">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone.icon}`}><tone.Icon className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Next step</p>
                      <h2 className="m-0 mt-0.5 text-base font-black text-slate-900">{nextStep.title}</h2>
                      <p className="mb-0 mt-1 text-sm leading-6 text-slate-600">{nextStep.text}</p>
                    </div>
                    {nextStep.actions.length ? (
                      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                        {nextStep.actions.map((action) => {
                          const cls = `inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold no-underline transition hover:no-underline ${action.primary ? "bg-[#073c35] text-white hover:opacity-90" : "border border-solid border-slate-300 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-800"}`;
                          return action.href
                            ? <Link key={action.label} href={action.href} className={cls}>{action.label}<ArrowRight className="h-4 w-4" /></Link>
                            : <button key={action.label} type="button" onClick={action.onClick} className={`${cls} cursor-pointer border-0`}>{action.label}</button>;
                        })}
                      </div>
                    ) : null}
                  </div>
                  <ol className="m-0 mt-4 flex list-none flex-wrap items-center gap-x-2 gap-y-1.5 border-0 border-t border-solid border-black/5 p-0 pt-3" aria-label="Lead progress">
                    {progress.map((step, index) => (
                      <li key={step.label} className="flex items-center gap-2">
                        <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${step.done ? "bg-[#073c35] text-white" : "border border-solid border-slate-300 bg-white text-slate-400"}`}>
                          {step.done ? <Check className="h-3 w-3" /> : index + 1}
                        </span>
                        <span className={`text-xs font-semibold ${step.done ? "text-slate-800" : "text-slate-400"}`}>
                          {step.label}{step.optional ? <span className="font-normal text-slate-400"> (optional)</span> : null}
                        </span>
                        {index < progress.length - 1 ? <span className="mx-1 h-px w-6 bg-slate-300" aria-hidden /> : null}
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })() : null}

            {conversionConfirm ? (
              <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-amber-700 shadow-sm">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="m-0 text-sm font-black text-amber-950">Send this lead for conversion review?</p>
                    <p className="mb-0 mt-1 text-xs leading-5 text-amber-900/75">
                      An administrator will verify the property and attribution. This does not approve earnings.
                    </p>
                    {conversionMissing.length ? (
                      <ul className="mb-0 mt-2 list-disc space-y-0.5 pl-4 text-xs font-semibold text-amber-950">
                        {conversionMissing.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConversionConfirm(false)}
                    className="min-h-10 rounded-xl border border-amber-200 bg-white px-4 text-sm font-bold text-amber-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving || conversionMissing.length > 0}
                    onClick={requestConversion}
                    className="min-h-10 rounded-xl bg-[#073c35] px-4 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {saving ? "Submitting" : "Confirm request"}
                  </button>
                </div>
              </section>
            ) : null}

            {editing ? (
              <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
                <div className="mb-5 flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                      <Pencil className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="m-0 text-sm font-black text-slate-900">Edit prospect details</h2>
                      <p className="mb-0 mt-1 text-[10px] text-slate-400">Keep identity, property and follow-up information accurate.</p>
                    </div>
                  </div>
                </div>
                <SalesLeadForm
                  key={lead.updatedAt}
                  checkRef={String(id)}
                  initial={{
                    propertyName: lead.propertyName,
                    contactPerson: lead.contactPerson || "",
                    contactPhone: lead.contactPhone || "",
                    contactEmail: lead.contactEmail || "",
                    location: lead.location || "",
                    region: lead.region || "",
                    district: lead.district || "",
                    ward: lead.ward || "",
                    propertyType: lead.propertyType || "",
                    estimatedRooms: lead.estimatedRooms ? String(lead.estimatedRooms) : "",
                    registrationNumber: lead.registrationNumber || "",
                    taxNumber: lead.taxNumber || "",
                    proposedProduct: lead.proposedProduct,
                    nextFollowUpAt: localDateTime(lead.nextFollowUpAt),
                    notes: lead.notes || "",
                  }}
                  submitLabel="Save lead changes"
                  showTopSubmit
                  submitting={saving}
                  onSubmit={save}
                />
              </section>
            ) : null}

            <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_360px]">
              {/* Main column: what to act on, then the history */}
              <div className="min-w-0 [&>*:first-child]:!mt-0">
                <AssistedListingCard leadRef={id} onChanged={() => void load()} onState={setAssisted} />
                <VisitCheckIn
                  leadRef={id}
                  closed={["CONVERTED", "LOST", "CANCELLED"].includes(lead.status)}
                  onRecorded={() => void load()}
                />
              <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-700">
                      <Clock3 className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="m-0 text-sm font-black text-slate-900">Activity timeline</h2>
                      <p className="mb-0 mt-1 text-[10px] text-slate-400">{lead.activities.length} recorded event{lead.activities.length === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                </div>

                {lead.activities.length ? (
                  <ol className="m-0 list-none px-5 py-2">
                    {lead.activities.map((activity, index) => {
                      const ActivityIcon = activityIcon(activity.type);
                      const isLast = index === lead.activities.length - 1;
                      return (
                        <li key={activity.id} className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-3 py-4">
                          {!isLast ? <span className="absolute bottom-0 left-[17px] top-12 w-px bg-slate-200" aria-hidden /> : null}
                          <span className="relative z-10 grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                            <ActivityIcon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 rounded-xl bg-slate-50/70 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 shadow-sm">
                                {formatLabel(activity.type)}
                              </span>
                              <time className="text-[10px] font-medium text-slate-400">{displayDate(activity.createdAt)}</time>
                            </div>
                            <p className="mb-0 mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{activity.description}</p>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                              <p className="m-0 text-[10px] text-slate-400">
                                By <span className="font-bold text-slate-600">{activity.createdBy.fullName || activity.createdBy.name || "NoLSAF user"}</span>
                              </p>
                              {activity.fileUrl ? (
                                <a
                                  href={activity.fileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-bold text-emerald-700 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:no-underline"
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                  Document
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <div className="grid min-h-56 place-items-center px-6 py-10 text-center">
                    <div>
                      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                        <Activity className="h-5 w-5" />
                      </span>
                      <p className="mb-0 mt-3 text-sm font-black text-slate-700">No activity recorded</p>
                      <p className="mb-0 mt-1 text-xs text-slate-400">Use the form to record the first interaction.</p>
                    </div>
                  </div>
                )}
              </section>
              </div>

              {/* Side panel: the facts, and recording a new interaction */}
              <aside className="min-w-0 space-y-4 xl:sticky xl:top-5">
              {!editing ? (
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
                  <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
                    <h2 className="m-0 text-sm font-black text-slate-900">Lead details</h2>
                    <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs font-bold text-emerald-700 hover:underline">
                      <Pencil className="h-3.5 w-3.5" />Edit
                    </button>
                  </div>
                  {canChangeStatus ? (
                    <div className="flex flex-wrap items-end gap-2 border-0 border-b border-solid border-slate-100 px-5 py-4">
                      <label className="min-w-0 flex-1">
                        <span className="mb-1 block text-[10px] font-bold text-slate-500">Pipeline status</span>
                        <select
                          value={statusEdit}
                          onChange={(event) => setStatusEdit(event.target.value)}
                          className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        >
                          <option value="NEW">New</option>
                          <option value="CONTACTED">Contacted</option>
                          <option value="MEETING_SCHEDULED">Meeting scheduled</option>
                          <option value="PROPOSAL_SENT">Proposal sent</option>
                          <option value="DOCUMENTS_PENDING">Documents pending</option>
                          <option value="TRIAL_STARTED">Trial started</option>
                          <option value="LOST">Lost</option>
                          <option value="CANCELLED">Cancelled</option>
                        </select>
                      </label>
                      {statusEdit === "LOST" ? (
                        <label className="w-full">
                          <span className="mb-1 block text-[10px] font-bold text-slate-500">Lost reason</span>
                          <input
                            value={lostReason}
                            onChange={(event) => setLostReason(event.target.value)}
                            className="min-h-10 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                            maxLength={300}
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        onClick={saveStatus}
                        disabled={statusSaveDisabled}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-bold shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: statusSaveDisabled ? "#e2e8f0" : "#073c35",
                          borderColor: statusSaveDisabled ? "#cbd5e1" : "#073c35",
                          color: statusSaveDisabled ? "#475569" : "#ffffff",
                        }}
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save status
                      </button>
                    </div>
                  ) : null}
                  <dl className="m-0">
                    {[
                      { label: "Contact", value: lead.contactPerson, Icon: UserRound },
                      { label: "Phone", value: lead.contactPhone, Icon: Phone },
                      { label: "Email", value: lead.contactEmail, Icon: Mail },
                      { label: "Type", value: lead.propertyType ? formatLabel(lead.propertyType) : null, Icon: Building2 },
                      { label: "Where", value: [lead.location, lead.ward, lead.district, lead.region].filter(Boolean).map((part) => formatLabel(String(part))).join(", ") || null, Icon: MapPin },
                      { label: "Rooms", value: lead.estimatedRooms ? String(lead.estimatedRooms) : null, Icon: BedDouble },
                      { label: "Registration", value: lead.registrationNumber, Icon: FileText },
                      { label: "Follow up", value: lead.nextFollowUpAt ? displayDate(lead.nextFollowUpAt) : null, Icon: CalendarClock },
                      { label: "Protected until", value: lead.protectionExpiresAt ? displayDate(lead.protectionExpiresAt) : null, Icon: ShieldCheck },
                    ].map(({ label, value, Icon }) => (
                      <div key={label} className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-2 border-0 border-t border-solid border-slate-100 px-5 py-2.5 first:border-t-0">
                        <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500"><Icon className="h-3.5 w-3.5 text-emerald-600" />{label}</dt>
                        <dd className={`m-0 break-words text-[13px] font-semibold leading-5 ${value ? "text-slate-800" : "text-slate-300"}`}>{value || "Not recorded"}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}
              <section id="lead-record-activity" className="rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
                <button
                  type="button"
                  onClick={() => setActivityOpen((value) => !value)}
                  aria-expanded={activityOpen || !lead.activities.length}
                  className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-5 py-4 text-left"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Activity className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-slate-900">Record activity</span>
                    <span className="mt-0.5 block text-[10px] text-slate-400">A call, meeting, email or note</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${activityOpen || !lead.activities.length ? "rotate-180" : ""}`} />
                </button>
                {activityOpen || !lead.activities.length ? <div className="px-5 pb-5">

                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold text-slate-600">Activity type</span>
                  <select
                    value={activityType}
                    onChange={(event) => setActivityType(event.target.value)}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="NOTE">Note</option>
                    <option value="CALL">Call</option>
                    <option value="EMAIL">Email</option>
                    <option value="MEETING">Meeting</option>
                    <option value="FOLLOW_UP">Follow-up</option>
                    <option value="DOCUMENT_RECEIVED">Document received</option>
                    <option value="PROPOSAL_SENT">Proposal sent</option>
                  </select>
                </label>

                <label className="mt-4 block">
                  <span className="mb-1.5 block text-[11px] font-bold text-slate-600">Description</span>
                  <textarea
                    id="lead-activity-description"
                    value={activityDescription}
                    onChange={(event) => setActivityDescription(event.target.value)}
                    className="min-h-28 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    placeholder="Record the outcome and next action"
                    maxLength={5000}
                  />
                </label>

                <div className="mt-4">
                  <SalesDateTimeField
                    label="Next follow-up"
                    value={activityFollowUp}
                    onChangeAction={setActivityFollowUp}
                  />
                </div>

                {activityType === "DOCUMENT_RECEIVED" ? (
                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-[11px] font-bold text-slate-600">Private document URL</span>
                    <input
                      value={documentUrl}
                      onChange={(event) => setDocumentUrl(event.target.value)}
                      type="url"
                      placeholder="https://"
                      className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                ) : null}

                <button
                  type="button"
                  disabled={saving || activityDescription.trim().length < 2}
                  onClick={addActivity}
                  className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#073c35] px-4 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "Saving activity" : "Record activity"}
                </button>
                </div> : null}
              </section>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </SalesShell>
  );
}
