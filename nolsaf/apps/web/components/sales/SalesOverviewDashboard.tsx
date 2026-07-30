"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Layers3,
  Loader2,
  Percent,
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
import { statusTone, type SalesMe } from "@/components/SalesShell";

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

function formatLabel(value: string): string {
  return String(value || "")
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
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
    green: {
      icon: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      dot: "bg-emerald-500",
    },
    blue: {
      icon: "bg-sky-50 text-sky-700 ring-sky-100",
      dot: "bg-sky-500",
    },
    violet: {
      icon: "bg-violet-50 text-violet-700 ring-violet-100",
      dot: "bg-violet-500",
    },
    amber: {
      icon: "bg-amber-50 text-amber-700 ring-amber-100",
      dot: "bg-amber-500",
    },
    teal: {
      icon: "bg-teal-50 text-teal-700 ring-teal-100",
      dot: "bg-teal-500",
    },
  };
  const style = tones[tone];

  return (
    <article className="group min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_18px_38px_-30px_rgba(8,127,104,0.35)] sm:rounded-2xl sm:p-4">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="m-0 min-h-6 text-[9px] font-black uppercase leading-3 tracking-[0.08em] text-slate-400 sm:min-h-0 sm:truncate sm:text-[10px] sm:leading-normal sm:tracking-[0.1em]">{label}</p>
          <p className="mb-0 mt-1.5 truncate text-base font-black tracking-[-0.035em] text-slate-950 sm:mt-2 sm:text-[clamp(1.1rem,1.7vw,1.4rem)]">{value}</p>
        </div>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 sm:h-9 sm:w-9 sm:rounded-xl ${style.icon}`}>
          <Icon className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
        </span>
      </div>
      <div className="mt-2.5 flex min-w-0 items-center gap-1.5 border-t border-slate-100 pt-2 sm:mt-3 sm:gap-2 sm:pt-2.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
        <p className="m-0 line-clamp-2 text-[9px] font-medium leading-3.5 text-slate-500 sm:truncate sm:text-[10px] sm:leading-normal">{note}</p>
      </div>
    </article>
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
      <section className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard icon={Building2} label="Total properties" value={data.totalProperties} note="Verified portfolio" tone="green" />
        <KpiCard icon={Layers3} label="NRMS properties" value={data.nrmsProperties} note="Active NRMS attribution" tone="blue" />
        <KpiCard icon={TrendingUp} label="Marketplace properties" value={data.marketplaceProperties} note="Marketplace attribution" tone="violet" />
        <KpiCard icon={CalendarClock} label="Conversion requests" value={data.conversionRequests} note="Pending admin review" tone="amber" />
        <KpiCard icon={WalletCards} label="Total earnings" value={money(summary.totalEarned, summary.currency)} note="Verified commission ledger" tone="teal" />
        <KpiCard icon={Wallet} label="Available payout" value={money(summary.available, summary.currency)} note="Eligible to request" tone="green" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.8fr)_minmax(290px,0.72fr)]">
        <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-100">
                  <TrendingUp className="h-4 w-4" />
                </span>
                <h2 className="m-0 text-sm font-black text-slate-900">Earnings overview</h2>
              </div>
              <p className="mb-0 mt-2 text-[11px] text-slate-400">Cumulative verified earnings</p>
            </div>
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-600">This month</span>
          </div>
          <div className="mt-4 h-52">
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
              <div className="grid h-full place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 text-center">
                <div>
                  <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-300 shadow-sm">
                    <TrendingUp className="h-5 w-5" />
                  </span>
                  <p className="mb-0 mt-3 text-xs font-bold text-slate-600">No earnings this month</p>
                  <p className="mb-0 mt-1 text-[10px] text-slate-400">Verified transactions will appear here.</p>
                </div>
              </div>
            )}
          </div>
        </article>

        <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100">
                  <CircleDollarSign className="h-4 w-4" />
                </span>
                <h2 className="m-0 text-sm font-black text-slate-900">Earnings breakdown</h2>
              </div>
              <p className="mb-0 mt-2 text-[11px] text-slate-400">Verified earning streams</p>
            </div>
            <span className="text-right">
              <span className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">Total</span>
              <span className="mt-1 block text-xs font-black text-slate-900">{money(summary.totalEarned, summary.currency)}</span>
            </span>
          </div>

          {pieData.length ? (
            <div className="relative mx-auto mt-3 h-32 max-w-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="label" innerRadius={38} outerRadius={56} strokeWidth={0}>
                    {pieData.map((item) => <Cell key={item.key} fill={item.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <span className="text-[10px] font-bold text-slate-500">{pieData.length} streams</span>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 p-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-slate-300 shadow-sm">
                <CircleDollarSign className="h-4 w-4" />
              </span>
              <div>
                <p className="m-0 text-xs font-bold text-slate-600">No verified earnings yet</p>
                <p className="mb-0 mt-1 text-[10px] text-slate-400">Streams will populate automatically.</p>
              </div>
            </div>
          )}

          <div className={`${pieData.length ? "mt-2" : "mt-4"} divide-y divide-slate-100`}>
            {STREAMS.map((stream) => {
              const value = stream.key === "OTHER" ? otherEarnings : Number(summary.byStream?.[stream.key] || 0);
              return (
                <div key={stream.key} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stream.color }} />
                    <span className="truncate text-[11px] font-bold text-slate-600">{stream.label}</span>
                  </span>
                  <span className="shrink-0 text-[11px] font-black text-slate-900">{money(value, summary.currency)}</span>
                </div>
              );
            })}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-violet-100">
              <Activity className="h-4 w-4" />
            </span>
            <div>
              <h2 className="m-0 text-sm font-black text-slate-900">Performance snapshot</h2>
              <p className="mb-0 mt-1 text-[10px] text-slate-400">Live workspace totals</p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {[
              { label: "Conversion rate", value: `${conversionRate}%`, note: `${data.convertedLeads} of ${data.totalLeads} leads`, Icon: Percent, tone: "bg-violet-50 text-violet-700" },
              { label: "Average / property", value: money(averageEarnings, summary.currency), note: "Verified portfolio", Icon: WalletCards, tone: "bg-teal-50 text-teal-700" },
              { label: "Earning events", value: summary.count.toLocaleString(), note: "Commission entries", Icon: Activity, tone: "bg-amber-50 text-amber-700" },
              { label: "Active attributions", value: me.level.activeProperties.toLocaleString(), note: "Currently earning", Icon: Building2, tone: "bg-emerald-50 text-emerald-700" },
            ].map(({ label, value, note, Icon, tone }) => (
              <div key={label} className="flex items-center gap-3 rounded-xl bg-slate-50/75 px-3 py-2.5">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[11px] font-bold text-slate-700">{label}</p>
                  <p className="mb-0 mt-0.5 truncate text-[9px] text-slate-400">{note}</p>
                </div>
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
            <>
              <div className="divide-y divide-slate-100 md:hidden">
                {properties.slice(0, 5).map((property) => {
                  const location = property.city || property.district || property.regionName || "Location not recorded";
                  const products = property.salesAttributions.map((item) => formatLabel(item.productType)).join(" + ");
                  return (
                    <Link
                      key={property.id}
                      href={`/sales/properties/${property.id}`}
                      className="group block px-4 py-3.5 no-underline transition hover:bg-emerald-50/40 hover:no-underline"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="m-0 truncate text-xs font-black text-slate-900">{property.title}</p>
                          <p className="mb-0 mt-1 truncate text-[10px] text-slate-400">
                            {location}{products ? ` · ${products}` : ""}
                          </p>
                        </div>
                        <span className="max-w-[45%] shrink-0 text-right text-[11px] font-black leading-4 text-slate-950">
                          {money(property.totalEarnings, property.currency)}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${statusTone(property.status)}`}>
                          {formatLabel(property.status)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                          Open
                          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
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
            </>
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

