"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock3, Eye, FileText, RefreshCw, RotateCcw, Search, SearchCheck, X, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import apiClient from "@/lib/apiClient";

const money = (value: unknown, currency = "TZS") => `${currency} ${Number(value || 0).toLocaleString()}`;

type TourCase = {
  id: number;
  status: string;
  description: string;
  createdAt: string;
  events?: Array<{ type: string; data?: any }>;
  booking?: {
    bookingCode?: string;
    title?: string;
    grossAmount?: number;
    currency?: string;
    guestName?: string | null;
    guestEmail?: string | null;
    customer?: { name?: string | null; email?: string | null } | null;
  };
};

type Filter = "" | "SUBMITTED" | "REVIEWING" | "REFUND_QUEUE" | "REFUNDED" | "REJECTED";

function groupFor(status: string): Exclude<Filter, ""> | "OTHER" {
  const value = String(status || "").toUpperCase();
  if (["ELIGIBLE", "OPEN"].includes(value)) return "SUBMITTED";
  if (["UNDER_REVIEW", "ACKNOWLEDGED", "ESCALATED"].includes(value)) return "REVIEWING";
  if (value === "APPROVED") return "REFUND_QUEUE";
  if (value === "RESOLVED") return "REFUNDED";
  if (value === "REJECTED") return "REJECTED";
  return "OTHER";
}

function labelFor(status: string) {
  const group = groupFor(status);
  return group === "REFUND_QUEUE" ? "Refund queue" : group === "REFUNDED" ? "Refunded" : group === "SUBMITTED" ? "Submitted" : group === "REVIEWING" ? "Reviewing" : group === "REJECTED" ? "Rejected" : String(status || "Open").replace(/_/g, " ");
}

