"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, BellRing, Clock3, FileUp,
  LockKeyhole, MessageSquareText, RefreshCw,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type CaseEvent = { id: number; type: string; message?: unknown; data?: any; createdAt: string };
type TourCase = {
  id: number; type: string; status: string; title: string; description: string;
  createdAt: string; operatorReceiptStatus?: "AWAITING_RECEIPT" | "RECEIVED"; events: CaseEvent[];
};

type Props = {
  bookingId: string;
  bookingCode: string;
  bookingStatus: string;
  payoutStatus?: string | null;
  startDate?: string | null;
  currency?: string | null;
  operatorPayoutAmount?: number | string | null;
};

const text = (value: unknown, fallback = "") => {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "message" in value && typeof (value as any).message === "string") return (value as any).message;
  return fallback;
};

const statusLabel = (status: string) => status.replaceAll("_", " ");
const isClosed = (status: string) => ["WITHDRAWN", "CLOSED", "RESOLVED", "REJECTED"].includes(status.toUpperCase());

function impactFor(status: string, bookingStatus: string) {
  const caseStatus = status.toUpperCase();
  if (caseStatus === "APPROVED" || ["CANCELED", "REFUNDED"].includes(bookingStatus.toUpperCase())) {
    return { booking: "Cancelled by NoLSAF", operations: "Stop delivery and await final instructions", payout: "Held pending refund reconciliation", tone: "rose" };
  }
  if (isClosed(caseStatus)) return { booking: "Remains active", operations: "Continue the confirmed tour plan", payout: "Returns to the normal payout lifecycle", tone: "emerald" };
  return { booking: "Active while under review", operations: "Do not cancel suppliers until NoLSAF decides", payout: "Unavailable while this case is open", tone: "amber" };
}

