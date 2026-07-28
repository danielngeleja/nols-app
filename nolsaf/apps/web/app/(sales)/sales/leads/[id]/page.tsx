"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
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
  if (type === "FOLLOW_UP") return CalendarClock;
  if (type === "DOCUMENT_RECEIVED") return FileText;
  if (type === "PROPOSAL_SENT") return Send;
  if (type === "STATUS_CHANGED") return Activity;
  return MessageSquare;
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
  const id = Number(params.id);
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
    if (Number.isInteger(id) && id > 0) void load();
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

  const canRequestConversion = lead
    ? !["CONVERSION_REQUESTED", "CONVERTED", "LOST", "CANCELLED"].includes(lead.status)
    : false;
  const canChangeStatus = lead ? !["CONVERSION_REQUESTED", "CONVERTED"].includes(lead.status) : false;

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
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className={`inline-flex min-h-9 items-center rounded-full px-3 text-[10px] font-black uppercase tracking-wide ${statusTone(lead.status)}`}>
                    {formatLabel(lead.status)}
                  </span>
                  {lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" ? (
                    <span className="inline-flex min-h-9 items-center rounded-full bg-amber-50 px-3 text-[10px] font-black uppercase tracking-wide text-amber-800">
                      Duplicate review
                    </span>
                  ) : null}
                  <Link
                    href="/sales/leads"
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 hover:no-underline"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Leads
                  </Link>
                  <button
                    type="button"
                    onClick={() => setEditing((value) => !value)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                  >
                    {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                    {editing ? "Close editor" : "Edit lead"}
                  </button>
                  {canRequestConversion ? (
                    <button
                      type="button"
                      onClick={() => setConversionConfirm(true)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#073c35] px-4 text-sm font-bold text-white transition hover:bg-emerald-800"
                    >
                      <Send className="h-4 w-4" />
                      Request conversion
                    </button>
                  ) : null}
                </div>
              )}
            />

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
                    disabled={saving}
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
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Pencil className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="m-0 text-sm font-black text-slate-900">Edit prospect details</h2>
                    <p className="mb-0 mt-1 text-[10px] text-slate-400">Keep identity, property and follow-up information accurate.</p>
                  </div>
                </div>
                <SalesLeadForm
                  key={lead.updatedAt}
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
                  submitLabel="Save changes"
                  submitting={saving}
                  onSubmit={save}
                />
              </section>
            ) : (
              <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <h2 className="m-0 text-sm font-black text-slate-900">Lead overview</h2>
                    <p className="mb-0 mt-1 text-[10px] text-slate-400">Contact, property and follow-up information</p>
                  </div>

                  {canChangeStatus ? (
                    <div className="flex flex-wrap items-end justify-end gap-2">
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-slate-500">Pipeline status</span>
                        <select
                          value={statusEdit}
                          onChange={(event) => setStatusEdit(event.target.value)}
                          className="min-h-10 min-w-48 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
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
                        <label>
                          <span className="mb-1 block text-[10px] font-bold text-slate-500">Lost reason</span>
                          <input
                            value={lostReason}
                            onChange={(event) => setLostReason(event.target.value)}
                            className="min-h-10 min-w-64 rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                            maxLength={300}
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        onClick={saveStatus}
                        disabled={saving || statusEdit === lead.status || (statusEdit === "LOST" && lostReason.trim().length < 2)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#073c35] px-3 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save status
                      </button>
                    </div>
                  ) : null}
                </div>

                <dl className="m-0 grid gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: "Contact", value: lead.contactPerson || "Not recorded", Icon: UserRound },
                    { label: "Phone", value: lead.contactPhone || "Not recorded", Icon: Phone },
                    { label: "Email", value: lead.contactEmail || "Not recorded", Icon: Mail },
                    { label: "Property type", value: lead.propertyType ? formatLabel(lead.propertyType) : "Not recorded", Icon: Building2 },
                    { label: "Region", value: lead.region ? formatLabel(lead.region) : "Not recorded", Icon: MapPin },
                    { label: "District", value: lead.district ? formatLabel(lead.district) : "Not recorded", Icon: MapPin },
                    { label: "Ward", value: lead.ward ? formatLabel(lead.ward) : "Not recorded", Icon: MapPin },
                    { label: "Street or landmark", value: lead.location || "Not recorded", Icon: MapPin },
                    { label: "Estimated rooms", value: lead.estimatedRooms ? String(lead.estimatedRooms) : "Not recorded", Icon: BedDouble },
                    { label: "Registration number", value: lead.registrationNumber || "Not recorded", Icon: FileText },
                    { label: "Next follow-up", value: displayDate(lead.nextFollowUpAt), Icon: CalendarClock },
                    { label: "Protection expires", value: displayDate(lead.protectionExpiresAt), Icon: ShieldCheck },
                  ].map(({ label, value, Icon }) => (
                    <div key={label} className="min-w-0 bg-white px-5 py-4">
                      <dt className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                        <Icon className="h-3.5 w-3.5 text-emerald-600" />
                        {label}
                      </dt>
                      <dd className="m-0 mt-2 break-words text-sm font-bold leading-5 text-slate-800">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_360px]">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
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

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)] xl:sticky xl:top-5">
                <div className="flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Activity className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="m-0 text-sm font-black text-slate-900">Record activity</h2>
                    <p className="mb-0 mt-1 text-[10px] text-slate-400">Add a traceable sales interaction</p>
                  </div>
                </div>

                <label className="mt-5 block">
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
              </section>
            </div>
          </>
        ) : null}
      </div>
    </SalesShell>
  );
}