function toneFor(status: string) {
  const group = groupFor(status);
  if (group === "REFUNDED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (group === "REJECTED") return "bg-rose-50 text-rose-700 border-rose-200";
  if (group === "REFUND_QUEUE") return "bg-blue-50 text-blue-700 border-blue-200";
  if (group === "REVIEWING") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

const eligibilityFor = (item: TourCase) => item.events?.find((event) => event.type === "ELIGIBILITY_CALCULATED")?.data || {};
const evidenceFor = (item: TourCase) => [...(item.events || [])].reverse().find((event) => event.type === "OPERATOR_COST_EVIDENCE")?.data?.items || [];

function Stat({ label, value, tone, Icon }: { label: string; value: number; tone: string; Icon: LucideIcon }) {
  return <div className="group min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#02665e]/30 hover:shadow-lg"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="truncate text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">{label}</div><div className="mt-1 text-3xl font-bold leading-none text-slate-900">{value}</div></div><div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-110 ${tone}`}><Icon className="h-5 w-5" /></div></div></div>;
}

export default function TourCancellationPanel() {
  const router = useRouter();
  const [items, setItems] = useState<TourCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [refundRefs, setRefundRefs] = useState<Record<number, string>>({});
  const [operatorCaused, setOperatorCaused] = useState<Record<number, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/api/admin/cancellations/tours?type=CANCELLATION");
      setItems(Array.isArray(res.data?.cases) ? res.data.cases : []);
    } catch (error: any) {
      setMessage(error?.response?.data?.error || "Failed to load tour cancellation cases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selectedId != null) router.push(`/admin/cancellations/tours/${selectedId}`); }, [router, selectedId]);

  const stats = useMemo(() => ({
    total: items.length,
    submitted: items.filter((item) => groupFor(item.status) === "SUBMITTED").length,
    reviewing: items.filter((item) => groupFor(item.status) === "REVIEWING").length,
    queue: items.filter((item) => groupFor(item.status) === "REFUND_QUEUE").length,
    refunded: items.filter((item) => groupFor(item.status) === "REFUNDED").length,
    rejected: items.filter((item) => groupFor(item.status) === "REJECTED").length,
  }), [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter && groupFor(item.status) !== filter) return false;
      if (!needle) return true;
      const booking = item.booking || {};
      return [item.id, booking.bookingCode, booking.title, booking.guestName, booking.guestEmail, booking.customer?.name, booking.customer?.email]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [filter, items, query]);

  const selected = items.find((item) => item.id === selectedId) || null;

  const act = async (item: TourCase, action: string) => {
    const reason = String(notes[item.id] || "").trim();
    if (!reason) return setMessage("Add an administrative reason before taking action.");
    const eligibility = eligibilityFor(item);
    const evidence = evidenceFor(item);
    setWorking(item.id);
    setMessage(null);
    try {
      const payload: any = { action, reason };
      if (action === "APPROVE_CANCELLATION") {
        payload.refundPercent = Number(eligibility.refundPercent || 0);
        payload.deductions = evidence;
        payload.operatorCaused = operatorCaused[item.id] === true;
      }
      if (action === "RECORD_REFUND") payload.refundReference = String(refundRefs[item.id] || "").trim();
      await apiClient.post(`/api/admin/cancellations/tours/${item.id}/action`, payload);
      setMessage(action === "RECORD_REFUND" ? "Refund recorded and customer notified." : "Tour cancellation case updated.");
      await load();
    } catch (error: any) {
      setMessage(error?.response?.data?.error || "Tour case action failed.");
    } finally {
      setWorking(null);
    }
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><h2 className="!m-0 text-base font-bold leading-6 text-slate-900">Tour package cancellation management</h2><p className="!mb-0 !mt-0.5 text-xs leading-5 text-slate-600 sm:text-sm">Manage traveler requests, policy decisions, operator evidence, and recorded tour refunds.</p></div>
      <button type="button" onClick={() => void load()} className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 sm:self-center"><RefreshCw className="h-4 w-4" /> Refresh</button>
    </div>

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"><Stat label="Total" value={stats.total} tone="bg-slate-100 text-slate-600" Icon={FileText} /><Stat label="Submitted" value={stats.submitted} tone="bg-slate-100 text-slate-600" Icon={Clock3} /><Stat label="Reviewing" value={stats.reviewing} tone="bg-amber-100 text-amber-700" Icon={SearchCheck} /><Stat label="Refund queue" value={stats.queue} tone="bg-blue-100 text-blue-700" Icon={CircleDollarSign} /><Stat label="Refunded" value={stats.refunded} tone="bg-emerald-100 text-emerald-700" Icon={CheckCircle2} /><Stat label="Rejected" value={stats.rejected} tone="bg-rose-100 text-rose-700" Icon={XCircle} /></div>

    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem_auto]">
        <div className="relative min-w-0"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by tour code, traveler, package, or case ID" className="box-border w-full min-w-0 rounded-xl border border-slate-300 py-2.5 pl-10 pr-10 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20" />{query && <button type="button" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Clear search"><X className="h-4 w-4" /></button>}</div>
        <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20"><option value="">All statuses</option><option value="SUBMITTED">Submitted</option><option value="REVIEWING">Reviewing</option><option value="REFUND_QUEUE">Refund queue</option><option value="REFUNDED">Refunded</option><option value="REJECTED">Rejected</option></select>
        <button type="button" onClick={() => { setQuery(""); setFilter(""); }} className="rounded-xl bg-[#02665e] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#014d47]">Reset</button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Open a case to review policy eligibility, operator evidence, and refund records.</p>
    </div>

    {message && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{message}</div>}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading tour cancellation cases…</div> : filtered.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No tour cancellation cases match these filters.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[940px]"><thead className="bg-slate-50 text-left"><tr className="text-xs uppercase tracking-wider text-slate-500"><th className="px-5 py-3">Case</th><th className="px-5 py-3">Traveler</th><th className="px-5 py-3">Tour package</th><th className="px-5 py-3">Policy</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Submitted</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((item) => { const booking = item.booking || {}; const eligibility = eligibilityFor(item); const traveler = booking.customer?.name || booking.guestName || "Traveler"; const submittedAt = new Date(item.createdAt); return <tr key={item.id} className="hover:bg-slate-50"><td className="px-5 py-4"><button type="button" onClick={() => setSelectedId(item.id)} className="font-bold text-[#02665e] hover:underline">#{item.id}</button><div className="mt-1 font-mono text-xs text-slate-500">{booking.bookingCode || "—"}</div></td><td className="px-5 py-4"><div className="font-semibold text-slate-900">{traveler}</div><div className="mt-1 text-xs text-slate-500">{booking.customer?.email || booking.guestEmail || "No email"}</div></td><td className="px-5 py-4"><div className="max-w-[15rem] truncate font-semibold text-slate-900">{booking.title || "Tour package"}</div><div className="mt-1 text-xs text-slate-500">{money(booking.grossAmount, booking.currency)}</div></td><td className="px-5 py-4"><div className="font-semibold text-slate-900">{Number(eligibility.refundPercent || 0)}%</div><div className="mt-1 max-w-[11rem] truncate text-xs text-slate-500">{eligibility.eligibilityCode || "Manual review"}</div></td><td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${toneFor(item.status)}`}>{labelFor(item.status)}</span></td><td className="px-5 py-4 text-sm text-slate-600"><div>{submittedAt.toLocaleDateString()}</div><div className="mt-1 text-xs text-slate-500">{submittedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => setSelectedId(item.id)} className="inline-flex rounded-lg bg-[#02665e] p-2 text-white hover:bg-[#014d47]" aria-label={`Open case ${item.id}`}><Eye className="h-4 w-4" /></button></td></tr>; })}</tbody></table></div>}
    </div>

    {selected && (() => { const booking = selected.booking || {}; const eligibility = eligibilityFor(selected); const evidence = evidenceFor(selected); const canApprove = ["ELIGIBLE", "UNDER_REVIEW", "ACKNOWLEDGED", "ESCALATED"].includes(String(selected.status).toUpperCase()); return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold uppercase tracking-wider text-[#02665e]">Tour case #{selected.id}</span><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${toneFor(selected.status)}`}>{labelFor(selected.status)}</span></div><h3 className="mt-2 break-words text-lg font-bold text-slate-900">{booking.bookingCode} · {booking.title}</h3><p className="mt-1 text-sm text-slate-600">{selected.description}</p></div><button type="button" onClick={() => setSelectedId(null)} className="self-start rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Tour policy result</div><div className="mt-1 font-bold text-slate-900">{eligibility.eligibilityCode || "Manual review"}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Provisional refund</div><div className="mt-1 font-bold text-slate-900">{Number(eligibility.refundPercent || 0)}% · {money(eligibility.estimatedRefundAmount, booking.currency)}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Operator evidence</div><div className="mt-1 font-bold text-slate-900">{evidence.length} documented item(s)</div></div></div><div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><AlertTriangle className="mr-1 inline h-4 w-4" />{eligibility.reason || "Confirm the tour terms accepted at booking before deciding this case."}</div>{evidence.length > 0 && <div className="mt-3 space-y-1">{evidence.map((entry: any, index: number) => <a key={index} href={entry.evidenceUrl} target="_blank" rel="noreferrer" className="block break-all text-xs text-[#02665e] underline">{entry.description}: {money(entry.amount, booking.currency)}</a>)}</div>}<textarea value={notes[selected.id] || ""} onChange={(event) => setNotes((old) => ({ ...old, [selected.id]: event.target.value }))} placeholder="Administrative reason and evidence assessment" className="mt-4 box-border w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20" rows={3} /><label className="mt-3 flex items-start gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={operatorCaused[selected.id] || false} onChange={(event) => setOperatorCaused((old) => ({ ...old, [selected.id]: event.target.checked }))} className="mt-0.5" />Operator or NoLSAF caused the cancellation. Apply a full refund without supplier deductions.</label><div className="mt-3 flex flex-wrap gap-2"><button disabled={working === selected.id} onClick={() => void act(selected, "REQUEST_EVIDENCE")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"><RotateCcw className="mr-1 inline h-4 w-4" />Request evidence</button><button disabled={working === selected.id || !canApprove} onClick={() => void act(selected, "APPROVE_CANCELLATION")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="mr-1 inline h-4 w-4" />Approve cancellation</button><button disabled={working === selected.id} onClick={() => void act(selected, "REJECT")} className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><XCircle className="mr-1 inline h-4 w-4" />Reject</button></div>{selected.status === "APPROVED" && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={refundRefs[selected.id] || ""} onChange={(event) => setRefundRefs((old) => ({ ...old, [selected.id]: event.target.value }))} placeholder="Payment-provider refund reference" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button disabled={working === selected.id || !refundRefs[selected.id]} onClick={() => void act(selected, "RECORD_REFUND")} className="rounded-lg bg-[#02665e] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><CircleDollarSign className="mr-1 inline h-4 w-4" />Record refund</button></div>}</section>; })()}
  </div>;
}
