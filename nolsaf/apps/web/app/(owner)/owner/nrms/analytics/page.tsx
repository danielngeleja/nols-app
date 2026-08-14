"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  Banknote,
  BarChart3,
  Building2,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Loader2,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  UtensilsCrossed,
  WalletCards,
} from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type RangeKey = "all" | "month" | "90d" | "year";

type CurrencyAnalytics = {
  currency: string;
  confirmedRevenue: number;
  roomRevenue: number;
  extraChargeRevenue: number;
  extraChargeCount: number;
  collectedRevenue: number;
  agencyCollectedRevenue: number;
  amountDue: number;
  agencyAmountDue: number;
  masterFolioCount: number;
  agencyFoliosDue: number;
  collectionRate: number;
  averageReservationValue: number;
  reservationCount: number;
  fullyPaidCount: number;
  partiallyPaidCount: number;
  unpaidCount: number;
  monthly: Array<{ month: string; confirmed: number; collected: number }>;
  sources: Array<{ source: string; count: number; confirmed: number; collected: number }>;
  paymentMethods: Array<{ method: string; count: number; amount: number }>;
  chargesByCategory: Array<{ category: string; count: number; amount: number }>;
};

type AnalyticsResponse = {
  range: { from: string | null; to: string | null };
  reservationCount: number;
  masterFolioCount: number;
  currencies: CurrencyAnalytics[];
};

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: "all", label: "All time" },
  { key: "month", label: "This month" },
  { key: "90d", label: "Last 90 days" },
  { key: "year", label: "This year" },
];

const SOURCE_LABELS: Record<string, string> = {
  NOLSAF: "NoLSAF",
  WALK_IN: "Walk-in",
  PHONE: "Phone",
  DIRECT: "Direct",
  AIRBNB: "Airbnb",
  BOOKING_COM: "Booking.com",
  EXPEDIA: "Expedia",
  OTHER: "Other",
};

const SOURCE_BRAND_COLORS: Record<string, string> = {
  NOLSAF: "#21847f",
  BOOKING_COM: "#003580",
  AIRBNB: "#ff385c",
  EXPEDIA: "#f5b800",
  WALK_IN: "#059669",
  DIRECT: "#0f766e",
  PHONE: "#7c3aed",
  OTHER: "#64748b",
};

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile money",
  BANK: "Bank transfer",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  UNCLASSIFIED_OUTLET_PAYMENT: "Outlet payment needs classification",
  OTHER: "Other",
};

const CHARGE_CATEGORY_LABELS: Record<string, string> = {
  RESTAURANT: "Restaurant",
  BAR: "Bar",
  LAUNDRY: "Laundry",
  MINIBAR: "Minibar",
  ROOM_SERVICE: "Room service",
  TRANSPORT: "Transport",
  DAMAGE: "Damage",
  OTHER: "Other",
};

function dateParam(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeParams(range: RangeKey): { from?: string; to?: string } {
  if (range === "all") return {};
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (range === "month") {
    return { from: dateParam(new Date(now.getFullYear(), now.getMonth(), 1)), to: dateParam(new Date(now.getFullYear(), now.getMonth() + 1, 1)) };
  }
  if (range === "year") {
    return { from: dateParam(new Date(now.getFullYear(), 0, 1)), to: dateParam(new Date(now.getFullYear() + 1, 0, 1)) };
  }
  return { from: dateParam(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89)), to: dateParam(tomorrow) };
}

function moneyFormatter(currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  }
}

