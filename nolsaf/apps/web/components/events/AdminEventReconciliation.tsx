"use client";

/**
 * Event hire revenue check, drawn the way an accountant reads it:
 *   1. a coverage score and the three totals,
 *   2. six months side by side (ledger against bookings), click to focus,
 *   3. the bridge from recomputed revenue to the ledger, one step per reason,
 *   4. the sources behind each step.
 * Source: GET /api/admin/finance/reconciliation, EVENT_HIRE stream only. Read only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { errorText, needsFinanceGrant } from "./admin/eventAdmin";
import { ErrorNote, FinanceLocked, Loading, SortTh, sortRows, type SortState } from "./admin/ui";

type Kind = "MISSING" | "OTHER_PERIOD" | "LEDGER_ONLY" | "AMOUNT";
type StreamRow = {
  stream: string;
  ledger: { revenue: number; recognized: number; reversals: number; reversedRevenue: number };
  overview: { revenue: number; count: number };
  difference: number;
};
type Finding = { stream: string; kind: Kind; sourceType: string; label: string; ledger: number; overview: number; difference: number; reversed: boolean };
type Data = { baseCurrency: string; streams: StreamRow[]; findings: Finding[]; findingsTotal: number; generatedAt: string };
type Month = { key: string; from: string; to: string; name: string; ledger: number | null; overview: number | null };

const TZ = "Africa/Dar_es_Salaam";
const STEPS: Array<{ kind: Kind; label: string; hint: string }> = [
  { kind: "MISSING", label: "Paid but not in the ledger", hint: "The ledger never recorded these payments" },
  { kind: "OTHER_PERIOD", label: "Recorded on another day", hint: "Same money, booked to a different EAT day" },
  { kind: "LEDGER_ONLY", label: "Only in the ledger", hint: "The ledger has an entry no paid booking explains" },
  { kind: "AMOUNT", label: "Amount differs", hint: "Both sides have it, with different amounts" },
];
type SortKey = "source" | "why" | "ledger" | "overview" | "difference";
const NF = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const zero = (v: number) => Math.abs(v) < 1;
const extract = (d: Data) => ({ ...d, streams: d.streams.filter(s => s.stream === "EVENT_HIRE"), findings: d.findings.filter(f => f.stream === "EVENT_HIRE") });

/** The last six EAT calendar months, oldest first. */
function lastMonths(n = 6): Month[] {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    const key = d.toISOString().slice(0, 7);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { key, from: `${key}-01`, to: last < today ? last : today, name: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), ledger: null, overview: null };
  });
}

