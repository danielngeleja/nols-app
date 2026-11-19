"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { Activity, AlertTriangle, ArrowLeft, Building2, CheckCircle2, ChevronRight, Clock3, Coins, Eye, FileText, Loader2, RefreshCw, Search, Wallet } from "lucide-react";
import { CountPill, EmptyState, SectionHeader } from "../_components/CommercialUi";
import { useAdminHref } from "@/lib/adminRecordRefs";

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
  const recordHref = useAdminHref();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [openStatements, setOpenStatements] = useState<OpenStatement[]>([]);
  const [processingTokens, setProcessingTokens] = useState<ProcessingToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
    () => accounts.filter(a => `${a.propertyTitle} ${a.owner.name} ${a.status.replaceAll('_', ' ')}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => {
      const orderDiff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return orderDiff !== 0 ? orderDiff : b.unpaidBalance - a.unpaidBalance;
    }),
    [accounts, query],
  );

  const totals = useMemo(() => ({
    owed: accounts.reduce((sum, a) => sum + a.unpaidBalance, 0),
    payable: openStatements.reduce((sum, s) => sum + s.amount, 0),
    stuck: processingTokens.filter((t) => hoursSince(t.createdAt) >= 6).length,
  }), [accounts, openStatements, processingTokens]);
  const inFlightAmount = useMemo(() => processingTokens.reduce((sum, t) => sum + t.amount, 0), [processingTokens]);
  const paymentRequired = useMemo(() => accounts.filter((a) => a.status === "PAYMENT_REQUIRED").length, [accounts]);

  if (loading) return <div role="status" className="w-full px-5 py-6"><div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading PAYG balances and payment activity…</div><div className="mt-4 h-24 animate-pulse rounded-xl bg-slate-100" /><div className="mt-4 h-48 animate-pulse rounded-xl bg-slate-50" /></div>;

  return (
    <div id="nrms-billing-board" className="w-full min-w-0 max-w-none space-y-4">
      {/* Identity band with money in motion, in the operator-record language */}
      <section className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_0%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden="true" />
        <div className="relative grid min-w-0 gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:items-center">
          <div className="min-w-0">
            <Link href="/admin/nrms" className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/45 no-underline transition hover:text-emerald-300">
              <ArrowLeft className="h-3 w-3" aria-hidden /> NRMS directory
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/80">NRMS commercial</p>
              <span className="inline-flex items-center gap-1 rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-white/70"><Eye className="h-3 w-3" aria-hidden /> Read-only</span>
            </div>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">PAYG billing board</h1>
            <p className="m-0 mt-1 text-[12px] text-white/60">NoLSAF NRMS revenue: balances, open statements and in-flight payments.</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {error ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-bold text-rose-200"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Figures unavailable</span>
              ) : (
                <>
                  {totals.stuck > 0 ? (
                    <span className="inline-flex items-center gap-2 rounded-md bg-amber-400/15 px-2.5 py-1.5 text-[11px] font-bold text-amber-200">
                      <span className="relative flex h-2 w-2" aria-hidden><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" /></span>
                      {totals.stuck} payment{totals.stuck === 1 ? "" : "s"} stuck over 6 hours
                    </span>
                  ) : null}
                  {paymentRequired > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-bold text-rose-200"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {paymentRequired} account{paymentRequired === 1 ? "" : "s"} at payment required</span>
                  ) : null}
                  {!totals.stuck && !paymentRequired ? (
                    <span className="inline-flex items-center gap-2 rounded-md bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-200"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Payments moving, no account blocked</span>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* Money in motion: where NRMS revenue sits right now */}
          <div className="min-w-0 rounded-md bg-white/[0.04] p-4 ring-1 ring-white/10">
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Money in motion</p>
              <p className="m-0 text-[11px] text-white/55">TZS</p>
            </div>
            <ol className="m-0 mt-3 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch sm:gap-1.5">
              {[
                { key: "accruing", label: "Accruing", value: totals.owed, sub: `${accounts.filter((a) => a.unpaidBalance > 0).length} of ${accounts.length} accounts`, dot: "bg-amber-400" },
                { key: "billed", label: "Billed", value: totals.payable, sub: `${openStatements.length} statement${openStatements.length === 1 ? "" : "s"} unpaid`, dot: "bg-sky-400" },
                { key: "flight", label: "In flight", value: inFlightAmount, sub: totals.stuck ? `${totals.stuck} stuck 6h+` : `${processingTokens.length} processing`, dot: totals.stuck ? "bg-rose-400" : "bg-emerald-400" },
              ].flatMap((stage, index, all) => {
                const tile = (
                  <li key={stage.key} className="min-w-0 rounded bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/10">
                    <p className="m-0 flex items-center gap-1.5 text-[10px] font-semibold text-white/55"><span className={`h-1.5 w-1.5 rounded-full ${stage.dot}`} aria-hidden /> {stage.label}</p>
                    <p className={`m-0 mt-1 truncate text-lg font-black tabular-nums tracking-tight ${stage.value ? "text-white" : "text-white/35"}`}>{error ? "-" : stage.value.toLocaleString()}</p>
                    <p className="m-0 truncate text-[10px] text-white/40">{stage.sub}</p>
                  </li>
                );
                return index < all.length - 1
                  ? [tile, <li key={`${stage.key}-arrow`} aria-hidden className="hidden items-center justify-center text-white/25 sm:flex"><ChevronRight className="h-4 w-4" /></li>]
                  : [tile];
              })}
            </ol>
          </div>
        </div>

        {/* Related workspaces and actions */}
        <div className="relative flex min-w-0 flex-wrap items-center gap-2 border-0 border-t border-solid border-white/10 px-3 py-2 sm:px-5">
          <nav aria-label="Billing workspaces" className="flex min-w-0 gap-1 overflow-x-auto">
            {[
              { href: "/admin/nrms/pricing", label: "Pricing & levers", Icon: Coins },
              { href: "/admin/nrms/reconciliation", label: "Reconciliation", Icon: RefreshCw },
              { href: "/admin/nrms/integrity", label: "Signals", Icon: Activity },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href} className="group inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-[12px] font-semibold text-white/70 no-underline transition hover:bg-white/[0.08] hover:text-white">
                <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-300/70 group-hover:text-emerald-300" aria-hidden />
                {label}
                <ChevronRight className="h-3 w-3 shrink-0 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-white/60" aria-hidden />
              </Link>
            ))}
          </nav>
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('finance-grant-required'))}
              className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-md border-0 bg-white/[0.08] px-4 text-xs font-bold text-white transition hover:bg-white/15 sm:flex-none"
            >
              Verify finance access
            </button>
            <button
              type="button"
              onClick={() => void load()}
              aria-label="Refresh billing board"
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-white/[0.08] text-white transition hover:bg-white/15"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}

      {/* Summary, joined cells like the operator statement's money strip */}
      <section aria-label="Billing summary" className="grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-3">
        {[
          { Icon: Wallet, label: "Total outstanding", value: error ? "Unavailable" : `TZS ${totals.owed.toLocaleString()}`, detail: `Across ${accounts.length} PAYG accounts`, ink: totals.owed > 0 ? "text-amber-600" : "text-emerald-700", iconTone: totals.owed > 0 ? "text-amber-500" : "text-neutral-300" },
          { Icon: FileText, label: "Open statements", value: error ? "Unavailable" : `TZS ${totals.payable.toLocaleString()}`, detail: `${openStatements.length} awaiting payment`, ink: totals.payable > 0 ? "text-sky-700" : "text-neutral-400", iconTone: "text-neutral-300" },
          { Icon: Clock3, label: "Stuck payments (6h+)", value: error ? "Unavailable" : String(totals.stuck), detail: `${processingTokens.length} payments in flight`, ink: totals.stuck > 0 ? "text-rose-600" : "text-neutral-400", iconTone: totals.stuck > 0 ? "text-rose-500" : "text-neutral-300" },
        ].map(({ Icon, label, value, detail, ink, iconTone }) => (
          <div key={label} className="min-w-0 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-semibold text-neutral-500">{label}</p>
              <Icon className={`h-4 w-4 shrink-0 ${iconTone}`} aria-hidden />
            </div>
            <p className={`m-0 mt-1 break-words text-lg font-black tabular-nums tracking-tight ${error ? "text-neutral-300" : ink}`}>{value}</p>
            <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400">{detail}</p>
          </div>
        ))}
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={Building2} title="Accounts" subtitle="Sorted by urgency, then unpaid balance" right={<CountPill count={accounts.length} singular="account" plural="accounts" />} />
        <div className="border-b border-slate-200 px-4 py-3"><label className="relative block w-full min-w-0"><span className="sr-only">Search billing accounts</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search property, owner or billing status" className="box-border w-full min-w-0 rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label></div>

        <div className="divide-y divide-neutral-100 md:hidden">
          {sortedAccounts.map((a) => {
            const style = STATUS_STYLE[a.status] ?? STATUS_STYLE.CLOSED;
            return (
              <article key={a.id} className="relative min-w-0 py-3.5 pl-4 pr-4">
                <span className={`absolute inset-y-0 left-0 w-1 ${style.accent}`} aria-hidden="true" />
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-neutral-900"><span className="truncate">{a.propertyTitle}</span><span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${style.badge}`}>{a.status.replaceAll("_", " ")}</span></p>
                    <p className="mb-0 mt-1 text-[10px] text-neutral-400">{a.owner.name}<span> · trial ends {a.trialEndsAt ? shortDate(a.trialEndsAt) : "Not recorded"}</span></p>
                  </div>
                  <Link href={recordHref("property", a.propertyId)} className="shrink-0 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800 no-underline transition hover:bg-emerald-100">View</Link>
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
          {!error && sortedAccounts.length === 0 && <EmptyState icon={Building2} title={query ? 'No matching accounts' : 'No PAYG accounts'} text={query ? 'Try another property, owner or status.' : 'Accounts appear here once properties activate NRMS billing.'} />}
        </div>

        <div className="hidden w-full min-w-0 max-w-full overflow-x-auto md:block">
          <table className="billing-account-register w-full min-w-[1000px] table-fixed border-collapse text-left">
            <caption className="sr-only">PAYG billing accounts</caption>
            <colgroup>{[19, 17, 19, 15, 11, 10, 9].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
            <thead><tr className="border-b border-neutral-100 text-[10px] font-bold uppercase tracking-wide text-neutral-400"><th scope="col" className="px-4 py-2.5 sm:px-5">Property</th><th scope="col" className="px-4 py-2.5">Owner</th><th scope="col" className="px-4 py-2.5">Status</th><th scope="col" className="px-4 py-2.5">Trial ends</th><th scope="col" className="px-4 py-2.5 text-right">Unpaid (TZS)</th><th scope="col" className="px-4 py-2.5 text-right">Limit (TZS)</th><th scope="col" className="px-4 py-2.5 text-right">Details</th></tr></thead>
            <tbody>
              {sortedAccounts.map((a) => {
                const style = STATUS_STYLE[a.status] ?? STATUS_STYLE.CLOSED;
                return (
                  <tr key={a.id} className="border-b border-neutral-50 text-xs transition last:border-0 hover:bg-neutral-50/60">
                    <td className="max-w-[220px] truncate px-4 py-3 font-bold text-neutral-800 sm:px-5">{a.propertyTitle}</td>
                    <td className="max-w-[160px] truncate px-4 py-3 text-neutral-500">{a.owner.name}</td>
                    <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>{a.status.replaceAll("_", " ")}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{a.trialEndsAt ? shortDate(a.trialEndsAt) : "Not recorded"}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${a.unpaidBalance > 0 ? "font-bold text-neutral-900" : "text-neutral-400"}`}>{a.unpaidBalance.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{a.unpaidLimit.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right sm:px-5"><Link href={recordHref("property", a.propertyId)} className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800 no-underline transition hover:bg-emerald-100">View</Link></td>
                  </tr>
                );
              })}
              {!error && sortedAccounts.length === 0 && <tr><td colSpan={7}><EmptyState icon={Building2} title={query ? 'No matching accounts' : 'No PAYG accounts'} text={query ? 'Try another property, owner or status.' : 'Accounts appear here once properties activate NRMS billing.'} /></td></tr>}
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
