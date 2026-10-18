"use client";

// Tour payouts: the conveyor that moves an operator's share from a paid booking to
// money in their account. Each stage says who acts next (operator or admin), what is
// sitting there and how long it has waited; the stages double as the list filter.
// Data: /api/admin/tour-revenue/overview (one row per tour booking).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Eye,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useAdminHref } from "@/lib/adminRecordRefs";

type RevenueStatus = "DRAFT" | "NEW" | "CLAIMED" | "VERIFIED" | "APPROVED" | "DISBURSED" | "REJECTED" | "CANCELLED";

interface TourRevenueRecord {
  id: number;
  bookingId: number;
  bookingCode: string;
  operatorAgentId: number;
  operatorName: string;
  tourTitle: string;
  destination: string;
  numberOfPeople: number;
  grossAmount: number;
  commissionPercent: number;
  commissionAmount: number;
  taxPercent: number;
  taxAmount: number;
  netAmount: number;
  currency: string;
  status: RevenueStatus;
  paymentAccess?: { status?: string; expiresAt?: string | null } | null;
  paymentRef: string | null;
  rejectionReason: string | null;
  stageSince?: string | null;
  tripStart?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RevenueSummary {
  total: number;
  draft: number;
  new: number;
  claimed: number;
  verified: number;
  approved: number;
  disbursed: number;
  rejected: number;
  cancelled?: number;
  totalAmount: number;
  disbursedAmount: number;
}

type Filter = RevenueStatus | "ALL";
type SortKey = "createdAt" | "bookingCode" | "operatorName" | "tourTitle" | "grossAmount" | "commissionAmount" | "netAmount" | "waiting";

// The conveyor. `actor` is who must move the record forward; `staleDays` is when waiting turns amber.
const STAGES: Array<{ key: RevenueStatus; label: string; actor: "operator" | "admin" | "done"; next: string; staleDays: number; dot: string }> = [
  { key: "NEW", label: "Paid, not claimed", actor: "operator", next: "Operator claims the payout", staleDays: 14, dot: "bg-sky-400" },
  { key: "CLAIMED", label: "Claimed", actor: "admin", next: "You verify the claim", staleDays: 2, dot: "bg-amber-400" },
  { key: "VERIFIED", label: "Verified", actor: "admin", next: "You approve the payout", staleDays: 2, dot: "bg-amber-300" },
  { key: "APPROVED", label: "Approved", actor: "admin", next: "You send it in Disbursements", staleDays: 3, dot: "bg-emerald-300" },
  { key: "DISBURSED", label: "Paid out", actor: "done", next: "Money is with the operator", staleDays: Infinity, dot: "bg-emerald-500" },
];

const STATE_PILL: Record<RevenueStatus, { label: string; pill: string }> = {
  DRAFT: { label: "Unpaid checkout", pill: "bg-neutral-100 text-neutral-600" },
  NEW: { label: "Not claimed", pill: "bg-sky-50 text-sky-700" },
  CLAIMED: { label: "Claimed", pill: "bg-amber-50 text-amber-700" },
  VERIFIED: { label: "Verified", pill: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "Approved", pill: "bg-emerald-50 text-emerald-700" },
  DISBURSED: { label: "Paid out", pill: "bg-emerald-600 text-white" },
  REJECTED: { label: "Rejected", pill: "bg-rose-50 text-rose-700" },
  CANCELLED: { label: "Booking cancelled", pill: "bg-rose-50 text-rose-700" },
};

function money(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0, currencyDisplay: "narrowSymbol" }).format(Math.round(Number(value || 0)));
  } catch {
    return `${currency} ${Math.round(Number(value || 0)).toLocaleString()}`;
  }
}

