"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, CircleDollarSign,
  Clock3, FileText, MapPin, RotateCcw, ShieldCheck, User, XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

const money = (value: unknown, currency = "TZS") => `${currency} ${Number(value || 0).toLocaleString()}`;
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString() : "Not recorded";

type DecisionAction = "APPROVE_CANCELLATION" | "REJECT" | "RECORD_REFUND";

function statusLabel(status: string) {
  if (status === "APPROVED") return "Refund queue";
  if (status === "RESOLVED") return "Refunded";
  if (["ELIGIBLE", "OPEN"].includes(status)) return "Submitted";
  if (["UNDER_REVIEW", "ACKNOWLEDGED", "ESCALATED"].includes(status)) return "Reviewing";
  return String(status || "Open").replaceAll("_", " ");
}

function statusClass(status: string) {
  if (status === "RESOLVED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "REJECTED") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "APPROVED") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    ELIGIBILITY_CALCULATED: "Policy eligibility calculated",
    REQUEST_EVIDENCE: "NoLSAF requested evidence",
    TRAVELER_EVIDENCE_SUBMITTED: "Traveller submitted evidence",
    ACKNOWLEDGE: "Operator acknowledged the case",
    ESCALATE: "Operator escalated the case",
    OPERATOR_COST_EVIDENCE: "Operator submitted cost evidence",
    OPERATOR_NOTIFIED: "Case delivered to operator",
    APPROVE_CANCELLATION: "Cancellation approved",
    RECORD_REFUND: "Refund recorded",
    REJECT: "Cancellation rejected",
  };
  return labels[type] || String(type || "System update").replaceAll("_", " ");
}

