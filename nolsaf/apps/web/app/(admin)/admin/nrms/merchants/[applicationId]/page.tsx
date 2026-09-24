"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Building2, Check, CheckCircle2, Clock3,
  ExternalLink, FileText, Fingerprint, Globe2, Hash, Loader2, Mail, Phone,
  RefreshCw, ShieldAlert, ShieldCheck, Undo2, UserRound, X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type ApplicationDetail = {
  application: {
    id: number; version: number; status: string; payloadHash: string | null; frozenAt: string | null;
    submittedAt: string | null; reviewedAt: string | null; decisionReason: string | null; providerSubmissionRef: string | null;
    merchant: {
      id: number; status: string; legalName: string | null; tradingName: string | null; registrationNumber: string | null;
      tin: string | null; country: string | null; contactEmail: string | null; contactPhone: string | null;
      administeredBy: { id: number; name: string | null; email: string | null; phone: string | null; emailVerifiedAt: string | null; phoneVerifiedAt: string | null } | null;
    };
    connection: { provider: string; environment: string } | null;
    documents: Array<{ id: number; documentType: string; issuingCountry: string | null; expiresAt: string | null; verificationState: string; rejectionCode: string | null; userDocument: { id: number; status: string; createdAt: string } | null }>;
  };
  policyAcceptance: { policyId: string; policyVersion: string; contentHash: string; acceptedAt: string } | null;
  auditTrail: Array<{ action: string; actorKind: string; actorUserId: number | null; previousState: string | null; nextState: string | null; reason: string | null; metadata: unknown; createdAt: string }>;
  properties: Array<{ propertyId: number; title: string | null }>;
  integrity: { frozenHash: string | null; computedHash: string; matches: boolean | null };
};
type Decision = "RETURN" | "REJECT" | "APPROVE";
/**
 * Mirrors CORRECTION_AREAS on the server. Returning used to send only free
 * text, so an owner was told "needs changes" and had to guess which of five
 * things to look at. Naming the areas turns the return into a checklist.
 */
const CORRECTION_AREAS = [
  { key: "BUSINESS_IDENTITY", label: "Business identity", hint: "Legal name, trading name, registration number" },
  { key: "TAX_IDENTIFIERS", label: "Tax identifiers", hint: "TIN, VRN and country of registration" },
  { key: "CONTACT_DETAILS", label: "Contact details", hint: "Merchant contact email and phone" },
  { key: "DOCUMENTS", label: "Documents", hint: "Evidence that is missing, unreadable or expired" },
  { key: "POLICY_ACCEPTANCE", label: "Policy acceptance", hint: "Terms must be read and accepted again" },
] as const;
type DocumentView = { id: number; applicationId: number; documentType: string; verificationState: string; expiresAt: string | null; uploadedAt: string | null; profileStatus: string | null; hasFile: boolean; unsafeUrl: boolean; kind: "image" | "pdf" | "other" };

// Copy for the confirmation dialog. Styling now lives on each button, so a
// destructive action cannot silently inherit a neutral look from a lookup.
const DECISIONS: Record<Decision, { label: string; title: string; body: string }> = {
  APPROVE: { label: "Approve", title: "Approve and queue provider submission?", body: "This queues the frozen package for the provider. It does not activate payments or open a wallet." },
  RETURN: { label: "Return for correction", title: "Return this application to the owner?", body: "The owner can correct and submit a new version while this reviewed package remains intact." },
  REJECT: { label: "Reject", title: "Reject this application?", body: "The provider account is marked rejected and the owner can no longer edit these details." },
};

