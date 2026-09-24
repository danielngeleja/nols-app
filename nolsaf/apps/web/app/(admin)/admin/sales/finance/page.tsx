"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  BadgeCheck,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  LayoutDashboard,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Users,
  Wallet,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type Commission = {
  id: number;
  type: string;
  status: string;
  sourceKey: string;
  commissionAmount: number;
  currency: string;
  earnedAt: string;
  property: { id: number; title: string } | null;
  salesPartner: {
    id: number;
    agentCode: string;
    user: { name: string | null; email: string | null };
  };
  payoutItem: { payoutId: number } | null;
};

type Payout = {
  id: number;
  referenceNumber: string;
  requestedAmount: number;
  approvedAmount: number | null;
  deductionAmount: number;
  withholdingTaxRate?: number | null;
  withholdingTaxAmount?: number;
  netPaidAmount: number | null;
  currency: string;
  status: string;
  payoutMethod: string;
  payoutName: string;
  payoutAccount: string | null;
  requestedAt: string;
  paymentReference: string | null;
  salesPartner: {
    id: number;
    agentCode: string;
    user: { name: string | null; email: string | null };
  };
  _count: { items: number };
};

const fieldClass =
  "min-h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:border-emerald-800 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-45";
// Ghost buttons on the dark sales header (shared Sales look).
const heroButton =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

type Stage = { key: string; label: string; hint: string; text: string; dot: string; soft: string };

// Ledger and payout lifecycles, in order. The track doubles as the status filter.
const COMMISSION_FLOW: Stage[] = [
  { key: "VALIDATING", label: "Validating", hint: "Source still being checked", text: "text-sky-700", dot: "bg-sky-500", soft: "bg-sky-50" },
  { key: "ELIGIBLE", label: "Eligible", hint: "Needs your approval", text: "text-amber-700", dot: "bg-amber-500", soft: "bg-amber-50" },
  { key: "AVAILABLE", label: "Available", hint: "Partner can withdraw", text: "text-emerald-700", dot: "bg-emerald-500", soft: "bg-emerald-50" },
  { key: "PAID", label: "Paid", hint: "Included in a paid payout", text: "text-neutral-700", dot: "bg-neutral-500", soft: "bg-neutral-100" },
];
const COMMISSION_OFF: Stage[] = [
  { key: "REVERSED", label: "Reversed", hint: "", text: "text-rose-600", dot: "bg-rose-500", soft: "bg-rose-50" },
  { key: "CANCELLED", label: "Cancelled", hint: "", text: "text-rose-600", dot: "bg-rose-500", soft: "bg-rose-50" },
];
const PAYOUT_FLOW: Stage[] = [
  { key: "REQUESTED", label: "Requested", hint: "Partner asked to withdraw", text: "text-amber-700", dot: "bg-amber-500", soft: "bg-amber-50" },
  { key: "UNDER_REVIEW", label: "Under review", hint: "Being checked", text: "text-sky-700", dot: "bg-sky-500", soft: "bg-sky-50" },
  { key: "APPROVED", label: "Approved", hint: "Send via AzamPay", text: "text-emerald-700", dot: "bg-emerald-500", soft: "bg-emerald-50" },
  { key: "PROCESSING", label: "Processing", hint: "Disbursement running", text: "text-violet-700", dot: "bg-violet-500", soft: "bg-violet-50" },
  { key: "PAID", label: "Paid", hint: "Money sent", text: "text-neutral-700", dot: "bg-neutral-500", soft: "bg-neutral-100" },
];
const PAYOUT_OFF: Stage[] = [
  { key: "REJECTED", label: "Rejected", hint: "", text: "text-rose-600", dot: "bg-rose-500", soft: "bg-rose-50" },
  { key: "CANCELLED", label: "Cancelled", hint: "", text: "text-rose-600", dot: "bg-rose-500", soft: "bg-rose-50" },
];

function stageFor(list: Stage[], status: string): Stage {
  return list.find((s) => s.key === status) || { key: status, label: humanize(status), hint: "", text: "text-neutral-600", dot: "bg-neutral-400", soft: "bg-neutral-50" };
}

function humanize(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function tidyName(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function initials(name: string | null | undefined) {
  const parts = String(name || "").trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.charAt(0) || "") + (parts[1]?.charAt(0) || "")).toUpperCase() || "?";
}

