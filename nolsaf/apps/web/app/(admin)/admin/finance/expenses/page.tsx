"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, KeyRound, Loader2, Lock, Percent, Plus, ReceiptText, RefreshCw, RotateCcw, X } from "lucide-react";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";
import RecordExpenseDialog from "./RecordExpenseDialog";

/**
 * NoLSAF's expense ledger: the cost side of the margin on /admin/finance.
 * Append-only. A wrong entry is reversed (a negative entry pointing back at
 * it), never edited or deleted. Bonuses appear here automatically when they
 * are granted. Behind the finance verification grant.
 */

type Category = { key: string; label: string; kind: "COST_OF_REVENUE" | "OPERATING" };
type Expense = {
  id: number;
  category: string;
  description: string;
  vendor: string | null;
  reference: string | null;
  amount: number;
  currency: string;
  incurredAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  stream: string | null;
  origin: "MANUAL" | "SYSTEM";
  note: string | null;
  reversedAt: string | null;
  reversesExpenseId: number | null;
};
type ListResponse = {
  items: Expense[];
  total: number;
  page: number;
  pageSize: number;
  totals: Array<{ category: string; currency: string; amount: number }>;
  categories: Category[];
  streams: string[];
  gatewayFeeEstimatePercent: number | null;
};

type PeriodKey = "month" | "lastMonth" | "quarter" | "year" | "all";
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

const STREAM_LABEL: Record<string, string> = { accommodation: "Accommodation", tours: "Tours", transport: "Transport", groupStay: "Group stay", subscriptions: "Subscriptions" };
const CATEGORY_TONE: Record<string, string> = {
  GATEWAY_FEE: "bg-sky-50 text-sky-700 ring-sky-200",
  PARTNER_BONUS: "bg-violet-50 text-violet-700 ring-violet-200",
  SMS: "bg-amber-50 text-amber-700 ring-amber-200",
  EMAIL: "bg-amber-50 text-amber-700 ring-amber-200",
  HOSTING: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  STAFF: "bg-rose-50 text-rose-700 ring-rose-200",
  MARKETING: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  OTHER: "bg-neutral-100 text-neutral-700 ring-neutral-200",
};

const PAGE_SIZE = 25;
const fieldClass =
  "box-border h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
const sectionLabel = "m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400";
const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";

/** Today in Dar es Salaam, as a UTC-midnight date for calendar arithmetic. */
function eatToday() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${day}T00:00:00Z`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
function periodRange(key: PeriodKey): { from: string; to: string } | null {
  const t = eatToday();
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  switch (key) {
    case "month": return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(t) };
    case "lastMonth": return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case "quarter": return { from: iso(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), to: iso(t) };
    case "year": return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(t) };
    default: return null;
  }
}
const money = (amount: number, currency = "TZS") => `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
const eatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "";

