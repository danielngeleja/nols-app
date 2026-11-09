"use client";

// The revenue ledger (revenue_entry) next to the figures /admin/finance
// recomputes today, for the selected period, with the sources behind every
// difference. Read only. Source: GET /api/admin/finance/reconciliation.
// The overview only switches to the ledger once this view is clean or every
// difference is explained (nolsaf/docs/REVENUE_LEDGER.md).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Scale } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Stream = "ACCOMMODATION" | "TOUR" | "TRANSPORT" | "GROUP_STAY" | "SUBSCRIPTION";
type Kind = "MISSING" | "OTHER_PERIOD" | "LEDGER_ONLY" | "AMOUNT";

type StreamRow = {
  stream: Stream;
  label: string;
  ledger: { revenue: number; gmv: number; partnerNet: number; recognized: number; reversals: number; reversedRevenue: number };
  overview: { revenue: number; gmv: number; partnerNet: number; count: number };
  difference: number;
  findings: { missing: number; otherPeriod: number; ledgerOnly: number; amount: number };
};

type Finding = { stream: Stream; kind: Kind; sourceType: string; label: string; ledger: number; overview: number; difference: number; reversed: boolean };

type Reconciliation = {
  ok: boolean;
  baseCurrency: string;
  ledgerEntries: number;
  totals: { ledger: number; overview: number; difference: number };
  streams: StreamRow[];
  findings: Finding[];
  findingsTotal: number;
  generatedAt: string;
};

const KIND_LABEL: Record<Kind, string> = {
  MISSING: "Not in the ledger",
  OTHER_PERIOD: "In the ledger on another day",
  LEDGER_ONLY: "Only in the ledger",
  AMOUNT: "Different amount",
};

const glass = "min-w-0 rounded-lg border border-solid border-[#284540] bg-[#182c28]";
const eyebrow = "m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8fb5ad]";
const NF = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const settled = (v: number) => Math.abs(v) < 1;

