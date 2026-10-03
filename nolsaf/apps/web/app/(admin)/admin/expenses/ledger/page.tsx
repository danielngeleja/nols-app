"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpenText, Loader2, Percent, Plus, ReceiptText, RefreshCw, RotateCcw, X } from "lucide-react";
import { CommandCanvas, eyebrow, panel } from "@/components/admin/commandUi";
import { LockedCard } from "../_shared";
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
  gatewayFeeRates: GatewayFeeRates;
};
type GatewayFeeRates = { provider: string; MNO: number; BANK: number; CARD: number };

type PeriodKey = "month" | "lastMonth" | "quarter" | "year" | "all";
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

const STREAM_LABEL: Record<string, string> = { accommodation: "Accommodation", tours: "Tours", transport: "Transport", groupStay: "Group stay", subscriptions: "Subscriptions" };

const CATEGORY_DOT: Record<string, string> = {
  GATEWAY_FEE: "#38bdf8",
  PARTNER_BONUS: "#a78bfa",
  SMS: "#fbbf24",
  EMAIL: "#fcd34d",
  HOSTING: "#34d399",
  STAFF: "#5eead4",
  MARKETING: "#f0abfc",
  OTHER: "#94a3b8",
};

const PAGE_SIZE = 25;
const fieldClass =
  "box-border h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