function titleCase(value: string | null | undefined): string { return String(value ?? "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatWhen(value: string | null): string { if (!value) return "Not recorded"; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Not recorded"; }
function shortHash(value: string | null): string { return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "Not frozen"; }
function statusTone(status: string): string { const value = status.toUpperCase(); if (value === "ACTIVE") return "ring-emerald-200 bg-emerald-50 text-emerald-700"; if (["READY_FOR_ADMIN_REVIEW", "ACTION_REQUIRED"].includes(value)) return "ring-amber-200 bg-amber-50 text-amber-800"; if (["ADMIN_REJECTED", "REJECTED"].includes(value)) return "ring-rose-200 bg-rose-50 text-rose-700"; return "ring-blue-200 bg-blue-50 text-blue-800"; }
/**
 * Colour and icon per audit action. Decisions carry weight; routine reads such
 * as a document view are muted so a page of them cannot bury an approval.
 */
function auditTone(action: string): { dot: string; note: string; muted: boolean; Icon: typeof Check } {
  const value = action.toUpperCase();
  if (value.includes("APPROVE")) return { dot: "bg-emerald-600 text-white", note: "bg-emerald-50 text-emerald-900", muted: false, Icon: ShieldCheck };
  if (value.includes("REJECT")) return { dot: "bg-rose-600 text-white", note: "bg-rose-50 text-rose-900", muted: false, Icon: X };
  if (value.includes("RETURN")) return { dot: "bg-amber-500 text-white", note: "bg-amber-50 text-amber-900", muted: false, Icon: Undo2 };
  if (value.includes("SUBMIT")) return { dot: "bg-blue-600 text-white", note: "bg-blue-50 text-blue-900", muted: false, Icon: Check };
  return { dot: "bg-slate-200 text-slate-500", note: "bg-slate-50 text-slate-600", muted: true, Icon: FileText };
}

function requestMessage(error: unknown, fallback: string): string { const cause = error as { response?: { data?: { error?: unknown; require2fa?: boolean } } }; if (cause.response?.data?.require2fa) return "Finance verification is required. Complete the OTP prompt, then try again."; const message = cause.response?.data?.error; return typeof message === "string" && message.trim() ? message : fallback; }
function documentFileUrl(view: DocumentView): string { return `/api/admin/payments/merchants/applications/${view.applicationId}/documents/${view.id}/file`; }

export default function MerchantApplicationDetailPage() {
  const params = useParams<{ applicationId: string }>();
  const applicationId = Number(params?.applicationId || 0);
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [pending, setPending] = useState<Decision | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);

  // Escape cancels the decision dialog, which handled no key press before.
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !submitting) setPending(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, submitting]);

  const load = useCallback(async () => {
    if (!Number.isInteger(applicationId) || applicationId <= 0) { setError("Invalid merchant application ID."); setLoading(false); return; }
    setLoading(true); setError(null);
    try { const response = await apiClient.get<ApplicationDetail>(`/api/admin/payments/merchants/applications/${applicationId}`); setDetail(response.data); }
    catch (cause) { setDetail(null); setError(requestMessage(cause, "This application could not be loaded.")); }
    finally { setLoading(false); }
  }, [applicationId]);
  useEffect(() => { void load(); }, [load]);

  /**
   * Opens the document in its own tab rather than an in-page viewer.
   *
   * The authenticated lookup still runs first: it is what reports whether a
   * file exists and whether its stored location passed validation, and it
   * refreshes the application so the access is reflected in the audit trail.
   * The tab is opened synchronously inside the click, because a window.open
   * issued after an await is treated as a popup and blocked. `opener` is
   * cleared for the same reason `noopener` would be, but noopener returns a
   * null handle, which would leave nothing to point at the file.
   */
  const openDocument = async (documentId: number) => {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    setViewingId(documentId); setViewError(null);
    try {
      const response = await apiClient.get<Omit<DocumentView, "applicationId">>(`/api/admin/payments/merchants/applications/${applicationId}/documents/${documentId}`);
      const view: DocumentView = { ...response.data, applicationId };
      if (!view.hasFile) {
        tab?.close();
        setViewError(view.unsafeUrl ? "That document's stored location failed validation, so the file will not be served." : "That document row has no file attached.");
      } else if (tab) {
        tab.location.replace(documentFileUrl(view));
      } else {
        // Popup blocked despite the synchronous open: fall back to same-tab.
        window.location.assign(documentFileUrl(view));
      }
      await load();
    } catch (cause) {
      tab?.close();
      setViewError(requestMessage(cause, "This document could not be opened."));
    } finally { setViewingId(null); }
  };

  const submitDecision = async () => {
    if (!detail || !pending || reason.trim().length < 3) return;
    setSubmitting(true); setError(null); setMessage(null);
    try { await apiClient.post(`/api/admin/payments/merchants/applications/${applicationId}/decision`, { decision: pending, reason: reason.trim(), ...(pending === "RETURN" ? { correctionAreas: areas } : {}) }); setMessage(`Application #${applicationId} recorded as ${DECISIONS[pending].label.toLowerCase()}.`); setPending(null); setReason(""); setAreas([]); await load(); }
    catch (cause) { setError(requestMessage(cause, "The decision could not be recorded.")); }
    finally { setSubmitting(false); }
  };

  const owner = detail?.application.merchant.administeredBy ?? null;
  const warnings = useMemo(() => { if (!detail || !owner) return []; const values: string[] = []; if (!owner.emailVerifiedAt) values.push("Owner account email is not verified."); if (!owner.phoneVerifiedAt) values.push("Owner account phone is not verified."); if (owner.email && detail.application.merchant.contactEmail && owner.email.toLowerCase() !== detail.application.merchant.contactEmail.toLowerCase()) values.push("Application email differs from the owner account email."); return values; }, [detail, owner]);

  if (loading) return <div className="mx-auto max-w-7xl p-6"><div className="flex min-h-64 items-center justify-center rounded-xl ring-1 ring-slate-200 bg-white text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin text-[#02665e]" />Loading application #{applicationId}</div></div>;
  if (!detail) return <div className="mx-auto max-w-7xl space-y-4 p-6"><div className="rounded-xl ring-1 ring-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error || "Application not found."}</div><Link href="/admin/nrms/merchants" className="inline-flex items-center gap-2 text-sm font-semibold text-[#02665e]"><ArrowLeft className="h-4 w-4" />Back to merchant applications</Link></div>;

  const altered = detail.integrity.matches === false;
  const decidable = detail.application.status === "READY_FOR_ADMIN_REVIEW";

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 lg:px-6 xl:px-8 2xl:max-w-[1720px]">
      <header className="overflow-hidden rounded-xl ring-1 ring-slate-200 bg-white shadow-sm">
        <div className="flex min-w-0 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4 sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
            <Link href="/admin/nrms/merchants" title="Back to merchant applications" aria-label="Back to merchant applications" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 no-underline transition hover:bg-slate-50 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /></Link>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><FileText className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="m-0 max-w-full truncate text-lg font-bold leading-6 text-slate-900 sm:text-xl">{detail.application.merchant.legalName || "Unnamed company"}</h1>
                <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#02665e]">ID #{detail.application.id}</span>
              </div>
              <p className="mb-0 mt-1 truncate text-xs text-slate-500">Version {detail.application.version} · {titleCase(detail.application.connection?.provider) || "No provider"} · {titleCase(detail.application.connection?.environment) || "No environment"}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 pl-[5.75rem] sm:pl-0">
            <span className={`inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-semibold ring-1 ${statusTone(detail.application.status)}`}>{titleCase(detail.application.status)}</span>
            <button type="button" onClick={() => void load()} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900" title="Refresh application" aria-label="Refresh application"><RefreshCw className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </header>

      {message && <div className="flex items-start gap-2 rounded-xl ring-1 ring-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4" />{message}</div>}
      {error && <div className="flex items-start gap-2 rounded-xl ring-1 ring-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4" />{error}</div>}

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3 lg:gap-6">
        <main className="min-w-0 space-y-4 lg:col-span-2 sm:space-y-6">
          <section className={`overflow-hidden rounded-xl shadow-sm ring-1 ${altered ? "ring-rose-300 bg-rose-950" : "ring-emerald-900/30 bg-[#0c2a27]"}`}>
            <div className="p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ${altered ? "ring-rose-300/30 text-rose-300" : "ring-emerald-300/20 text-emerald-300"}`}>{altered ? <ShieldAlert className="h-5 w-5" /> : <Fingerprint className="h-5 w-5" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Submission integrity</p>
                    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold ring-1 ${altered ? "ring-rose-300/30 bg-rose-400/10 text-rose-200" : detail.integrity.matches ? "ring-emerald-300/30 bg-emerald-400/10 text-emerald-200" : "ring-white/15 bg-white/5 text-white/60"}`}>
                      {altered ? <ShieldAlert className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                      {altered ? "Mismatch detected" : detail.integrity.matches ? "Verified match" : "Not yet verified"}
                    </span>
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-white">{altered ? "Package changed after submission" : detail.integrity.matches ? "Submitted package is authentic" : "No frozen package available"}</h2>
                  <p className="mt-1 text-xs leading-5 text-white/55">{altered ? "The current merchant record no longer matches the submitted snapshot. Approval remains blocked." : detail.integrity.matches ? "The current merchant information matches the exact snapshot frozen when this application was submitted." : "Submit and freeze the application before its integrity can be verified."}</p>
                </div>
              </div>
              <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2">
                <div className="min-w-0 rounded-lg ring-1 ring-white/10 bg-white/[0.05] px-3 py-2.5"><div className="text-[9px] font-bold uppercase tracking-wider text-white/35">Frozen snapshot</div><div className="mt-1 truncate font-mono text-[11px] text-white/75" title={detail.integrity.frozenHash || "Not frozen"}>{shortHash(detail.integrity.frozenHash)}</div></div>
                <div className="min-w-0 rounded-lg ring-1 ring-white/10 bg-white/[0.05] px-3 py-2.5"><div className="text-[9px] font-bold uppercase tracking-wider text-white/35">Current record</div><div className="mt-1 truncate font-mono text-[11px] text-white/75" title={detail.integrity.computedHash}>{shortHash(detail.integrity.computedHash)}</div></div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl ring-1 ring-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 px-4 py-3 shadow-[inset_0_-1px_0_0_#e2e8f0] sm:px-5">
              <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Building2 className="h-4 w-4" /></span><div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Legal entity</p><h2 className="truncate text-sm font-semibold text-slate-900">Business identity</h2></div></div>
              <span className={`inline-flex shrink-0 rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wide ring-1 ${statusTone(detail.application.merchant.status)}`}>{titleCase(detail.application.merchant.status)}</span>
            </div>
            <div className="p-4 sm:p-5">
              <div className="min-w-0"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Registered name</div><div className="mt-1 break-words text-lg font-semibold leading-6 text-slate-900">{detail.application.merchant.legalName || "Not provided"}</div>{detail.application.merchant.tradingName && <div className="mt-1 text-xs text-slate-500">Trading name: <span className="font-semibold text-slate-700">{detail.application.merchant.tradingName}</span></div>}</div>
              <dl className="mt-4 grid [&>div]:shadow-[inset_0_-1px_0_0_#e2e8f0] sm:grid-cols-3 sm:[&>div]:shadow-[inset_1px_0_0_0_#e2e8f0] sm:[&>div:first-child]:shadow-none shadow-[inset_0_1px_0_0_#e2e8f0,inset_0_-1px_0_0_#e2e8f0]">
                <div className="min-w-0 py-3 sm:px-3 sm:first:pl-0"><dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-400"><Hash className="h-3.5 w-3.5" />Registration</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-900">{detail.application.merchant.registrationNumber || "Not provided"}</dd></div>
                <div className="min-w-0 py-3 sm:px-3"><dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-400"><FileText className="h-3.5 w-3.5" />Company TIN</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-900">{detail.application.merchant.tin || "Not provided"}</dd></div>
                <div className="min-w-0 py-3 sm:px-3 sm:last:pr-0"><dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-400"><Globe2 className="h-3.5 w-3.5" />Country</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-900">{detail.application.merchant.country || "Not provided"}</dd></div>
              </dl>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl ring-1 ring-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2.5 px-4 py-3 shadow-[inset_0_-1px_0_0_#e2e8f0] sm:px-5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700"><UserRound className="h-4 w-4" /></span><div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Account administrator</p><h2 className="text-sm font-semibold text-slate-900">Owner and security contact</h2></div></div>
            <div className="grid min-w-0 gap-4 p-4 sm:p-5 md:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] md:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-base font-bold text-indigo-700">{(owner?.name || "O").trim().charAt(0).toUpperCase()}</span>
                <div className="min-w-0"><div className="truncate text-base font-semibold text-slate-900">{owner?.name || "Owner not named"}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Owner ID {owner?.id ? `#${owner.id}` : "not recorded"}</div></div>
              </div>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <div className="flex min-w-0 items-center gap-2.5 pl-3 shadow-[inset_2px_0_0_0_#bfdbfe]"><Mail className="h-4 w-4 shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Email</span><span className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${owner?.emailVerifiedAt ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{owner?.emailVerifiedAt ? "Verified" : "Unverified"}</span></div><div className="mt-1 truncate text-xs font-semibold text-slate-800" title={detail.application.merchant.contactEmail || "Not provided"}>{detail.application.merchant.contactEmail || "Not provided"}</div></div></div>
                <div className="flex min-w-0 items-center gap-2.5 pl-3 shadow-[inset_2px_0_0_0_#c7d2fe]"><Phone className="h-4 w-4 shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Phone</span><span className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${owner?.phoneVerifiedAt ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{owner?.phoneVerifiedAt ? "Verified" : "Unverified"}</span></div><div className="mt-1 truncate text-xs font-semibold text-slate-800">{detail.application.merchant.contactPhone || "Not provided"}</div></div></div>
              </div>
            </div>
            {warnings.length > 0 && <div className="space-y-1.5 bg-amber-50/60 px-4 py-3 shadow-[inset_0_1px_0_0_#fef3c7] sm:px-5">{warnings.map((warning) => <p key={warning} className="m-0 flex items-start gap-1.5 text-[11px] font-medium leading-4 text-amber-800"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{warning}</p>)}</div>}
          </section>

          <section className="rounded-xl ring-1 ring-slate-200 bg-white p-4 shadow-sm sm:p-6"><div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold text-slate-900">Properties covered</h2><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{detail.properties.length}</span></div>{detail.properties.length ? <div className="grid gap-2 sm:grid-cols-2">{detail.properties.map((property) => <div key={property.propertyId} className="flex min-w-0 items-center gap-2 rounded-lg ring-1 ring-slate-200 bg-slate-50 p-3"><Building2 className="h-4 w-4 shrink-0 text-slate-400" /><span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{property.title || `Property ${property.propertyId}`}</span><span className="text-[10px] font-bold text-slate-400">#{property.propertyId}</span></div>)}</div> : <p className="text-sm text-slate-500">No properties are linked to this merchant.</p>}</section>

          <section className="rounded-xl ring-1 ring-slate-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="mb-4 text-base font-semibold text-slate-900">Evidence and consent</h2><div className="space-y-2">{detail.application.documents.length === 0 && <p className="text-sm text-slate-500">No documents were attached to this version.</p>}{detail.application.documents.map((document) => <div key={document.id} className="flex flex-col gap-3 rounded-lg ring-1 ring-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center"><FileText className="h-4 w-4 shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-slate-900">{titleCase(document.documentType)}</div><div className="mt-0.5 text-[11px] text-slate-500">{document.expiresAt ? `Expires ${formatWhen(document.expiresAt)}` : "No expiry recorded"} · Profile {titleCase(document.userDocument?.status) || "missing"}</div></div><span className="w-fit rounded-md bg-white px-2 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">{titleCase(document.verificationState)}</span><button type="button" onClick={() => void openDocument(document.id)} disabled={!document.userDocument || viewingId === document.id} title={document.userDocument ? "Opens the file in a new tab" : "No file was uploaded against this document"} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-semibold text-[#02665e] transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">{viewingId === document.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}Open</button></div>)}</div>{viewError && <p className="mt-3 text-xs font-semibold text-rose-700">{viewError}</p>}<div className={`mt-4 rounded-lg p-3 ring-1 ${detail.policyAcceptance ? "ring-emerald-200 bg-emerald-50" : "ring-amber-200 bg-amber-50"}`}><div className="text-xs font-semibold text-slate-900">{detail.policyAcceptance ? `Policy ${detail.policyAcceptance.policyId} ${detail.policyAcceptance.policyVersion} accepted` : "No current policy acceptance"}</div>{detail.policyAcceptance && <div className="mt-1 text-[11px] text-slate-600">{formatWhen(detail.policyAcceptance.acceptedAt)} · {shortHash(detail.policyAcceptance.contentHash)}</div>}</div></section>
        </main>

        <aside className="min-w-0 space-y-4 sm:space-y-6">
          <section className="overflow-hidden rounded-xl ring-1 ring-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 shadow-[inset_0_-1px_0_0_#f1f5f9] sm:px-5">
              <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Record summary</p><h2 className="mt-0.5 text-base font-semibold text-slate-900">Application overview</h2></div>
              <span className="rounded-lg bg-[#02665e] px-2.5 py-1.5 text-xs font-bold tabular-nums text-white">#{detail.application.id}</span>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-slate-200">
              <div className="min-w-0 bg-white p-3 sm:p-4"><dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400"><Clock3 className="h-3.5 w-3.5 text-[#02665e]" />Submitted</dt><dd className="mt-1.5 break-words text-xs font-semibold leading-5 text-slate-800">{formatWhen(detail.application.submittedAt)}</dd></div>
              <div className="min-w-0 bg-white p-3 sm:p-4"><dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400"><CheckCircle2 className="h-3.5 w-3.5 text-[#02665e]" />Reviewed</dt><dd className={`mt-1.5 break-words text-xs font-semibold leading-5 ${detail.application.reviewedAt ? "text-slate-800" : "text-amber-700"}`}>{detail.application.reviewedAt ? formatWhen(detail.application.reviewedAt) : "Pending review"}</dd></div>
              <div className="min-w-0 bg-white p-3 sm:p-4"><dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400"><FileText className="h-3.5 w-3.5 text-[#02665e]" />Provider reference</dt><dd className="mt-1.5 break-all text-xs font-semibold leading-5 text-slate-800">{detail.application.providerSubmissionRef || "Not assigned"}</dd></div>
              <div className="min-w-0 bg-white p-3 sm:p-4"><dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-[#02665e]" />Package version</dt><dd className="mt-1.5 text-xs font-semibold leading-5 text-slate-800">Version {detail.application.version}</dd></div>
            </dl>
          </section>

          <section className={`rounded-xl p-4 shadow-sm ring-1 sm:p-5 ${decidable ? "ring-emerald-200 bg-emerald-50/50" : "ring-slate-200 bg-white"}`}><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#02665e] ring-1 ring-slate-200"><ShieldCheck className="h-4 w-4" /></span><h2 className="text-base font-semibold text-slate-900">Review decision</h2></div>{!decidable ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">This application is {titleCase(detail.application.status)} and is not awaiting a decision.{detail.application.decisionReason ? ` Last note: ${detail.application.decisionReason}` : ""}</p> : <><label className="mt-4 block text-xs font-semibold text-slate-700">Decision reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={5} maxLength={300} placeholder="Record what you checked and why." className="mt-2 box-border w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm font-normal text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-emerald-100" /></label><div className="mt-1 text-right text-[10px] tabular-nums text-slate-400">{reason.trim().length}/300</div><div className="mt-4">
              {/* Three identical grey slabs told you nothing: not which action
                  was which, and not why none of them worked. The gate is
                  stated once, above the buttons that it gates. */}
              {(altered || reason.trim().length < 3) && (
                <p className={`m-0 mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold leading-4 ring-1 ${altered ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-slate-50 text-slate-600 ring-slate-200"}`}>
                  {altered ? <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
                  <span>
                    {altered
                      ? "Approval is blocked: the merchant record no longer matches the snapshot frozen at submission. It can still be returned or rejected."
                      : "Write a short decision reason to enable these actions."}
                  </span>
                </p>
              )}

              {/* Naming the areas is what makes a return actionable: the owner
                  gets a checklist and their form can open exactly these
                  sections, instead of the whole application going back. */}
              <fieldset className="m-0 mb-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Areas needing correction</legend>
                <div className="space-y-1.5">
                  {CORRECTION_AREAS.map((area) => {
                    const on = areas.includes(area.key);
                    return (
                      <label key={area.key} className={`flex cursor-pointer items-start gap-2.5 rounded-md p-2 text-left transition ${on ? "bg-white ring-1 ring-amber-300" : "hover:bg-white/60"}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setAreas((current) => current.includes(area.key) ? current.filter((key) => key !== area.key) : [...current, area.key])}
                          className="sr-only"
                        />
                        <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-amber-600 bg-amber-600 text-white" : "border-slate-300 bg-white"}`}>
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className={`block text-[11px] font-bold leading-4 ${on ? "text-amber-900" : "text-slate-700"}`}>{area.label}</span>
                          <span className="block text-[10px] leading-4 text-slate-500">{area.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="m-0 mt-2 text-[10px] leading-4 text-amber-800/80">Only used when returning. Approving or rejecting ignores this.</p>
              </fieldset>

              {/* Approve leads, the other two share a row beneath it, so the
                  irreversible one is not the same size and weight as the one
                  you reach for most. */}
              <button
                type="button"
                onClick={() => setPending("APPROVE")}
                disabled={altered || reason.trim().length < 3 || submitting}
                title={altered ? "Blocked while the package does not match the frozen snapshot" : undefined}
                className="inline-flex h-10 w-full appearance-none items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] px-3 text-xs font-bold text-white shadow-sm transition hover:bg-[#01544d] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
              >
                <ShieldCheck className="h-4 w-4" />Approve
              </button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPending("RETURN")}
                  disabled={reason.trim().length < 3 || areas.length === 0 || submitting}
                  title={areas.length === 0 ? "Tick at least one area that needs correction" : undefined}
                  className="inline-flex h-10 w-full appearance-none items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2 text-xs font-bold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <Undo2 className="h-4 w-4 shrink-0" />Return{areas.length > 0 ? ` (${areas.length})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => setPending("REJECT")}
                  disabled={reason.trim().length < 3 || submitting}
                  className="inline-flex h-10 w-full appearance-none items-center justify-center gap-1.5 rounded-lg border border-rose-300 bg-white px-2 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <X className="h-4 w-4 shrink-0" />Reject
                </button>
              </div>
            </div></>}</section>

          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-[#02665e]" /><h2 className="m-0 text-base font-semibold text-slate-900">Audit trail</h2></div>
              {detail.auditTrail.length > 0 && <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold tabular-nums text-slate-500">{detail.auditTrail.length}</span>}
            </div>
            {detail.auditTrail.length ? (
              /* Every dot was the same emerald, so an approval, a rejection and
                 a routine document view all looked equally important. Tone now
                 comes from the action, and the continuous rail is drawn per
                 entry so the last one does not trail into empty space. */
              <ol className="m-0 list-none p-0">
                {detail.auditTrail.map((entry, index) => {
                  const tone = auditTone(entry.action);
                  const ToneIcon = tone.Icon;
                  const last = index === detail.auditTrail.length - 1;
                  const flagged = Array.isArray((entry.metadata as { correctionAreas?: unknown } | null)?.correctionAreas)
                    ? ((entry.metadata as { correctionAreas: string[] }).correctionAreas)
                    : [];
                  return (
                    <li key={`${entry.createdAt}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
                      {!last && <span aria-hidden="true" className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-slate-200" />}
                      <span className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${tone.dot}`}>
                        <ToneIcon className="h-3 w-3" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`m-0 text-xs font-semibold ${tone.muted ? "text-slate-600" : "text-slate-900"}`}>{titleCase(entry.action)}</p>
                        <p className="m-0 mt-0.5 text-[10px] text-slate-400">{formatWhen(entry.createdAt)} · {entry.actorKind.toLowerCase()}{entry.actorUserId ? ` #${entry.actorUserId}` : ""}</p>
                        {entry.reason && <p className={`m-0 mt-1.5 rounded-md px-2 py-1.5 text-[11px] leading-4 ${tone.note}`}>{entry.reason}</p>}
                        {/* What the reviewer actually asked the owner to fix. */}
                        {flagged.length > 0 && (
                          <p className="m-0 mt-1.5 flex flex-wrap gap-1">
                            {flagged.map((area) => (
                              <span key={area} className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">
                                {CORRECTION_AREAS.find((item) => item.key === area)?.label ?? titleCase(area)}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="m-0 text-xs text-slate-500">Nothing recorded yet.</p>}
          </section>
        </aside>
      </div>

      {pending && <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4"><button type="button" aria-label="Cancel decision" onClick={() => setPending(null)} className="absolute inset-0 border-0 bg-slate-950/50 backdrop-blur-sm" /><section role="dialog" aria-modal="true" className="relative w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"><div className="p-5 shadow-[inset_0_-1px_0_0_#e2e8f0]"><h2 className="text-lg font-semibold text-slate-900">{DECISIONS[pending].title}</h2><p className="mt-2 text-sm leading-5 text-slate-600">{DECISIONS[pending].body}</p></div><div className="space-y-3 p-5"><div className="rounded-lg bg-slate-50 p-3 text-sm"><div className="font-semibold text-slate-900">Application #{detail.application.id}</div><div className="mt-1 text-xs text-slate-500">{detail.application.merchant.legalName}</div></div><p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{reason.trim()}</p>{pending === "RETURN" && areas.length > 0 && <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200"><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-amber-800">The owner will be asked to correct</p><ul className="m-0 mt-1.5 list-none space-y-1 p-0">{areas.map((key) => <li key={key} className="flex items-center gap-1.5 text-xs font-semibold text-amber-900"><Check className="h-3 w-3 shrink-0" />{CORRECTION_AREAS.find((area) => area.key === key)?.label ?? key}</li>)}</ul></div>}</div><div className="flex justify-end gap-2 bg-slate-50 px-5 py-3 shadow-[inset_0_1px_0_0_#e2e8f0]"><button type="button" onClick={() => setPending(null)} disabled={submitting} className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold">Cancel</button><button type="button" onClick={() => void submitDecision()} disabled={submitting} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#02665e] px-4 text-xs font-semibold text-white disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Confirm</button></div></section></div>}
    </div>
  );
}