function daysSince(iso?: string | null) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function ageLabel(days: number | null) {
  if (days == null) return "";
  return days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

function eatDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function tokenLeft(expiresAt: string | null | undefined, nowMs: number) {
  const ms = expiresAt ? new Date(expiresAt).getTime() : 0;
  if (!Number.isFinite(ms) || ms <= nowMs) return null;
  const s = Math.floor((ms - nowMs) / 1000);
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

const HERO_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline";

export default function AdminTourRevenueOverview() {
  const recordHref = useAdminHref();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [revenues, setRevenues] = useState<TourRevenueRecord[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const pageSize = 12;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ ok: boolean; summary: RevenueSummary; revenues: TourRevenueRecord[]; agentCommissionCurrency?: string }>("/api/admin/tour-revenue/overview");
      if (res.data.ok) {
        setSummary(res.data.summary);
        setRevenues(res.data.revenues);
        setCurrency(res.data.agentCommissionCurrency || res.data.revenues[0]?.currency || "USD");
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Failed to load tour payouts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Payment-link countdowns only tick while unpaid checkouts are on screen.
  useEffect(() => {
    if (filter !== "DRAFT") return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [filter]);

  // ── Conveyor numbers ──
  const stageStats = useMemo(() => {
    const out = {} as Record<RevenueStatus, { count: number; amount: number; oldest: number | null; stale: number }>;
    (Object.keys(STATE_PILL) as RevenueStatus[]).forEach((k) => { out[k] = { count: 0, amount: 0, oldest: null, stale: 0 }; });
    for (const r of revenues) {
      const s = out[r.status];
      if (!s) continue;
      s.count += 1;
      s.amount += r.status === "DRAFT" ? Number(r.grossAmount || 0) : Number(r.netAmount || 0);
      const age = daysSince(r.stageSince);
      if (age != null) {
        s.oldest = s.oldest == null ? age : Math.max(s.oldest, age);
        const stage = STAGES.find((x) => x.key === r.status);
        if (stage && age > stage.staleDays) s.stale += 1;
      }
    }
    return out;
  }, [revenues]);

  const yourQueue = STAGES.filter((s) => s.actor === "admin").map((s) => ({ ...s, ...stageStats[s.key] }));
  const queueCount = yourQueue.reduce((n, s) => n + s.count, 0);
  const owedTotal = ["NEW", "CLAIMED", "VERIFIED", "APPROVED"].reduce((n, k) => n + stageStats[k as RevenueStatus].amount, 0);
  const cancelledLive = revenues.filter((r) => r.status === "CANCELLED").length;

  // The single most useful next move for an admin.
  const nextMove = (() => {
    const approved = stageStats.APPROVED;
    if (approved.count) return { text: `Send ${approved.count} approved ${approved.count === 1 ? "payout" : "payouts"} worth ${money(approved.amount, currency)}.`, href: "/admin/disbursements", cta: "Open Disbursements" };
    const verified = stageStats.VERIFIED;
    if (verified.count) return { text: `Approve ${verified.count} verified ${verified.count === 1 ? "claim" : "claims"}${verified.oldest ? `, oldest waiting ${ageLabel(verified.oldest)}` : ""}.`, filter: "VERIFIED" as Filter, cta: "Show them" };
    const claimed = stageStats.CLAIMED;
    if (claimed.count) return { text: `Verify ${claimed.count} new ${claimed.count === 1 ? "claim" : "claims"}${claimed.oldest ? `, oldest waiting ${ageLabel(claimed.oldest)}` : ""}.`, filter: "CLAIMED" as Filter, cta: "Show them" };
    if (stageStats.NEW.count) return { text: `Nothing waits on you. ${stageStats.NEW.count} paid ${stageStats.NEW.count === 1 ? "booking is" : "bookings are"} waiting for the operator to claim.`, filter: "NEW" as Filter, cta: "See them" };
    return { text: "Nothing waits on you. Every payout is either sent or not yet earned.", cta: null };
  })();

  // ── List ──
  const operators = useMemo(() => {
    const map = new Map<number, string>();
    revenues.forEach((r) => { if (r.operatorAgentId) map.set(r.operatorAgentId, r.operatorName); });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [revenues]);

  const filtered = useMemo(() => {
    let rows = filter === "ALL" ? revenues.filter((r) => r.status !== "DRAFT") : revenues.filter((r) => r.status === filter);
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => `${r.bookingCode} ${r.operatorName} ${r.tourTitle} ${r.destination} ${r.paymentRef || ""}`.toLowerCase().includes(q));
    if (operatorFilter) rows = rows.filter((r) => String(r.operatorAgentId) === operatorFilter);
    const min = Number(amountMin);
    if (amountMin && Number.isFinite(min)) rows = rows.filter((r) => Number(r.grossAmount || 0) >= min);
    const max = Number(amountMax);
    if (amountMax && Number.isFinite(max)) rows = rows.filter((r) => Number(r.grossAmount || 0) <= max);
    return rows;
  }, [revenues, filter, query, operatorFilter, amountMin, amountMax]);

  const sorted = useMemo(() => {
    const read = (r: TourRevenueRecord): number | string => {
      switch (sortBy) {
        case "bookingCode": return r.bookingCode.toLowerCase();
        case "operatorName": return r.operatorName.toLowerCase();
        case "tourTitle": return r.tourTitle.toLowerCase();
        case "grossAmount": return Number(r.grossAmount || 0);
        case "commissionAmount": return Number(r.commissionAmount || 0);
        case "netAmount": return Number(r.netAmount || 0);
        case "waiting": return daysSince(r.stageSince) ?? -1;
        default: return new Date(r.createdAt).getTime() || 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = read(a);
      const bv = read(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortBy, sortDir]);

  useEffect(() => { setPage(1); }, [filter, query, operatorFilter, amountMin, amountMax]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pages);
  const shown = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const totals = filtered.reduce(
    (t, r) => ({ gross: t.gross + Number(r.grossAmount || 0), commission: t.commission + Number(r.commissionAmount || 0), tax: t.tax + Number(r.taxAmount || 0), net: t.net + Number(r.netAmount || 0) }),
    { gross: 0, commission: 0, tax: 0, net: 0 },
  );
  const draftView = filter === "DRAFT";
  const activeChips = [
    operatorFilter ? { key: "op", label: operators.find((o) => String(o.id) === operatorFilter)?.name || "Operator", clear: () => setOperatorFilter("") } : null,
    amountMin ? { key: "min", label: `From ${money(Number(amountMin), currency)}`, clear: () => setAmountMin("") } : null,
    amountMax ? { key: "max", label: `Up to ${money(Number(amountMax), currency)}`, clear: () => setAmountMax("") } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  const onSort = (key: SortKey) => {
    if (sortBy === key) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); return; }
    setSortBy(key);
    setSortDir(key === "createdAt" || key === "waiting" || key.endsWith("Amount") ? "desc" : "asc");
  };
  const sortIcon = (key: SortKey) =>
    sortBy !== key ? <ChevronsUpDown className="h-3 w-3 text-neutral-300" /> : sortDir === "asc" ? <ChevronUp className="h-3 w-3 text-emerald-700" /> : <ChevronDown className="h-3 w-3 text-emerald-700" />;
  const pickStage = (key: Filter) => setFilter((cur) => (cur === key ? "ALL" : key));

  return (
    <div id="tour-payouts" className="w-full min-w-0 space-y-4">
      <style>{`#tour-payouts, #tour-payouts * { box-sizing: border-box; }`}</style>

      {/* Header: the payout conveyor */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.18)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Agents module</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tour payouts</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">
                {loading && !summary ? "Reading the pipeline" : <>{money(owedTotal, currency)} owed to operators across {stageStats.NEW.count + queueCount} bookings. {queueCount ? <span className="font-semibold text-amber-200">{queueCount} {queueCount === 1 ? "waits" : "wait"} on you.</span> : "Nothing waits on you."}</>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/disbursements" className={HERO_BUTTON}><Send className="h-3.5 w-3.5" aria-hidden /> Disbursements</Link>
              <Link href="/admin/agents/tour-bookings" className={HERO_BUTTON}>Tour commerce</Link>
              <button type="button" onClick={() => void load()} aria-disabled={loading} aria-label="Refresh tour payouts" title="Refresh" className={`${HERO_BUTTON} w-9 px-0`}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          {/* Stages: each one filters the list below */}
          <ol className="m-0 mt-6 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-5">
            {STAGES.map((stage, i) => {
              const s = stageStats[stage.key];
              const on = filter === stage.key;
              const yours = stage.actor === "admin" && s.count > 0;
              return (
                <li key={stage.key} className="relative min-w-0">
                  <button
                    type="button"
                    onClick={() => pickStage(stage.key)}
                    aria-pressed={on}
                    className={`flex h-full w-full cursor-pointer flex-col rounded-xl border border-solid p-3 text-left transition ${on ? "border-white/50 bg-white/[0.12]" : yours ? "border-amber-300/40 bg-amber-300/[0.07] hover:bg-amber-300/[0.12]" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${stage.dot}`} aria-hidden />
                        <span className="truncate">{stage.label}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${stage.actor === "admin" ? "bg-amber-300/20 text-amber-200" : stage.actor === "operator" ? "bg-sky-300/15 text-sky-200" : "bg-emerald-300/15 text-emerald-200"}`}>
                        {stage.actor === "admin" ? "You" : stage.actor === "operator" ? "Operator" : "Done"}
                      </span>
                    </span>
                    <span className={`mt-2 text-2xl font-bold tabular-nums leading-none ${s.count ? "text-white" : "text-white/30"}`}>{loading && !summary ? "..." : s.count}</span>
                    <span className={`mt-1 text-xs tabular-nums ${s.count ? "text-white/75" : "text-white/30"}`}>{money(s.amount, currency)}</span>
                    <span className={`mt-1.5 text-[11px] ${s.stale ? "font-semibold text-amber-200" : "text-white/40"}`}>
                      {s.count === 0 ? stage.next : s.stale ? `${s.stale} waiting too long, oldest ${ageLabel(s.oldest)}` : s.oldest != null && stage.actor !== "done" ? `Oldest ${ageLabel(s.oldest)}` : stage.next}
                    </span>
                  </button>
                  {i < STAGES.length - 1 ? (
                    <ChevronRight className="absolute -right-2.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-[#0b2420] p-0.5 text-white/40 ring-1 ring-white/15 md:block" aria-hidden />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {/* Off the conveyor */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-white/40">Off the line</span>
            {([
              ["DRAFT", "Unpaid checkouts", stageStats.DRAFT.count, "bg-white/10 text-white/70"],
              ["REJECTED", "Rejected claims", stageStats.REJECTED.count, "bg-rose-400/15 text-rose-200"],
              ["CANCELLED", "Cancelled bookings", cancelledLive, "bg-rose-400/15 text-rose-200"],
            ] as const).map(([key, label, count, tone]) => (
              <button
                key={key}
                type="button"
                onClick={() => pickStage(key)}
                aria-pressed={filter === key}
                className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border-0 px-2.5 font-semibold transition ${filter === key ? "bg-white text-neutral-900" : `${tone} hover:bg-white/20`}`}
              >
                {label} <span className="tabular-nums">{count}</span>
              </button>
            ))}
          </div>

          {/* Next move */}
          <div className="mt-5 flex flex-col gap-3 border-0 border-t border-solid border-white/10 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-white/75"><span className="mr-1.5 font-semibold text-emerald-300">Next:</span>{nextMove.text}</p>
            {nextMove.cta ? (
              "href" in nextMove && nextMove.href ? (
                <Link href={nextMove.href} className={`${HERO_BUTTON} shrink-0`}>{nextMove.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
              ) : (
                <button type="button" onClick={() => "filter" in nextMove && nextMove.filter && setFilter(nextMove.filter)} className={`${HERO_BUTTON} shrink-0`}>{nextMove.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
              )
            ) : null}
          </div>
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden /> {error}
        </div>
      ) : null}

      {cancelledLive > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />
          <span className="flex-1">
            <span className="font-semibold">{cancelledLive} cancelled or refunded {cancelledLive === 1 ? "booking still has" : "bookings still have"} a payout on record.</span>{" "}
            They are kept off the conveyor so nobody pays them by mistake.
          </span>
          <button type="button" onClick={() => setFilter("CANCELLED")} className="shrink-0 border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Review</button>
        </div>
      ) : null}

      {/* List */}
      <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-col gap-2.5 px-5 pb-3 pt-4 sm:flex-row sm:items-center">
          <p className="m-0 shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
            {filter === "ALL" ? "All payouts" : STATE_PILL[filter].label}
          </p>
          <div className="relative min-w-0 flex-1 sm:ml-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Booking code, operator, tour or receipt"
              aria-label="Search tour payouts"
              className="block h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-8 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-neutral-400 hover:bg-neutral-100"><X className="h-3.5 w-3.5" /></button> : null}
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-solid px-3 text-xs font-semibold ${showFilters || activeChips.length ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-white text-neutral-600"}`}
          >
            Filters{activeChips.length ? ` (${activeChips.length})` : ""}
          </button>
          {filter !== "ALL" ? (
            <button type="button" onClick={() => setFilter("ALL")} className="h-9 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent px-2 text-xs font-semibold text-neutral-500 hover:text-neutral-900">Show all</button>
          ) : null}
        </div>

        {showFilters ? (
          <div className="grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-5 py-3 sm:grid-cols-3">
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-neutral-500">Operator</span>
              <select value={operatorFilter} onChange={(e) => setOperatorFilter(e.target.value)} className="block h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs text-neutral-900 outline-none focus:border-emerald-400">
                <option value="">Every operator</option>
                {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-neutral-500">Booking at least ({currency})</span>
              <input type="number" min={0} value={amountMin} onChange={(e) => setAmountMin(e.target.value)} placeholder="0" className="block h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs text-neutral-900 outline-none focus:border-emerald-400" />
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-neutral-500">Booking at most ({currency})</span>
              <input type="number" min={0} value={amountMax} onChange={(e) => setAmountMax(e.target.value)} placeholder="No limit" className="block h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs text-neutral-900 outline-none focus:border-emerald-400" />
            </label>
          </div>
        ) : null}

        {activeChips.length ? (
          <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-neutral-100 px-5 py-2.5">
            {activeChips.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 py-0.5 pl-2.5 pr-1 text-[11px] font-semibold text-emerald-800">
                {c.label}
                <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`} className="grid h-5 w-5 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-emerald-700 hover:bg-emerald-100"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        ) : null}

        {/* What the rows on screen add up to */}
        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-y border-solid border-neutral-100 bg-neutral-100 lg:grid-cols-4">
          {[
            { label: draftView ? "Would have been paid" : "Travellers paid", value: money(totals.gross, currency), tone: "text-neutral-900" },
            { label: "NoLSAF commission", value: draftView ? "None yet" : money(totals.commission, currency), tone: "text-violet-700" },
            { label: "Tax", value: draftView ? "None yet" : money(totals.tax, currency), tone: "text-neutral-900" },
            { label: "To operators", value: draftView ? "None yet" : money(totals.net, currency), tone: "text-emerald-700" },
          ].map((f) => (
            <div key={f.label} className="min-w-0 bg-white px-5 py-3">
              <dt className="text-[11px] text-neutral-500">{f.label}</dt>
              <dd className={`m-0 mt-0.5 truncate text-base font-bold tabular-nums ${f.tone}`}>{f.value}</dd>
            </div>
          ))}
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-0 border-b border-solid border-neutral-100">
                {([
                  ["bookingCode", "Booking", "left"],
                  ["operatorName", "Operator", "left"],
                  ["tourTitle", "Tour", "left"],
                  ["grossAmount", draftView ? "Would pay" : "Paid", "right"],
                  ["commissionAmount", "NoLSAF", "right"],
                  ["netAmount", "To operator", "right"],
                  ["waiting", draftView ? "Payment link" : "Stage", "left"],
                ] as const).map(([key, label, align]) => (
                  <th key={key} className={`px-3 py-2.5 first:pl-5 ${align === "right" ? "text-right" : ""}`}>
                    <button type="button" onClick={() => onSort(key)} className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400 hover:text-neutral-700">
                      {label} {sortIcon(key)}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2.5 pr-5"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && revenues.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-neutral-500">Loading payouts</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-neutral-500">{query || activeChips.length ? "Nothing matches these filters." : filter === "ALL" ? "No paid tour booking yet." : `Nothing in ${STATE_PILL[filter].label.toLowerCase()}.`}</td></tr>
              ) : (
                shown.map((r) => {
                  const pill = STATE_PILL[r.status] ?? STATE_PILL.NEW;
                  const stage = STAGES.find((s) => s.key === r.status);
                  const age = daysSince(r.stageSince);
                  const stale = stage && age != null && age > stage.staleDays;
                  const isDraft = r.status === "DRAFT";
                  const left = isDraft ? tokenLeft(r.paymentAccess?.expiresAt, nowMs) : null;
                  return (
                    <tr key={r.id} className="border-0 border-b border-solid border-neutral-100 transition hover:bg-emerald-50/40">
                      <td className="px-3 py-3 pl-5">
                        <div className="whitespace-nowrap font-mono text-[11px] font-semibold text-neutral-800">{r.bookingCode}</div>
                        <div className="whitespace-nowrap text-[11px] text-neutral-400">{eatDate(r.createdAt)}</div>
                        {r.paymentRef ? <div className="whitespace-nowrap text-[11px] font-semibold text-emerald-700">Receipt {r.paymentRef}</div> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-neutral-700">{r.operatorName}</td>
                      <td className="px-3 py-3">
                        <div className="max-w-[220px] truncate font-semibold text-neutral-900">{r.tourTitle}</div>
                        <div className="text-[11px] text-neutral-500">{r.destination} · {r.numberOfPeople} {r.numberOfPeople === 1 ? "traveller" : "travellers"}</div>
                      </td>
                      <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${isDraft ? "text-neutral-400" : "text-neutral-900"}`}>{money(r.grossAmount, r.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        {isDraft ? <span className="text-neutral-300">None</span> : <><span className="text-violet-700">{money(r.commissionAmount, r.currency)}</span><span className="block text-[10px] text-neutral-400">{Number(r.commissionPercent || 0)}%{r.taxAmount ? ` · tax ${money(r.taxAmount, r.currency)}` : ""}</span></>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-emerald-700">{isDraft ? <span className="font-normal text-neutral-300">None</span> : money(r.netAmount, r.currency)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${pill.pill}`}>{pill.label}</span>
                        <div className={`mt-1 text-[11px] ${stale ? "font-semibold text-amber-700" : "text-neutral-500"}`}>
                          {isDraft
                            ? left ? `Link open, ${left} left` : "Payment link expired"
                            : r.status === "REJECTED" ? (r.rejectionReason || "No reason recorded")
                              : r.status === "CANCELLED" ? "Do not pay"
                                : r.status === "DISBURSED" ? (age != null ? `Paid ${ageLabel(age)} ago`.replace("today ago", "today") : "Paid")
                                  : stage ? `${stage.next}${age != null ? `, ${ageLabel(age)}` : ""}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-3 pr-5 text-right">
                        <Link href={recordHref("tour", r.id)} aria-label={`Open ${r.bookingCode}`} title="Open" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 no-underline transition hover:bg-emerald-50 hover:text-emerald-700">
                          <Eye className="h-4 w-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && sorted.length > pageSize ? (
          <div className="flex items-center justify-between gap-2 px-5 py-3 text-xs text-neutral-500">
            <span>Showing <span className="font-bold text-neutral-800">{(safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, sorted.length)}</span> of <span className="font-bold text-neutral-800">{sorted.length}</span></span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} aria-disabled={safePage <= 1} className="h-8 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 hover:bg-neutral-50 aria-disabled:pointer-events-none aria-disabled:opacity-40">Prev</button>
              <span className="tabular-nums">Page {safePage} of {pages}</span>
              <button type="button" onClick={() => setPage(Math.min(pages, safePage + 1))} aria-disabled={safePage >= pages} className="h-8 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 hover:bg-neutral-50 aria-disabled:pointer-events-none aria-disabled:opacity-40">Next</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
