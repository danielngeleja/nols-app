"use client";

/**
 * Sales overview: the partner's whole picture on one calm screen.
 *  1. Key figures, one joined panel (properties, conversions, earned, available)
 *  2. This month: leaderboard place, target progress, quick actions
 *  3. Earnings and performance
 *  4. Attributed properties and notifications
 * Flat surfaces, hairline borders, modest corners. Extra sections (rank, ID
 * card, team) load independently, so one being unavailable never blanks the page.
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUp,
  Bell,
  Building2,
  CalendarClock,
  IdCard,
  Loader2,
  Percent,
  Plus,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  WalletCards,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import apiClient from "@/lib/apiClient";
import { codeLabel, statusTone, type SalesMe } from "@/components/SalesShell";

type DashboardMe = SalesMe & {
  payout?: { name: string | null; method: string | null; accountMasked: string | null };
};

type EarningsSummary = {
  pending: number;
  available: number;
  paid: number;
  totalEarned: number;
  thisMonth: number;
  count: number;
  currency: string;
  byStream: Record<string, number>;
};

type ChartPoint = { date: string; NRMS_USAGE: number; MARKETPLACE_BOOKING: number; other: number };

type PropertyRow = {
  id: number;
  ref: string;
  title: string;
  status: string;
  city: string | null;
  district: string | null;
  regionName: string | null;
  nrmsActivatedAt: string | null;
  totalEarnings: number;
  currency: string;
  salesAttributions: Array<{ id: number; productType: string; status: string; attributedAt: string }>;
};

type NotificationRow = {
  id: number | string;
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
  meta?: { actionPath?: string } | null;
};

type MonthStanding = {
  rank: number | null;
  total: number;
  points: number;
  movement: number;
  target: { goal: number; confirmed: number };
  gap: { rank: number; points: number } | null;
};

type DashboardData = {
  me: DashboardMe;
  summary: EarningsSummary;
  chart: ChartPoint[];
  properties: PropertyRow[];
  totalProperties: number;
  nrmsProperties: number;
  marketplaceProperties: number;
  totalLeads: number;
  convertedLeads: number;
  conversionRequests: number;
  notifications: NotificationRow[];
  totalUnread: number;
  standing: MonthStanding | null;
  cardValid: boolean | null;
  isTeamLead: boolean;
};

const STREAMS = [
  { key: "NRMS_USAGE", label: "NRMS commission", color: "#16a34a" },
  { key: "MARKETPLACE_BOOKING", label: "Marketplace share", color: "#02665e" },
  { key: "OTHER", label: "Other earnings", color: "#d4a017" },
] as const;

const card = "min-w-0 rounded-lg border border-solid border-slate-200 bg-white";

function money(value: number, currency = "TZS"): string {
  return `${currency === "TZS" ? "TSh" : currency} ${Math.round(Number(value || 0)).toLocaleString("en-US")}`;
}

function relativeTime(value: string): string {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function titleCase(value: string | null | undefined): string {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bEs\b/g, "es");
}

/** One cell of the joined key-figures panel. */
function Figure({ icon: Icon, label, value, note, children }: { icon: typeof Building2; label: string; value: string | number; note?: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col bg-white p-4">
      <p className="m-0 flex items-center gap-1.5 truncate text-[12px] font-medium text-slate-500">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden /> {label}
      </p>
      <p className="m-0 mt-1.5 truncate text-[22px] font-bold tracking-tight tabular-nums text-slate-900">{value}</p>
      {note ? <p className="m-0 mt-0.5 truncate text-[12px] text-slate-500">{note}</p> : null}
      {children}
    </div>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold text-slate-900">{children}</h2>
      {action}
    </div>
  );
}

const linkAction = "text-[13px] font-semibold text-[#02665e] no-underline hover:underline";

