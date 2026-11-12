"use client";

/**
 * Earnings: what you have earned, when pending money unlocks, and the full
 * ledger with the calculation behind every line. Rows and columns, no ids.
 */
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Hourglass,
  Minus,
  ReceiptText,
  RefreshCw,
  Send,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Summary = {
  pending: number;
  available: number;
  paid: number;
  reversed: number;
  totalEarned: number;
  thisMonth: number;
  lastMonth: number;
  inWithdrawal: number;
  minimum: number;
  currency: string;
  count: number;
  byStream: Record<string, number>;
  statusCounts: Record<string, number>;
  trend: Array<{ month: string; amount: number }>;
  unlocks: { within7Days: number; within30Days: number; later: number; next: { at: string; amount: number } | null };
};

type Earning = {
  ref: string;
  type: string;
  status: string;
  source: string;
  grossAmount: number;
  taxAmount: number;
  processingFeeAmount: number;
  refundAmount: number;
  discountAmount: number;
  eligibleNetRevenue: number;
  commissionRate: number;
  commissionAmount: number;
  currency: string;
  description: string | null;
  earnedAt: string;
  eligibleAt: string | null;
  availableAt: string | null;
  paidAt: string | null;
  reversedAt: string | null;
  property: { title: string } | null;
  contract: { contractNumber: string | null } | null;
};

