"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { Activity, AlertTriangle, ArrowLeft, Building2, Clock3, Coins, FileText, Loader2, RefreshCw, Wallet } from "lucide-react";
import { CountPill, EmptyState, SectionHeader, SummaryCard } from "../_components/CommercialUi";

type Account = {
  id: number; propertyId: number; propertyTitle: string;
  owner: { id: number; name: string; email: string | null };
  status: string; trialEndsAt: string | null; unpaidBalance: number; unpaidLimit: number;
};
type OpenStatement = { id: number; propertyId: number | null; propertyTitle: string; amount: number; currency: string; closedAt: string };
type ProcessingToken = { id: number; token: string; statementId: number; propertyTitle: string; amount: number; currency: string; method: string | null; createdAt: string; expiresAt: string };

const STATUS_ORDER = ["PAYMENT_REQUIRED", "WARNING", "PAYMENT_PENDING", "ACTIVE", "TRIAL", "CLOSED"];
const STATUS_STYLE: Record<string, { badge: string; accent: string; bar: string }> = {
  TRIAL: { badge: "border-sky-100 bg-sky-50 text-sky-700", accent: "bg-sky-400", bar: "bg-sky-400" },
  ACTIVE: { badge: "border-emerald-100 bg-emerald-50 text-emerald-700", accent: "bg-emerald-500", bar: "bg-emerald-500" },
  WARNING: { badge: "border-amber-100 bg-amber-50 text-amber-700", accent: "bg-amber-500", bar: "bg-amber-500" },
  PAYMENT_REQUIRED: { badge: "border-red-100 bg-red-50 text-red-700", accent: "bg-red-500", bar: "bg-red-500" },
  PAYMENT_PENDING: { badge: "border-violet-100 bg-violet-50 text-violet-700", accent: "bg-violet-500", bar: "bg-violet-500" },
  CLOSED: { badge: "border-neutral-200 bg-neutral-100 text-neutral-500", accent: "bg-neutral-300", bar: "bg-neutral-300" },
};

function shortDate(value: string | null): string {
  if (!value) return "n/a";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function hoursSince(value: string): number {
  return Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000);
}

function clampPercent(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
}

