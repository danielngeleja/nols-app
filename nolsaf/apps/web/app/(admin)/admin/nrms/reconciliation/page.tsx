"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Download, FileText, Loader2, RefreshCw, Search, Wallet, XCircle } from "lucide-react";
import { CountPill, EmptyState, SectionHeader, SummaryCard } from "../_components/CommercialUi";

type Statement = { id: number; status: string; amount: number; currency: string; closedAt: string; property: { id: number; title: string }; owner: { name: string }; items: Array<{ id: number; serviceDate: string; room: string | null; amount: number; classification: string }> };
type Payment = { id: number; status: string; method: string | null; amount: number; currency: string; createdAt: string; statementId: number; property: { id: number; title: string }; owner: { name: string }; events: Array<{ id: number; provider: string; eventId: string; amount: number; status: string; createdAt: string }> };

const STATEMENT_BADGE: Record<string, string> = {
  PAYABLE: "border-amber-100 bg-amber-50 text-amber-700",
  PAID: "border-emerald-100 bg-emerald-50 text-emerald-700",
  OPEN: "border-sky-100 bg-sky-50 text-sky-700",
};

const TOKEN_BADGE: Record<string, string> = {
  PROCESSING: "border-violet-100 bg-violet-50 text-violet-700",
  FAILED: "border-red-100 bg-red-50 text-red-700",
  MISMATCHED: "border-amber-100 bg-amber-50 text-amber-700",
  EXPIRED: "border-neutral-200 bg-neutral-100 text-neutral-500",
};

const inputClass = "block min-h-9 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

const STATEMENT_PAGE_SIZE = 10;

function shortDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ReconciliationPage() {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [queue, setQueue] = useState<Payment[]>([]);
  const [inputs, setInputs] = useState<Record<number, { reason: string; providerRef: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([apiClient.get("/api/admin/nrms/reconcile/statements"), apiClient.get("/api/admin/nrms/reconcile/payments")]);
      setStatements(s.data?.statements ?? []);
      setQueue(p.data?.queue ?? []);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load reconciliation");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (p: Payment, kind: "reconcile" | "void") => {
    const row = inputs[p.id] ?? { reason: "", providerRef: "" };
    setBusyId(p.id);
    setError(null);
    try {
      await apiClient.post(`/api/admin/nrms/reconcile/tokens/${p.id}/${kind}`, kind === "reconcile" ? row : { reason: row.reason });
      setNotice(`Payment token #${p.id} ${kind === "reconcile" ? "reconciled" : "voided"}. The owner was notified.`);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.require2fa ? "Finance OTP verification is required, then retry." : cause?.response?.data?.error || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const filteredStatements = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return statements;
    return statements.filter((s) => s.property.title.toLowerCase().includes(q) || s.owner.name.toLowerCase().includes(q) || s.status.toLowerCase().includes(q));
  }, [statements, query]);

  const pageCount = Math.max(1, Math.ceil(filteredStatements.length / STATEMENT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedStatements = filteredStatements.slice((currentPage - 1) * STATEMENT_PAGE_SIZE, currentPage * STATEMENT_PAGE_SIZE);

  const totals = useMemo(() => ({
    payable: statements.reduce((sum, s) => sum + s.amount, 0),
    exceptions: queue.length,
  }), [statements, queue]);

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div id="nrms-reconciliation" className="mx-auto min-w-0 max-w-7xl space-y-5 px-4 py-6">
      {/* Preflight is disabled in this project; without border-box, w-full controls overflow their grid columns */}
      <style>{`#nrms-reconciliation, #nrms-reconciliation * { box-sizing: border-box; }`}</style>
      <Link href="/admin/nrms/billing" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline transition hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> PAYG billing</Link>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">RECONCILE</div>
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><RefreshCw className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS commercial</p>
                <span className="inline-flex rounded-full border border-emerald-100 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm">Finance OTP required</span>
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Billing reconciliation</h1>
              <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500 sm:text-sm">Trace statements to room-nights and resolve provider exceptions.</p>
            </div>
          </div>
          <a href="/api/admin/nrms/reconcile/export.csv" className="inline-flex shrink-0 items-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white no-underline shadow-[0_10px_24px_-16px_rgba(4,120,87,0.8)] transition hover:bg-emerald-800"><Download className="h-4 w-4" /> Export CSV</a>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}
      {notice && <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{notice}</span></div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={RefreshCw} label="Exception queue" value={String(totals.exceptions)} detail="Stuck, failed or mismatched" tone={totals.exceptions > 0 ? "amber" : "emerald"} />
        <SummaryCard icon={FileText} label="Statements" value={String(statements.length)} detail="Closed billing periods" tone="blue" />
        <SummaryCard icon={Wallet} label="Payable total" value={`TZS ${totals.payable.toLocaleString()}`} detail="Across all statements" tone="slate" />
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={RefreshCw} title="Exception queue" subtitle="Stuck, failed or mismatched payments needing manual reconciliation" right={<CountPill count={queue.length} singular="payment" plural="payments" />} />
        <div className="bg-neutral-50/70 p-3 sm:p-4">
          {queue.length === 0 && <EmptyState icon={CheckCircle2} title="Nothing to reconcile" text="Stuck, failed or mismatched payments will appear here." />}
          <div className="space-y-2.5">
            {queue.map((p) => {
              const row = inputs[p.id] ?? { reason: "", providerRef: "" };
              const canReconcile = row.reason.trim().length >= 5 && row.providerRef.trim().length >= 3;
              const canVoid = row.reason.trim().length >= 5;
              const busy = busyId === p.id;
              return (
                <div key={p.id} className="relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_8px_24px_-24px_rgba(15,23,42,0.7)]">
                  <span className="absolute inset-y-0 left-0 w-1 bg-amber-400" aria-hidden="true" />
                  <div className="p-3.5 pl-4 sm:p-4 sm:pl-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-neutral-900">
                          <span className="truncate">{p.property.title}</span>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${TOKEN_BADGE[p.status] ?? "border-neutral-200 bg-neutral-100 text-neutral-500"}`}>{p.status.replaceAll("_", " ")}</span>
                        </p>
                        <p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">Token #{p.id} · statement #{p.statementId} · {p.owner.name} · {p.method ?? "method unknown"} · {shortDateTime(p.createdAt)}</p>
                      </div>
                      <p className="m-0 shrink-0 text-sm font-bold tabular-nums text-neutral-900">{p.currency} {p.amount.toLocaleString()}</p>
                    </div>

                    <div className="mt-3 grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto]">
                      <input value={row.providerRef} onChange={(e) => setInputs({ ...inputs, [p.id]: { ...row, providerRef: e.target.value } })} placeholder="Provider reference" className={inputClass} aria-label={`Provider reference for token ${p.id}`} />
                      <input value={row.reason} onChange={(e) => setInputs({ ...inputs, [p.id]: { ...row, reason: e.target.value } })} placeholder="Reason, at least 5 characters" className={inputClass} aria-label={`Reason for token ${p.id}`} />
                      <button type="button" disabled={busy || !canReconcile} onClick={() => void act(p, "reconcile")} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-3.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Mark reconciled</button>
                      <button type="button" disabled={busy || !canVoid} onClick={() => void act(p, "void")} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"><XCircle className="h-3.5 w-3.5" />Void for retry</button>
                    </div>

                    {p.events.length > 0 && (
                      <div className="mt-3 space-y-1 border-t border-dashed border-neutral-100 pt-2.5">
                        {p.events.map((e) => (
                          <p key={e.id} className="m-0 truncate text-[10px] text-neutral-500"><span className="font-bold text-neutral-600">{e.provider}</span> {e.eventId} · {e.status} · {e.amount.toLocaleString()} · {shortDateTime(e.createdAt)}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={FileText} title="Statements" subtitle="Closed billing periods and their usage line items" right={<CountPill count={filteredStatements.length} singular="statement" plural="statements" />} />
        <div className="border-b border-neutral-100 px-4 py-3 sm:px-5">
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search property, owner or status" className={`${inputClass} pl-9`} aria-label="Search statements" />
          </div>
        </div>
        <div className="divide-y divide-neutral-100">
          {pagedStatements.map((s, index) => (
            <details key={s.id} className={`group ${index % 2 === 1 ? "bg-emerald-50/30" : "bg-white"}`}>
              <summary className="cursor-pointer list-none px-4 py-3.5 transition hover:bg-neutral-50/60 marker:hidden sm:px-5">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-neutral-900">
                      <span className="truncate">#{s.id} {s.property.title}</span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATEMENT_BADGE[s.status] ?? "border-neutral-200 bg-neutral-100 text-neutral-500"}`}>{s.status}</span>
                    </p>
                    <p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">{s.owner.name} · closed {shortDateTime(s.closedAt)} · {s.items.length} {s.items.length === 1 ? "item" : "items"}</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-neutral-900">{s.currency} {s.amount.toLocaleString()}</span>
                </div>
              </summary>
              <div className="overflow-x-auto border-t border-neutral-100 bg-neutral-50/50 px-4 py-3 sm:px-5">
                <table className="w-full min-w-[35rem] border-collapse text-left text-[11px]">
                  <thead><tr className="text-[10px] font-bold uppercase tracking-wide text-neutral-400"><th className="py-1.5 pr-3">Usage event</th><th className="py-1.5 pr-3">Service date</th><th className="py-1.5 pr-3">Room</th><th className="py-1.5 pr-3">Class</th><th className="py-1.5 text-right">Amount</th></tr></thead>
                  <tbody>
                    {s.items.map((i) => (
                      <tr key={i.id} className="border-t border-neutral-100 text-neutral-600">
                        <td className="py-1.5 pr-3">#{i.id}</td>
                        <td className="py-1.5 pr-3">{new Date(i.serviceDate).toLocaleDateString()}</td>
                        <td className="py-1.5 pr-3">{i.room ?? "n/a"}</td>
                        <td className="py-1.5 pr-3">{i.classification.replaceAll("_", " ")}</td>
                        <td className="py-1.5 text-right tabular-nums font-bold text-neutral-800">{i.amount.toLocaleString()}</td>
                      </tr>
                    ))}
                    {s.items.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-neutral-400">No usage items on this statement.</td></tr>}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          {filteredStatements.length === 0 && (
            statements.length === 0
              ? <EmptyState icon={FileText} title="No statements yet" text="Statements appear here once a billing period closes." />
              : <EmptyState icon={Search} title="No matches" text="No statements match this search." />
          )}
        </div>
        {filteredStatements.length > STATEMENT_PAGE_SIZE && (
          <div className="flex flex-col gap-2 border-t border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="m-0 text-[11px] text-neutral-500">Showing <b className="font-bold text-neutral-700">{(currentPage - 1) * STATEMENT_PAGE_SIZE + 1}-{Math.min(currentPage * STATEMENT_PAGE_SIZE, filteredStatements.length)}</b> of {filteredStatements.length} statements</p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-[11px] font-bold tabular-nums text-neutral-700">Page {currentPage} of {pageCount}</span>
              <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