export default function SalesOverviewDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    (async () => {
      setLoading(true);
      setError("");
      try {
        const [me, summary, chart, properties, nrms, marketplace, leads, converted, conversion, notifications] = await Promise.all([
          apiClient.get("/api/sales/me"),
          apiClient.get("/api/sales/earnings/summary"),
          apiClient.get("/api/sales/earnings/chart", { params: { from: monthStart.toISOString(), to: new Date().toISOString() } }),
          apiClient.get("/api/sales/properties", { params: { page: 1, pageSize: 5 } }),
          apiClient.get("/api/sales/properties", { params: { page: 1, pageSize: 1, product: "NRMS" } }),
          apiClient.get("/api/sales/properties", { params: { page: 1, pageSize: 1, product: "MARKETPLACE" } }),
          apiClient.get("/api/sales/leads", { params: { page: 1, pageSize: 1 } }),
          apiClient.get("/api/sales/leads", { params: { page: 1, pageSize: 1, status: "CONVERTED" } }),
          apiClient.get("/api/sales/leads", { params: { page: 1, pageSize: 1, status: "CONVERSION_REQUESTED" } }),
          apiClient.get("/api/sales/notifications", { params: { tab: "unread", page: 1, pageSize: 4 } }),
        ]);
        // Optional extras: never allowed to blank the overview.
        const [board, idCard, team] = await Promise.allSettled([
          apiClient.get("/api/sales/leaderboard", { params: { period: "month", scope: "national" } }),
          apiClient.get("/api/sales/id-card"),
          apiClient.get("/api/sales/team/status"),
        ]);
        if (cancelled) return;
        const boardMe = board.status === "fulfilled" ? board.value.data?.me : null;
        setData({
          me: me.data,
          summary: summary.data?.summary,
          chart: chart.data?.points || [],
          properties: properties.data?.properties || [],
          totalProperties: Number(properties.data?.total || 0),
          nrmsProperties: Number(nrms.data?.total || 0),
          marketplaceProperties: Number(marketplace.data?.total || 0),
          totalLeads: Number(leads.data?.total || 0),
          convertedLeads: Number(converted.data?.total || 0),
          conversionRequests: Number(conversion.data?.total || 0),
          notifications: notifications.data?.items || [],
          totalUnread: Number(notifications.data?.totalUnread || 0),
          standing: boardMe
            ? { rank: boardMe.rank, total: Number(board.status === "fulfilled" ? board.value.data?.total : 0), points: boardMe.points, movement: boardMe.movement, target: boardMe.target, gap: boardMe.gap }
            : null,
          cardValid: idCard.status === "fulfilled" ? (idCard.value.data?.card ? idCard.value.data.card.validity === "VALID" : false) : null,
          isTeamLead: team.status === "fulfilled" ? Boolean(team.value.data?.isTeamLead) : false,
        });
      } catch (cause: any) {
        if (!cancelled) setError(cause?.response?.data?.error || "Could not load the Sales overview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const cumulativeChart = useMemo(() => {
    let nrms = 0;
    let marketplace = 0;
    let other = 0;
    return (data?.chart || []).map((point) => {
      nrms += Number(point.NRMS_USAGE || 0);
      marketplace += Number(point.MARKETPLACE_BOOKING || 0);
      other += Number(point.other || 0);
      return {
        ...point,
        label: new Date(`${point.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }),
        total: nrms + marketplace + other,
      };
    });
  }, [data?.chart]);

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-[#02665e]">
        <div className="text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /><p className="mb-0 mt-3 text-sm text-slate-500">Preparing your Sales overview…</p></div>
      </div>
    );
  }

  if (error || !data) {
    return <p className="m-0 rounded-md border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error || "Sales overview is unavailable."}</p>;
  }

  const { me, summary, properties, notifications, standing } = data;
  const conversionRate = data.totalLeads > 0 ? Math.round((data.convertedLeads / data.totalLeads) * 100) : 0;
  const otherEarnings = Number(summary.byStream?.PERFORMANCE_BONUS || 0) + Number(summary.byStream?.MANUAL_ADJUSTMENT || 0);
  const streams = STREAMS.map((stream) => ({ ...stream, value: stream.key === "OTHER" ? otherEarnings : Number(summary.byStream?.[stream.key] || 0) }));
  const streamTotal = streams.reduce((sum, s) => sum + s.value, 0);
  const canWithdraw = Number(summary.available || 0) > 0;
  const productMix = [data.nrmsProperties ? `NRMS ${data.nrmsProperties}` : null, data.marketplaceProperties ? `Marketplace ${data.marketplaceProperties}` : null].filter(Boolean).join(" · ");
  const targetPct = standing ? Math.min(100, Math.round((standing.target.confirmed / Math.max(1, standing.target.goal)) * 100)) : 0;

  return (
    <div id="sales-overview-dashboard" className="space-y-4">
      <style>{`#sales-overview-dashboard, #sales-overview-dashboard * { box-sizing: border-box; }`}</style>

      {/* 1. Key figures */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-200 lg:grid-cols-4" aria-label="Key figures">
        <Figure icon={Building2} label="Properties" value={data.totalProperties} note={productMix || "None attributed yet"} />
        <Figure icon={CalendarClock} label="Conversion requests" value={data.conversionRequests} note={data.conversionRequests ? "Waiting for NoLSAF review" : "Nothing waiting"} />
        <Figure icon={WalletCards} label="Total earned" value={money(summary.totalEarned, summary.currency)} note={summary.pending ? `${money(summary.pending, summary.currency)} still validating` : "Verified commission"} />
        <Figure icon={Wallet} label="Available to withdraw" value={money(summary.available, summary.currency)} note={canWithdraw ? undefined : "Nothing to withdraw yet"}>
          {canWithdraw ? (
            <Link href="/sales/payouts" className="mt-2 inline-flex h-8 w-fit items-center gap-1.5 rounded-md bg-[#02665e] px-3 text-[13px] font-semibold text-white no-underline hover:bg-[#014d47]">
              Withdraw <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </Figure>
      </section>

      {/* 2. This month */}
      <section className={`${card} grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center`} aria-label="This month">
        <div className="grid min-w-0 gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          <Link href="/sales/leaderboard" className="flex items-center gap-3 rounded-md border border-solid border-slate-200 px-3 py-2 no-underline hover:border-[#02665e]/40 hover:bg-slate-50">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-amber-50 text-amber-600"><Trophy className="h-4 w-4" aria-hidden /></span>
            <span>
              <span className="block text-[11px] text-slate-500">Leaderboard</span>
              <span className="block text-[15px] font-bold text-slate-900">
                {standing?.rank ? `#${standing.rank}` : "Not ranked"}
                {standing?.rank && standing.total ? <span className="text-[12px] font-medium text-slate-400"> of {standing.total}</span> : null}
                {standing && standing.movement > 0 ? <span className="ml-1.5 inline-flex items-center text-[11px] font-semibold text-emerald-700"><ArrowUp className="h-3 w-3" />{standing.movement}</span> : null}
              </span>
            </span>
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900"><Target className="h-4 w-4 text-[#02665e]" aria-hidden /> Monthly target</span>
              <span className="text-slate-600">{standing ? `${standing.target.confirmed} of ${standing.target.goal} confirmed properties · ${standing.points.toLocaleString("en-US")} pts` : "Opens once the leaderboard is live"}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#02665e] transition-[width] duration-500" style={{ width: `${targetPct}%` }} /></div>
            {standing?.gap ? <p className="m-0 mt-1.5 text-[12px] text-slate-500">{standing.gap.points} points to reach #{standing.gap.rank}. One owner-confirmed property is worth 50.</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/sales/leads/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#02665e] px-3 text-[13px] font-semibold text-white no-underline hover:bg-[#014d47]">
            <Plus className="h-4 w-4" aria-hidden /> New lead
          </Link>
          <Link href="/sales/id-card" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-800 no-underline hover:bg-slate-50">
            <IdCard className="h-4 w-4" aria-hidden /> {data.cardValid === false ? "Get ID card" : "My ID card"}
            {data.cardValid ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="Valid" /> : null}
          </Link>
          {data.isTeamLead ? (
            <Link href="/sales/team" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-800 no-underline hover:bg-slate-50">
              <Users className="h-4 w-4" aria-hidden /> My team
            </Link>
          ) : null}
        </div>
      </section>

      {/* 3. Earnings and performance */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <article className={card}>
          <SectionTitle action={<p className="m-0 text-[12px] text-slate-500">This month <span className="font-semibold text-slate-900">{money(summary.thisMonth, summary.currency)}</span></p>}>Earnings</SectionTitle>
          <div className="grid gap-5 border-0 border-t border-solid border-slate-100 p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(200px,1fr)]">
            <div className="min-w-0">
              {cumulativeChart.length ? (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cumulativeChart} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesTotalFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#02665e" stopOpacity={0.16} />
                          <stop offset="95%" stopColor="#02665e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#eef2f1" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}K`} width={40} />
                      <Tooltip formatter={(value: any) => money(Number(value), summary.currency)} />
                      <Area type="monotone" dataKey="total" name="Total" stroke="#02665e" strokeWidth={2} fill="url(#salesTotalFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-full min-h-[120px] items-center gap-3 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white text-slate-400 ring-1 ring-slate-200"><TrendingUp className="h-4 w-4" aria-hidden /></span>
                  <div>
                    <p className="m-0 text-sm font-medium text-slate-700">No earnings this month yet</p>
                    <p className="m-0 mt-0.5 text-[12px] text-slate-500">The chart fills in as your properties bring in revenue after guests check out.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <p className="m-0 text-[12px] font-medium text-slate-500">By stream</p>
              <ul className="m-0 mt-2 list-none space-y-2.5 p-0">
                {streams.map((stream) => {
                  const share = streamTotal > 0 ? (stream.value / streamTotal) * 100 : 0;
                  return (
                    <li key={stream.key}>
                      <div className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="flex min-w-0 items-center gap-2 text-slate-600">
                          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: stream.color }} />
                          <span className="truncate">{stream.label}</span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-slate-900">{money(stream.value, summary.currency)}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: stream.color }} /></div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex items-center justify-between border-0 border-t border-solid border-slate-100 pt-3 text-[13px]">
                <span className="text-slate-500">Paid out so far</span>
                <span className="font-semibold tabular-nums text-slate-900">{money(summary.paid, summary.currency)}</span>
              </div>
            </div>
          </div>
        </article>

        <article className={card}>
          <SectionTitle>Performance</SectionTitle>
          <dl className="m-0 divide-y divide-slate-100 border-0 border-t border-solid border-slate-100">
            {[
              { label: "Conversion rate", value: `${conversionRate}%`, note: `${data.convertedLeads} of ${data.totalLeads} leads converted`, Icon: Percent },
              { label: "Earning properties", value: me.level.activeProperties.toLocaleString(), note: "Attributions currently earning", Icon: Building2 },
              { label: "Earning events", value: summary.count.toLocaleString(), note: "Commission entries recorded", Icon: Activity },
            ].map(({ label, value, note, Icon }) => (
              <div key={label} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-50 text-slate-500 ring-1 ring-slate-100"><Icon className="h-4 w-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <dt className="truncate text-[13px] font-medium text-slate-800">{label}</dt>
                  <dd className="m-0 mt-0.5 truncate text-[12px] text-slate-500">{note}</dd>
                </div>
                <span className="shrink-0 text-lg font-bold tabular-nums text-slate-900">{value}</span>
              </div>
            ))}
          </dl>
        </article>
      </section>

      {/* 4. Properties and notifications */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <article className={`${card} overflow-hidden`}>
          <SectionTitle action={<Link href="/sales/properties" className={linkAction}>View all</Link>}>Attributed properties</SectionTitle>
          {properties.length ? (
            <>
              <div className="border-0 border-t border-solid border-slate-100 md:hidden">
                {properties.slice(0, 5).map((property) => {
                  const location = titleCase(property.city || property.district || property.regionName) || "Location not recorded";
                  const products = property.salesAttributions.map((item) => codeLabel(item.productType)).join(" + ");
                  return (
                    <Link key={property.ref} href={`/sales/properties/${property.ref}`} className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3 no-underline last:border-b-0 hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-slate-900">{titleCase(property.title)}</p>
                        <p className="m-0 mt-0.5 truncate text-[12px] text-slate-500">{location}{products ? ` · ${products}` : ""}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{money(property.totalEarnings, property.currency)}</span>
                    </Link>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
                  <thead className="border-0 border-y border-solid border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Property</th>
                      <th className="px-3 py-2.5">Location</th>
                      <th className="px-3 py-2.5">Products</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Earnings</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {properties.map((property) => (
                      <tr key={property.ref} className="border-0 border-t border-solid border-slate-100 first:border-t-0 hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-slate-900">{titleCase(property.title)}</td>
                        <td className="px-3 py-3 text-slate-500">{titleCase(property.city || property.district || property.regionName) || "Not recorded"}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {property.salesAttributions.map((item) => (
                              <span key={item.id} className="rounded bg-[#02665e]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#02665e]">{codeLabel(item.productType)}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusTone(property.status)}`}>{codeLabel(property.status)}</span></td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{money(property.totalEarnings, property.currency)}</td>
                        <td className="pr-3 text-right">
                          <Link href={`/sales/properties/${property.ref}`} aria-label={`Open ${property.title}`} className="inline-grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                            <ArrowRight className="h-4 w-4" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 border-0 border-t border-solid border-slate-100 px-4 py-6">
              <Building2 className="h-5 w-5 text-slate-300" aria-hidden />
              <p className="m-0 text-sm text-slate-500">No attributed properties yet. Converted leads appear here once the owner confirms you and NoLSAF verifies them.</p>
            </div>
          )}
        </article>

        <article className={`${card} overflow-hidden`}>
          <SectionTitle action={<Link href="/sales/notifications" className={linkAction}>View all</Link>}>
            Notifications
            {data.totalUnread ? <span className="rounded bg-[#02665e] px-1.5 text-[11px] font-semibold leading-5 text-white">{data.totalUnread}</span> : null}
          </SectionTitle>
          <div className="border-0 border-t border-solid border-slate-100">
            {notifications.length ? notifications.map((item) => {
              const content = (
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#02665e]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-[13px] font-medium leading-5 text-slate-800">{item.title}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{relativeTime(item.createdAt)}</span>
                  </span>
                </div>
              );
              return item.meta?.actionPath?.startsWith("/sales")
                ? <Link key={String(item.id)} href={item.meta.actionPath} className="block border-0 border-b border-solid border-slate-100 no-underline last:border-b-0 hover:bg-slate-50">{content}</Link>
                : <div key={String(item.id)} className="border-0 border-b border-solid border-slate-100 last:border-b-0">{content}</div>;
            }) : (
              <div className="flex items-center gap-3 px-4 py-6">
                <Bell className="h-5 w-5 text-slate-300" aria-hidden />
                <p className="m-0 text-sm text-slate-500">You are all caught up.</p>
              </div>
            )}
          </div>
          {data.totalUnread > notifications.length ? (
            <p className="m-0 border-0 border-t border-solid border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">{data.totalUnread - notifications.length} more unread</p>
          ) : null}
        </article>
      </section>
    </div>
  );
}