const sectionLabel = "m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400";

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



  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  if (locked) return <LockedCard what="The expense ledger" />;

  const recorded = data ? tzsTotal(() => true) : 0;
  const ofRevenue = data ? tzsTotal((c) => kindOf(c) === "COST_OF_REVENUE") : 0;
  const running = data ? tzsTotal((c) => kindOf(c) === "OPERATING") : 0;
  const byCategory = (data?.totals ?? []).filter((t) => t.currency === "TZS" && t.amount !== 0).sort((a, b) => b.amount - a.amount);

  return (
    <div className="w-full min-w-0">
    <CommandCanvas>
      {/* Command bar */}
      <div className="flex flex-wrap items-center gap-3 px-1 pt-1">
        <div className="mr-auto min-w-0">
          <p className={eyebrow}><BookOpenText className="h-3.5 w-3.5" /> Expenses · Ledger</p>
          <p className="m-0 mt-1 text-sm text-slate-400">Every cost NoLSAF records, from gateway statements to paid payroll. Corrections are reversals, never edits.</p>
        </div>
        <button type="button" onClick={() => setRecordOpen(true)} disabled={!data} className="inline-flex h-9 items-center gap-2 rounded-md border-0 bg-emerald-400 px-4 text-xs font-semibold text-[#06201b] transition hover:bg-emerald-300 disabled:opacity-50">
          <Plus className="h-4 w-4" /> Record expense
        </button>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} aria-label="Refresh" className="grid h-9 w-9 place-items-center rounded-md border border-solid border-[#284540] bg-[#182c28] text-slate-300 transition hover:border-emerald-300/40 hover:text-emerald-200 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Totals */}
      <section className={`${panel} overflow-hidden`}>
        <dl className="m-0 grid grid-cols-2 gap-px bg-[#284540] lg:grid-cols-4">
          {[
            { label: "Recorded costs", value: data ? money(recorded) : "...", detail: `${PERIODS.find((pp) => pp.key === period)?.label}${otherCurrencies.length ? ` · plus ${otherCurrencies.join(", ")}` : ""}`, color: "#e2e8f0" },
            { label: "Costs of revenue", value: data ? money(ofRevenue) : "...", detail: "gateway fees and bonuses", color: "#38bdf8" },
            { label: "Running costs", value: data ? money(running) : "...", detail: "SMS, hosting, staff, marketing", color: "#f87171" },
            { label: "Gateway rates", value: data ? `${data.gatewayFeeRates.MNO}% · ${data.gatewayFeeRates.CARD}%` : "...", detail: data ? `${data.gatewayFeeRates.provider}: mobile money and bank, card` : "", color: "#fbbf24" },
          ].map((f) => (
            <div key={f.label} className="min-w-0 bg-[#182c28] px-5 py-4">
              <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8fb5ad]"><span className="h-2 w-2" style={{ background: f.color }} />{f.label}</dt>
              <dd className="m-0 mt-2 truncate text-xl font-semibold tabular-nums text-white">{f.value}</dd>
              <dd className="m-0 mt-0.5 truncate text-[11px] text-slate-500">{f.detail}</dd>
            </div>
          ))}
        </dl>
        {recorded > 0 ? (
          <div className="border-0 border-t border-solid border-[#284540] px-5 py-3">
            <span className="flex h-1.5 gap-0.5">
              {byCategory.map((t) => <span key={t.category} className="h-full" style={{ width: `${(t.amount / recorded) * 100}%`, background: CATEGORY_DOT[t.category] ?? "#94a3b8" }} title={`${labelOf(t.category)}: ${money(t.amount)}`} />)}
            </span>
            <p className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
              {byCategory.map((t) => <span key={t.category} className="inline-flex items-center gap-1.5"><span className="h-2 w-2" style={{ background: CATEGORY_DOT[t.category] ?? "#94a3b8" }} />{labelOf(t.category)} <b className="font-semibold tabular-nums text-slate-200">{Math.round((t.amount / recorded) * 100)}%</b></span>)}
            </p>
          </div>
        ) : null}
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-solid border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          <X className="mt-0.5 h-4 w-4 shrink-0" /> <span className="flex-1">{error}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        {/* Ledger */}
        <section className={`${panel} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="mr-auto min-w-0">
              <p className={eyebrow}>Entries</p>
              <p className="m-0 mt-1 text-xs tabular-nums text-slate-500">{loading ? "Loading..." : `${(data?.total ?? 0).toLocaleString()} ${data?.total === 1 ? "entry" : "entries"}, newest first`}</p>
            </div>
            <div className="inline-flex flex-wrap rounded-md border border-solid border-[#284540] bg-[#13241f] p-0.5" role="group" aria-label="Period">
              {PERIODS.map((pp) => (
                <button key={pp.key} type="button" onClick={() => { setPeriod(pp.key); setPage(1); }} aria-pressed={period === pp.key} className={`h-8 rounded border-0 px-3 text-xs font-semibold transition ${period === pp.key ? "bg-emerald-400 text-[#06201b]" : "bg-transparent text-slate-400 hover:text-white"}`}>
                  {pp.label}
                </button>
              ))}
            </div>
          </div>
          {/* Category filter */}
          <div className="flex gap-1.5 overflow-x-auto border-0 border-t border-solid border-[#284540] px-5 py-2.5" role="group" aria-label="Category">
            {[{ key: "", label: "All categories" }, ...categories].map((c) => (
              <button key={c.key || "all"} type="button" onClick={() => { setCategory(c.key); setPage(1); }} aria-pressed={category === c.key} className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded border border-solid px-2.5 text-[11px] font-semibold transition ${category === c.key ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-200" : "border-[#284540] bg-transparent text-slate-400 hover:text-slate-200"}`}>
                {c.key ? <span className="h-1.5 w-1.5" style={{ background: CATEGORY_DOT[c.key] ?? "#94a3b8" }} /> : null}{c.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-3 py-3 font-semibold">Category</th>
                  <th className="px-3 py-3 font-semibold">Description</th>
                  <th className="px-3 py-3 font-semibold">Stream</th>
                  <th className="px-3 py-3 text-right font-semibold">Amount</th>
                  <th className="px-5 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  Array.from({ length: 5 }).map((_, i) => <tr key={i} className="border-0 border-t border-solid border-[#284540]"><td colSpan={6} className="px-5 py-4"><div className="h-3 w-3/4 animate-pulse bg-white/[0.05]" /></td></tr>)
                ) : !data?.items.length ? (
                  <tr className="border-0 border-t border-solid border-[#284540]">
                    <td colSpan={6} className="px-5 py-12 text-center">
                      <span className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-emerald-400/10 text-emerald-300"><ReceiptText className="h-5 w-5" /></span>
                      <p className="m-0 mt-3 text-sm font-semibold text-white">No expenses in this period</p>
                      <p className="m-0 mt-0.5 text-xs text-slate-500">Record gateway statements and running bills here. Bonuses and paid payroll appear on their own.</p>
                    </td>
                  </tr>
                ) : (
                  data.items.map((row) => {
                    const reversal = row.reversesExpenseId != null;
                    const reversed = Boolean(row.reversedAt);
                    return (
                      <tr key={row.id} className={`border-0 border-t border-solid border-[#284540] align-top transition-colors hover:bg-white/[0.02] ${reversed ? "opacity-60" : ""}`}>
                        <td className="whitespace-nowrap px-5 py-3 tabular-nums text-slate-300">
                          {eatDate(row.incurredAt)}
                          {row.periodStart && row.periodEnd ? <span className="block text-[11px] text-slate-500">{eatDate(row.periodStart)} to {eatDate(row.periodEnd)}</span> : null}
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded border border-solid border-[#284540] bg-[#13241f] px-2 py-0.5 text-[11px] font-semibold text-slate-200"><span className="h-1.5 w-1.5" style={{ background: CATEGORY_DOT[row.category] ?? "#94a3b8" }} />{labelOf(row.category)}</span>
                          <span className="mt-1 block text-[11px] text-slate-500">{row.origin === "SYSTEM" ? "By the platform" : "By an admin"}</span>
                        </td>
                        <td className="max-w-[320px] px-3 py-3">
                          <span className={`block truncate font-medium ${reversed ? "text-slate-500 line-through" : "text-slate-100"}`}>{row.description}</span>
                          <span className="block truncate text-xs text-slate-500">{[row.vendor, row.reference ? `Ref ${row.reference}` : null, reversal ? row.note : null].filter(Boolean).join(" · ") || " "}</span>
                          {reversed ? <span className="mt-1 inline-flex rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">Reversed {eatDate(row.reversedAt)}</span> : null}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-400">{row.stream ? STREAM_LABEL[row.stream] ?? row.stream : "Whole platform"}</td>
                        <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${row.amount < 0 ? "text-emerald-300" : "text-white"}`}>{money(row.amount, row.currency)}</td>
                        <td className="px-5 py-3 text-right">
                          {!reversal && !reversed ? (
                            <button type="button" onClick={() => setReversing(row)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-[#284540] bg-transparent px-2.5 text-xs font-semibold text-slate-300 transition hover:border-rose-400/40 hover:text-rose-200">
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
          <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-[#284540] px-5 py-3 text-xs text-slate-500">
            <span>Corrections are made by reversing an entry, never by editing it.</span>
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => setPage((pg) => Math.max(1, pg - 1))} disabled={page <= 1 || loading} className="h-8 rounded-md border border-solid border-[#284540] bg-transparent px-2.5 font-semibold text-slate-300 disabled:opacity-30">Previous</button>
              <span className="tabular-nums">Page {page} of {totalPages}</span>
              <button type="button" onClick={() => setPage((pg) => pg + 1)} disabled={page >= totalPages || loading} className="h-8 rounded-md border border-solid border-[#284540] bg-transparent px-2.5 font-semibold text-slate-300 disabled:opacity-30">Next</button>
            </span>
          </div>
        </section>

        {/* Side */}
        <div className="min-w-0 space-y-4">
          <section className={`${panel} p-5`}>
            <div className="flex items-center justify-between gap-2">
              <p className={eyebrow}><Percent className="h-3.5 w-3.5" /> Gateway fee rates</p>
              <span className="rounded bg-white/[0.05] px-2 py-0.5 text-[10px] font-bold text-slate-300">{data?.gatewayFeeRates.provider ?? "AzamPay"}</span>
            </div>
            <p className="m-0 mt-3 text-xs leading-relaxed text-slate-400">Deducted from each guest payment and carried by NoLSAF revenue. Until a period has fees from a settlement statement, the margin estimates them with these rates.</p>
            <dl className="m-0 mt-3 divide-y divide-[#284540] border border-solid border-[#284540]">
              {[
                { key: "MNO", label: "Mobile money" },
                { key: "BANK", label: "Bank" },
                { key: "CARD", label: "Card" },
              ].map((c) => (
                <div key={c.key} className="flex items-center justify-between bg-[#13241f] px-3 py-2">
                  <dt className="text-xs text-slate-300">{c.label}</dt>
                  <dd className="m-0 text-sm font-semibold tabular-nums text-white">{data ? `${data.gatewayFeeRates[c.key as "MNO" | "BANK" | "CARD"]}%` : "..."}</dd>
                </div>
              ))}
            </dl>
            <Link href="/admin/expenses/settings" className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-[#284540] bg-transparent px-3 text-xs font-semibold text-slate-200 no-underline hover:border-emerald-300/40 hover:text-emerald-200 hover:no-underline">Change the rates</Link>
          </section>

          <section className={`${panel} p-5`}>
            <p className={eyebrow}>How categories count</p>
            <ul className="m-0 mt-3 list-none space-y-3 p-0 text-xs leading-relaxed text-slate-400">
              <li className="border-0 border-l-2 border-solid border-sky-400 pl-3"><span className="font-semibold text-slate-100">Costs of revenue</span> (gateway fees, bonuses) come off revenue first and set the contribution margin.</li>
              <li className="border-0 border-l-2 border-solid border-rose-400 pl-3"><span className="font-semibold text-slate-100">Running costs</span> (SMS, email, hosting, staff, marketing, other) come off contribution and set the net margin.</li>
              <li className="border-0 border-l-2 border-solid border-slate-500 pl-3">Sales partner commissions and driver referral earnings are read from their own ledgers, so they are not entered here.</li>
            </ul>
          </section>
        </div>
      </div>
    </CommandCanvas>

      {recordOpen && data && (
        <RecordExpenseDialog
          categories={data.categories}
          streams={data.streams}
          feeRates={data.gatewayFeeRates}
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