export default function PlatformExpensesPage() {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [category, setCategory] = useState<string>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [recordOpen, setRecordOpen] = useState(false);
  const [reversing, setReversing] = useState<Expense | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [rateMessage, setRateMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const range = periodRange(period);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (range) { params.set("from", range.from); params.set("to", range.to); }
    if (category) params.set("category", category);
    fetch(`/api/admin/finance/expenses?${params.toString()}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 403 && json?.require2fa) { setLocked(true); setData(null); return; }
        if (!res.ok) { setError(json?.error || "Could not load expenses."); return; }
        setLocked(false);
        setError(null);
        setData(json);
        setRateInput(json.gatewayFeeEstimatePercent == null ? "" : String(json.gatewayFeeEstimatePercent));
      })
      .catch(() => { if (!cancelled) setError("Network error, could not load expenses."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // range is derived from period
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, category, page, reloadKey]);

  useEffect(() => {
    const onGranted = () => setReloadKey((k) => k + 1);
    window.addEventListener("finance-grant-granted", onGranted);
    return () => window.removeEventListener("finance-grant-granted", onGranted);
  }, []);

  const categories = data?.categories ?? [];
  const labelOf = (key: string) => categories.find((c) => c.key === key)?.label ?? key;
  const kindOf = (key: string) => categories.find((c) => c.key === key)?.kind;
  const tzsTotal = (filter: (c: string) => boolean) =>
    (data?.totals ?? []).filter((t) => t.currency === "TZS" && filter(t.category)).reduce((s, t) => s + t.amount, 0);
  const otherCurrencies = useMemo(() => [...new Set((data?.totals ?? []).filter((t) => t.currency !== "TZS" && t.amount !== 0).map((t) => t.currency))], [data]);

  const facts = [
    { label: "Recorded costs", value: data ? money(tzsTotal(() => true)) : "...", detail: `${PERIODS.find((p) => p.key === period)?.label}${otherCurrencies.length ? ` · plus ${otherCurrencies.join(", ")}` : ""}` },
    { label: "Costs of revenue", value: data ? money(tzsTotal((c) => kindOf(c) === "COST_OF_REVENUE")) : "...", detail: "gateway fees and bonuses" },
    { label: "Running costs", value: data ? money(tzsTotal((c) => kindOf(c) === "OPERATING")) : "...", detail: "SMS, hosting, staff, marketing" },
    { label: "Gateway fee estimate", value: data ? (data.gatewayFeeEstimatePercent != null ? `${data.gatewayFeeEstimatePercent}%` : "Not set") : "...", detail: "used until statements are recorded" },
  ];

  const saveRate = useCallback(async () => {
    const raw = rateInput.trim();
    const value = raw === "" ? null : Number(raw);
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 20)) {
      setRateMessage({ tone: "error", text: "Enter a rate between 0 and 20, or leave it empty to turn the estimate off." });
      return;
    }
    setRateSaving(true);
    setRateMessage(null);
    try {
      const res = await fetch("/api/admin/finance/expenses/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gatewayFeeEstimatePercent: value }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setRateMessage({ tone: "error", text: json?.error || "The rate was not saved." }); return; }
      setRateMessage({ tone: "ok", text: value ? `Saved. Periods without statements are estimated at ${value}%.` : "Estimate turned off." });
      setReloadKey((k) => k + 1);
    } catch {
      setRateMessage({ tone: "error", text: "Network error, the rate was not saved." });
    } finally {
      setRateSaving(false);
    }
  }, [rateInput]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  if (locked) {
    return (
      <div className="w-full min-w-0">
        <FinanceGrantPanel showTrigger={false} listenForRequired />
        <section className="mx-auto mt-10 max-w-md rounded-2xl border border-solid border-neutral-300 bg-white p-6 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Lock className="h-5 w-5" /></span>
          <h1 className="m-0 mt-4 text-lg font-bold text-neutral-900">Expenses are protected</h1>
          <p className="m-0 mt-1 text-sm text-neutral-500">Verify finance access to view or record NoLSAF&apos;s costs.</p>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("finance-grant-required"))} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-[#0b2420] px-4 text-sm font-semibold text-white hover:bg-[#12342f]">
            <KeyRound className="h-4 w-4" /> Verify to view
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <FinanceGrantPanel showTrigger={false} listenForRequired />

      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Link href="/admin/finance" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80 no-underline hover:text-emerald-200">
                <ArrowLeft className="h-3 w-3" /> Finance
              </Link>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Expenses</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">What it costs NoLSAF to run. These entries turn the revenue figure on Finance into a contribution and net margin.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => setRecordOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-emerald-400 px-3 text-xs font-bold text-[#0b2420] hover:bg-emerald-300">
                <Plus className="h-3.5 w-3.5" /> Record expense
              </button>
              <button type="button" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className="m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums text-white">{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <X className="mt-0.5 h-4 w-4 shrink-0" /> <span className="flex-1">{error}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        {/* Ledger */}
        <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
            <div className="mr-auto min-w-0">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Ledger</h2>
              <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading..." : `${(data?.total ?? 0).toLocaleString()} ${data?.total === 1 ? "entry" : "entries"}, newest first`}</p>
            </div>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className={`${fieldClass} h-9 w-auto text-xs`} aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <div className="inline-flex flex-wrap rounded-lg bg-neutral-100 p-0.5" role="group" aria-label="Period">
              {PERIODS.map((p) => (
                <button key={p.key} type="button" onClick={() => { setPeriod(p.key); setPage(1); }} aria-pressed={period === p.key} className={`h-8 rounded-md border-0 px-2.5 text-xs font-semibold ${period === p.key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="text-[11px] text-neutral-400">
                  <th className="px-4 py-2.5 font-semibold sm:pl-5">Date</th>
                  <th className="px-3 py-2.5 font-semibold">Category</th>
                  <th className="px-3 py-2.5 font-semibold">Description</th>
                  <th className="px-3 py-2.5 font-semibold">Stream</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 text-right font-semibold sm:pr-5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-0 border-t border-solid border-neutral-200"><td colSpan={6} className="px-5 py-4"><div className="h-3 w-3/4 animate-pulse rounded-full bg-neutral-200/80" /></td></tr>
                  ))
                ) : !data?.items.length ? (
                  <tr className="border-0 border-t border-solid border-neutral-200">
                    <td colSpan={6} className="px-5 py-10 text-center">
                      <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><ReceiptText className="h-5 w-5" /></span>
                      <p className="m-0 mt-3 text-sm font-semibold text-neutral-900">No expenses in this period</p>
                      <p className="m-0 mt-0.5 text-xs text-neutral-500">Record gateway statements and running bills here. Bonuses appear automatically.</p>
                    </td>
                  </tr>
                ) : (
                  data.items.map((row) => {
                    const reversal = row.reversesExpenseId != null;
                    const reversed = Boolean(row.reversedAt);
                    return (
                      <tr key={row.id} className={`border-0 border-t border-solid border-neutral-200 align-top ${reversed ? "text-neutral-400" : ""}`}>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums sm:pl-5">
                          {eatDate(row.incurredAt)}
                          {row.periodStart && row.periodEnd ? <span className="block text-[11px] text-neutral-400">{eatDate(row.periodStart)} to {eatDate(row.periodEnd)}</span> : null}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${CATEGORY_TONE[row.category] ?? CATEGORY_TONE.OTHER}`}>{labelOf(row.category)}</span>
                          <span className="mt-1 block text-[11px] text-neutral-400">{row.origin === "SYSTEM" ? "Recorded by the platform" : "Recorded by an admin"}</span>
                        </td>
                        <td className="max-w-[320px] px-3 py-3">
                          <span className={`block truncate font-medium ${reversed ? "line-through" : "text-neutral-900"}`}>{row.description}</span>
                          <span className="block truncate text-xs text-neutral-400">{[row.vendor, row.reference ? `Ref ${row.reference}` : null, reversal ? row.note : null].filter(Boolean).join(" · ") || " "}</span>
                          {reversed ? <span className="mt-0.5 inline-flex rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">Reversed {eatDate(row.reversedAt)}</span> : null}
                        </td>
                        <td className="px-3 py-3 text-xs text-neutral-500">{row.stream ? STREAM_LABEL[row.stream] ?? row.stream : "Whole platform"}</td>
                        <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${row.amount < 0 ? "text-emerald-700" : reversed ? "" : "text-neutral-900"}`}>{money(row.amount, row.currency)}</td>
                        <td className="px-4 py-3 text-right sm:pr-5">
                          {!reversal && !reversed ? (
                            <button type="button" onClick={() => setReversing(row)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                              <RotateCcw className="h-3.5 w-3.5" /> Reverse
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-4 py-3 text-xs text-neutral-500 sm:px-5">
            <span>Corrections are made by reversing an entry, never by editing it.</span>
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="h-8 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 font-semibold text-neutral-700 disabled:opacity-40">Previous</button>
              <span className="tabular-nums">Page {page} of {totalPages}</span>
              <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages || loading} className="h-8 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 font-semibold text-neutral-700 disabled:opacity-40">Next</button>
            </span>
          </div>
        </section>

        {/* Side: gateway estimate and what each category means */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><Percent className="h-4 w-4" /></span>
              <h2 className="m-0 text-sm font-bold text-neutral-900">Gateway fee estimate</h2>
            </div>
            <p className="m-0 mt-2 text-xs text-neutral-500">The payment providers do not report their fees to NoLSAF. Until a period has gateway fees recorded from a settlement statement, the margin estimates them at this rate on guest money collected.</p>
            <div className="mt-3 flex items-center gap-2">
              <div className="relative flex-1">
                <input value={rateInput} onChange={(e) => setRateInput(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="Not set" aria-label="Gateway fee estimate percent" className={`${fieldClass} pr-8`} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">%</span>
              </div>
              <button type="button" onClick={() => void saveRate()} disabled={rateSaving} className="inline-flex h-10 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white hover:bg-[#12342f] disabled:opacity-50">
                {rateSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
              </button>
            </div>
            {rateMessage && <p className={`m-0 mt-2 text-xs ${rateMessage.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>{rateMessage.text}</p>}
          </section>

          <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-4 shadow-sm">
            <p className={sectionLabel}>How categories count</p>
            <ul className="m-0 mt-2 list-none space-y-2 p-0 text-xs text-neutral-600">
              <li><span className="font-semibold text-neutral-900">Costs of revenue</span> (gateway fees, bonuses) come off revenue first and set the contribution margin.</li>
              <li><span className="font-semibold text-neutral-900">Running costs</span> (SMS, email, hosting, staff, marketing, other) come off contribution and set the net margin.</li>
              <li>Sales partner commissions and driver referral earnings are read from their own ledgers, so they are not entered here.</li>
            </ul>
          </section>
        </div>
      </div>

      {recordOpen && data && (
        <RecordExpenseDialog
          categories={data.categories}
          streams={data.streams}
          feeRate={data.gatewayFeeEstimatePercent}
          onClose={() => setRecordOpen(false)}
          onSaved={() => { setRecordOpen(false); setReloadKey((k) => k + 1); }}
        />
      )}
      {reversing && (
        <ReverseDialog
          expense={reversing}
          label={labelOf(reversing.category)}
          onClose={() => setReversing(null)}
          onDone={() => { setReversing(null); setReloadKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}

function DialogShell({ title, subtitle, onClose, busy, children, footer }: { title: string; subtitle: string; onClose: () => void; busy: boolean; children: React.ReactNode; footer: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title} onClick={() => !busy && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><ReceiptText className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-neutral-900">{title}</p>
            <p className="m-0 mt-0.5 text-xs text-neutral-500">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-0 border-t border-solid border-neutral-200 px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

function ReverseDialog({ expense, label, onClose, onDone }: { expense: Expense; label: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reverse() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/expenses/${expense.id}/reverse`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error || "The expense was not reversed."); return; }
      onDone();
    } catch {
      setError("Network error, the expense was not reversed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      title="Reverse this expense"
      subtitle="A reversing entry cancels it. The original stays in the ledger for the record."
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Cancel</button>
          <button type="button" onClick={() => void reverse()} disabled={saving || reason.trim().length < 3} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reverse expense
          </button>
        </>
      }
    >
      <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200">
        {[
          { label: "Category", value: label },
          { label: "Amount", value: money(expense.amount, expense.currency) },
          { label: "Date", value: eatDate(expense.incurredAt) },
          { label: "Description", value: expense.description },
        ].map((f) => (
          <div key={f.label} className="min-w-0 bg-white px-3 py-2.5">
            <dt className="text-[11px] text-neutral-500">{f.label}</dt>
            <dd className="m-0 mt-0.5 truncate text-sm font-semibold text-neutral-900" title={f.value}>{f.value}</dd>
          </div>
        ))}
      </dl>
      <label className="block">
        <span className={sectionLabel}>Reason</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Entered twice, duplicate of the September statement" className={`${fieldClass} mt-2`} />
      </label>
      {error && <p className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">{error}</p>}
    </DialogShell>
  );
}
