"use client";

/**
 * Long-stay program dashboard (docs/LONG_STAY_RENTALS.md). Long stays are
 * their own program, like Group Stay and No4P Agents, not a corner of
 * Owners: this page is its home. It answers, in order:
 *   1. What is waiting on an admin right now (each links to its queue).
 *   2. Where every tenancy sits in the pipeline.
 *   3. The homes and the inspections behind them.
 *   4. Money held for tenants and fees earned, per currency.
 *   5. Who moves in next.
 */
import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, BadgeCheck, CalendarClock, ClipboardCheck, FileWarning, Gavel, Home, KeyRound,
  Loader2, MessageCircleQuestion, RefreshCw, Scale, ShieldCheck, ShieldOff, Users, Wallet,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type Counts = Record<string, number>;
type Overview = {
  open: boolean;
  landlords: { on: number; paused: number };
  listings: Counts;
  tenancies: Counts;
  payouts: Counts;
  inspections: Counts;
  tenantIds: Counts;
  enquiries: Counts;
  claims: Counts;
  mismatches: number;
  /** Partners asking to switch long stay on for an owner. */
  accessRequests?: number;
  money: Array<{ currency: string; held: number; earned: number; rentUnderLease: number }>;
  moveIns: Array<{ ref: string; status: string; moveInDate: string | null; termMonths: number | null; rent: { amount: number; currency: string } | null; home: string | null; area: string; tenant: string | null }>;
};
type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const n = (c: Counts | undefined, ...keys: string[]) => keys.reduce((sum, k) => sum + (c?.[k] ?? 0), 0);
const money = (amount: number, currency: string) => `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");
const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" }) + "T00:00:00Z").getTime();
  return Math.round((new Date(`${iso}T00:00:00Z`).getTime() - today) / 86_400_000);
};

/** Pipeline stages in the order a tenancy moves through them. */
const STAGES: Array<{ key: string; label: string; hint: string }> = [
  { key: "OFFERED", label: "Reserved, waiting landlord", hint: "24 hours to confirm" },
  { key: "ACCEPTED", label: "Lease out", hint: "Both sides sign" },
  { key: "AWAITING_PAYMENT", label: "Waiting for payment", hint: "48 hours to pay" },
  { key: "RESERVED", label: "Paid, home reserved", hint: "First month held" },
  { key: "MOVE_IN", label: "Moving in", hint: "72-hour confirmation" },
  { key: "ACTIVE", label: "Living there", hint: "Lease running" },
  { key: "ENDING", label: "Notice given", hint: "Leaving soon" },
];

export default function LongStayDashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<Overview>("/api/admin/long-stay/overview");
      setData(response.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not load the long-stay overview.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const t = data?.tenancies;
  const live = n(t, "ACTIVE", "ENDING", "MOVE_IN", "RESERVED");
  const moving14 = data?.moveIns.length ?? 0;

  const queue: Array<{ label: string; hint: string; count: number; href: string; Icon: Icon; tone: "warn" | "bad" | "info" }> = data ? [
    { label: "Long stay requests", hint: "Partners asking for an owner", count: data.accessRequests ?? 0, href: "/admin/long-stay/requests", Icon: KeyRound, tone: "warn" },
    { label: "Tenant IDs to check", hint: "Approve before a tenant can pay", count: n(data.tenantIds, "PENDING"), href: "/admin/long-stay/tenants", Icon: ShieldCheck, tone: "warn" },
    { label: "Homes waiting for a partner", hint: "Assign a Sales Partner to inspect", count: n(data.inspections, "REQUESTED"), href: "/admin/long-stay/inspections", Icon: ClipboardCheck, tone: "warn" },
    { label: "Inspection reports to review", hint: "Pass, fail or send back", count: n(data.inspections, "SUBMITTED"), href: "/admin/long-stay/inspections", Icon: BadgeCheck, tone: "warn" },
    { label: "Visits overdue", hint: "Partner missed the 5 days", count: n(data.inspections, "OVERDUE"), href: "/admin/long-stay/inspections", Icon: CalendarClock, tone: "bad" },
    { label: "Payouts to approve", hint: "First month after move-in", count: n(data.payouts, "READY", "REVIEW"), href: "/admin/long-stay/tenancies", Icon: Wallet, tone: "warn" },
    { label: "Disputes", hint: "Decide where the money goes", count: n(t, "DISPUTED"), href: "/admin/long-stay/tenancies", Icon: Gavel, tone: "bad" },
    { label: "Balance mismatches", hint: "Move-in amounts disagree", count: data.mismatches, href: "/admin/long-stay/tenancies", Icon: Scale, tone: "bad" },
    { label: "Overdue stays", hint: "Past the end, no move-out", count: n(t, "OVERDUE"), href: "/admin/long-stay/tenancies", Icon: FileWarning, tone: "bad" },
    { label: "Refunds owed by landlords", hint: "Claims open or recovering", count: n(data.claims, "OPEN", "RECOVERING"), href: "/admin/long-stay/tenancies", Icon: AlertTriangle, tone: "warn" },
    { label: "Ask NoLSAF", hint: "Tenant questions and visits", count: n(data.enquiries, "OPEN"), href: "/admin/long-stay/enquiries", Icon: MessageCircleQuestion, tone: "info" },
  ] : [];
  const waiting = queue.reduce((s, q) => s + q.count, 0);
  const stageMax = Math.max(1, ...STAGES.map((s) => n(t, s.key)));

  return (
    <div id="ls-dashboard" className="w-full min-w-0 space-y-4">
      <style>{`#ls-dashboard, #ls-dashboard * { box-sizing: border-box; }`}</style>

      {/* Program floor, in the No4P Agents style */}
      <section className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_100%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "18px 18px" }} aria-hidden />
        <div className="relative px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
                <Home className="h-3.5 w-3.5" /> Long stays
                {data ? (
                  <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal ${data.open ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${data.open ? "bg-emerald-400" : "bg-amber-400"}`} />{data.open ? "Open for bookings" : "Bookings closed"}
                  </span>
                ) : null}
              </p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Long-stay program</h1>
              <p className="m-0 mt-1 max-w-xl text-sm text-white/60">Monthly rentals from reservation to move-out: tenant checks, inspections, leases, payments and payouts.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/admin/long-stay/payments" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-white/15 bg-white/[0.06] px-3 text-[12.5px] font-semibold text-white no-underline hover:bg-white/[0.12]"><Wallet className="h-3.5 w-3.5" />Payments</Link>
              <Link href="/admin/long-stay/tenancies" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-white/15 bg-white/[0.06] px-3 text-[12.5px] font-semibold text-white no-underline hover:bg-white/[0.12]"><Home className="h-3.5 w-3.5" />Tenancies</Link>
              <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh" title="Refresh"
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-solid border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.12] disabled:opacity-60">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "Waiting on you", value: waiting, hint: waiting ? "Items to act on" : "All clear", tone: waiting ? "text-amber-300" : "text-emerald-300" },
              { label: "Live tenancies", value: live, hint: "Reserved to notice given", tone: "text-white" },
              { label: "Moving in, 14 days", value: moving14, hint: moving14 ? "See the list below" : "None coming up", tone: "text-white" },
              { label: "Live homes", value: data ? n(data.listings, "APPROVED") : 0, hint: data ? `${n(data.listings, "PENDING")} waiting approval` : "", tone: "text-white" },
              { label: "Landlords on", value: data?.landlords.on ?? 0, hint: data?.landlords.paused ? `${data.landlords.paused} paused` : "None paused", tone: "text-white" },
            ].map((m) => (
              <div key={m.label} className="min-w-0 rounded-md bg-white/[0.04] px-3.5 py-3 ring-1 ring-inset ring-white/10">
                <dt className="truncate text-[11px] font-semibold text-white/55">{m.label}</dt>
                <dd className={`m-0 mt-1 text-2xl font-bold tabular-nums leading-none ${m.tone}`}>{data ? m.value : "-"}</dd>
                <p className="m-0 mt-1.5 truncate text-[11px] text-white/40">{m.hint}</p>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {error ? <p className="m-0 rounded-md bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p> : null}
      {data && !data.open ? (
        <p className="m-0 flex items-start gap-2 rounded-md border border-solid border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          <ShieldOff className="mt-0.5 h-4 w-4 flex-none" />
          Long-stay bookings are closed (LONG_STAY_OPEN is off). Landlords can prepare listings and partners can inspect, but no home can be approved or reserved yet.
        </p>
      ) : null}

      {!data ? (
        loading ? <div className="grid min-h-48 place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : null
      ) : (
        <>
          {/* 1. Work queues: what needs you first, every queue listed, nothing cut off */}
          <section className="rounded-lg border border-solid border-slate-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
              <div>
                <h2 className="m-0 text-[15px] font-bold text-slate-900">Work queues</h2>
                <p className="m-0 text-[12px] text-slate-500">{waiting ? `${waiting} ${waiting === 1 ? "item needs" : "items need"} you; the rest are clear` : "Every queue is clear"}</p>
              </div>
              <span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12px] font-semibold ${waiting ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                {waiting ? <AlertTriangle className="h-3.5 w-3.5" /> : <BadgeCheck className="h-3.5 w-3.5" />}{queue.filter((q) => q.count === 0).length} of {queue.length} clear
              </span>
            </header>
            <ul className="m-0 grid list-none p-0 lg:grid-cols-2">
              {[...queue].sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || Number(b.tone === "bad") - Number(a.tone === "bad") || b.count - a.count).map((q) => {
                const due = q.count > 0;
                const iconCls = !due ? "bg-slate-100 text-slate-400" : q.tone === "bad" ? "bg-red-50 text-red-600" : q.tone === "warn" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700";
                return (
                  <li key={q.label} className="border-0 border-b border-solid border-slate-100 lg:odd:border-r">
                    <Link href={q.href} className={`group flex items-center gap-3 px-4 py-3 no-underline ${due ? "hover:bg-slate-50" : "hover:bg-slate-50/60"}`}>
                      <span className={`grid h-9 w-9 flex-none place-items-center rounded-md ${iconCls}`}><q.Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13.5px] font-semibold ${due ? "text-slate-900" : "text-slate-500"}`}>{q.label}</span>
                        <span className="block text-[12px] text-slate-500">{q.hint}</span>
                      </span>
                      {due ? (
                        <>
                          <span className={`min-w-[2.25rem] rounded-md px-2 py-1 text-center text-[15px] font-bold tabular-nums ${q.tone === "bad" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{q.count}</span>
                          <span className="inline-flex h-8 flex-none items-center gap-1 rounded-md bg-[#02665e] px-3 text-[12.5px] font-semibold text-white group-hover:bg-[#014e47]">Open<ArrowRight className="h-3.5 w-3.5" /></span>
                        </>
                      ) : (
                        <span className="inline-flex flex-none items-center gap-1 text-[12px] font-medium text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" />Clear</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* 2. Pipeline */}
            <section className="rounded-lg border border-solid border-slate-200 bg-white">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
                <h2 className="m-0 text-[15px] font-bold text-slate-900">Tenancy pipeline</h2>
                <Link href="/admin/long-stay/tenancies" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#02665e] no-underline hover:underline">All tenancies<ArrowRight className="h-3.5 w-3.5" /></Link>
              </header>
              <ol className="m-0 list-none space-y-2.5 p-4">
                {STAGES.map((s, i) => {
                  const count = n(t, s.key);
                  return (
                    <li key={s.key} className="grid grid-cols-[22px_minmax(0,190px)_minmax(0,1fr)_40px] items-center gap-3">
                      <span className={`grid h-[22px] w-[22px] place-items-center rounded-full text-[10.5px] font-bold ${count ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-400"}`}>{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-slate-800">{s.label}</span>
                        <span className="block text-[11px] text-slate-400">{s.hint}</span>
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-[#02665e]" style={{ width: `${(count / stageMax) * 100}%` }} />
                      </span>
                      <span className="text-right text-[14px] font-bold tabular-nums text-slate-900">{count}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="flex flex-wrap gap-x-5 gap-y-1 border-0 border-t border-solid border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
                <span>Ended <b className="text-slate-800">{n(t, "ENDED")}</b></span>
                <span>Cancelled <b className="text-slate-800">{n(t, "CANCELLED")}</b></span>
                <span>Disputed <b className={n(t, "DISPUTED") ? "text-red-600" : "text-slate-800"}>{n(t, "DISPUTED")}</b></span>
                <span>Overdue <b className={n(t, "OVERDUE") ? "text-red-600" : "text-slate-800"}>{n(t, "OVERDUE")}</b></span>
              </div>
            </section>

            {/* 3. Homes and inspections */}
            <section className="rounded-lg border border-solid border-slate-200 bg-white">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
                <h2 className="m-0 text-[15px] font-bold text-slate-900">Homes and inspections</h2>
                <Link href="/admin/long-stay/inspections" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#02665e] no-underline hover:underline">Inspections<ArrowRight className="h-3.5 w-3.5" /></Link>
              </header>
              <div className="grid grid-cols-2 gap-px bg-slate-100">
                {[
                  { label: "Live homes", value: n(data.listings, "APPROVED"), Icon: Home },
                  { label: "Waiting approval", value: n(data.listings, "PENDING"), Icon: ClipboardCheck },
                  { label: "Drafts", value: n(data.listings, "DRAFT"), Icon: KeyRound },
                  { label: "Landlords switched on", value: data.landlords.on, Icon: Users },
                ].map((m) => (
                  <div key={m.label} className="flex items-center gap-3 bg-white px-4 py-3">
                    <m.Icon className="h-4 w-4 flex-none text-[#02665e]" />
                    <span className="min-w-0 flex-1 text-[12.5px] text-slate-500">{m.label}</span>
                    <span className="text-[16px] font-bold tabular-nums text-slate-900">{m.value}</span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3">
                <p className="m-0 mb-2 text-[11.5px] font-semibold text-slate-500">Inspections</p>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                  {([["PASSED", "bg-emerald-500"], ["SUBMITTED", "bg-violet-500"], ["ASSIGNED", "bg-sky-500"], ["REQUESTED", "bg-amber-400"], ["FAILED", "bg-red-500"]] as const).map(([k, cls]) => {
                    const total = n(data.inspections, "PASSED", "SUBMITTED", "ASSIGNED", "REQUESTED", "FAILED") || 1;
                    const v = n(data.inspections, k);
                    return v ? <span key={k} className={cls} style={{ width: `${(v / total) * 100}%` }} /> : null;
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-600">
                  {([["Passed", "PASSED", "bg-emerald-500"], ["To review", "SUBMITTED", "bg-violet-500"], ["Visit booked", "ASSIGNED", "bg-sky-500"], ["No partner", "REQUESTED", "bg-amber-400"], ["Failed", "FAILED", "bg-red-500"]] as const).map(([label, k, cls]) => (
                    <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${cls}`} />{label} <b className="tabular-nums text-slate-900">{n(data.inspections, k)}</b></span>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {/* 4. Money */}
            <section className="rounded-lg border border-solid border-slate-200 bg-white">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
                <h2 className="m-0 text-[15px] font-bold text-slate-900">Money</h2>
                <Link href="/admin/long-stay/payments" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#02665e] no-underline hover:underline">All payments<ArrowRight className="h-3.5 w-3.5" /></Link>
              </header>
              {data.money.length === 0 ? (
                <p className="m-0 px-4 py-6 text-center text-[13px] text-slate-500">No long-stay payments yet.</p>
              ) : (
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-[11.5px] text-slate-500">
                      <th className="px-4 py-2 font-semibold">Currency</th>
                      <th className="px-4 py-2 text-right font-semibold" title="Paid by tenants, payout not yet released">Held now</th>
                      <th className="px-4 py-2 text-right font-semibold" title="Tenant fees and landlord commission on moved-in tenancies">Fees earned</th>
                      <th className="px-4 py-2 text-right font-semibold" title="Monthly rent times term on paid tenancies">Rent under lease</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.money.map((m) => (
                      <tr key={m.currency} className="border-0 border-t border-solid border-slate-100">
                        <td className="px-4 py-2.5 font-semibold text-slate-800">{m.currency}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{money(m.held, m.currency)}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[#02665e]">{money(m.earned, m.currency)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{money(m.rentUnderLease, m.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* 5. Next move-ins */}
            <section className="rounded-lg border border-solid border-slate-200 bg-white">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
                <h2 className="m-0 text-[15px] font-bold text-slate-900">Moving in, next 14 days</h2>
                <span className="text-[12.5px] text-slate-500">{moving14} {moving14 === 1 ? "tenancy" : "tenancies"}</span>
              </header>
              {data.moveIns.length === 0 ? (
                <p className="m-0 px-4 py-6 text-center text-[13px] text-slate-500">No move-ins in the next two weeks.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {data.moveIns.map((m) => {
                    const d = daysUntil(m.moveInDate);
                    return (
                      <li key={m.ref} className="border-0 border-t border-solid border-slate-100 first:border-t-0">
                        <Link href={`/admin/long-stay/tenancies?ref=${encodeURIComponent(m.ref)}`} className="flex items-center gap-3 px-4 py-2.5 no-underline hover:bg-slate-50">
                          <span className={`grid h-10 w-12 flex-none place-items-center rounded-md text-center leading-tight ${d !== null && d <= 0 ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-700"}`}>
                            <span className="text-[10.5px] font-semibold">{d === null ? "" : d < 0 ? `${-d}d ago` : d === 0 ? "Today" : `in ${d}d`}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-semibold text-slate-900">{m.home || "Long-stay home"}</span>
                            <span className="block truncate text-[12px] text-slate-500">{m.tenant || "Tenant"} · {day(m.moveInDate)}{m.termMonths ? ` · ${m.termMonths} months` : ""}{m.area ? ` · ${m.area}` : ""}</span>
                          </span>
                          {m.rent ? <span className="flex-none text-right text-[12.5px] font-semibold tabular-nums text-slate-700">{money(m.rent.amount, m.rent.currency)}<span className="block text-[10.5px] font-normal text-slate-400">a month</span></span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