export default function TourCancellationWorkspace(props: Props) {
  const [cases, setCases] = useState<TourCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [drafts, setDrafts] = useState<Record<number, { kind: string; description: string; amount: string; evidenceUrl: string; fileName: string; disclosedBeforePayment: boolean }>>({});
  const [uploading, setUploading] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!props.bookingId) return;
    setLoading(true);
    try {
      const response = await apiClient.get(`/api/agent/tour-bookings/${encodeURIComponent(props.bookingId)}/cases`);
      setCases(Array.isArray(response.data?.cases) ? response.data.cases : []);
    } catch (error: any) {
      setNotice(text(error?.response?.data?.error, "Could not load traveller cases."));
    } finally { setLoading(false); }
  }, [props.bookingId]);

  useEffect(() => { void load(); }, [load]);

  const activeCases = useMemo(() => cases.filter((item) => !isClosed(item.status)), [cases]);
  if (!loading && cases.length === 0) return null;

  const respond = async (tourCase: TourCase, action: "ACKNOWLEDGE" | "ESCALATE") => {
    const message = String(messages[tourCase.id] || "").trim();
    if (!message) return setNotice("Write an update before sending it.");
    setWorking(tourCase.id); setNotice(null);
    try {
      await apiClient.post(`/api/agent/tour-bookings/${encodeURIComponent(props.bookingId)}/cases/${tourCase.id}/action`, { action, message });
      setMessages((old) => ({ ...old, [tourCase.id]: "" }));
      setNotice(action === "ESCALATE" ? "Case escalated to NoLSAF and recorded in the shared activity." : "Receipt acknowledged, update recorded, and the traveller notified.");
      await load();
    } catch (error: any) { setNotice(text(error?.response?.data?.error, "Could not update the case.")); }
    finally { setWorking(null); }
  };

  const uploadEvidence = async (caseId: number, file: File) => {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return setNotice("Evidence must be a PDF, JPG, or PNG file.");
    if (file.size > 5 * 1024 * 1024) return setNotice("Evidence files must be 5MB or smaller.");
    setUploading(caseId); setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "agent-documents/tour-cases");
      const response = await apiClient.post("/api/uploads/cloudinary/upload", form);
      const url = String(response.data?.secure_url || "");
      if (!url) throw new Error("Upload did not return a file URL");
      setDrafts((old) => ({ ...old, [caseId]: { ...(old[caseId] || { kind: "NON_REFUNDABLE_COMPONENT", description: "", amount: "", disclosedBeforePayment: false }), evidenceUrl: url, fileName: file.name } }));
      setNotice("Evidence file uploaded. Add its cost details, then submit it to NoLSAF.");
    } catch (error: any) { setNotice(text(error?.response?.data?.message || error?.response?.data?.error, "Evidence upload failed.")); }
    finally { setUploading(null); }
  };

  const submitEvidence = async (tourCase: TourCase) => {
    const draft = drafts[tourCase.id];
    if (!draft?.description.trim() || !(Number(draft.amount) > 0) || !draft.evidenceUrl) return setNotice("Add a cost description, positive amount, and evidence file.");
    setWorking(tourCase.id); setNotice(null);
    try {
      await apiClient.post(`/api/agent/tour-bookings/${encodeURIComponent(props.bookingId)}/cases/${tourCase.id}/cost-evidence`, {
        message: messages[tourCase.id]?.trim() || "Operator submitted documented supplier cost.",
        items: [{ kind: draft.kind, description: draft.description.trim(), amount: Number(draft.amount), evidenceUrl: draft.evidenceUrl, disclosedBeforePayment: draft.disclosedBeforePayment }],
      });
      setDrafts((old) => ({ ...old, [tourCase.id]: { kind: "NON_REFUNDABLE_COMPONENT", description: "", amount: "", evidenceUrl: "", fileName: "", disclosedBeforePayment: false } }));
      setMessages((old) => ({ ...old, [tourCase.id]: "" }));
      setNotice("Supplier cost and evidence submitted to NoLSAF.");
      await load();
    } catch (error: any) { setNotice(text(error?.response?.data?.error, "Could not submit cost evidence.")); }
    finally { setWorking(null); }
  };

  return <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
    <header className="flex flex-col gap-3 border-b border-amber-100 bg-amber-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="flex items-center gap-2"><BellRing className="h-5 w-5 text-amber-700" /><h2 className="font-bold text-slate-950">Cancellation and traveller cases</h2></div><p className="mt-1 text-sm text-slate-600">One shared workspace for operational impact, evidence, and communication with NoLSAF.</p></div>
      <div className="flex items-center gap-2"><Link href="/account/agent/cancellations" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 no-underline hover:bg-amber-50">Open case inbox</Link><button type="button" onClick={() => void load()} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-amber-300 bg-white text-amber-900" aria-label="Refresh cases"><RefreshCw className="h-4 w-4" /></button></div>
    </header>
    {notice && <div role="status" className="mx-5 mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">{notice}</div>}
    {loading ? <div className="p-8 text-center text-sm text-slate-500">Loading cases...</div> : <div className="space-y-5 p-5">{cases.map((tourCase) => {
      const eligibility = tourCase.events.find((event) => event.type === "ELIGIBILITY_CALCULATED")?.data || {};
      const impact = impactFor(tourCase.status, props.bookingStatus);
      const financial = ["CANCELLATION", "REFUND"].includes(tourCase.type.toUpperCase());
      const closed = isClosed(tourCase.status);
      const draft = drafts[tourCase.id] || { kind: "NON_REFUNDABLE_COMPONENT", description: "", amount: "", evidenceUrl: "", fileName: "", disclosedBeforePayment: false };
      const hoursToStart = props.startDate ? Math.round((new Date(props.startDate).getTime() - Date.now()) / 3_600_000) : null;
      const operatorResponse = tourCase.events.find((event) => ["ACKNOWLEDGE", "ESCALATE", "OPERATOR_COST_EVIDENCE"].includes(event.type));
      const responseDueAt = eligibility.operatorResponseDueAt ? new Date(String(eligibility.operatorResponseDueAt)) : null;
      return <article key={tourCase.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">{tourCase.type} case #{tourCase.id}</div><h3 className="mt-1 break-words font-bold text-slate-950">{tourCase.title}</h3><p className="mt-1 break-words text-sm text-slate-600">{tourCase.description}</p></div><span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">{statusLabel(tourCase.status)}</span></div>
        <div className={`border-b px-4 py-3 text-sm ${operatorResponse ? "border-emerald-100 bg-emerald-50 text-emerald-900" : "border-sky-100 bg-sky-50 text-sky-900"}`}><span className="font-semibold">Responsibility: </span>{operatorResponse ? `Received by you ${new Date(operatorResponse.createdAt).toLocaleString()}.` : responseDueAt ? `Delivered by NoLSAF. Acknowledge receipt by ${responseDueAt.toLocaleString()}.` : "Delivered by NoLSAF and awaiting your acknowledgement."}</div>
        <div className="grid gap-3 px-4 py-4 md:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Booking impact</div><div className="mt-1 text-sm font-semibold text-slate-900">{impact.booking}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Operational instruction</div><div className="mt-1 text-sm font-semibold text-slate-900">{impact.operations}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Payout impact</div><div className="mt-1 text-sm font-semibold text-slate-900">{impact.payout}</div></div></div>
        <div className="grid gap-3 border-t border-slate-100 px-4 py-4 sm:grid-cols-3"><div><div className="text-xs text-slate-500">Policy result</div><div className="mt-1 text-sm font-semibold">{eligibility.eligibilityCode || "Manual review"}</div></div><div><div className="text-xs text-slate-500">Provisional refund</div><div className="mt-1 text-sm font-semibold">{Number(eligibility.refundPercent || 0)}% · {props.currency || "TZS"} {Number(eligibility.estimatedRefundAmount || 0).toLocaleString()}</div></div><div><div className="text-xs text-slate-500">Travel urgency</div><div className="mt-1 text-sm font-semibold">{hoursToStart == null ? "Travel date not recorded" : hoursToStart <= 0 ? "Travel has started" : `${hoursToStart} hours until departure`}</div></div></div>
        {!closed && <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 px-4 py-4"><div><label className="text-xs font-semibold text-slate-700">Shared case update</label><textarea value={messages[tourCase.id] || ""} onChange={(event) => setMessages((old) => ({ ...old, [tourCase.id]: event.target.value }))} rows={3} placeholder="Explain your response, supplier position, or operational concern" className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm" /><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={working === tourCase.id} onClick={() => void respond(tourCase, "ACKNOWLEDGE")} className="rounded-lg bg-[#02665e] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"><MessageSquareText className="mr-1 inline h-4 w-4" />Send update and acknowledge</button><button type="button" disabled={working === tourCase.id} onClick={() => void respond(tourCase, "ESCALATE")} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-60"><AlertTriangle className="mr-1 inline h-4 w-4" />Escalate to NoLSAF</button></div></div>
          {financial && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2"><FileUp className="h-4 w-4 text-amber-800" /><div className="text-sm font-bold text-amber-950">Document a non-recoverable supplier cost</div></div><p className="mt-1 text-xs text-amber-800">Only genuine, disclosed, and verifiable costs may affect NoLSAF's final refund decision.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><select value={draft.kind} onChange={(event) => setDrafts((old) => ({ ...old, [tourCase.id]: { ...draft, kind: event.target.value } }))} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"><option value="NON_REFUNDABLE_COMPONENT">Non-refundable component</option><option value="CONSUMED_SERVICE">Consumed service</option><option value="RECOVERY_COST">Recovery cost</option></select><input value={draft.description} onChange={(event) => setDrafts((old) => ({ ...old, [tourCase.id]: { ...draft, description: event.target.value } }))} placeholder="Supplier cost description" className="rounded-lg border border-amber-300 px-3 py-2 text-sm" /><input value={draft.amount} onChange={(event) => setDrafts((old) => ({ ...old, [tourCase.id]: { ...draft, amount: event.target.value } }))} placeholder={`Amount in ${props.currency || "TZS"}`} inputMode="decimal" className="rounded-lg border border-amber-300 px-3 py-2 text-sm" /><label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-amber-400 bg-white px-3 py-2 text-sm font-semibold text-amber-900"><input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadEvidence(tourCase.id, file); event.currentTarget.value = ""; }} />{uploading === tourCase.id ? "Uploading..." : draft.fileName || "Upload receipt or supplier document"}</label></div><label className="mt-3 flex items-start gap-2 text-xs text-amber-900"><input type="checkbox" checked={draft.disclosedBeforePayment} onChange={(event) => setDrafts((old) => ({ ...old, [tourCase.id]: { ...draft, disclosedBeforePayment: event.target.checked } }))} className="mt-0.5" />This non-refundable cost was disclosed to the traveller before payment.</label><button type="button" disabled={working === tourCase.id || uploading === tourCase.id || !draft.evidenceUrl} onClick={() => void submitEvidence(tourCase)} className="mt-3 rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">Submit cost evidence</button></div>}
        </div>}
        <details className="border-t border-slate-100 px-4 py-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Shared case activity ({tourCase.events.length})</summary><div className="mt-3 space-y-3">{tourCase.events.map((event) => <div key={event.id} className="flex gap-3"><Clock3 className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" /><div className="min-w-0"><div className="text-xs font-semibold text-slate-800">{event.type.replaceAll("_", " ")}</div><div className="mt-0.5 break-words text-xs text-slate-600">{text(event.message, "Activity recorded")}</div><div className="mt-0.5 text-[11px] text-slate-400">{new Date(event.createdAt).toLocaleString()}</div></div></div>)}</div></details>
      </article>;
    })}</div>}
    {!loading && activeCases.length > 0 && <footer className="flex items-start gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-600"><LockKeyhole className="mt-0.5 h-4 w-4 flex-shrink-0" />NoLSAF controls the final cancellation, refund, and payout decision. Operator evidence is reviewed, not applied automatically.</footer>}
  </section>;
}