function readableCode(value: string, labels: Record<string, string>): string {
  return labels[value] ?? value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

export default function RevenueAnalyticsPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [range, setRange] = useState<RangeKey>("all");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<AnalyticsResponse>(
        `/api/owner/nrms/reservations/property/${selectedPropertyId}/analytics`,
        { params: rangeParams(range) },
      );
      setData(response.data);
      setSelectedCurrency((current) => {
        if (response.data.currencies.some((item) => item.currency === current)) return current;
        return response.data.currencies[0]?.currency ?? "";
      });
    } catch (requestError: unknown) {
      const message = requestError instanceof Error ? requestError.message : "Failed to load revenue analytics";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range, selectedPropertyId]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const analytics = useMemo(
    () => data?.currencies.find((item) => item.currency === selectedCurrency) ?? data?.currencies[0] ?? null,
    [data, selectedCurrency],
  );
  const sourceRows = useMemo(() => {
    const rows = analytics?.sources ?? [];
    const nolsaf = rows.find((source) => source.source === "NOLSAF") ?? { source: "NOLSAF", count: 0, confirmed: 0, collected: 0 };
    return [nolsaf, ...rows.filter((source) => source.source !== "NOLSAF")];
  }, [analytics]);
  const currency = analytics?.currency || selectedCurrency || selectedProperty?.currency || "";
  const formatMoney = useMemo(() => moneyFormatter(currency), [currency]);
  const money = useCallback((value: number) => formatMoney.format(value), [formatMoney]);

  const monthly = useMemo(() => {
    return (analytics?.monthly ?? []).slice(-12).map((entry) => ({
      ...entry,
      label: new Date(`${entry.month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    }));
  }, [analytics]);

  const maxSourceRevenue = Math.max(1, ...sourceRows.map((source) => source.confirmed));

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 pb-10">
      <section className="flex flex-wrap items-center justify-between gap-4 px-1 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
            <BarChart3 className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="m-0 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Revenue &amp; Analytics</h2>
              <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-700 sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Live</span>
            </div>
            <p className="mb-0 mt-1 text-xs text-neutral-500">Confirmed value, collections, and outstanding revenue for {selectedProperty?.title ?? "this property"}.</p>
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-sm sm:flex-none">
            <CalendarRange className="mx-2 hidden h-3.5 w-3.5 shrink-0 text-neutral-400 md:block" />
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                aria-pressed={range === option.key}
                className={`min-h-8 shrink-0 appearance-none rounded-lg border-0 px-3 text-[11px] font-bold transition ${range === option.key ? "bg-emerald-700 text-white shadow-sm" : "bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {data && data.currencies.length > 1 && (
            <label className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 shadow-sm">
              <CircleDollarSign className="h-3.5 w-3.5 text-neutral-400" />
              <span className="sr-only">Currency</span>
              <select value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)} className="border-0 bg-transparent p-0 text-xs font-bold outline-none">
                {data.currencies.map((item) => <option key={item.currency} value={item.currency}>{item.currency}</option>)}
              </select>
            </label>
          )}

          <button type="button" onClick={() => void loadAnalytics()} disabled={loading} aria-label="Refresh analytics" title="Refresh data" className="inline-flex h-10 w-10 shrink-0 appearance-none items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void loadAnalytics()} className="appearance-none rounded-lg border-0 bg-red-100 px-3 py-2 text-xs font-bold text-red-800">Try again</button>
        </div>
      )}

      {loading && !analytics ? (
        <div className="flex min-h-72 items-center justify-center rounded-3xl border border-neutral-200 bg-white text-neutral-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading revenue data…
        </div>
      ) : analytics ? (
        <>
          <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5" aria-label="Revenue KPIs">
            <KpiCard icon={TrendingUp} label="Confirmed revenue" value={money(analytics.confirmedRevenue)} note={`${money(analytics.roomRevenue)} rooms plus guest services`} tone="emerald" />
            <KpiCard icon={UtensilsCrossed} label="Extra charges" value={money(analytics.extraChargeRevenue)} note={`${analytics.extraChargeCount} restaurant, bar and service charges`} tone="rose" />
            <KpiCard icon={WalletCards} label="Collected revenue" value={money(analytics.collectedRevenue)} note={analytics.agencyCollectedRevenue > 0 ? `${money(analytics.agencyCollectedRevenue)} received on agency bills` : "Guest and agency payments recorded"} tone="blue" />
            <KpiCard icon={Clock3} label="Amount due" value={money(analytics.amountDue)} note={`${analytics.partiallyPaidCount + analytics.unpaidCount} guest folios${analytics.agencyFoliosDue > 0 ? ` · ${analytics.agencyFoliosDue} agency ${analytics.agencyFoliosDue === 1 ? "bill" : "bills"}` : ""} due`} tone={analytics.amountDue > 0 ? "amber" : "emerald"} />
            <KpiCard icon={CircleDollarSign} label="Collection rate" value={`${analytics.collectionRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`} note="Collected against confirmed value" tone="violet" />
          </section>

          <section className="grid overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_14px_38px_-34px_rgba(15,23,42,0.45)] sm:grid-cols-2 xl:grid-cols-5">
            <MiniKpi label="Reservations" value={String(analytics.reservationCount)} icon={ReceiptText} />
            <MiniKpi label="Guest folios clear" value={String(analytics.fullyPaidCount)} icon={CheckCircle2} />
            <MiniKpi label="Guest folios partial" value={String(analytics.partiallyPaidCount)} icon={Banknote} />
            <MiniKpi label="Agency bills" value={String(analytics.masterFolioCount)} icon={Building2} />
            <MiniKpi label="Average reservation" value={money(analytics.averageReservationValue)} icon={BarChart3} />
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)] sm:p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="m-0 text-lg font-bold text-neutral-950">Restaurant, bar &amp; service revenue</h3>
                <p className="mb-0 mt-1 text-sm text-neutral-500">Every non-voided folio charge is included in confirmed revenue and grouped by operating department.</p>
              </div>
              <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700">{money(analytics.extraChargeRevenue)} total</span>
            </div>
            {analytics.chargesByCategory.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {analytics.chargesByCategory.map((charge) => {
                  const share = analytics.extraChargeRevenue > 0 ? (charge.amount / analytics.extraChargeRevenue) * 100 : 0;
                  return (
                    <article key={charge.category} className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="m-0 truncate text-xs font-bold uppercase tracking-[0.08em] text-neutral-500">{readableCode(charge.category, CHARGE_CATEGORY_LABELS)}</p>
                          <p className="mb-0 mt-1.5 text-lg font-bold tabular-nums text-neutral-950">{money(charge.amount)}</p>
                        </div>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-rose-600 shadow-sm"><UtensilsCrossed className="h-3.5 w-3.5" /></span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-200"><div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.min(100, share)}%` }} /></div>
                      <p className="mb-0 mt-2 text-xs text-neutral-500">{charge.count} {charge.count === 1 ? "charge" : "charges"} · {share.toFixed(0)}%</p>
                    </article>
                  );
                })}
              </div>
            ) : <EmptyPanel message="No restaurant, bar, or service charges were posted in this period." compact />}
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.8fr)]">
            <article className="min-w-0 rounded-3xl border border-neutral-200 bg-white p-5 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)] sm:p-6">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="m-0 text-lg font-bold text-neutral-950">Revenue trend</h3>
                  <p className="mb-0 mt-1 text-sm text-neutral-500">Confirmed value compared with money collected</p>
                </div>
                <div className="flex items-center gap-4 text-xs font-semibold text-neutral-500">
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />Confirmed</span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-blue-500" />Collected</span>
                </div>
              </div>
              {monthly.length ? (
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthly} barGap={3} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#737373", fontSize: 11 }} />
                      <YAxis axisLine={false} tickLine={false} width={58} tick={{ fill: "#a3a3a3", fontSize: 10 }} tickFormatter={(value) => Intl.NumberFormat(undefined, { notation: "compact" }).format(Number(value))} />
                      <Tooltip formatter={(value) => money(Number(value))} cursor={{ fill: "#f5f5f5" }} contentStyle={{ borderRadius: 12, borderColor: "#e5e7eb", boxShadow: "0 12px 30px rgba(15,23,42,.1)" }} />
                      <Bar dataKey="confirmed" name="Confirmed" fill="#047857" radius={[5, 5, 0, 0]} maxBarSize={34} />
                      <Bar dataKey="collected" name="Collected" fill="#3b82f6" radius={[5, 5, 0, 0]} maxBarSize={34} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyPanel message="No monthly revenue is available for this period." />}
            </article>

            <article className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)] sm:p-6">
              <h3 className="m-0 text-lg font-bold text-neutral-950">Payment methods</h3>
              <p className="mb-5 mt-1 text-sm text-neutral-500">How collected revenue was received</p>
              {analytics.paymentMethods.length ? (
                <div className="space-y-3">
                  {analytics.paymentMethods.map((method) => {
                    const share = analytics.collectedRevenue > 0 ? (method.amount / analytics.collectedRevenue) * 100 : 0;
                    return (
                      <div key={method.method} className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-3.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-bold text-neutral-800">{readableCode(method.method, METHOD_LABELS)}</span>
                          <span className="text-sm font-bold tabular-nums text-neutral-950">{money(method.amount)}</span>
                        </div>
                        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-neutral-200"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, share)}%` }} /></div>
                        <p className="mb-0 mt-2 text-xs text-neutral-500">{method.count} {method.count === 1 ? "payment" : "payments"} · {share.toFixed(0)}%</p>
                      </div>
                    );
                  })}
                </div>
              ) : <EmptyPanel message="No payments have been recorded for this period." compact />}
            </article>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)] sm:p-6">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="m-0 text-lg font-bold text-neutral-950">Revenue by booking source</h3>
                <p className="mb-0 mt-1 text-sm text-neutral-500">See which channels are generating reservation value and cash</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">{analytics.sources.length} active sources</span>
            </div>
            {sourceRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-separate border-spacing-0 text-left">
                  <thead><tr className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400"><th className="border-b border-neutral-200 px-3 py-3">Source</th><th className="border-b border-neutral-200 px-3 py-3">Reservations</th><th className="border-b border-neutral-200 px-3 py-3">Confirmed</th><th className="border-b border-neutral-200 px-3 py-3">Collected</th><th className="border-b border-neutral-200 px-3 py-3">Collection</th></tr></thead>
                  <tbody>
                    {sourceRows.map((source) => {
                      const rate = source.confirmed > 0 ? (source.collected / source.confirmed) * 100 : 0;
                      const brandColor = SOURCE_BRAND_COLORS[source.source] ?? SOURCE_BRAND_COLORS.OTHER;
                      return (
                        <tr key={source.source} className="text-sm text-neutral-700">
                          <td className="border-b border-neutral-100 px-3 py-4"><div className="flex items-center gap-2 font-bold text-neutral-900"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: brandColor }} />{readableCode(source.source, SOURCE_LABELS)}{source.count === 0 && <span className="text-[9px] font-semibold text-neutral-400">No activity</span>}</div><div className="mt-2 h-1.5 w-36 overflow-hidden rounded-full" style={{ backgroundColor: `${brandColor}1a` }}><div className="h-full rounded-full" style={{ width: `${source.confirmed > 0 ? Math.max(4, (source.confirmed / maxSourceRevenue) * 100) : 0}%`, backgroundColor: brandColor }} /></div></td>
                          <td className="border-b border-neutral-100 px-3 py-4 font-semibold tabular-nums">{source.count}</td>
                          <td className="border-b border-neutral-100 px-3 py-4 font-bold tabular-nums text-neutral-950">{money(source.confirmed)}</td>
                          <td className="border-b border-neutral-100 px-3 py-4 font-semibold tabular-nums text-blue-700">{money(source.collected)}</td>
                          <td className="border-b border-neutral-100 px-3 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${rate >= 99.5 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{rate.toFixed(0)}%</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <EmptyPanel message="No confirmed reservation revenue is available for this period." />}
          </section>
        </>
      ) : !error ? (
        <div className="rounded-3xl border border-dashed border-neutral-300 bg-white px-6 py-20 text-center">
          <BarChart3 className="mx-auto h-10 w-10 text-neutral-300" />
          <h3 className="mb-0 mt-4 text-lg font-bold text-neutral-800">No revenue recorded yet</h3>
          <p className="mb-0 mt-1 text-sm text-neutral-500">Confirmed, checked-in, and completed reservations will appear here.</p>
        </div>
      ) : null}
    </main>
  );
}

