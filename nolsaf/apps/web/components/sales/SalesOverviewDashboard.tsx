"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  FileSignature,
  Layers3,
  Loader2,
  TrendingUp,
  Wallet,
  WalletCards,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import apiClient from "@/lib/apiClient";
import { initialsOf, statusTone, type SalesMe } from "@/components/SalesShell";

type DashboardMe = SalesMe & {
  payout?: {
    name: string | null;
    method: string | null;
    accountMasked: string | null;
  };
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

type ChartPoint = {
  date: string;
  NRMS_USAGE: number;
  MARKETPLACE_BOOKING: number;
  other: number;
};

type PropertyRow = {
  id: number;
  title: string;
  status: string;
  city: string | null;
  district: string | null;
  regionName: string | null;
  nrmsActivatedAt: string | null;
  totalEarnings: number;
  currency: string;
  salesAttributions: Array<{
    id: number;
    productType: string;
    status: string;
    attributedAt: string;
  }>;
};

type NotificationRow = {
  id: number | string;
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
  meta?: { actionPath?: string } | null;
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
};

const STREAMS = [
  { key: "NRMS_USAGE", label: "NRMS commission", color: "#22c55e" },
  { key: "MARKETPLACE_BOOKING", label: "Marketplace share", color: "#087f68" },
  { key: "OTHER", label: "Other earnings", color: "#f5b700" },
] as const;

function money(value: number, currency = "TZS"): string {
  return `${currency === "TZS" ? "TSh" : currency} ${Math.round(Number(value || 0)).toLocaleString("en-US")}`;
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function relativeTime(value: string): string {
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(difference / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: typeof Building2;
  label: string;
  value: string | number;
  note: string;
  tone: "green" | "blue" | "violet" | "amber" | "teal";
}) {
  const tones = {
    green: "border-emerald-100 bg-emerald-50/45 text-emerald-700",
    blue: "border-sky-100 bg-sky-50/45 text-sky-700",
    violet: "border-violet-100 bg-violet-50/45 text-violet-700",
    amber: "border-amber-100 bg-amber-50/45 text-amber-700",
    teal: "border-teal-100 bg-teal-50/45 text-teal-700",
  };
  return (
    <div className={`min-w-0 border p-4 ${tones[tone]}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/80 shadow-sm">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate text-xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mb-0 mt-0.5 text-xs font-bold text-slate-700">{label}</p>
          <p className="mb-0 mt-1 truncate text-[10px] text-slate-400">{note}</p>
        </div>
      </div>
    </div>
  );
}

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
        const [
          meResponse,
          summaryResponse,
          chartResponse,
          propertiesResponse,
          nrmsResponse,
          marketplaceResponse,
          leadsResponse,
          convertedResponse,
          conversionResponse,
          notificationsResponse,
        ] = await Promise.all([
          apiClient.get("/api/sales/me"),
          apiClient.get("/api/sales/earnings/summary"),
          apiClient.get("/api/sales/earnings/chart", {
            params: { from: monthStart.toISOString(), to: new Date().toISOString() },
          }),
          apiClient.get("/api/sales/properties", { params: { page: 1, pageSize: 5 } }),
          apiClient.get("/api/sales/properties", { params: { page: 1, pageSize: 1, product: "NRMS" } }),
          apiClient.get("/api/sales/properties", { params: { page: 1, pageSize: 1, product: "MARKETPLACE" } }),
          apiClient.get("/api/sales/leads", { params: { page: 1, pageSize: 1 } }),
          apiClient.get("/api/sales/leads", { params: { page: 1, pageSize: 1, status: "CONVERTED" } }),
          apiClient.get("/api/sales/leads", { params: { page: 1, pageSize: 1, status: "CONVERSION_REQUESTED" } }),
          apiClient.get("/api/sales/notifications", { params: { tab: "unread", page: 1, pageSize: 4 } }),
        ]);
        if (cancelled) return;
        setData({
          me: meResponse.data,
          summary: summaryResponse.data?.summary,
          chart: chartResponse.data?.points || [],
          properties: propertiesResponse.data?.properties || [],
          totalProperties: Number(propertiesResponse.data?.total || 0),
          nrmsProperties: Number(nrmsResponse.data?.total || 0),
          marketplaceProperties: Number(marketplaceResponse.data?.total || 0),
          totalLeads: Number(leadsResponse.data?.total || 0),
          convertedLeads: Number(convertedResponse.data?.total || 0),
          conversionRequests: Number(conversionResponse.data?.total || 0),
          notifications: notificationsResponse.data?.items || [],
          totalUnread: Number(notificationsResponse.data?.totalUnread || 0),
        });
      } catch (cause: any) {
        if (!cancelled) {
          setError(cause?.response?.data?.error || "Could not load the Sales overview.");
        }
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
        label: new Date(`${point.date}T00:00:00Z`).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          timeZone: "UTC",
        }),
        nrms,
        marketplace,
        total: nrms + marketplace + other,
      };
    });
  }, [data?.chart]);

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-emerald-700">
        <div className="text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin" /><p className="mb-0 mt-3 text-sm text-slate-500">Preparing your Sales overview…</p></div>
      </div>
    );
  }

  if (error || !data) {
    return <p className="border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-700">{error || "Sales overview is unavailable."}</p>;
  }

  const { me, summary, properties, notifications } = data;
  const contract = me.contract;
  const conversionRate = data.totalLeads > 0 ? Math.round((data.convertedLeads / data.totalLeads) * 100) : 0;
  const averageEarnings = data.totalProperties > 0 ? summary.totalEarned / data.totalProperties : 0;
  const otherEarnings =
    Number(summary.byStream?.PERFORMANCE_BONUS || 0) +
    Number(summary.byStream?.MANUAL_ADJUSTMENT || 0);
  const pieData = STREAMS.map((stream) => ({
    ...stream,
    value:
      stream.key === "OTHER"
        ? otherEarnings
        : Number(summary.byStream?.[stream.key] || 0),
  })).filter((stream) => stream.value > 0);

  return (
    <div id="sales-overview-dashboard" className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(440px,1fr)]">
        <div className="flex min-w-0 items-center gap-4 border border-slate-200 bg-white p-5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.55)]">
          {me.partner.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.partner.avatarUrl} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover ring-4 ring-emerald-50" />
          ) : (
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-100 to-teal-50 text-xl font-black text-emerald-800 ring-4 ring-emerald-50">
              {initialsOf(me.partner.name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="m-0 text-xs text-slate-500">Welcome back,</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="m-0 truncate text-2xl font-black tracking-tight text-slate-950">{me.partner.name || "Sales partner"}</h1>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-800">{me.level.benefits.badge}</span>
            </div>
            <p className="mb-0 mt-2 text-xs text-slate-600">Partner ID: <strong>{me.partner.agentCode}</strong></p>
            <p className="mb-0 mt-1 text-xs text-slate-500">{me.partner.region || "Region not assigned"}{me.partner.territory ? ` · ${me.partner.territory}` : ""}</p>
          </div>
        </div>

        <Link href="/sales/contract" className="group grid min-w-0 gap-4 border border-slate-200 bg-white p-5 text-left no-underline shadow-[0_16px_40px_-34px_rgba(15,23,42,0.55)] sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><FileSignature className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-500">Agreement status</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${statusTone(contract?.status || "PENDING")}`}>{contract?.status || "Pending"}</span></span>
            <span className="mt-2 block text-sm font-bold text-slate-900">{contract ? `${shortDate(contract.startsAt)} – ${shortDate(contract.expiresAt)}` : "Agreement not available"}</span>
            <span className="mt-1 block text-xs text-slate-500">{contract ? `${contract.nrmsCommissionRate}% NRMS · ${contract.marketplaceRevenueRate}% marketplace` : "Open agreement details"}</span>
          </span>
          <span className="border-l border-slate-100 pl-4 text-right">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">Expires</span>
            <span className="mt-1 block text-base font-black text-slate-950">{contract ? shortDate(contract.expiresAt) : "—"}</span>
            <span className={`mt-1 block text-[11px] font-bold ${(contract?.daysRemaining || 0) <= 30 ? "text-red-600" : "text-emerald-700"}`}>{contract ? `${contract.daysRemaining} days remaining` : "No active term"}</span>
          </span>
        </Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={Building2} label="Total properties" value={data.totalProperties} note="Verified portfolio" tone="green" />
        <KpiCard icon={Layers3} label="NRMS properties" value={data.nrmsProperties} note="Attributed product" tone="blue" />
        <KpiCard icon={TrendingUp} label="Marketplace properties" value={data.marketplaceProperties} note="Attributed product" tone="violet" />
        <KpiCard icon={CalendarClock} label="Conversion requests" value={data.conversionRequests} note="Awaiting review" tone="amber" />
        <KpiCard icon={WalletCards} label="Total earnings" value={money(summary.totalEarned, summary.currency)} note="All verified records" tone="teal" />
        <KpiCard icon={Wallet} label="Available payout" value={money(summary.available, summary.currency)} note="Ready to request" tone="green" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.8fr)_minmax(280px,0.55fr)]">
        <article className="min-w-0 border border-slate-200 bg-white p-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.5)]">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="m-0 text-sm font-black text-slate-900">Earnings overview</h2><p className="mb-0 mt-1 text-[11px] text-slate-400">Cumulative recorded earnings this month</p></div>
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-bold text-slate-600">This month</span>
          </div>
          <div className="mt-4 h-64">
            {cumulativeChart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulativeChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesTotalFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f5b700" stopOpacity={0.22} /><stop offset="95%" stopColor="#f5b700" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e8eeec" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `TSh ${Math.round(Number(value) / 1000)}K`} width={62} />
                  <Tooltip formatter={(value: any) => money(Number(value), summary.currency)} />
                  <Area type="monotone" dataKey="total" name="Total earnings" stroke="#f5b700" strokeWidth={2.2} fill="url(#salesTotalFill)" />
                  <Area type="monotone" dataKey="marketplace" name="Marketplace share" stroke="#087f68" strokeWidth={2} fill="transparent" />
                  <Area type="monotone" dataKey="nrms" name="NRMS commission" stroke="#22c55e" strokeWidth={2} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-center"><div><TrendingUp className="mx-auto h-7 w-7 text-slate-200" /><p className="mb-0 mt-2 text-xs font-bold text-slate-500">No earnings recorded this month</p></div></div>
            )}
          </div>
        </article>

        <article className="min-w-0 border border-slate-200 bg-white p-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.5)]">
          <h2 className="m-0 text-sm font-black text-slate-900">Earnings breakdown</h2>
          <p className="mb-0 mt-1 text-[11px] text-slate-400">All verified earning streams</p>
          <div className="mt-3 grid items-center gap-2 sm:grid-cols-[150px_1fr] xl:grid-cols-1 2xl:grid-cols-[150px_1fr]">
            <div className="relative h-40">
              {pieData.length ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart><Pie data={pieData} dataKey="value" nameKey="label" innerRadius={45} outerRadius={68} strokeWidth={0}>{pieData.map((item) => <Cell key={item.key} fill={item.color} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p className="m-0 text-[10px] text-slate-400">Total</p><p className="mb-0 mt-0.5 text-xs font-black text-slate-900">{money(summary.totalEarned, summary.currency)}</p></div></div>
                </>
              ) : <div className="grid h-full place-items-center text-xs text-slate-400">No earnings</div>}
            </div>
            <div className="space-y-3">
              {STREAMS.map((stream) => {
                const value = stream.key === "OTHER" ? otherEarnings : Number(summary.byStream?.[stream.key] || 0);
                return <div key={stream.key} className="flex items-start gap-2"><span className="mt-1 h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: stream.color }} /><div className="min-w-0"><p className="m-0 text-[11px] font-bold text-slate-700">{stream.label}</p><p className="mb-0 mt-0.5 text-[11px] text-slate-500">{money(value, summary.currency)}</p></div></div>;
              })}
            </div>
          </div>
        </article>

        <article className="border border-slate-200 bg-white p-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.5)]">
          <h2 className="m-0 text-sm font-black text-slate-900">Performance snapshot</h2>
          <div className="mt-3 divide-y divide-slate-100 border border-slate-100">
            {[
              ["Conversion rate", `${conversionRate}%`, `${data.convertedLeads} of ${data.totalLeads} leads`],
              ["Average earnings / property", money(averageEarnings, summary.currency), "Verified portfolio"],
              ["Earning events", summary.count.toLocaleString(), "Recorded ledger entries"],
              ["Active attributions", me.level.activeProperties.toLocaleString(), "Currently earning"],
            ].map(([label, value, note]) => (
              <div key={label} className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0"><p className="m-0 text-[11px] font-bold text-slate-700">{label}</p><p className="mb-0 mt-0.5 truncate text-[10px] text-slate-400">{note}</p></div>
                <span className="shrink-0 text-xs font-black text-slate-950">{value}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.75fr)_minmax(280px,0.55fr)]">
        <article className="min-w-0 overflow-hidden border border-slate-200 bg-white shadow-[0_16px_40px_-36px_rgba(15,23,42,0.5)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5"><h2 className="m-0 text-sm font-black text-slate-900">Attributed properties</h2><Link href="/sales/properties" className="text-[11px] font-bold text-emerald-700 no-underline hover:underline">View all properties</Link></div>
          {properties.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[660px] border-collapse text-left">
                <thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-wide text-slate-400"><tr><th className="px-4 py-2.5">Property</th><th className="px-3 py-2.5">Location</th><th className="px-3 py-2.5">Products</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Earnings</th><th className="w-8" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {properties.map((property) => (
                    <tr key={property.id} className="text-xs">
                      <td className="px-4 py-3 font-bold text-slate-900">{property.title}</td>
                      <td className="px-3 py-3 text-slate-500">{property.city || property.district || property.regionName || "—"}</td>
                      <td className="px-3 py-3"><div className="flex gap-1">{property.salesAttributions.map((item) => <span key={item.id} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{item.productType}</span>)}</div></td>
                      <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${statusTone(property.status)}`}>{property.status}</span></td>
                      <td className="px-3 py-3 text-right font-black text-slate-900">{money(property.totalEarnings, property.currency)}</td>
                      <td className="pr-3"><Link href={`/sales/properties/${property.id}`} aria-label={`Open ${property.title}`}><ArrowRight className="h-3.5 w-3.5 text-slate-300" /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="grid min-h-48 place-items-center text-center"><div><Building2 className="mx-auto h-7 w-7 text-slate-200" /><p className="mb-0 mt-2 text-xs font-bold text-slate-500">No attributed properties yet</p></div></div>}
        </article>

        <article className="border border-slate-200 bg-white p-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.5)]">
          <div className="flex items-center justify-between"><h2 className="m-0 text-sm font-black text-slate-900">Earnings summary</h2><span className="text-[10px] font-bold text-slate-400">All time</span></div>
          <div className="mt-3 divide-y divide-slate-100 border border-slate-100">
            {[
              ["NRMS commission", Number(summary.byStream?.NRMS_USAGE || 0), "text-emerald-700"],
              ["Marketplace share", Number(summary.byStream?.MARKETPLACE_BOOKING || 0), "text-teal-700"],
              ["Pending earnings", summary.pending, "text-amber-600"],
              ["Total earnings", summary.totalEarned, "text-slate-950"],
            ].map(([label, value, tone]) => <div key={String(label)} className="flex items-center justify-between gap-3 px-3 py-3"><span className="text-[11px] text-slate-600">{label}</span><span className={`text-xs font-black ${tone}`}>{money(Number(value), summary.currency)}</span></div>)}
          </div>
          <Link href="/sales/payouts" className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#087f68] text-sm font-bold text-white no-underline hover:bg-[#066b59]"><Wallet className="h-4 w-4" />Request payout</Link>
        </article>

        <article className="border border-slate-200 bg-white p-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.5)]">
          <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Bell className="h-4 w-4 text-emerald-700" /><h2 className="m-0 text-sm font-black text-slate-900">Recent notifications</h2></div><Link href="/sales/notifications" className="text-[10px] font-bold text-emerald-700 no-underline">View all</Link></div>
          <div className="mt-3 divide-y divide-slate-100 border border-slate-100">
            {notifications.length ? notifications.map((item) => {
              const content = <div className="flex items-start gap-2.5 px-3 py-3"><span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="line-clamp-2 block text-[11px] font-bold leading-4 text-slate-800">{item.title}</span><span className="mt-1 block text-[9px] text-slate-400">{relativeTime(item.createdAt)}</span></span><ArrowRight className="mt-1 h-3 w-3 shrink-0 text-slate-300" /></div>;
              return item.meta?.actionPath?.startsWith("/sales") ? <Link key={String(item.id)} href={item.meta.actionPath} className="block no-underline hover:bg-slate-50">{content}</Link> : <div key={String(item.id)}>{content}</div>;
            }) : <div className="px-4 py-10 text-center"><Bell className="mx-auto h-6 w-6 text-slate-200" /><p className="mb-0 mt-2 text-[11px] text-slate-400">No unread updates</p></div>}
          </div>
          {data.totalUnread > notifications.length ? <p className="mb-0 mt-2 text-center text-[10px] text-slate-400">{data.totalUnread - notifications.length} more unread</p> : null}
        </article>
      </section>
    </div>
  );
}

