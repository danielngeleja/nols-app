"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Download, FileText, Loader2, RefreshCw, Search, Wallet, XCircle } from "lucide-react";
import { CountPill, EmptyState, SectionHeader } from "../_components/CommercialUi";

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

function UsageBreakdown({ statement: s }: { statement: Statement }) {
  const [page, setPage] = useState(1);
  const size = 10;
  const pages = Math.max(1, Math.ceil(s.items.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  return (
    <section aria-labelledby={`usage-title-${s.id}`} className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div><h3 id={`usage-title-${s.id}`} className="m-0 text-sm font-bold text-slate-950">Statement #{s.id} usage breakdown</h3><p className="m-0 mt-1 text-xs text-slate-600">{s.property.title} · {s.items.length.toLocaleString()} usage items</p></div>
        <p className="m-0 text-sm font-bold text-emerald-800">Statement total {s.currency} {s.amount.toLocaleString()}</p>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="usage-breakdown-table w-full min-w-[35rem] border-collapse text-left text-xs">
          <caption className="sr-only">Usage charges for statement {s.id}</caption>
          <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-600"><tr>{['Usage reference', 'Service date', 'Room', 'Billing category', `Charge (${s.currency})`].map((label, index) => <th scope="col" key={label} className={`px-4 py-2.5 ${index === 4 ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
          <tbody>{s.items.slice(start, start + size).map(i => <tr key={i.id} className="text-slate-700 hover:bg-emerald-50/50"><td className="px-4 py-2.5">#{i.id}</td><td className="px-4 py-2.5">{new Date(i.serviceDate).toLocaleDateString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })}</td><td className="px-4 py-2.5">{i.room ?? 'Not recorded'}</td><td className="px-4 py-2.5">{i.classification.replaceAll('_', ' ')}</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{i.amount.toLocaleString()}</td></tr>)}
            {!s.items.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No usage items on this statement.</td></tr>}
          </tbody>
        </table>
      </div>
      {s.items.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600" aria-live="polite"><span>Showing {start + 1} to {Math.min(start + size, s.items.length)} of {s.items.length} usage items</span><div className="flex items-center gap-2"><button type="button" disabled={current === 1} onClick={() => setPage(current - 1)} aria-label={`Previous usage page for statement ${s.id}`} className="rounded-lg border border-slate-200 px-2 py-1.5 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span>Page {current} of {pages}</span><button type="button" disabled={current === pages} onClick={() => setPage(current + 1)} aria-label={`Next usage page for statement ${s.id}`} className="rounded-lg border border-slate-200 px-2 py-1.5 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>}
    </section>
  );
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
  const [exporting, setExporting] = useState(false);
  const [expandedStatements, setExpandedStatements] = useState<Set<number>>(new Set());
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await apiClient.get('/api/admin/nrms/reconcile/export.csv', { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nrms-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause: any) {
      setError(cause?.response?.data?.require2fa ? 'Verify finance access, then retry Export CSV.' : cause?.response?.data?.error || 'CSV export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([apiClient.get("/api/admin/nrms/reconcile/statements"), apiClient.get("/api/admin/nrms/reconcile/payments")]);
      setStatements(s.data?.statements ?? []);
      setQueue(p.data?.queue ?? []);
      setRefreshedAt(new Date());
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load reconciliation");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const handleGranted = () => { void load(); };
    window.addEventListener("finance-grant-granted", handleGranted);
    return () => window.removeEventListener("finance-grant-granted", handleGranted);
  }, [load]);

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
    payable: statements.filter(s => s.status === 'PAYABLE').reduce((sum, s) => sum + s.amount, 0),
    exceptions: queue.length,
  }), [statements, queue]);

  /** Where the loaded statements' money stands, for the balance panel in the band. */
  const balance = useMemo(() => {
    const sumOf = (status: string) => statements.filter((s) => s.status === status).reduce((sum, s) => sum + s.amount, 0);
    const paid = sumOf('PAID');
    const payable = sumOf('PAYABLE');
    const open = sumOf('OPEN');
    const total = paid + payable + open;
    const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
    return { paid, payable, open, total, collectedPct: total > 0 ? Math.round((paid / total) * 100) : null, widths: { paid: pct(paid), payable: pct(payable), open: pct(open) } };
  }, [statements]);

  return (
    <div id="nrms-reconciliation" className="w-full min-w-0 max-w-none space-y-4">
      {/* Preflight is disabled in this project; without border-box, w-full controls overflow their grid columns */}
      <style>{`#nrms-reconciliation, #nrms-reconciliation * { box-sizing: border-box; }`}</style>

      {/* Identity band with a live collection balance, in the operator-record language */}
      <section className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_0%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden="true" />
        <div className="relative grid min-w-0 gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
          <div className="min-w-0">
            <Link href="/admin/nrms/billing" className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/45 no-underline transition hover:text-emerald-300">
              <ArrowLeft className="h-3 w-3" aria-hidden /> PAYG billing
            </Link>
            <p className="m-0 mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/80">NRMS finance workspace</p>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Billing reconciliation</h1>
            <p className="m-0 mt-1 text-[12px] text-white/60">Review usage, match provider payments and resolve exceptions.</p>
            <div className="mt-4">
              {loading ? (
                <span className="inline-flex items-center gap-2 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-semibold text-white/60"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking the queue</span>
              ) : error ? (
                <span className="inline-flex items-center gap-2 rounded-md bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-rose-200"><XCircle className="h-3.5 w-3.5" aria-hidden /> Could not load reconciliation</span>
              ) : totals.exceptions > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-md bg-amber-400/15 px-2.5 py-1.5 text-[11px] font-bold text-amber-200">
                  <span className="relative flex h-2 w-2" aria-hidden><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" /></span>
                  {totals.exceptions} payment exception{totals.exceptions === 1 ? '' : 's'} need you
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-md bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-200"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Queue clear, every payment matched</span>
              )}
            </div>
          </div>

          {/* Collection balance: where the loaded statements' money stands */}
          <div className="min-w-0 rounded-md bg-white/[0.04] p-4 ring-1 ring-white/10">
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Collection balance</p>
              <p className="m-0 text-[11px] text-white/55">
                {balance.collectedPct === null ? 'No statements loaded' : <><span className="font-bold tabular-nums text-emerald-300">{balance.collectedPct}%</span> collected</>}
              </p>
            </div>
            <p className="m-0 mt-2 text-[11px] text-white/50">Awaiting collection</p>
            <p className="m-0 text-2xl font-black tabular-nums tracking-tight text-white">TZS {balance.payable.toLocaleString()}</p>
            <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-white/10" role="img" aria-label={`Paid TZS ${balance.paid.toLocaleString()}, payable TZS ${balance.payable.toLocaleString()}, open TZS ${balance.open.toLocaleString()}`}>
              <span className="h-full bg-emerald-400 transition-all duration-700" style={{ width: `${balance.widths.paid}%` }} />
              <span className="h-full bg-amber-400 transition-all duration-700" style={{ width: `${balance.widths.payable}%` }} />
              <span className="h-full bg-sky-400 transition-all duration-700" style={{ width: `${balance.widths.open}%` }} />
            </div>
            <dl className="m-0 mt-3 grid grid-cols-3 gap-2">
              {[
                { label: 'Paid', value: balance.paid, dot: 'bg-emerald-400' },
                { label: 'Payable', value: balance.payable, dot: 'bg-amber-400' },
                { label: 'Open', value: balance.open, dot: 'bg-sky-400' },
              ].map((part) => (
                <div key={part.label} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-[10px] font-semibold text-white/50"><span className={`h-1.5 w-1.5 rounded-full ${part.dot}`} aria-hidden /> {part.label}</dt>
                  <dd className="m-0 mt-0.5 truncate text-[12px] font-bold tabular-nums text-white/90">{part.value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Actions, with when the figures were last read */}
        <div className="relative flex min-w-0 flex-wrap items-center gap-2 border-0 border-t border-solid border-white/10 px-4 py-3 sm:px-6">
          <span className="w-full text-[11px] text-white/45 sm:w-auto">
            {refreshedAt
              ? `Refreshed ${refreshedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' })} EAT · ${statements.length} statement${statements.length === 1 ? '' : 's'} loaded`
              : 'Loading figures'}
          </span>
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('finance-grant-required'))}
              className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-md border-0 bg-white/[0.08] px-4 text-xs font-bold text-white transition hover:bg-white/15 sm:flex-none"
            >
              Verify finance access
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void load()}
              aria-label="Refresh reconciliation"
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-white/[0.08] text-white transition hover:bg-white/15 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => void exportCsv()}
              className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-emerald-300 px-4 text-xs font-bold text-[#0b2420] transition hover:bg-emerald-200 disabled:opacity-50 sm:flex-none"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}
      {notice && <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{notice}</span></div>}

      {/* Summary, joined cells like the operator statement's money strip */}
      <section aria-label="Reconciliation summary" className="reconciliation-metrics grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-3">
        {[
          {
            icon: AlertTriangle, label: 'Needs attention', value: String(totals.exceptions), detail: 'Provider payment exceptions',
            ink: totals.exceptions > 0 ? 'text-amber-600' : 'text-neutral-950', iconTone: totals.exceptions > 0 ? 'text-amber-600' : 'text-neutral-300',
          },
          { icon: FileText, label: 'Statements loaded', value: String(statements.length), detail: 'Available billing periods', ink: 'text-neutral-950', iconTone: 'text-neutral-300' },
          {
            icon: Wallet, label: 'Awaiting collection', value: `TZS ${totals.payable.toLocaleString()}`, detail: 'Payable statements loaded',
            ink: totals.payable > 0 ? 'text-emerald-700' : 'text-neutral-400', iconTone: 'text-neutral-300',
          },
        ].map(({ icon: Icon, label, value, detail, ink, iconTone }) => (
          <div key={label} className="min-w-0 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-semibold text-neutral-500">{label}</p>
              <Icon className={`h-4 w-4 shrink-0 ${iconTone}`} aria-hidden />
            </div>
            <p className={`m-0 mt-1 break-words text-lg font-black tabular-nums tracking-tight ${loading || error ? 'text-neutral-300' : ink}`}>{loading || error ? 'Unavailable' : value}</p>
            <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400">{detail}</p>
          </div>
        ))}
      </section>

      {loading && <div role="status" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading statements and provider exceptions…</div>}

      <section className="reconciliation-panel min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={RefreshCw} title="Exception queue" subtitle="Stuck, failed or mismatched payments needing manual reconciliation" right={<CountPill count={queue.length} singular="payment" plural="payments" />} />
        <div className="bg-neutral-50/70 p-3 sm:p-4">
          {!loading && !error && queue.length === 0 && <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-4"><CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" /><div><p className="m-0 text-sm font-bold text-emerald-950">Queue is clear</p><p className="m-0 mt-1 text-xs text-emerald-800">No stuck, failed or mismatched payments in the loaded queue.</p></div></div>}
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

                    <div className="mt-3 grid min-w-0 grid-cols-1 gap-2">
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

      <section className="reconciliation-panel min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={FileText} title="Statements" subtitle="Closed billing periods and their usage line items" right={<CountPill count={filteredStatements.length} singular="statement" plural="statements" />} />
        <div className="border-b border-neutral-100 px-4 py-3 sm:px-5">
          <div className="relative w-full min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search property, owner or status" className={`${inputClass} pl-9`} aria-label="Search statements" />
          </div>
        </div>
        <div className="w-full min-w-0 max-w-full overflow-x-auto">
          <table className="statement-register w-full min-w-[1000px] table-fixed border-collapse text-left text-xs">
            <caption className="sr-only">Billing statements and expandable usage details</caption>
            <colgroup>
              {[9, 16, 14, 10, 20, 9, 13, 9].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
            </colgroup>
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-600">
              <tr>{['Statement', 'Property', 'Owner', 'Status', 'Closed (EAT)', 'Usage items', 'Amount', 'Details'].map(label => <th scope="col" key={label} className={`px-3 py-3 ${label === 'Amount' ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr>
            </thead>
            <tbody>
          {pagedStatements.map((s, index) => (
            <Fragment key={s.id}>
              <tr className={`${index % 2 ? 'bg-slate-50/60' : 'bg-white'} text-slate-700 hover:bg-emerald-50/50`}>
                <td className="px-3 py-3 font-semibold">#{s.id}</td>
                <td className="px-3 py-3 font-semibold text-slate-950">{s.property.title}</td>
                <td className="px-3 py-3">{s.owner.name}</td>
                <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${STATEMENT_BADGE[s.status] ?? 'border-neutral-200 bg-neutral-100 text-neutral-500'}`}>{s.status}</span></td>
                <td className="px-3 py-3 whitespace-nowrap">{new Date(s.closedAt).toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</td>
                <td className="px-3 py-3 tabular-nums">{s.items.length}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap font-bold tabular-nums text-slate-950">{s.currency} {s.amount.toLocaleString()}</td>
                <td className="px-3 py-3"><button type="button" aria-expanded={expandedStatements.has(s.id)} aria-controls={`statement-usage-${s.id}`} aria-label={`${expandedStatements.has(s.id) ? 'Collapse' : 'Expand'} breakdown for statement ${s.id}`} onClick={() => setExpandedStatements(current => { const next = new Set(current); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100">{expandedStatements.has(s.id) ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronDown aria-hidden="true" className="h-4 w-4" />}</button></td>
              </tr>
              <tr id={`statement-usage-${s.id}`} hidden={!expandedStatements.has(s.id)}><td colSpan={8} className="bg-slate-50 px-4 py-3">
                <UsageBreakdown statement={s} />
              </td></tr>
            </Fragment>
          ))}
            </tbody>
          </table>
          {!loading && !error && filteredStatements.length === 0 && (
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
