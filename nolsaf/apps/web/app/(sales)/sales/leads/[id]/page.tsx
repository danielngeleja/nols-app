"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Target } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesLeadForm, { toSalesLeadPayload, type SalesLeadFormValue } from "@/components/sales/SalesLeadForm";
import SalesDateTimeField from "@/components/sales/SalesDateTimeField";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Activity = {
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
  activities: Activity[];
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

  return (
    <SalesShell>
      <style jsx global>{`
        #sales-lead-detail *,
        #sales-lead-detail *::before,
        #sales-lead-detail *::after {
          box-sizing: border-box;
        }
      `}</style>
      <div id="sales-lead-detail">
        {loading ? <p className="mt-6 text-sm text-gray-500">Loading lead...</p> : null}
        {error ? <p className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        {notice ? <p className="mt-5 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p> : null}

        {lead ? (
          <>
            <SalesPageHeader
              icon={Target}
              eyebrow={`${lead.proposedProduct.replaceAll("_", " ")} prospect`}
              title={lead.propertyName}
              description={`Pipeline status: ${lead.status.replaceAll("_", " ")}${lead.location ? ` · ${lead.location}` : ""}`}
              actions={<div className="flex flex-wrap justify-end gap-2">
                <Link href="/sales/leads" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 no-underline hover:border-emerald-300"><ArrowLeft className="h-4 w-4" />Leads</Link>
                <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800">
                  {editing ? "Close editor" : "Edit lead"}
                </button>
                {!["CONVERSION_REQUESTED", "CONVERTED", "LOST", "CANCELLED"].includes(lead.status) ? (
                  <button type="button" onClick={() => setConversionConfirm(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
                    Request conversion
                  </button>
                ) : null}
              </div>}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusTone(lead.status)}`}>{lead.status.replaceAll("_", " ")}</span>
              {lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">Duplicate review</span> : null}
            </div>

            {conversionConfirm ? (
              <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-gray-900">Send this lead for conversion review?</p>
                <p className="mt-1 text-sm text-gray-700">An administrator will verify the property and attribution. This action does not approve earnings.</p>
                <div className="mt-4 flex gap-2">
                  <button type="button" disabled={saving} onClick={requestConversion} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Confirm request</button>
                  <button type="button" onClick={() => setConversionConfirm(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                </div>
              </section>
            ) : null}

            {editing ? (
              <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
                <h2 className="mb-4 text-sm font-semibold text-gray-900">Edit prospect details</h2>
                <SalesLeadForm
                  key={lead.updatedAt}
                  initial={{
                    propertyName: lead.propertyName,
                    contactPerson: lead.contactPerson || "",
                    contactPhone: lead.contactPhone || "",
                    contactEmail: lead.contactEmail || "",
                    location: lead.location || "",
                    region: lead.region || "",
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
              <>
                {!["CONVERSION_REQUESTED", "CONVERTED"].includes(lead.status) ? (
                  <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="min-w-52 flex-1 text-sm font-medium text-gray-800">
                        Pipeline status
                        <select value={statusEdit} onChange={(event) => setStatusEdit(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
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
                        <label className="min-w-64 flex-[2] text-sm font-medium text-gray-800">
                          Lost reason
                          <input value={lostReason} onChange={(event) => setLostReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" maxLength={300} />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        onClick={saveStatus}
                        disabled={saving || statusEdit === lead.status || (statusEdit === "LOST" && lostReason.trim().length < 2)}
                        className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand disabled:opacity-40"
                      >
                        Save status
                      </button>
                    </div>
                  </section>
                ) : null}
                <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Contact", lead.contactPerson || "Not recorded"],
                    ["Phone", lead.contactPhone || "Not recorded"],
                    ["Email", lead.contactEmail || "Not recorded"],
                    ["Location", lead.location || "Not recorded"],
                    ["Property type", lead.propertyType || "Not recorded"],
                    ["Estimated rooms", lead.estimatedRooms ? String(lead.estimatedRooms) : "Not recorded"],
                    ["Next follow-up", displayDate(lead.nextFollowUpAt)],
                    ["Protection expires", displayDate(lead.protectionExpiresAt)],
                  ].map(([label, value]) => (
                    <div key={label} className="border border-slate-200 bg-white p-4">
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="mt-1 break-words text-sm font-medium text-gray-900">{value}</p>
                    </div>
                  ))}
                </section>
              </>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
              <section className="rounded-xl border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-5 py-4">
                  <h2 className="text-sm font-semibold text-gray-900">Activity timeline</h2>
                </div>
                {lead.activities.length ? (
                  <ol className="divide-y divide-gray-100">
                    {lead.activities.map((activity) => (
                      <li key={activity.id} className="p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">{activity.type.replaceAll("_", " ")}</span>
                          <time className="text-xs text-gray-500">{displayDate(activity.createdAt)}</time>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{activity.description}</p>
                        <p className="mt-2 text-xs text-gray-500">By {activity.createdBy.fullName || activity.createdBy.name || "NoLSAF user"}</p>
                        {activity.fileUrl ? <a href={activity.fileUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-medium text-brand hover:underline">Open document</a> : null}
                      </li>
                    ))}
                  </ol>
                ) : <p className="p-5 text-sm text-gray-500">No activity recorded.</p>}
              </section>

              <section className="h-fit rounded-xl border border-gray-200 bg-white p-5">
                <h2 className="text-sm font-semibold text-gray-900">Record activity</h2>
                <label className="mt-4 block text-sm font-medium text-gray-800">
                  Type
                  <select value={activityType} onChange={(event) => setActivityType(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                    <option value="NOTE">Note</option>
                    <option value="CALL">Call</option>
                    <option value="EMAIL">Email</option>
                    <option value="MEETING">Meeting</option>
                    <option value="FOLLOW_UP">Follow-up</option>
                    <option value="DOCUMENT_RECEIVED">Document received</option>
                    <option value="PROPOSAL_SENT">Proposal sent</option>
                  </select>
                </label>
                <label className="mt-4 block text-sm font-medium text-gray-800">
                  Description
                  <textarea value={activityDescription} onChange={(event) => setActivityDescription(event.target.value)} className="mt-1 block min-h-28 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" maxLength={5000} />
                </label>
                <div className="mt-4">
                  <SalesDateTimeField
                    label="Next follow-up"
                    value={activityFollowUp}
                    onChangeAction={setActivityFollowUp}
                  />
                </div>
                {activityType === "DOCUMENT_RECEIVED" ? (
                  <label className="mt-4 block text-sm font-medium text-gray-800">
                    Private document URL
                    <input value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} type="url" placeholder="https://" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  </label>
                ) : null}
                <button
                  type="button"
                  disabled={saving || activityDescription.trim().length < 2}
                  onClick={addActivity}
                  className="mt-5 w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Record activity"}
                </button>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </SalesShell>
  );
}