const TABS = [
  { key: "ALL", label: "All" },
  { key: "VALIDATING", label: "Validating" },
  { key: "ELIGIBLE", label: "Eligible" },
  { key: "APPROVED", label: "Approved" },
  { key: "AVAILABLE", label: "Available" },
  { key: "PAID", label: "Paid" },
  { key: "REVERSED", label: "Reversed" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const STREAMS = [
  { key: "", label: "All streams" },
  { key: "NRMS_USAGE", label: "NRMS usage" },
  { key: "MARKETPLACE_BOOKING", label: "Marketplace bookings" },
  { key: "AGENCY_STAY", label: "Agency stays" },
  { key: "AGENCY_GROUP", label: "Agency group stays" },
  { key: "AGENCY_TOUR", label: "Agency tours" },
  { key: "PERFORMANCE_BONUS", label: "Performance bonus" },
  { key: "MANUAL_ADJUSTMENT", label: "Adjustments" },
];
const STREAM_LABEL: Record<string, string> = Object.fromEntries(STREAMS.filter((s) => s.key).map((s) => [s.key, s.label]));
const PENDING = ["PENDING", "VALIDATING", "ELIGIBLE", "APPROVED"];
const pageSize = 25;
const card = "rounded-lg border border-solid border-slate-200 bg-white";
const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500";

function money(value: number, currency = "TZS") {
  return `${currency === "TZS" ? "TSh" : currency} ${Math.round(Number(value || 0)).toLocaleString("en-US")}`;
}

function eatDate(value: string | null) {
  if (!value) return "–";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function daysFromNow(value: string | null) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function monthShort(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
}

function label(value: string) {
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Figure({ icon: Icon, title, value, note, tone = "text-slate-900" }: { icon: typeof WalletCards; title: string; value: string; note: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3.5">
      <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><Icon className="h-3.5 w-3.5" aria-hidden /> {title}</p>
      <p className={`m-0 mt-1 truncate text-xl font-bold tabular-nums tracking-tight ${tone}`} title={value}>{value}</p>
      <div className="m-0 truncate text-[12px] text-slate-500">{note}</div>
    </div>
  );
}

function Change({ now, before }: { now: number; before: number }) {
  if (before <= 0) return <span>{now > 0 ? "First earnings this period" : "Nothing yet this month"}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const Icon = pct > 2 ? ArrowUpRight : pct < -2 ? ArrowDownRight : Minus;
  const tone = pct > 2 ? "text-emerald-700" : pct < -2 ? "text-amber-700" : "text-slate-500";
  return <span className={`inline-flex items-center gap-0.5 ${tone}`}><Icon className="h-3.5 w-3.5" aria-hidden />{pct > 0 ? "+" : ""}{pct}% <span className="text-slate-500">vs all of last month</span></span>;
}

export default function SalesEarningsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>("ALL");
  const [stream, setStream] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/sales/earnings/summary");
      setSummary(data?.summary || null);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load your earnings summary.");
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await apiClient.get("/api/sales/earnings", {
        params: { page, pageSize, ...(tab !== "ALL" ? { status: tab } : {}), ...(stream ? { type: stream } : {}) },
      });
      setEarnings(data?.earnings || []);
      setTotal(Number(data?.total || 0));
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load earnings.");
    } finally {
      setLoading(false);
    }
  }, [page, tab, stream]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadList(); }, [loadList]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const s = summary;
  const canWithdraw = !!s && s.available >= s.minimum;
  const peak = useMemo(() => Math.max(1, ...(s?.trend ?? []).map((p) => p.amount)), [s]);
  const unlockTotal = s ? s.unlocks.within7Days + s.unlocks.within30Days + s.unlocks.later : 0;
  const streams = useMemo(() => {
    if (!s) return [];
    const rows = [
      { key: "NRMS_USAGE", label: "NRMS", amount: s.byStream.NRMS_USAGE || 0, bar: "bg-[#02665e]" },
      { key: "MARKETPLACE_BOOKING", label: "Marketplace", amount: s.byStream.MARKETPLACE_BOOKING || 0, bar: "bg-sky-500" },
      { key: "AGENCY", label: "Agency Desk", amount: (s.byStream.AGENCY_STAY || 0) + (s.byStream.AGENCY_GROUP || 0) + (s.byStream.AGENCY_TOUR || 0), bar: "bg-violet-500" },
      { key: "OTHER", label: "Bonus and adjustments", amount: (s.byStream.PERFORMANCE_BONUS || 0) + (s.byStream.MANUAL_ADJUSTMENT || 0), bar: "bg-amber-400" },
    ].filter((r) => r.key !== "AGENCY" || r.amount > 0);
    const sum = rows.reduce((t, r) => t + Math.max(0, r.amount), 0);
    return rows.map((r) => ({ ...r, share: sum > 0 ? Math.max(0, r.amount) / sum : 0 }));
  }, [s]);

  const choose = (next: Tab) => { setTab(next); setPage(1); setOpen(null); };

  return (
    <SalesShell>
      <style jsx global>{`#sales-earnings, #sales-earnings * { box-sizing: border-box; }`}</style>
      <div id="sales-earnings" className="space-y-4">
        <SalesPageHeader
          icon={WalletCards}
          title="Earnings"
          description="Every earning traced to collected NoLSAF revenue, the agreement rate applied at that time, and the day it becomes yours to withdraw."
          actions={
            <Link
              href="/sales/payouts"
              className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold no-underline sm:w-auto ${canWithdraw ? "bg-[#02665e] text-white hover:bg-[#014d47] hover:text-white" : "border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <Send className="h-4 w-4" aria-hidden />
              {canWithdraw ? `Withdraw ${money(s!.available)}` : "Open payouts"}
            </Link>
          }
        />

        {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p> : null}

        {/* Key figures, one joined panel */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-200 lg:grid-cols-4" aria-label="Earnings figures">
          {s ? (
            <>
              <Figure
                icon={CircleDollarSign}
                title="Ready to withdraw"
                value={money(s.available)}
                tone="text-[#02665e]"
                note={s.inWithdrawal > 0 ? `${money(s.inWithdrawal)} already on its way` : canWithdraw ? "Above the minimum" : `${money(Math.max(0, s.minimum - s.available))} to the ${money(s.minimum)} minimum`}
              />
              <Figure
                icon={Hourglass}
                title="Unlocks in 7 days"
                value={money(s.unlocks.within7Days)}
                note={s.unlocks.next ? `Next: ${money(s.unlocks.next.amount)} on ${eatDate(s.unlocks.next.at)}` : s.pending > 0 ? "Waiting for validation" : "Nothing pending"}
              />
              <Figure icon={TrendingUp} title="Earned this month" value={money(s.thisMonth)} note={<Change now={s.thisMonth} before={s.lastMonth} />} />
              <Figure icon={BadgeCheck} title="Paid to you" value={money(s.paid)} note={`${money(s.totalEarned)} earned in total`} />
            </>
          ) : (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white px-4 py-3.5" aria-hidden>
                <span className="block h-3 w-24 animate-pulse rounded bg-slate-100" />
                <span className="mt-2 block h-6 w-32 animate-pulse rounded bg-slate-200" />
                <span className="mt-2 block h-3 w-28 animate-pulse rounded bg-slate-100" />
              </div>
            ))
          )}
        </section>

        {/* Insight: when money unlocks, and where it comes from */}
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <article className={`${card} min-w-0 p-4`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarClock className="h-4 w-4 text-[#02665e]" aria-hidden /> When your pending money unlocks</h2>
              <span className="text-[12px] tabular-nums text-slate-500">{s ? money(s.pending) : "–"} pending</span>
            </div>
            {s && unlockTotal > 0 ? (
              <>
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <span className="h-full bg-[#02665e]" style={{ width: `${(s.unlocks.within7Days / unlockTotal) * 100}%` }} />
                  <span className="h-full bg-[#02665e]/45" style={{ width: `${(s.unlocks.within30Days / unlockTotal) * 100}%` }} />
                  <span className="h-full bg-slate-300" style={{ width: `${(s.unlocks.later / unlockTotal) * 100}%` }} />
                </div>
                <dl className="m-0 mt-3 grid grid-cols-3 gap-3">
                  {[
                    { t: "Within 7 days", v: s.unlocks.within7Days, dot: "bg-[#02665e]" },
                    { t: "In 8 to 30 days", v: s.unlocks.within30Days, dot: "bg-[#02665e]/45" },
                    { t: "Later or in review", v: s.unlocks.later, dot: "bg-slate-300" },
                  ].map((row) => (
                    <div key={row.t} className="min-w-0">
                      <dt className="flex items-center gap-1.5 text-[11px] text-slate-500"><span className={`h-2 w-2 shrink-0 rounded-full ${row.dot}`} />{row.t}</dt>
                      <dd className="m-0 mt-0.5 truncate text-[14px] font-semibold tabular-nums text-slate-900">{money(row.v)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="m-0 mt-3 text-[12px] text-slate-500">Earnings wait out a validation window (7 days for NRMS, 30 for Marketplace) so cancellations and refunds can settle first.</p>
              </>
            ) : (
              <p className="m-0 mt-3 text-[13px] text-slate-500">{s ? "Nothing pending. New earnings show here with the day they unlock." : "Loading"}</p>
            )}
          </article>

          <article className={`${card} min-w-0 p-4`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><TrendingUp className="h-4 w-4 text-[#02665e]" aria-hidden /> Last 6 months</h2>
              <span className="text-[12px] text-slate-500">Earned, by month</span>
            </div>
            <div className="mt-3 grid h-24 grid-cols-6 items-end gap-2" role="img" aria-label="Earnings for the last six months">
              {(s?.trend ?? Array.from({ length: 6 }, (_, i) => ({ month: String(i), amount: 0 }))).map((p, i, all) => (
                <div key={p.month} className="flex h-full min-w-0 flex-col justify-end">
                  <span
                    className={`block w-full rounded-t-sm ${i === all.length - 1 ? "bg-[#02665e]" : "bg-[#02665e]/30"}`}
                    style={{ height: `${Math.max(4, (p.amount / peak) * 100)}%` }}
                    title={s ? `${monthShort(p.month)}: ${money(p.amount)}` : undefined}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-6 gap-2 text-center text-[11px] text-slate-500">
              {(s?.trend ?? []).map((p) => <span key={p.month}>{monthShort(p.month)}</span>)}
            </div>
            <div className="mt-3 border-0 border-t border-solid border-slate-100 pt-3">
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                {streams.map((r) => <span key={r.key} className={`h-full ${r.bar}`} style={{ width: `${r.share * 100}%` }} />)}
              </div>
              <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px] text-slate-600">
                {streams.map((r) => (
                  <li key={r.key} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${r.bar}`} />{r.label} <span className="font-semibold tabular-nums text-slate-900">{Math.round(r.share * 100)}%</span></li>
                ))}
              </ul>
            </div>
          </article>
        </section>

        {/* Ledger */}
        <section className={`${card} overflow-hidden`} aria-label="Earnings ledger">
          <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Filter by status">
              {TABS.filter((t) => t.key === "ALL" || t.key === tab || (s?.statusCounts[t.key] ?? 0) > 0).map((t) => {
                const count = t.key === "ALL" ? s?.count : s?.statusCounts[t.key];
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => choose(t.key)}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border-0 px-2.5 text-[12px] font-semibold ${tab === t.key ? "bg-slate-900 text-white" : "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}
                  >
                    {t.label}
                    {count !== undefined ? <span className={`rounded px-1 text-[11px] tabular-nums ${tab === t.key ? "bg-white/15" : "bg-slate-100"}`}>{count}</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="earning-stream">Earning stream</label>
              <select
                id="earning-stream"
                value={stream}
                onChange={(e) => { setStream(e.target.value); setPage(1); setOpen(null); }}
                className="h-8 rounded-md border border-solid border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-700 outline-none focus:border-[#02665e]"
              >
                {/* Agency streams only appear to partners who have agency earnings: the desk is never advertised. */}
                {STREAMS.filter((o) => !o.key.startsWith("AGENCY_") || Number(s?.byStream?.[o.key] || 0) > 0).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button type="button" onClick={() => { void loadSummary(); void loadList(); }} disabled={loading} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className={`${th} pl-4`}>Source</th>
                  <th className={th}>Earned</th>
                  <th className={`${th} text-right`}>Eligible revenue</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={`${th} text-right`}>Your commission</th>
                  <th className={th}>Status</th>
                  <th className={`${th} pr-4`}><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && !earnings.length ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-0 border-t border-solid border-slate-100" aria-hidden>
                      {[48, 20, 24, 10, 24, 18, 8].map((w, j) => (
                        <td key={j} className={`py-3.5 ${j === 0 ? "pl-4 pr-3" : "px-3"}`}><span className="block h-3.5 animate-pulse rounded bg-slate-100" style={{ width: `${w * 2}px` }} /></td>
                      ))}
                    </tr>
                  ))
                ) : earnings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <ReceiptText className="mx-auto h-6 w-6 text-slate-300" aria-hidden />
                      <p className="m-0 mt-2 text-sm font-medium text-slate-800">{tab === "ALL" && !stream ? "No earnings yet" : "Nothing in this view"}</p>
                      <p className="m-0 mt-1 text-[13px] text-slate-500">{tab === "ALL" && !stream ? "Revenue collected from the properties you brought in will show here." : "Try another status or stream."}</p>
                    </td>
                  </tr>
                ) : (
                  earnings.map((item) => {
                    const expanded = open === item.ref;
                    const pending = PENDING.includes(item.status);
                    const left = pending ? daysFromNow(item.eligibleAt) : null;
                    const negative = item.commissionAmount < 0;
                    return (
                      <Fragment key={item.ref}>
                        <tr className={`border-0 border-t border-solid border-slate-100 align-top ${expanded ? "bg-slate-50/70" : "hover:bg-slate-50/60"}`}>
                          <td className="py-3 pl-4 pr-3">
                            <p className="m-0 max-w-[22rem] truncate text-[13px] font-semibold text-slate-900">{item.property?.title || item.source}</p>
                            <p className="m-0 text-[11px] text-slate-500">{STREAM_LABEL[item.type] || label(item.type)}{item.property ? ` · ${item.source}` : ""}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-[12px] text-slate-600">{eatDate(item.earnedAt)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right text-[12px] tabular-nums text-slate-700">{money(item.eligibleNetRevenue, item.currency)}</td>
                          <td className="px-3 py-3 text-right text-[12px] tabular-nums text-slate-700">{item.commissionRate}%</td>
                          <td className={`whitespace-nowrap px-3 py-3 text-right text-[13px] font-semibold tabular-nums ${negative ? "text-rose-700" : "text-slate-900"}`}>{money(item.commissionAmount, item.currency)}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${statusTone(item.status)}`}>{label(item.status)}</span>
                            {pending && left !== null ? (
                              <span className="mt-0.5 block text-[11px] text-slate-500">{left <= 0 ? "Unlocking now" : `Unlocks in ${left} day${left === 1 ? "" : "s"}`}</span>
                            ) : item.status === "PAID" && item.paidAt ? (
                              <span className="mt-0.5 block text-[11px] text-slate-500">Paid {eatDate(item.paidAt)}</span>
                            ) : null}
                          </td>
                          <td className="py-3 pl-3 pr-4 text-right">
                            <button
                              type="button"
                              onClick={() => setOpen(expanded ? null : item.ref)}
                              aria-expanded={expanded}
                              aria-label={`${expanded ? "Hide" : "Show"} the calculation for ${item.property?.title || item.source}`}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-solid border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              How <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
                            </button>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="bg-slate-50/70">
                            <td colSpan={7} className="px-4 pb-4 pt-1">
                              <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                                <div className="rounded-md border border-solid border-slate-200 bg-white px-3 py-2.5">
                                  <p className="m-0 text-[11px] font-semibold text-slate-500">How it was worked out</p>
                                  <dl className="m-0 mt-1.5 space-y-1 text-[12px]">
                                    {[
                                      ["Gross NoLSAF revenue", money(item.grossAmount, item.currency)],
                                      ["Tax", `- ${money(item.taxAmount, item.currency)}`],
                                      ["Processing fees", `- ${money(item.processingFeeAmount, item.currency)}`],
                                      ["Refunds and discounts", `- ${money(item.refundAmount + item.discountAmount, item.currency)}`],
                                    ].map(([k, v]) => (
                                      <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="m-0 tabular-nums text-slate-700">{v}</dd></div>
                                    ))}
                                    <div className="flex justify-between gap-4 border-0 border-t border-solid border-slate-100 pt-1"><dt className="font-medium text-slate-700">Eligible revenue</dt><dd className="m-0 font-semibold tabular-nums text-slate-900">{money(item.eligibleNetRevenue, item.currency)}</dd></div>
                                    <div className="flex justify-between gap-4 rounded bg-[#02665e]/10 px-2 py-1"><dt className="font-semibold text-[#02665e]">Your {item.commissionRate}%</dt><dd className="m-0 font-bold tabular-nums text-[#02665e]">{money(item.commissionAmount, item.currency)}</dd></div>
                                  </dl>
                                </div>
                                <div className="rounded-md border border-solid border-slate-200 bg-white px-3 py-2.5">
                                  <p className="m-0 text-[11px] font-semibold text-slate-500">Record</p>
                                  <dl className="m-0 mt-1.5 space-y-1 text-[12px]">
                                    <div className="flex justify-between gap-4"><dt className="text-slate-500">Source</dt><dd className="m-0 text-right text-slate-700">{item.source}</dd></div>
                                    {item.contract?.contractNumber ? <div className="flex justify-between gap-4"><dt className="text-slate-500">Agreement</dt><dd className="m-0 font-mono text-[11px] text-slate-700">{item.contract.contractNumber}</dd></div> : null}
                                    <div className="flex justify-between gap-4"><dt className="text-slate-500">Validation ends</dt><dd className="m-0 text-slate-700">{eatDate(item.eligibleAt)}</dd></div>
                                    {item.availableAt ? <div className="flex justify-between gap-4"><dt className="text-slate-500">Available since</dt><dd className="m-0 text-slate-700">{eatDate(item.availableAt)}</dd></div> : null}
                                    {item.reversedAt ? <div className="flex justify-between gap-4"><dt className="text-slate-500">Reversed</dt><dd className="m-0 text-rose-700">{eatDate(item.reversedAt)}</dd></div> : null}
                                  </dl>
                                  {item.description ? <p className="m-0 mt-2 border-0 border-t border-solid border-slate-100 pt-2 text-[12px] leading-5 text-slate-600">{item.description}</p> : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {total > pageSize ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 px-4 py-2.5">
              <p className="m-0 text-[12px] text-slate-500">{(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total.toLocaleString("en-US")}</p>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={page <= 1 || loading} onClick={() => { setOpen(null); setPage((v) => Math.max(1, v - 1)); }} aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                <span className="min-w-12 text-center text-[12px] font-semibold tabular-nums text-slate-600">{page} / {totalPages}</span>
                <button type="button" disabled={page >= totalPages || loading} onClick={() => { setOpen(null); setPage((v) => Math.min(totalPages, v + 1)); }} aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" aria-hidden /></button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </SalesShell>
  );
}