function money(value: number | null | undefined, currency: string) {
  if (value == null) return "Not set";
  return `${currency || "TZS"} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not set";
}

function errorMessage(cause: any, fallback: string) {
  return cause?.response?.data?.require2fa
    ? "Finance OTP verification is required. Complete it in the verification panel, then retry."
    : cause?.response?.data?.error || fallback;
}

// Sum per currency, so mixed ledgers never add TZS to USD.
function totals(items: Array<{ amount: number; currency: string }>) {
  const map = new Map<string, number>();
  items.forEach((i) => map.set(i.currency || "TZS", (map.get(i.currency || "TZS") || 0) + Number(i.amount || 0)));
  return [...map.entries()];
}

export default function AdminSalesFinancePage() {
  const [tab, setTab] = useState<"commissions" | "payouts">("commissions");
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [whtRate, setWhtRate] = useState(0);
  const [commissionStatus, setCommissionStatus] = useState("ELIGIBLE");
  const [payoutStatus, setPayoutStatus] = useState("REQUESTED");
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [deduction, setDeduction] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustment, setAdjustment] = useState({
    salesPartnerId: "",
    propertyId: "",
    amount: "",
    currency: "TZS",
    reason: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [commissionResponse, payoutResponse] = await Promise.all([
        apiClient.get("/api/admin/sales/commissions", {
          params: { pageSize: 100, status: commissionStatus || undefined, q: query || undefined },
        }),
        apiClient.get("/api/admin/sales/payouts", {
          params: { pageSize: 100, status: payoutStatus || undefined, q: query || undefined },
        }),
      ]);
      setCommissions(commissionResponse.data?.commissions || []);
      setPayouts(payoutResponse.data?.payouts || []);
      setWhtRate(Number(payoutResponse.data?.withholdingTaxRate || 0));
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not load sales finance data."));
    } finally {
      setLoading(false);
    }
  }, [commissionStatus, payoutStatus, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const commissionTotals = useMemo(() => totals(commissions.map((c) => ({ amount: c.commissionAmount, currency: c.currency }))), [commissions]);
  const payoutTotals = useMemo(() => totals(payouts.map((p) => ({ amount: p.netPaidAmount ?? p.requestedAmount, currency: p.currency }))), [payouts]);
  const showTotal = (list: Array<[string, number]>) => (list.length === 0 ? "TZS 0" : list.length === 1 ? money(list[0][1], list[0][0]) : "Mixed currencies");

  const commissionAction = async (item: Commission, action: "approve" | "reverse") => {
    const note = (reason[`commission-${item.id}`] || "").trim();
    if (note.length < 5) return setError("Enter an audit reason of at least 5 characters.");
    setBusy(`commission-${action}-${item.id}`);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/sales/commissions/${item.id}/${action}`, { reason: note });
      setNotice(action === "approve" ? `Commission #${item.id} is available to withdraw.` : `Commission #${item.id} was reversed with ledger history retained.`);
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, `Commission ${action} failed.`));
    } finally {
      setBusy("");
    }
  };

  // "processing" and "paid" were retired here: a payout is paid exclusively
  // through the AzamPay Disbursement queue once it reaches APPROVED (see the
  // "Send via AzamPay" link shown for APPROVED payouts).
  const payoutAction = async (item: Payout, action: "approve" | "reject") => {
    const note = (reason[`payout-${item.id}`] || "").trim();
    if (note.length < 5) return setError("Enter an audit reason of at least 5 characters.");
    const payload: Record<string, unknown> = { reason: note };
    if (action === "approve") {
      const value = Number(deduction[item.id] || 0);
      if (!Number.isFinite(value) || value < 0) return setError("Deduction must be zero or a positive amount.");
      payload.deductionAmount = value;
    }
    setBusy(`payout-${action}-${item.id}`);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/sales/payouts/${item.id}/${action}`, payload);
      setNotice(`Payout ${item.referenceNumber} moved to ${humanize(action === "approve" ? "APPROVED" : "REJECTED")}.`);
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, `Payout ${action} failed.`));
    } finally {
      setBusy("");
    }
  };

  const createAdjustment = async () => {
    const partnerId = Number(adjustment.salesPartnerId);
    const propertyId = adjustment.propertyId ? Number(adjustment.propertyId) : null;
    const amount = Number(adjustment.amount);
    if (!Number.isInteger(partnerId) || partnerId <= 0 || !Number.isFinite(amount) || amount === 0 || adjustment.reason.trim().length < 5) {
      setError("Enter a valid partner ID, non-zero amount, and audit reason of at least 5 characters.");
      return;
    }
    setBusy("adjustment");
    setError("");
    setNotice("");
    try {
      await apiClient.post("/api/admin/sales/commissions/adjustments", {
        salesPartnerId: partnerId,
        propertyId,
        amount,
        currency: adjustment.currency,
        reason: adjustment.reason.trim(),
      });
      setAdjustment({ salesPartnerId: "", propertyId: "", amount: "", currency: "TZS", reason: "" });
      setAdjustOpen(false);
      setNotice("Manual ledger adjustment created and made available.");
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not create the adjustment."));
    } finally {
      setBusy("");
    }
  };

  const flow = tab === "commissions" ? COMMISSION_FLOW : PAYOUT_FLOW;
  const off = tab === "commissions" ? COMMISSION_OFF : PAYOUT_OFF;
  const currentStatus = tab === "commissions" ? commissionStatus : payoutStatus;
  const setCurrentStatus = (value: string) => (tab === "commissions" ? setCommissionStatus(value) : setPayoutStatus(value));
  const visibleCount = tab === "commissions" ? commissions.length : payouts.length;
  const adjustAmount = Number(adjustment.amount);

  return (
    <div className="space-y-5 w-full min-w-0">
      {/* Sales header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
                Sales <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-white/70"><Lock className="h-3 w-3" /> Finance OTP protected</span>
              </p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Sales finance</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Approve ledger earnings and move partner payouts through auditable steps.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/sales" className={heroButton}><LayoutDashboard className="h-3.5 w-3.5" /> Sales review</Link>
              <Link href="/admin/sales/partners" className={heroButton}><Users className="h-3.5 w-3.5" /> Partners</Link>
              <Link href="/admin/sales/materials" className={heroButton}><BookOpen className="h-3.5 w-3.5" /> Materials</Link>
              <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 px-0`} aria-label="Refresh sales finance data" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{showTotal(commissionTotals)}</p>
              <p className="m-0 mt-1 text-xs text-white/55">{commissions.length} {commissionStatus ? stageFor([...COMMISSION_FLOW, ...COMMISSION_OFF], commissionStatus).label.toLowerCase() : "all"} {commissions.length === 1 ? "commission" : "commissions"}</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-emerald-300">{showTotal(payoutTotals)}</p>
              <p className="m-0 mt-1 text-xs text-white/55">{payouts.length} {payoutStatus ? stageFor([...PAYOUT_FLOW, ...PAYOUT_OFF], payoutStatus).label.toLowerCase() : "all"} {payouts.length === 1 ? "payout" : "payouts"}</p>
            </div>
          </div>

          <div className="mt-5 flex gap-1" role="tablist" aria-label="Sales finance views">
            {([["commissions", "Commissions", CircleDollarSign, commissions.length], ["payouts", "Payouts", Send, payouts.length]] as const).map(([key, label, Icon, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`relative inline-flex h-11 items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${tab === key ? "text-white" : "text-white/50 hover:text-white/80"}`}
              >
                <Icon className="h-4 w-4" /> {label}
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${tab === key ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/60"}`}>{count}</span>
                {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Lifecycle track: pick a stage to work on */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-2">
        <div className={`grid grid-cols-2 gap-2 ${flow.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          {flow.map((stage, idx) => {
            const selected = currentStatus === stage.key;
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => setCurrentStatus(stage.key)}
                aria-pressed={selected}
                className={`relative min-w-0 rounded-xl border border-solid p-3 text-left transition-all ${selected ? `border-neutral-900 ${stage.soft}` : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${stage.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${stage.dot}`} /> {stage.label}
                  </span>
                  <span className="text-[11px] tabular-nums text-neutral-400">Step {idx + 1}</span>
                </span>
                <span className="mt-1.5 block truncate text-[11px] text-neutral-500">{stage.hint}</span>
                <span className="mt-1.5 block text-sm font-semibold tabular-nums text-neutral-900">
                  {selected ? (loading ? "…" : `${visibleCount} shown`) : " "}
                </span>
                {idx < flow.length - 1 && (
                  <ChevronRight className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white p-0.5 text-neutral-300 ring-1 ring-neutral-200 lg:block" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 pb-0.5">
          <span className="text-[11px] text-neutral-400">Also:</span>
          {[...off, { key: "", label: "All statuses", hint: "", text: "", dot: "bg-neutral-400", soft: "" }].map((stage) => {
            const selected = currentStatus === stage.key;
            return (
              <button
                key={stage.key || "all"}
                type="button"
                onClick={() => setCurrentStatus(stage.key)}
                aria-pressed={selected}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border border-solid px-2.5 text-xs font-medium transition-colors ${selected ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${stage.dot}`} /> {stage.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Work area */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">
              {currentStatus ? stageFor([...flow, ...off], currentStatus).label : "All"} {tab}
            </h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">
              {loading ? "Loading…" : `${visibleCount} shown · ${showTotal(tab === "commissions" ? commissionTotals : payoutTotals)}`}
            </p>
          </div>
          <div className="ml-auto flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                placeholder="Reference, agent code, partner or property"
                aria-label="Search sales finance"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {tab === "commissions" && (
              <button type="button" onClick={() => setAdjustOpen((v) => !v)} aria-expanded={adjustOpen} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#12342f]">
                {adjustOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} Manual adjustment
              </button>
            )}
          </div>
        </div>

        {tab === "commissions" && adjustOpen && (
          <div className="border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><RotateCcw className="h-4 w-4" /></span>
              <div>
                <p className="m-0 text-sm font-semibold text-neutral-900">Manual ledger adjustment</p>
                <p className="m-0 mt-0.5 text-xs text-neutral-500">A positive amount credits the partner; a negative amount recovers money. Both stay in the audit trail.</p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,1.1fr)_6rem_minmax(0,1.6fr)]">
              <label className="text-[11px] font-semibold text-neutral-600">Partner profile ID *<input className={`${fieldClass} mt-1`} inputMode="numeric" value={adjustment.salesPartnerId} onChange={(e) => setAdjustment({ ...adjustment, salesPartnerId: e.target.value })} placeholder="e.g. 12" /></label>
              <label className="text-[11px] font-semibold text-neutral-600">Property ID<input className={`${fieldClass} mt-1`} inputMode="numeric" value={adjustment.propertyId} onChange={(e) => setAdjustment({ ...adjustment, propertyId: e.target.value })} placeholder="Optional" /></label>
              <label className="text-[11px] font-semibold text-neutral-600">Amount *<input className={`${fieldClass} mt-1`} type="number" value={adjustment.amount} onChange={(e) => setAdjustment({ ...adjustment, amount: e.target.value })} placeholder="50000 or -50000" /></label>
              <label className="text-[11px] font-semibold text-neutral-600">Currency<input className={`${fieldClass} mt-1`} maxLength={3} value={adjustment.currency} onChange={(e) => setAdjustment({ ...adjustment, currency: e.target.value.toUpperCase() })} placeholder="TZS" /></label>
              <label className="text-[11px] font-semibold text-neutral-600 sm:col-span-2 lg:col-span-1">Audit reason *<input className={`${fieldClass} mt-1`} value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} placeholder="Why this adjustment is needed" /></label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-xs text-neutral-500">
                {Number.isFinite(adjustAmount) && adjustAmount !== 0
                  ? <>This will <span className={adjustAmount > 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-600"}>{adjustAmount > 0 ? "credit" : "recover"} {money(Math.abs(adjustAmount), adjustment.currency)}</span>{adjustment.salesPartnerId ? ` for partner #${adjustment.salesPartnerId}` : ""}.</>
                  : "Enter an amount to preview the effect."}
              </p>
              <button type="button" disabled={busy === "adjustment"} onClick={() => void createAdjustment()} className={primaryButton}>
                {busy === "adjustment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />} Create adjustment
              </button>
            </div>
          </div>
        )}

        {loading && visibleCount === 0 ? (
          <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> {tab === "commissions" ? "Loading ledger" : "Loading payouts"}
          </div>
        ) : visibleCount === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
              {tab === "commissions" ? <CircleDollarSign className="h-5 w-5" /> : <Send className="h-5 w-5" />}
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">
              {currentStatus ? `Nothing ${stageFor([...flow, ...off], currentStatus).label.toLowerCase()}` : `No ${tab} yet`}
            </p>
            <p className="m-0 mt-1 text-xs text-neutral-500">{query ? "Try another search." : "Pick another stage above to see other records."}</p>
          </div>
        ) : tab === "commissions" ? (
          <ul className={`m-0 list-none p-0 transition-opacity ${loading ? "opacity-60" : ""}`}>
            {commissions.map((item) => {
              const stage = stageFor([...COMMISSION_FLOW, ...COMMISSION_OFF], item.status);
              const key = `commission-${item.id}`;
              const note = (reason[key] || "").trim();
              const canApprove = item.status === "ELIGIBLE";
              const canReverse = !["REVERSED", "CANCELLED"].includes(item.status);
              const name = tidyName(item.salesPartner.user.name) || item.salesPartner.user.email || "Partner";
              const negative = Number(item.commissionAmount) < 0;
              return (
                <li key={item.id} className="grid gap-4 border-0 border-t border-solid border-neutral-100 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(300px,1fr)] lg:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">{initials(name)}</span>
                    <div className="min-w-0">
                      <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="truncate font-semibold text-neutral-900">{name}</span>
                        <span className="font-mono text-xs text-neutral-500">{item.salesPartner.agentCode}</span>
                      </p>
                      <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-neutral-500">
                        <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
                        {item.property?.title || "No property"} <span className="text-neutral-300">·</span> {humanize(item.type)}
                      </p>
                      <p className="m-0 mt-1 flex items-center gap-2 text-[11px]">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${stage.soft} ${stage.text}`}><span className={`h-1.5 w-1.5 rounded-full ${stage.dot}`} />{stage.label}</span>
                        <span className="truncate font-mono text-neutral-400" title={item.sourceKey}>#{item.id} · {item.sourceKey}</span>
                      </p>
                    </div>
                  </div>

                  <div className="lg:text-right">
                    <p className={`m-0 text-lg font-bold tabular-nums ${negative ? "text-rose-600" : "text-neutral-900"}`}>{money(item.commissionAmount, item.currency)}</p>
                    <p className="m-0 text-xs text-neutral-400">Earned {when(item.earnedAt)}</p>
                    {item.payoutItem && <p className="m-0 text-[11px] text-neutral-500">In payout #{item.payoutItem.payoutId}</p>}
                  </div>

                  {canApprove || canReverse ? (
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                      <input className={fieldClass} value={reason[key] || ""} onChange={(e) => setReason({ ...reason, [key]: e.target.value })} placeholder="Audit reason (required)" aria-label={`Audit reason for commission ${item.id}`} />
                      <div className="flex flex-shrink-0 gap-2">
                        {canApprove && (
                          <button type="button" disabled={!!busy || note.length < 5} onClick={() => void commissionAction(item, "approve")} className={primaryButton}>
                            {busy === `commission-approve-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Approve
                          </button>
                        )}
                        {canReverse && (
                          <button type="button" disabled={!!busy || note.length < 5} onClick={() => void commissionAction(item, "reverse")} className={`${secondaryButton} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700`}>
                            {busy === `commission-reverse-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reverse
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="m-0 text-xs text-neutral-400 lg:text-right">No actions for {stage.label.toLowerCase()} entries</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className={`m-0 list-none p-0 transition-opacity ${loading ? "opacity-60" : ""}`}>
            {payouts.map((item) => {
              const stage = stageFor([...PAYOUT_FLOW, ...PAYOUT_OFF], item.status);
              const key = `payout-${item.id}`;
              const note = (reason[key] || "").trim();
              const reviewable = ["REQUESTED", "UNDER_REVIEW"].includes(item.status);
              const name = tidyName(item.salesPartner.user.name) || item.salesPartner.user.email || "Partner";
              const pendingDeduction = Number(deduction[item.id] || 0);
              const deductionShown = reviewable ? (Number.isFinite(pendingDeduction) ? pendingDeduction : 0) : Number(item.deductionAmount || 0);
              // Before approval, preview tax at the configured rate exactly as the
              // server computes it; after approval, show what was recorded.
              const gross = Number(item.approvedAmount ?? item.requestedAmount);
              const taxRate = reviewable ? whtRate : Number(item.withholdingTaxRate || 0);
              const taxShown = reviewable
                ? Math.round(Math.max(gross - deductionShown, 0) * (whtRate / 100) * 100) / 100
                : Number(item.withholdingTaxAmount || 0);
              const net = item.netPaidAmount ?? Math.max(gross - deductionShown - taxShown, 0);
              return (
                <li key={item.id} className="grid gap-4 border-0 border-t border-solid border-neutral-100 px-4 py-4 sm:px-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(300px,1fr)] xl:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">{initials(name)}</span>
                    <div className="min-w-0">
                      <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-mono font-semibold text-neutral-900">{item.referenceNumber}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${stage.soft} ${stage.text}`}><span className={`h-1.5 w-1.5 rounded-full ${stage.dot}`} />{stage.label}</span>
                      </p>
                      <p className="m-0 mt-0.5 truncate text-xs text-neutral-600">{name} <span className="font-mono text-neutral-400">{item.salesPartner.agentCode}</span></p>
                      <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">
                        <Wallet className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-neutral-400" />
                        {humanize(item.payoutMethod)} ending {item.payoutAccount || "unknown"} · {item._count.items} ledger {item._count.items === 1 ? "item" : "items"}
                      </p>
                      <p className="m-0 mt-0.5 text-[11px] text-neutral-400">Requested {when(item.requestedAt)}{item.paymentReference ? ` · Ref ${item.paymentReference}` : ""}</p>
                    </div>
                  </div>

                  {/* Money breakdown */}
                  <dl className="m-0 space-y-1 rounded-lg bg-neutral-50 px-3 py-2.5 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-neutral-500">Requested</dt><dd className="m-0 tabular-nums text-neutral-800">{money(item.requestedAmount, item.currency)}</dd></div>
                    {(deductionShown > 0 || reviewable) && (
                      <div className="flex justify-between gap-3"><dt className="text-neutral-500">Deduction</dt><dd className={`m-0 tabular-nums ${deductionShown > 0 ? "text-rose-600" : "text-neutral-400"}`}>{deductionShown > 0 ? `- ${money(deductionShown, item.currency)}` : "None"}</dd></div>
                    )}
                    {taxShown > 0 && (
                      <div className="flex justify-between gap-3"><dt className="text-neutral-500">Withholding tax{taxRate ? ` (${taxRate}%)` : ""}</dt><dd className="m-0 tabular-nums text-rose-600">- {money(taxShown, item.currency)}</dd></div>
                    )}
                    <div className="flex justify-between gap-3 border-0 border-t border-solid border-neutral-200 pt-1"><dt className="font-medium text-neutral-700">{item.netPaidAmount != null ? "Net paid" : "Net to pay"}</dt><dd className="m-0 font-semibold tabular-nums text-neutral-900">{money(net, item.currency)}</dd></div>
                  </dl>

                  {reviewable ? (
                    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
                      <input className={fieldClass} value={reason[key] || ""} onChange={(e) => setReason({ ...reason, [key]: e.target.value })} placeholder="Audit reason (required)" aria-label={`Audit reason for payout ${item.referenceNumber}`} />
                      <input className={fieldClass} type="number" min="0" value={deduction[item.id] || ""} onChange={(e) => setDeduction({ ...deduction, [item.id]: e.target.value })} placeholder="Deduction" aria-label={`Deduction for payout ${item.referenceNumber}`} />
                      <div className="flex gap-2 sm:col-span-2">
                        <button type="button" disabled={!!busy || note.length < 5} onClick={() => void payoutAction(item, "approve")} className={`${primaryButton} flex-1`}>
                          {busy === `payout-approve-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Approve {money(net, item.currency)}
                        </button>
                        <button type="button" disabled={!!busy || note.length < 5} onClick={() => void payoutAction(item, "reject")} className={`${secondaryButton} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700`}>
                          {busy === `payout-reject-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Reject
                        </button>
                      </div>
                    </div>
                  ) : item.status === "APPROVED" ? (
                    <div className="flex flex-col items-start gap-1.5 xl:items-end">
                      <Link
                        href={`/admin/disbursements?sourceType=SALES_PAYOUT&sourceId=${item.id}`}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0b2420] px-4 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#12342f] hover:no-underline"
                      >
                        <Send className="h-4 w-4 text-emerald-300" /> Send via AzamPay
                      </Link>
                      <p className="m-0 text-[11px] text-neutral-400">Paid only through the disbursement queue</p>
                    </div>
                  ) : (
                    <p className="m-0 text-xs text-neutral-400 xl:text-right">No actions for {stage.label.toLowerCase()} payouts</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="m-0 flex items-center gap-1.5 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 text-[11px] text-neutral-400 sm:px-5">
          <Lock className="h-3 w-3" /> Every action needs an audit reason and Finance OTP verification.
        </p>
      </section>
    </div>
  );
}