export default function AdminTourCancellationDetailPage() {
  const params = useParams<{ id?: string | string[] }>();
  const id = Number(Array.isArray(params.id) ? params.id[0] : params.id);
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [reason, setReason] = useState("");
  const [refundReference, setRefundReference] = useState("");
  const [operatorCaused, setOperatorCaused] = useState(false);
  const [overrideOperatorResponse, setOverrideOperatorResponse] = useState(false);
  const [confirmAction, setConfirmAction] = useState<DecisionAction | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/api/admin/cancellations/tours/${id}`);
      setItem(response.data?.case || null);
    } catch (requestError: any) {
      setError(String(requestError?.response?.data?.error || "Failed to load this cancellation case."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (Number.isFinite(id) && id > 0) void load(); }, [id]);

  const events = item?.events || [];
  const eligibility = useMemo(() => events.find((event: any) => event.type === "ELIGIBILITY_CALCULATED")?.data || {}, [events]);
  const requestedEvidence = useMemo(() => events.find((event: any) => event.type === "REQUEST_EVIDENCE"), [events]);
  const operatorEvidence = useMemo(() => [...events].reverse().find((event: any) => event.type === "OPERATOR_COST_EVIDENCE")?.data?.items || [], [events]);
  const operatorNotified = useMemo(() => events.find((event: any) => event.type === "OPERATOR_NOTIFIED"), [events]);
  const operatorResponse = useMemo(() => events.find((event: any) => ["ACKNOWLEDGE", "ESCALATE", "OPERATOR_COST_EVIDENCE"].includes(event.type)), [events]);
  const operatorResponseDueAt = eligibility.operatorResponseDueAt ? new Date(String(eligibility.operatorResponseDueAt)) : null;
  const operatorResponseWindowOpen = Boolean(item?.booking?.operatorAgentId && !operatorResponse && operatorResponseDueAt && operatorResponseDueAt.getTime() > Date.now());
  const evidenceFiles = useMemo(() => events
    .filter((event: any) => event.type === "TRAVELER_EVIDENCE_SUBMITTED")
    .flatMap((event: any) => Array.isArray(event?.data?.documents) ? event.data.documents.map((file: any) => ({ ...file, submittedAt: event.createdAt })) : []), [events]);
  const closed = ["RESOLVED", "REJECTED", "CLOSED", "WITHDRAWN"].includes(String(item?.status || "").toUpperCase());

  const openConfirmation = (action: DecisionAction) => {
    if (!reason.trim()) return setError("Add an administrative reason before taking this action.");
    if (action === "RECORD_REFUND" && refundReference.trim().length < 3) return setError("Add the payment-provider refund reference before recording the refund.");
    setError(null);
    setConfirmAction(action);
  };

  const act = async (action: "DELIVER_TO_OPERATOR" | "REQUEST_EVIDENCE" | DecisionAction) => {
    if (!item || !reason.trim()) return setError("Add an administrative reason before taking this action.");
    setWorking(true);
    setError(null);
    try {
      const payload: any = { action, reason: reason.trim() };
      if (action === "APPROVE_CANCELLATION" || action === "REJECT") payload.overrideOperatorResponse = overrideOperatorResponse;
      if (action === "APPROVE_CANCELLATION") {
        payload.refundPercent = Number(eligibility.refundPercent || 0);
        payload.deductions = operatorEvidence;
        payload.operatorCaused = operatorCaused;
      }
      if (action === "RECORD_REFUND") payload.refundReference = refundReference.trim();
      await apiClient.post(`/api/admin/cancellations/tours/${item.id}/action`, payload);
      setReason("");
      setRefundReference("");
      setOverrideOperatorResponse(false);
      setConfirmAction(null);
      await load();
    } catch (actionError: any) {
      setError(String(actionError?.response?.data?.error || "Unable to update this cancellation case."));
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <div className="mx-auto max-w-6xl px-4 py-10 text-center text-sm text-slate-500">Loading cancellation case...</div>;
  if (!item) return <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-rose-700">{error || "Cancellation case not found."}</div>;

  const booking = item.booking || {};
  const traveler = booking.customer || {};
  const refunds = (booking.financialTransactions || []).filter((entry: any) => entry.kind === "REFUND");
  const confirmationTitle = confirmAction === "APPROVE_CANCELLATION" ? "Approve this cancellation?" : confirmAction === "REJECT" ? "Reject this cancellation?" : "Record this refund as completed?";
  const confirmationText = confirmAction === "APPROVE_CANCELLATION"
    ? `${overrideOperatorResponse && operatorResponseWindowOpen ? "The urgent-decision override will be permanently recorded. " : ""}This cancels the booking, holds the operator payout, and creates the approved refund record.`
    : confirmAction === "REJECT"
      ? `${overrideOperatorResponse && operatorResponseWindowOpen ? "The urgent-decision override will be permanently recorded. " : ""}This closes the traveller's request and sends them the decision.`
      : `This records ${refundReference.trim()} as the payment-provider refund reference.`;

  return <main className="mx-auto w-[calc(100%-1rem)] max-w-6xl min-w-0 space-y-5 overflow-x-clip py-5 sm:w-[calc(100%-1.5rem)]">
    <Link href="/admin/cancellations?service=tours" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50" aria-label="Back to tour cancellations"><ArrowLeft className="h-5 w-5" /></Link>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e] shadow-sm">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Tour cancellation case</div>
                <h1 className="mt-0.5 text-2xl font-bold text-slate-950">#{item.id}</h1>
              </div>
            </div>
            <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5">
              <span className="flex-shrink-0 text-sm text-slate-600">Tour booking</span>
              <span className="truncate font-mono text-sm font-semibold text-slate-950">{booking.bookingCode || "Not recorded"}</span>
            </div>
          </div>
          <span className={`inline-flex flex-shrink-0 self-start rounded-full border px-3 py-1 text-xs font-bold ${statusClass(item.status)}`}>
            {statusLabel(item.status)}
          </span>
        </div>
      </div>

      <div className="grid gap-3 px-5 py-5 sm:px-6 md:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <User className="h-4 w-4 flex-shrink-0" />
            <span>Traveller</span>
          </div>
          <div className="mt-2 truncate font-semibold text-slate-900">{traveler.name || booking.guestName || "Traveller"}</div>
          <div className="mt-1 truncate text-sm text-slate-600">{traveler.email || booking.guestEmail || "No contact recorded"}</div>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <MapPin className="h-4 w-4 flex-shrink-0" />
            <span>Tour package</span>
          </div>
          <div className="mt-2 truncate font-semibold text-slate-900">{booking.title || "Tour package"}</div>
          <div className="mt-1 truncate text-sm text-slate-600">{booking.destination || "Destination not recorded"}</div>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <CalendarDays className="h-4 w-4 flex-shrink-0" />
            <span>Submitted</span>
          </div>
          <div className="mt-2 font-semibold text-slate-900">{dateTime(item.createdAt)}</div>
          <div className="mt-1 text-sm text-slate-600">Booking value: {money(booking.grossAmount, booking.currency)}</div>
        </div>
      </div>
    </section>

    <section className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[#02665e]" /><h2 className="font-bold text-slate-950">Evidence review</h2></div>{requestedEvidence ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-sm font-semibold text-amber-950">Evidence requested from traveller</div><p className="mt-1 text-sm leading-relaxed text-amber-900">{String(requestedEvidence.message || "NoLSAF requested supporting evidence.")}</p></div> : <p className="mt-3 text-sm text-slate-600">No additional traveller evidence has been requested.</p>}<div className="mt-4 space-y-2">{evidenceFiles.length === 0 ? <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">No traveller evidence has been uploaded yet.</div> : evidenceFiles.map((file: any, index: number) => <div key={`${file.url}-${index}`} className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-teal-50/50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="font-semibold text-slate-900">{file.label || file.fileName || "Supporting evidence"}</div><div className="mt-1 break-all text-xs text-slate-600">{file.fileName || "Uploaded file"} · Submitted {dateTime(file.submittedAt)}</div></div><a href={file.url} target="_blank" rel="noreferrer" className="inline-flex w-fit rounded-lg border border-[#02665e] bg-white px-3 py-2 text-sm font-semibold text-[#02665e] no-underline hover:bg-teal-50">Open file</a></div>)}</div></section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-slate-500" /><h2 className="font-bold text-slate-950">Case activity</h2></div><div className="mt-3 divide-y divide-slate-100">{events.map((event: any) => <div key={event.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-slate-900">{eventLabel(event.type)}</div><div className="text-xs text-slate-500">{dateTime(event.createdAt)}</div></div><p className="mt-1 text-sm leading-relaxed text-slate-600">{typeof event.message === "string" ? event.message : "Case activity recorded."}</p></div>)}</div></section>
      </div>

      <aside className="grid min-w-0 gap-5 lg:grid-cols-2 2xl:grid-cols-1"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 flex-shrink-0 text-[#02665e]" />
            <h2 className="font-bold text-slate-950">Decision and refund</h2>
          </div>
          <dl className="mt-4 space-y-2.5">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Policy result</dt>
              <dd className="ml-0 mt-1 text-sm font-semibold text-slate-900">{String(eligibility.eligibilityCode || "Manual review").replaceAll("_", " ")}</dd>
            </div>
            <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[#02665e]">Provisional refund</dt>
              <dd className="ml-0 mt-1 text-lg font-bold text-slate-950">{money(eligibility.estimatedRefundAmount, booking.currency)}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Refund record</dt>
              <dd className="ml-0 mt-1 text-sm font-semibold text-slate-900">{refunds.length ? String(refunds[0].status).replaceAll("_", " ") : "Created after approval"}</dd>
            </div>
            <div className={`rounded-xl border px-4 py-3 ${operatorResponse ? "border-emerald-200 bg-emerald-50" : operatorResponseWindowOpen ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Operator participation</dt>
              <dd className="ml-0 mt-1 text-sm font-semibold text-slate-900">
                {operatorResponse ? `Responded ${dateTime(operatorResponse.createdAt)}` : operatorResponseWindowOpen ? `Awaiting response until ${dateTime(operatorResponseDueAt)}` : booking.operatorAgentId ? "Response window completed" : "No operator assigned"}
              </dd>
            </div>
          </dl>
        </section>
        {!closed && !operatorNotified && String(booking.paymentStatus || "").toUpperCase() === "PAID" && <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm"><div className="text-sm font-bold text-sky-950">Operator has not received this case</div><p className="mt-1 text-xs leading-relaxed text-sky-800">Deliver it before expecting acknowledgement, evidence, or an operational response.</p><button type="button" disabled={working || reason.trim().length < 2} onClick={() => void act("DELIVER_TO_OPERATOR")} className="mt-3 w-full rounded-lg bg-sky-800 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-900 disabled:opacity-50">Deliver to operator</button></section>}
        {!closed && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-950">Admin decision</h2><p className="mt-1 text-xs text-slate-500">Record the reason that will be kept in the case history.</p><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="Decision reason or evidence request" className="mt-4 box-border w-full min-w-0 max-w-full resize-y rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20" /><label className="mt-3 flex items-start gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={operatorCaused} onChange={(event) => setOperatorCaused(event.target.checked)} className="mt-0.5" />Operator or NoLSAF caused the cancellation</label>{operatorResponseWindowOpen && <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950"><input type="checkbox" checked={overrideOperatorResponse} onChange={(event) => setOverrideOperatorResponse(event.target.checked)} className="mt-0.5" /><span>Urgent decision before operator deadline<span className="mt-1 block font-normal text-amber-800">Only use when waiting until {dateTime(operatorResponseDueAt)} would materially harm the traveller or tour. The reason and override are permanently audited.</span></span></label>}<div className="mt-4 grid gap-2"><button type="button" disabled={working} onClick={() => void act("REQUEST_EVIDENCE")} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"><RotateCcw className="mr-1 inline h-4 w-4" />Request evidence</button><button type="button" disabled={working || !["ELIGIBLE", "UNDER_REVIEW", "ACKNOWLEDGED", "ESCALATED"].includes(item.status)} onClick={() => openConfirmation("APPROVE_CANCELLATION")} className="rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"><CheckCircle2 className="mr-1 inline h-4 w-4" />Approve cancellation</button><button type="button" disabled={working} onClick={() => openConfirmation("REJECT")} className="rounded-lg bg-rose-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-60"><XCircle className="mr-1 inline h-4 w-4" />Reject request</button></div>{item.status === "APPROVED" && <div className="mt-4"><label className="text-xs font-semibold text-slate-700">Refund reference</label><input value={refundReference} onChange={(event) => setRefundReference(event.target.value)} placeholder="Payment-provider reference" className="mt-1 box-border w-full min-w-0 max-w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" disabled={working || refundReference.trim().length < 3} onClick={() => openConfirmation("RECORD_REFUND")} className="mt-2 w-full rounded-lg bg-[#02665e] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-60">Record refund</button></div>}</section>}
      </aside>
    </section>

    {confirmAction && <section role="alertdialog" aria-modal="true" className="rounded-2xl border border-slate-300 bg-slate-950 p-5 text-white shadow-xl"><h2 className="text-lg font-bold">{confirmationTitle}</h2><p className="mt-2 text-sm text-slate-300">{confirmationText}</p><div className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-200">Reason: {reason}</div><div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" onClick={() => setConfirmAction(null)} disabled={working} className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold hover:bg-white/10">Keep reviewing</button><button type="button" onClick={() => void act(confirmAction)} disabled={working} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-100">{working ? "Saving..." : "Confirm decision"}</button></div></section>}
  </main>;
}