export default function RevenueReconciliationPanel({
  range,
  periodPhrase,
  onLocked,
}: {
  /** EAT calendar days, both inclusive. Null for all time. */
  range: { from: string; to: string } | null;
  periodPhrase: string;
  onLocked: () => void;
}) {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<Stream | "ALL">("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get("/api/admin/finance/reconciliation", { params: range ?? {} });
      setData(res.data as Reconciliation);
    } catch (e: any) {
      if (e?.response?.status === 403 && e?.response?.data?.require2fa) {
        setData(null);
        onLocked();
        return;
      }
      setError(e?.response?.data?.error || e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [range?.from, range?.to, onLocked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const currency = data?.baseCurrency || "TZS";
  const money = (v: number) => `${v < 0 ? "-" : ""}${currency} ${NF.format(Math.abs(Math.round(v || 0)))}`;
  const signed = (v: number) => (settled(v) ? money(0) : `${v > 0 ? "+" : ""}${money(v)}`);
  const findings = useMemo(() => (data?.findings ?? []).filter((f) => stream === "ALL" || f.stream === stream), [data?.findings, stream]);
  const labelOf = useMemo(() => new Map((data?.streams ?? []).map((s) => [s.stream, s.label])), [data?.streams]);
  const clean = data ? data.findingsTotal === 0 && settled(data.totals.difference) : false;

  return (
    <div className="space-y-4">
      <section className={`${glass} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={eyebrow}><Scale className="h-3.5 w-3.5" /> Ledger reconciliation</p>
            <p className="m-0 mt-1 max-w-2xl text-sm text-slate-400">
              What the revenue ledger recorded {periodPhrase}, next to what this page recomputes from invoices and bookings today. Days are counted in EAT. The page switches to the ledger only once every difference here is explained.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh reconciliation" className="grid h-9 w-9 place-items-center rounded-md border border-solid border-[#284540] bg-[#13241f] text-slate-300 transition hover:border-emerald-300/40 hover:text-emerald-200 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error ? <div className="mt-4 rounded-md border border-solid border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">Could not load the reconciliation: {error}</div> : null}

        {data && data.ledgerEntries === 0 ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-md border border-dashed border-amber-300/30 px-4 py-3 text-xs leading-5 text-slate-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <span>The ledger has no entries {periodPhrase}. New payments are recorded once this release is live, and past payments arrive when the backfill is run. Until then every source below shows as not in the ledger.</span>
          </div>
        ) : null}

        <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-solid border-[#284540] bg-[#284540] sm:grid-cols-3">
          {[
            { label: "Revenue in the ledger", value: data?.totals.ledger, tone: "text-white" },
            { label: "Recomputed today", value: data?.totals.overview, tone: "text-white" },
            { label: "Difference", value: data?.totals.difference, tone: data && !settled(data.totals.difference) ? "text-amber-300" : "text-emerald-300" },
          ].map((tile) => (
            <div key={tile.label} className="bg-[#13241f] px-4 py-3">
              <p className="m-0 text-[11px] font-medium text-slate-500">{tile.label}</p>
              {loading && !data ? (
                <div className="mt-1.5 h-6 w-32 animate-pulse rounded bg-white/[0.05]" />
              ) : (
                <p className={`m-0 mt-0.5 whitespace-nowrap text-lg font-bold tabular-nums ${tile.tone}`}>{tile.label === "Difference" ? signed(tile.value ?? 0) : money(tile.value ?? 0)}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={`${glass} overflow-hidden`}>
        <div className="px-5 py-4 sm:px-6">
          <p className={eyebrow}>By stream</p>
          <p className="m-0 mt-1 text-sm text-slate-400">NoLSAF revenue per stream. Refunds are what the ledger has already taken back.</p>
        </div>
        <div className="overflow-x-auto border-0 border-t border-solid border-[#284540]">
          <table className="w-full min-w-[46rem] border-collapse text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                <th className="px-5 py-2.5 font-semibold sm:px-6">Stream</th>
                <th className="px-3 py-2.5 text-right font-semibold">Ledger</th>
                <th className="px-3 py-2.5 text-right font-semibold">Recomputed</th>
                <th className="px-3 py-2.5 text-right font-semibold">Difference</th>
                <th className="px-3 py-2.5 text-right font-semibold">Refunds</th>
                <th className="px-5 py-2.5 font-semibold sm:px-6">To explain</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-0 border-t border-solid border-[#284540]"><td colSpan={6} className="px-5 py-3 sm:px-6"><div className="h-4 animate-pulse rounded bg-white/[0.04]" /></td></tr>
                  ))
                : (data?.streams ?? []).map((s) => {
                    const open = s.findings.missing + s.findings.otherPeriod + s.findings.ledgerOnly + s.findings.amount;
                    const active = stream === s.stream;
                    return (
                      <tr key={s.stream} onClick={() => setStream(active ? "ALL" : s.stream)} className={`cursor-pointer border-0 border-t border-solid border-[#284540] transition ${active ? "bg-[#13241f]" : "hover:bg-[#13241f]"}`}>
                        <td className="px-5 py-3 font-semibold text-slate-100 sm:px-6">{s.label}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-200">{money(s.ledger.revenue)}<span className="block text-[10px] text-slate-500">{s.ledger.recognized} recorded</span></td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-200">{money(s.overview.revenue)}<span className="block text-[10px] text-slate-500">{s.overview.count} paid</span></td>
                        <td className={`px-3 py-3 text-right font-semibold tabular-nums ${settled(s.difference) ? "text-emerald-300" : "text-amber-300"}`}>{signed(s.difference)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-300">{s.ledger.reversals ? <>{money(s.ledger.reversedRevenue)}<span className="block text-[10px] text-slate-500">{s.ledger.reversals} reversal{s.ledger.reversals === 1 ? "" : "s"}</span></> : <span className="text-slate-600">None</span>}</td>
                        <td className="px-5 py-3 sm:px-6">
                          {open === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Matches</span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {[
                                { n: s.findings.missing, label: "missing" },
                                { n: s.findings.otherPeriod, label: "other day" },
                                { n: s.findings.ledgerOnly, label: "ledger only" },
                                { n: s.findings.amount, label: "amount" },
                              ].filter((c) => c.n > 0).map((c) => (
                                <span key={c.label} className="rounded bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200 ring-1 ring-inset ring-amber-300/25">{c.n} {c.label}</span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${glass} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className={eyebrow}>Sources behind the difference</p>
            <p className="m-0 mt-1 text-sm text-slate-400">
              {stream === "ALL" ? "Every stream" : labelOf.get(stream)}, largest difference first.
              {data && data.findingsTotal > data.findings.length ? ` Showing ${data.findings.length} of ${data.findingsTotal}.` : ""}
            </p>
          </div>
          {stream !== "ALL" ? (
            <button type="button" onClick={() => setStream("ALL")} className="h-8 rounded-md border border-solid border-[#284540] bg-[#13241f] px-3 text-xs font-semibold text-slate-300 transition hover:text-white">Show all streams</button>
          ) : null}
        </div>
        {clean ? (
          <p className="m-0 flex items-center gap-2 border-0 border-t border-solid border-[#284540] px-5 py-4 text-sm text-emerald-300 sm:px-6"><CheckCircle2 className="h-4 w-4" /> The ledger and the recomputed figures agree {periodPhrase}.</p>
        ) : findings.length === 0 ? (
          <p className="m-0 border-0 border-t border-solid border-[#284540] px-5 py-4 text-sm text-slate-500 sm:px-6">{loading ? "Loading..." : "Nothing to explain for this stream."}</p>
        ) : (
          <div className="overflow-x-auto border-0 border-t border-solid border-[#284540]">
            <table className="w-full min-w-[46rem] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  <th className="px-5 py-2.5 font-semibold sm:px-6">Source</th>
                  <th className="px-3 py-2.5 font-semibold">Stream</th>
                  <th className="px-3 py-2.5 font-semibold">Why</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Ledger</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Recomputed</th>
                  <th className="px-5 py-2.5 text-right font-semibold sm:px-6">Difference</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={`${f.stream}-${f.sourceType}-${f.label}-${f.kind}`} className="border-0 border-t border-solid border-[#284540]">
                    <td className="max-w-[16rem] truncate px-5 py-2.5 font-medium text-slate-100 sm:px-6" title={f.label}>{f.label}</td>
                    <td className="px-3 py-2.5 text-slate-400">{labelOf.get(f.stream) ?? f.stream}</td>
                    <td className="px-3 py-2.5 text-slate-300">
                      {KIND_LABEL[f.kind]}
                      {f.reversed ? <span className="ml-1.5 rounded bg-sky-300/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200 ring-1 ring-inset ring-sky-300/25">Refund recorded</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{money(f.ledger)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{money(f.overview)}</td>
                    <td className={`px-5 py-2.5 text-right font-semibold tabular-nums sm:px-6 ${f.difference < 0 ? "text-rose-300" : "text-amber-300"}`}>{signed(f.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
