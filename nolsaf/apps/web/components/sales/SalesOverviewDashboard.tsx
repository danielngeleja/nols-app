"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bell,
  Building2,
  CalendarClock,
  Loader2,
  Percent,
  TrendingUp,
  Wallet,
  WalletCards,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import apiClient from "@/lib/apiClient";
import { codeLabel, statusTone, type SalesMe } from "@/components/SalesShell";

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

function relativeTime(value: string): string {
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(difference / 60_000));
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

/** One tile style for every headline number: calm label, strong value, one accent. */
function KpiCard({
  icon: Icon,
  label,
  value,
  note,
  children,
}: {
  icon: typeof Building2;
  label: string;
  value: string | number;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.45)]">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 truncate text-[13px] font-medium text-slate-500">{label}</p>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="m-0 mt-1 truncate text-2xl font-bold tracking-tight tabular-nums text-slate-900">{value}</p>
      {note ? <p className="m-0 mt-1 truncate text-xs text-slate-500">{note}</p> : null}
      {children}
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
  const otherEarnings =
    Number(summary.byStream?.PERFORMANCE_BONUS || 0) +
    Number(summary.byStream?.MANUAL_ADJUSTMENT || 0);
  const streams = STREAMS.map((stream) => ({
    ...stream,
    value: stream.key === "OTHER" ? otherEarnings : Number(summary.byStream?.[stream.key] || 0),
  }));
  const streamTotal = streams.reduce((sum, s) => sum + s.value, 0);
  const canWithdraw = Number(summary.available || 0) > 0;
  const card = "min-w-0 rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]";
  const productMix = [
    data.nrmsProperties ? `NRMS ${data.nrmsProperties}` : null,
    data.marketplaceProperties ? `Marketplace ${data.marketplaceProperties}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div id="sales-overview-dashboard" className="space-y-4">
      {/* Headline numbers: one per question a partner asks */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={Building2} label="Properties" value={data.totalProperties} note={productMix || "None attributed yet"} />
        <KpiCard
          icon={CalendarClock}
          label="Conversion requests"
          value={data.conversionRequests}
          note={data.conversionRequests ? "Waiting for NoLSAF review" : "Nothing waiting for review"}
        />
        <KpiCard
          icon={WalletCards}
          label="Total earned"
          value={money(summary.totalEarned, summary.currency)}
          note={summary.pending ? `${money(summary.pending, summary.currency)} still validating` : "Verified commission"}
        />
        <KpiCard icon={Wallet} label="Available to withdraw" value={money(summary.available, summary.currency)}>
          {canWithdraw ? (
            <Link
              href="/sales/payouts"
              className="mt-3 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[#087f68] px-3 text-sm font-semibold text-white no-underline transition hover:bg-[#066b59]"
            >
              Request payout
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : (
            <p className="m-0 mt-1 text-xs text-slate-500">Nothing to withdraw yet</p>
          )}
        </KpiCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        {/* Earnings: the chart and where the money comes from, in one place */}
        <article className={`${card} p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-base font-semibold text-slate-900">Earnings</h2>
            <p className="m-0 text-xs text-slate-500">
              This month <span className="font-semibold text-slate-800">{money(summary.thisMonth, summary.currency)}</span>
            </p>
          </div>

          <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(200px,1fr)]">
            <div className="min-w-0">
              {cumulativeChart.length ? (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cumulativeChart} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesTotalFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#087f68" stopOpacity={0.18} />
                          <stop offset="95%" stopColor="#087f68" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#eef2f1" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}K`} width={40} />
                      <Tooltip formatter={(value: any) => money(Number(value), summary.currency)} />
                      <Area type="monotone" dataKey="total" name="Total" stroke="#087f68" strokeWidth={2} fill="url(#salesTotalFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-full min-h-[120px] items-center gap-3 rounded-xl bg-slate-50 px-4 py-5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-slate-400 shadow-sm">
                    <TrendingUp className="h-4 w-4" aria-hidden />
                  </span>
                  <div>
                    <p className="m-0 text-sm font-medium text-slate-700">No earnings this month yet</p>
                    <p className="m-0 mt-0.5 text-xs text-slate-500">The chart fills in as your properties bring in revenue.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-slate-500">By stream</p>
              <ul className="m-0 mt-2 list-none space-y-2.5 p-0">
                {streams.map((stream) => {
                  const share = streamTotal > 0 ? (stream.value / streamTotal) * 100 : 0;
                  return (
                    <li key={stream.key}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-slate-600">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stream.color }} />
                          <span className="truncate">{stream.label}</span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-slate-900">{money(stream.value, summary.currency)}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: stream.color }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex items-center justify-between border-0 border-t border-solid border-slate-100 pt-3 text-sm">
                <span className="text-slate-500">Paid out so far</span>
                <span className="font-semibold tabular-nums text-slate-900">{money(summary.paid, summary.currency)}</span>
              </div>
            </div>
          </div>
        </article>

        {/* Performance: only what is not already shown above */}
        <article className={`${card} p-5`}>
          <h2 className="m-0 text-base font-semibold text-slate-900">Performance</h2>
          <dl className="m-0 mt-4 space-y-4">
            {[
              { label: "Conversion rate", value: `${conversionRate}%`, note: `${data.convertedLeads} of ${data.totalLeads} leads converted`, Icon: Percent },
              { label: "Earning properties", value: me.level.activeProperties.toLocaleString(), note: "Attributions currently earning", Icon: Building2 },
              { label: "Earning events", value: summary.count.toLocaleString(), note: "Commission entries recorded", Icon: Activity },
            ].map(({ label, value, note, Icon }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <dt className="truncate text-sm font-medium text-slate-800">{label}</dt>
                  <dd className="m-0 mt-0.5 truncate text-xs text-slate-500">{note}</dd>
                </div>
                <span className="shrink-0 text-lg font-semibold tabular-nums text-slate-900">{value}</span>
              </div>
            ))}
          </dl>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <article className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <h2 className="m-0 text-base font-semibold text-slate-900">Attributed properties</h2>
            <Link href="/sales/properties" className="text-sm font-medium text-emerald-700 no-underline hover:underline">View all</Link>
          </div>
          {properties.length ? (
            <>
              <div className="border-0 border-t border-solid border-slate-100 md:hidden">
                {properties.slice(0, 5).map((property) => {
                  const location = titleCase(property.city || property.district || property.regionName) || "Location not recorded";
                  const products = property.salesAttributions.map((item) => codeLabel(item.productType)).join(" + ");
                  return (
                    <Link
                      key={property.id}
                      href={`/sales/properties/${property.id}`}
                      className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-3.5 no-underline last:border-b-0 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-slate-900">{titleCase(property.title)}</p>
                        <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{location}{products ? ` · ${products}` : ""}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{money(property.totalEarnings, property.currency)}</span>
                    </Link>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Property</th>
                      <th className="px-3 py-2.5 font-medium">Location</th>
                      <th className="px-3 py-2.5 font-medium">Products</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 text-right font-medium">Earnings</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {properties.map((property) => (
                      <tr key={property.id} className="border-0 border-t border-solid border-slate-100 hover:bg-slate-50/60">
                        <td className="px-5 py-3 font-medium text-slate-900">{titleCase(property.title)}</td>
                        <td className="px-3 py-3 text-slate-500">{titleCase(property.city || property.district || property.regionName) || "Not recorded"}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {property.salesAttributions.map((item) => (
                              <span key={item.id} className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">{codeLabel(item.productType)}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone(property.status)}`}>{codeLabel(property.status)}</span></td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{money(property.totalEarnings, property.currency)}</td>
                        <td className="pr-4 text-right">
                          <Link href={`/sales/properties/${property.id}`} aria-label={`Open ${property.title}`} className="inline-grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
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
            <div className="flex items-center gap-3 border-0 border-t border-solid border-slate-100 px-5 py-6">
              <Building2 className="h-5 w-5 text-slate-300" aria-hidden />
              <p className="m-0 text-sm text-slate-500">No attributed properties yet. Converted leads appear here once NoLSAF verifies them.</p>
            </div>
          )}
        </article>

        <article className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <h2 className="m-0 flex items-center gap-2 text-base font-semibold text-slate-900">
              Notifications
              {data.totalUnread ? <span className="rounded-full bg-emerald-600 px-1.5 py-px text-[11px] font-semibold text-white">{data.totalUnread}</span> : null}
            </h2>
            <Link href="/sales/notifications" className="text-sm font-medium text-emerald-700 no-underline hover:underline">View all</Link>
          </div>
          <div className="border-0 border-t border-solid border-slate-100">
            {notifications.length ? notifications.map((item) => {
              const content = (
                <div className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-sm font-medium leading-5 text-slate-800">{item.title}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">{relativeTime(item.createdAt)}</span>
                  </span>
                </div>
              );
              return item.meta?.actionPath?.startsWith("/sales")
                ? <Link key={String(item.id)} href={item.meta.actionPath} className="block border-0 border-b border-solid border-slate-100 no-underline last:border-b-0 hover:bg-slate-50">{content}</Link>
                : <div key={String(item.id)} className="border-0 border-b border-solid border-slate-100 last:border-b-0">{content}</div>;
            }) : (
              <div className="flex items-center gap-3 px-5 py-6">
                <Bell className="h-5 w-5 text-slate-300" aria-hidden />
                <p className="m-0 text-sm text-slate-500">You are all caught up.</p>
              </div>
            )}
          </div>
          {data.totalUnread > notifications.length ? (
            <p className="m-0 border-0 border-t border-solid border-slate-100 px-5 py-2.5 text-xs text-slate-500">{data.totalUnread - notifications.length} more unread</p>
          ) : null}
        </article>
      </section>
    </div>
  );
}