function KpiCard({ icon: Icon, label, value, note, tone }: { icon: typeof TrendingUp; label: string; value: string; note: string; tone: "emerald" | "rose" | "blue" | "amber" | "violet" }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return (
    <article className="flex min-h-[138px] flex-col rounded-xl border border-neutral-200 bg-white p-4 shadow-[0_12px_30px_-30px_rgba(15,23,42,0.45)]">
      <div className="flex min-w-0 items-center justify-between gap-2.5">
        <p className="m-0 truncate text-[11px] font-semibold leading-4 text-neutral-500">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <p className="mb-0 mt-2 whitespace-nowrap text-base font-bold leading-5 tabular-nums tracking-tight text-neutral-950">{value}</p>
      <p className="mb-0 mt-auto pt-2 text-[11px] leading-4 text-neutral-500">{note}</p>
    </article>
  );
}

function MiniKpi({ label, value, icon: Icon }: { label: string; value: string; icon: typeof ReceiptText }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-neutral-100 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0"><p className="m-0 text-xs font-semibold text-neutral-500">{label}</p><p className="mb-0 mt-0.5 truncate text-base font-bold text-neutral-950">{value}</p></div>
    </div>
  );
}

function EmptyPanel({ message, compact = false }: { message: string; compact?: boolean }) {
  return <div className={`flex items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 text-center text-sm text-neutral-500 ${compact ? "min-h-36 px-4" : "min-h-64 px-6"}`}>{message}</div>;
}