export default function AdminEventReconciliation() {
  const [scope, setScope] = useState<string>("ALL");
  const [data, setData] = useState<Data | null>(null);
  const [months, setMonths] = useState<Month[]>(() => lastMonths());
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<Kind | "ALL">("ALL");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "difference", dir: "desc" });

  const fail = (e: unknown) => {
    if (needsFinanceGrant(e)) { setLocked(true); setData(null); return; }
    setError(errorText(e, "Could not load the revenue check."));
  };
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const month = months.find(m => m.key === scope);
    try {
      const r = await apiClient.get("/api/admin/finance/reconciliation", { params: { stream: "EVENT_HIRE", ...(month ? { from: month.from, to: month.to } : {}) } });
      setData(extract(r.data)); setLocked(false);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMonths = useCallback(async () => {
    const base = lastMonths();
    const results = await Promise.allSettled(base.map(m => apiClient.get("/api/admin/finance/reconciliation", { params: { stream: "EVENT_HIRE", from: m.from, to: m.to } })));
    setMonths(base.map((m, i) => {
      const r = results[i];
      const s = r.status === "fulfilled" ? extract(r.value.data).streams[0] : undefined;
      return { ...m, ledger: s ? s.ledger.revenue : null, overview: s ? s.overview.revenue : null };
    }));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadMonths(); }, [loadMonths]);
  useEffect(() => {
    const run = () => { void load(); void loadMonths(); };
    window.addEventListener("finance-grant-granted", run);
    window.addEventListener("event-hire-refresh", run);
    return () => { window.removeEventListener("finance-grant-granted", run); window.removeEventListener("event-hire-refresh", run); };
  }, [load, loadMonths]);

  const cur = data?.baseCurrency || "TZS";
  const money = (v: number) => `${v < 0 ? "-" : ""}${cur} ${NF.format(Math.abs(Math.round(v || 0)))}`;
  const signed = (v: number) => (zero(v) ? money(0) : `${v > 0 ? "+" : ""}${money(v)}`);
  const s = data?.streams[0];
  const scopeName = scope === "ALL" ? "all time" : new Date(`${scope}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  // Coverage: how much of the revenue the bookings prove is also in the ledger.
  const coverage = !s ? null : s.overview.revenue <= 0 ? (s.ledger.revenue <= 0 ? 100 : 0) : Math.max(0, Math.min(100, Math.round(((s.overview.revenue - (data?.findings.filter(f => f.kind === "MISSING").reduce((n, f) => n + f.overview, 0) ?? 0)) / s.overview.revenue) * 100)));
  const ledgerEmpty = Boolean(s && s.ledger.recognized + s.ledger.reversals === 0);
  const nothingYet = Boolean(s && ledgerEmpty && s.overview.count === 0);
  const stepSum = (k: Kind) => (data?.findings ?? []).filter(f => f.kind === k).reduce((n, f) => n + f.difference, 0);
  const stepCount = (k: Kind) => (data?.findings ?? []).filter(f => f.kind === k).length;

  const rows = useMemo(() => sortRows((data?.findings ?? []).filter(f => step === "ALL" || f.kind === step), sort, (f, k) =>
    k === "source" ? f.label.toLowerCase() : k === "why" ? STEPS.find(x => x.kind === f.kind)!.label : k === "ledger" ? f.ledger : k === "overview" ? f.overview : Math.abs(f.difference)), [data, step, sort]);
  const onSort = (k: SortKey) => setSort(p => (p.key === k ? { key: k, dir: p.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "source" || k === "why" ? "asc" : "desc" }));

  if (locked) return <section className="rounded-lg border border-solid border-neutral-200 bg-white"><FinanceLocked what="The event revenue check" /></section>;

  const peak = Math.max(1, ...months.flatMap(m => [m.ledger ?? 0, m.overview ?? 0]));
  const ringTone = coverage == null ? "#d4d4d4" : coverage >= 99 ? "#059669" : coverage >= 80 ? "#d97706" : "#e11d48";

  return (
    <div className="space-y-3">
      {/* 1. Score and totals */}
      <section className="grid min-w-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white md:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3 md:border-b-0 md:border-r">
          <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${ringTone} ${(coverage ?? 0) * 3.6}deg, #f0f0f0 0deg)` }} aria-hidden>
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-[13px] font-bold tabular-nums text-neutral-900">{coverage == null ? "..." : nothingYet ? "-" : `${coverage}%`}</span>
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold text-neutral-900">{!s ? "Checking" : nothingYet ? "Nothing to check yet" : coverage === 100 && zero(s.difference) ? "Fully reconciled" : ledgerEmpty ? "Ledger not started" : "Needs explaining"}</p>
            <p className="m-0 text-[11px] leading-4 text-neutral-500">{nothingYet ? "No paid events and no ledger entries." : "Paid event revenue that is also in the ledger"}</p>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-3">
          {[
            { k: "Bookings say", v: s?.overview.revenue, n: s ? `${s.overview.count} paid ${s.overview.count === 1 ? "event" : "events"}` : "" },
            { k: "Ledger says", v: s?.ledger.revenue, n: s ? `${s.ledger.recognized} entries${s.ledger.reversals ? `, ${s.ledger.reversals} reversed` : ""}` : "" },
            { k: "Gap", v: s?.difference, n: s ? (zero(s.difference) ? "Nothing to explain" : `${data?.findingsTotal ?? 0} sources`) : "", gap: true },
          ].map((f, i) => (
            <div key={f.k} className={`min-w-0 px-4 py-3 ${i ? "border-0 border-l border-solid border-neutral-100" : ""}`}>
              <dt className="text-[11px] text-neutral-500">{f.k} <span className="text-neutral-400">· {scopeName}</span></dt>
              <dd className={`m-0 truncate text-[18px] font-bold tabular-nums ${f.gap && f.v && !zero(f.v) ? "text-amber-700" : "text-neutral-900"}`}>{f.v === undefined ? "..." : f.gap ? signed(f.v) : money(f.v)}</dd>
              <span className="block truncate text-[11px] text-neutral-400">{f.n}</span>
            </div>
          ))}
        </dl>
      </section>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* 2. Month by month */}
        <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
            <p className="m-0 text-[13px] font-semibold text-neutral-900">Month by month</p>
            <div className="flex items-center gap-3 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-neutral-300" />Bookings</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#02665e]" />Ledger</span>
              <button type="button" onClick={() => setScope("ALL")} className={`h-6 rounded border border-solid px-2 text-[11px] font-semibold ${scope === "ALL" ? "border-[#0b2420] bg-[#0b2420] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}>All time</button>
            </div>
          </div>
          <div className="grid grid-cols-6 items-end gap-2 px-3 pb-2 pt-4">
            {months.map(m => {
              const on = scope === m.key;
              const gap = m.ledger != null && m.overview != null ? m.ledger - m.overview : 0;
              return (
                <button key={m.key} type="button" onClick={() => setScope(on ? "ALL" : m.key)} aria-pressed={on} title={m.ledger == null ? "Loading" : `Bookings ${money(m.overview ?? 0)} · Ledger ${money(m.ledger)}`}
                  className={`group flex min-w-0 flex-col items-center gap-1 rounded-md border border-solid px-1 pb-1.5 pt-1 ${on ? "border-[#02665e]/40 bg-[#02665e]/[0.05]" : "border-transparent bg-transparent hover:bg-neutral-50"}`}>
                  <span className={`h-4 text-[10px] font-bold tabular-nums ${zero(gap) ? "text-transparent" : "text-amber-700"}`}>{zero(gap) ? "ok" : `${gap > 0 ? "+" : "-"}${compact.format(Math.abs(gap))}`}</span>
                  <span className="flex h-24 w-full items-end justify-center gap-1">
                    {[{ v: m.overview, c: "bg-neutral-300" }, { v: m.ledger, c: "bg-[#02665e]" }].map((b, i) => (
                      <span key={i} className={`w-3 rounded-t-sm ${m.ledger == null ? "animate-pulse bg-neutral-100" : b.c}`} style={{ height: m.ledger == null ? "30%" : `${Math.max(2, ((b.v ?? 0) / peak) * 100)}%` }} />
                    ))}
                  </span>
                  <span className={`text-[11px] font-semibold ${on ? "text-[#02665e]" : "text-neutral-600"}`}>{m.name}</span>
                </button>
              );
            })}
          </div>
          <p className="m-0 border-0 border-t border-solid border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400">Click a month to check only that month. Amber figures are gaps in {cur}.</p>
        </section>

        {/* 3. The bridge */}
        <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
            <p className="m-0 text-[13px] font-semibold text-neutral-900">From bookings to the ledger</p>
            <button type="button" onClick={() => { void load(); void loadMonths(); }} disabled={loading} aria-label="Refresh" title="Refresh" className="grid h-7 w-7 place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
          </div>
          {!s ? <Loading /> : (
            <ol className="m-0 list-none p-0 text-[12.5px]">
              <li className="flex items-center justify-between gap-2 px-3 py-2"><span className="font-semibold text-neutral-900">Revenue the bookings prove</span><strong className="tabular-nums text-neutral-900">{money(s.overview.revenue)}</strong></li>
              {STEPS.map(x => {
                const sum = stepSum(x.kind), n = stepCount(x.kind), on = step === x.kind;
                return (
                  <li key={x.kind} className="border-0 border-t border-dashed border-neutral-200">
                    <button type="button" disabled={!n} onClick={() => setStep(on ? "ALL" : x.kind)} title={x.hint}
                      className={`flex w-full items-center justify-between gap-2 border-0 px-3 py-2 text-left ${on ? "bg-[#02665e]/[0.06]" : "bg-white enabled:hover:bg-neutral-50"} disabled:cursor-default`}>
                      <span className="min-w-0"><span className={`block truncate ${n ? "text-neutral-800" : "text-neutral-400"}`}>{x.label}</span><span className="block text-[10.5px] text-neutral-400">{n ? `${n} ${n === 1 ? "source" : "sources"} · click to list` : "None"}</span></span>
                      <span className={`shrink-0 font-semibold tabular-nums ${!n ? "text-neutral-300" : sum < 0 ? "text-rose-700" : "text-amber-700"}`}>{n ? signed(sum) : money(0)}</span>
                    </button>
                  </li>
                );
              })}
              <li className="flex items-center justify-between gap-2 border-0 border-t-2 border-solid border-neutral-800 px-3 py-2"><span className="font-semibold text-neutral-900">Revenue in the ledger</span><strong className="tabular-nums text-neutral-900">{money(s.ledger.revenue)}</strong></li>
            </ol>
          )}
        </section>
      </div>

      {/* 4. Sources */}
      <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
          <p className="m-0 text-[13px] font-semibold text-neutral-900">
            {step === "ALL" ? "Every source behind the gap" : STEPS.find(x => x.kind === step)!.label}<span className="ml-1.5 font-normal text-neutral-400">{data ? rows.length : ""}</span>
            {step !== "ALL" && <button type="button" onClick={() => setStep("ALL")} className="ml-2 border-0 bg-transparent p-0 text-[11px] font-semibold text-[#02665e] hover:underline">Show all</button>}
          </p>
          {data && <p className="m-0 text-[11px] text-neutral-400">{scopeName} · checked {new Date(data.generatedAt).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })} EAT{data.findingsTotal > data.findings.length ? ` · showing ${data.findings.length} of ${data.findingsTotal}` : ""}</p>}
        </div>
        {loading && !data ? <Loading /> : rows.length === 0 ? (
          <p className="m-0 px-4 py-3 text-[12.5px] text-neutral-500">{nothingYet ? "Once a client pays for an event, it appears here until the ledger records it." : "Nothing to explain here."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
              <thead className="sticky top-0 z-[1]">
                <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-100">
                  <SortTh k="source" label="Source" sort={sort} onSort={onSort} first />
                  <SortTh k="why" label="Why" sort={sort} onSort={onSort} />
                  <SortTh k="overview" label="Bookings" sort={sort} onSort={onSort} right />
                  <SortTh k="ledger" label="Ledger" sort={sort} onSort={onSort} right />
                  <SortTh k="difference" label="Gap" sort={sort} onSort={onSort} right />
                </tr>
              </thead>
              <tbody>
                {rows.map((f, i) => {
                  const c = (k: SortKey, x = "") => `px-3 py-2 align-middle ${k !== "source" ? "border-0 border-l border-solid border-neutral-100" : ""} ${sort.key === k ? "bg-[#02665e]/[0.04]" : ""} ${x}`;
                  return (
                    <tr key={`${f.sourceType}-${f.label}-${f.kind}`} className={`border-0 border-t border-solid border-neutral-100 ${i % 2 ? "bg-neutral-50" : "bg-white"}`}>
                      <td className={c("source", "max-w-[18rem]")}><p className="m-0 truncate font-medium text-neutral-900" title={f.label}>{f.label}</p></td>
                      <td className={c("why", "text-neutral-700")}>{STEPS.find(x => x.kind === f.kind)!.label}{f.reversed && <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-sky-700">Refund recorded</span>}</td>
                      <td className={c("overview", "text-right tabular-nums text-neutral-700")}>{money(f.overview)}</td>
                      <td className={c("ledger", "text-right tabular-nums text-neutral-700")}>{money(f.ledger)}</td>
                      <td className={c("difference", `text-right font-semibold tabular-nums ${f.difference < 0 ? "text-rose-700" : "text-amber-700"}`)}>{signed(f.difference)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="m-0 text-[11px] text-neutral-500">
        Deposits are owed to clients and never count as revenue. Payments: <Link className="font-semibold text-[#02665e] no-underline hover:underline" href="/admin/event-hire/payments">Collections & deposits</Link>. Payouts and refunds: <Link className="font-semibold text-[#02665e] no-underline hover:underline" href="/admin/event-hire/settlements">Payouts & refunds</Link>.
      </p>
    </div>
  );
}