export default function AdminNrmsBillingPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [openStatements, setOpenStatements] = useState<OpenStatement[]>([]);
  const [processingTokens, setProcessingTokens] = useState<ProcessingToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get("/api/admin/nrms/billing");
      setAccounts(res.data?.accounts ?? []);
      setOpenStatements(res.data?.openStatements ?? []);
      setProcessingTokens(res.data?.processingTokens ?? []);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load the billing board");
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

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => {
      const orderDiff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return orderDiff !== 0 ? orderDiff : b.unpaidBalance - a.unpaidBalance;
    }),
    [accounts],
  );

  const totals = useMemo(() => ({
    owed: accounts.reduce((sum, a) => sum + a.unpaidBalance, 0),
    payable: openStatements.reduce((sum, s) => sum + s.amount, 0),
    stuck: processingTokens.filter((t) => hoursSince(t.createdAt) >= 6).length,
  }), [accounts, openStatements, processingTokens]);

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5 px-4 py-6">
      <Link href="/admin/nrms" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline transition hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> NRMS directory</Link>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">PAYG</div>
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Wallet className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS commercial</p>
                <span className="inline-flex rounded-full border border-emerald-100 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm">Read-only</span>
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">PAYG billing board</h1>
              <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500 sm:text-sm">NoLSAF NRMS revenue: balances, open statements and in-flight payments.</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href="/admin/nrms/pricing" className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 text-xs font-bold text-emerald-800 no-underline shadow-sm transition hover:bg-white"><Coins className="h-4 w-4" /> Pricing &amp; levers</Link>
            <Link href="/admin/nrms/reconciliation" className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 text-xs font-bold text-emerald-800 no-underline shadow-sm transition hover:bg-white"><RefreshCw className="h-4 w-4" /> Reconciliation</Link>
            <Link href="/admin/nrms/integrity" className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white/85 px-3 py-2 text-xs font-bold text-neutral-700 no-underline shadow-sm transition hover:bg-white"><Activity className="h-4 w-4" /> Signals</Link>
          </div>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={Wallet} label="Total outstanding" value={`TZS ${totals.owed.toLocaleString()}`} detail={`Across ${accounts.length} PAYG accounts`} tone={totals.owed > 0 ? "amber" : "emerald"} />
        <SummaryCard icon={FileText} label="Open statements" value={`TZS ${totals.payable.toLocaleString()}`} detail={`${openStatements.length} awaiting payment`} tone="blue" />
        <SummaryCard icon={Clock3} label="Stuck payments (6h+)" value={String(totals.stuck)} detail={`${processingTokens.length} payments in flight`} tone={totals.stuck > 0 ? "amber" : "slate"} />
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={Building2} title="Accounts" subtitle="Sorted by urgency, then unpaid balance" right={<CountPill count={accounts.length} singular="account" plural="accounts" />} />

        <div className="divide-y divide-neutral-100 md:hidden">
          {sortedAccounts.map((a) => {
            const style = STATUS_STYLE[a.status] ?? STATUS_STYLE.CLOSED;
            return (
              <article key={a.id} className="relative min-w-0 py-3.5 pl-4 pr-4">
                <span className={`absolute inset-y-0 left-0 w-1 ${style.accent}`} aria-hidden="true" />
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-neutral-900"><span className="truncate">{a.propertyTitle}</span><span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${style.badge}`}>{a.status.replaceAll("_", " ")}</span></p>
                    <p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">{a.owner.name}{a.status === "TRIAL" && <span> · trial ends {shortDate(a.trialEndsAt)}</span>}</p>
                  </div>
                  <Link href={`/admin/nrms/${a.propertyId}`} className="shrink-0 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800 no-underline transition hover:bg-emerald-100">View</Link>
                </div>
                <div className="mt-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Unpaid</span>
                    <span className="text-xs font-bold tabular-nums text-neutral-800">{a.unpaidBalance.toLocaleString()} <span className="font-medium text-neutral-400">/ {a.unpaidLimit.toLocaleString()}</span></span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100 ring-1 ring-inset ring-neutral-200/70"><div className={`h-full rounded-full ${style.bar}`} style={{ width: `${clampPercent(a.unpaidBalance, a.unpaidLimit)}%` }} /></div>
                </div>
              </article>
            );
          })}
          {accounts.length === 0 && <EmptyState icon={Building2} title="No PAYG accounts" text="Accounts appear here once properties activate NRMS billing." />}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead><tr className="border-b border-neutral-100 text-[10px] font-bold uppercase tracking-wide text-neutral-400"><th className="px-4 py-2.5 sm:px-5">Property</th><th className="px-4 py-2.5">Owner</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Trial ends</th><th className="px-4 py-2.5 text-right">Unpaid</th><th className="px-4 py-2.5 text-right">Limit</th><th className="px-4 py-2.5 sm:px-5" /></tr></thead>
            <tbody>
              {sortedAccounts.map((a) => {
                const style = STATUS_STYLE[a.status] ?? STATUS_STYLE.CLOSED;
                return (
                  <tr key={a.id} className="border-b border-neutral-50 text-xs transition last:border-0 hover:bg-neutral-50/60">
                    <td className="max-w-[220px] truncate px-4 py-3 font-bold text-neutral-800 sm:px-5">{a.propertyTitle}</td>
                    <td className="max-w-[160px] truncate px-4 py-3 text-neutral-500">{a.owner.name}</td>
                    <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>{a.status.replaceAll("_", " ")}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{a.status === "TRIAL" ? shortDate(a.trialEndsAt) : "n/a"}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${a.unpaidBalance > 0 ? "font-bold text-neutral-900" : "text-neutral-400"}`}>{a.unpaidBalance.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{a.unpaidLimit.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right sm:px-5"><Link href={`/admin/nrms/${a.propertyId}`} className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800 no-underline transition hover:bg-emerald-100">View</Link></td>
                  </tr>
                );
              })}
              {accounts.length === 0 && <tr><td colSpan={7}><EmptyState icon={Building2} title="No PAYG accounts" text="Accounts appear here once properties activate NRMS billing." /></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <SectionHeader icon={FileText} title="Open statements" subtitle="Closed statements awaiting owner payment" right={<CountPill count={openStatements.length} singular="statement" plural="statements" />} />
          <div className="divide-y divide-neutral-50">
            {openStatements.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs transition hover:bg-neutral-50/60 sm:px-5">
                <div className="min-w-0"><p className="m-0 truncate font-bold text-neutral-800">{s.propertyTitle}</p><p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">Statement #{s.id} · closed {shortDate(s.closedAt)}</p></div>
                <span className="shrink-0 font-bold tabular-nums text-neutral-900">{s.currency} {s.amount.toLocaleString()}</span>
              </div>
            ))}
            {openStatements.length === 0 && <EmptyState icon={FileText} title="Nothing payable" text="Statements appear here once a billing period closes with a balance." />}
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <SectionHeader icon={Clock3} title="Payments in flight" subtitle="Owner payment tokens still processing" right={<CountPill count={processingTokens.length} singular="payment" plural="payments" />} />
          <div className="divide-y divide-neutral-50">
            {processingTokens.map((t) => {
              const hours = hoursSince(t.createdAt);
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs transition hover:bg-neutral-50/60 sm:px-5">
                  <div className="min-w-0"><p className="m-0 truncate font-bold text-neutral-800">{t.propertyTitle}</p><p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{t.method ?? "Method unknown"} · started {shortDate(t.createdAt)}</p></div>
                  <div className="shrink-0 text-right">
                    <span className="font-bold tabular-nums text-neutral-900">{t.currency} {t.amount.toLocaleString()}</span>
                    {hours >= 6 && <p className="mb-0 mt-0.5 rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[9px] font-bold text-red-700">Stuck {hours}h</p>}
                  </div>
                </div>
              );
            })}
            {processingTokens.length === 0 && <EmptyState icon={Clock3} title="No payments in flight" text="Owner payments show here while the mobile-money confirmation is pending." />}
          </div>
        </section>
      </div>
    </div>
  );
}
