"use client";

// Tailwind preflight is disabled in this app (corePlugins.preflight = false),
// so a bare `border-*` utility renders nothing: border-style stays `none`.
// Every hairline on this page is a ring-* or an inset shadow for that reason.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Handshake,
  Inbox,
  Instagram,
  Lightbulb,
  Link2,
  Loader2,
  MessageSquareText,
  Minus,
  PenLine,
  Percent,
  RefreshCw,
  Store,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type ChannelKey =
  | "NOLSAF_MARKETPLACE" | "DIRECT_BOOKING" | "WHATSAPP" | "INSTAGRAM" | "AGENT_PORTAL"
  | "BOOKING_COM" | "EXPEDIA" | "AIRBNB" | "WALK_IN" | "PHONE" | "OTHER";

type ChannelFamily = "MARKETPLACE" | "DIRECT" | "SOCIAL" | "B2B" | "OTA" | "ON_SITE";
type ChannelState = "LIVE" | "MANUAL" | "ATTENTION" | "CONNECTED_IDLE" | "NOT_CONNECTED";
type ChannelAction =
  | "CONNECT_CHANNEL_MANAGER" | "FIX_CHANNEL" | "CONNECT_MESSAGING" | "FIX_MESSAGING"
  | "INVITE_AGENTS" | "REVIEW_AGENT_REQUESTS" | "COMPLETE_LISTING" | "SHARE_BOOKING_LINK";

type ChannelRow = {
  key: ChannelKey;
  label: string;
  family: ChannelFamily;
  currency: string;
  rank: number;
  reservations: number;
  roomNights: number;
  roomRevenue: number;
  extrasRevenue: number;
  grossRevenue: number;
  commission: number;
  netRevenue: number;
  revenueShare: number;
  bookingShare: number;
  adr: number;
  averageStayValue: number;
  averageLengthOfStay: number;
  averageLeadTimeDays: number | null;
  settled: number;
  routed: number;
  outstanding: number;
  collectionRate: number | null;
  settlementRate: number | null;
  cancellations: number;
  noShows: number;
  cancellationRate: number | null;
  previousNetRevenue: number;
  changePct: number | null;
  commissionKnown: boolean;
};

type Readiness = {
  key: ChannelKey;
  label: string;
  family: ChannelFamily;
  summary: string;
  state: ChannelState;
  detail: string;
  action: ChannelAction | null;
  reservations: number;
};

type CurrencyReport = {
  currency: string;
  summary: {
    reservations: number; roomNights: number; grossRevenue: number; commission: number; netRevenue: number;
    settled: number; routed: number; outstanding: number; adr: number; activeChannels: number; cancellations: number;
    noShows: number; previousNetRevenue: number; changePct: number | null;
  };
  channels: ChannelRow[];
  highlights: {
    topRevenue: ChannelKey | null; bestAdr: ChannelKey | null; bestCollection: ChannelKey | null;
    mostReliable: ChannelKey | null; fastestGrowing: ChannelKey | null; commissionFreeShare: number;
  };
};

type SalesChannelResponse = {
  property: { id: number; title: string; currency: string; status: string | null };
  basis: "BOOKED" | "STAY";
  range: { from: string; to: string; days: number };
  granularity: "day" | "week" | "month";
  currencies: CurrencyReport[];
  readiness: Readiness[];
  series: Array<Record<string, number | string>>;
  agents: Array<{ id: number; name: string; reservations: number; netRevenue: number; currency: string }>;
  funnel: {
    periodDays: number;
    funnel: { visits: number; inquiries: number; responded: number; holds: number; confirmed: number };
    rates: { visitToInquiryPct: number | null; inquiryToHoldPct: number | null; holdToConfirmedPct: number | null };
    averageFirstResponseMinutes: number | null;
    sources: Array<{ source: string; visits: number; inquiries: number; responded: number; holds: number; confirmed: number }>;
  };
  agentPipeline: { active: number; pending: number; total: number };
};

const CHANNEL_COLORS: Record<ChannelKey, string> = {
  NOLSAF_MARKETPLACE: "#047857",
  DIRECT_BOOKING: "#2563eb",
  WHATSAPP: "#16a34a",
  INSTAGRAM: "#db2777",
  AGENT_PORTAL: "#7c3aed",
  BOOKING_COM: "#0e7490",
  EXPEDIA: "#b45309",
  AIRBNB: "#e11d48",
  WALK_IN: "#525252",
  PHONE: "#a16207",
  OTHER: "#a3a3a3",
};

const FAMILY_LABELS: Record<ChannelFamily, string> = {
  MARKETPLACE: "Marketplace",
  DIRECT: "Direct",
  SOCIAL: "Social",
  B2B: "Travel trade",
  OTA: "OTA",
  ON_SITE: "On site",
};

const FAMILY_ICONS: Record<ChannelFamily, typeof Store> = {
  MARKETPLACE: Store,
  DIRECT: Target,
  SOCIAL: MessageSquareText,
  B2B: Handshake,
  OTA: Link2,
  ON_SITE: Users,
};

const STATE_STYLES: Record<ChannelState, { label: string; pill: string; dot: string; accent: string }> = {
  LIVE: { label: "Selling", pill: "bg-emerald-50 text-emerald-700 ring-emerald-100", dot: "bg-emerald-500", accent: "ring-emerald-200/70" },
  MANUAL: { label: "By hand", pill: "bg-amber-50 text-amber-800 ring-amber-100", dot: "bg-amber-500", accent: "ring-amber-200/80" },
  ATTENTION: { label: "Needs you", pill: "bg-rose-50 text-rose-700 ring-rose-100", dot: "bg-rose-500", accent: "ring-rose-200/80" },
  CONNECTED_IDLE: { label: "Quiet", pill: "bg-blue-50 text-blue-700 ring-blue-100", dot: "bg-blue-400", accent: "ring-neutral-200/80" },
  NOT_CONNECTED: { label: "Unused", pill: "bg-neutral-100 text-neutral-500 ring-neutral-200/60", dot: "bg-neutral-300", accent: "ring-neutral-200/70" },
};

const STATE_ORDER: Record<ChannelState, number> = { ATTENTION: 0, MANUAL: 1, LIVE: 2, CONNECTED_IDLE: 3, NOT_CONNECTED: 4 };

const ACTION_LABELS: Record<ChannelAction, string> = {
  CONNECT_CHANNEL_MANAGER: "Connect channel manager",
  FIX_CHANNEL: "Fix this connection",
  CONNECT_MESSAGING: "Link the account",
  FIX_MESSAGING: "Re-authorise",
  INVITE_AGENTS: "Invite an agency",
  REVIEW_AGENT_REQUESTS: "Review requests",
  COMPLETE_LISTING: "Check listing status",
  SHARE_BOOKING_LINK: "Get your booking link",
};

function actionHref(action: ChannelAction, channel: ChannelKey, propertyId: number): string {
  switch (action) {
    case "CONNECT_CHANNEL_MANAGER":
    case "FIX_CHANNEL":
      return `/owner/nrms/channels?provider=${channel}`;
    case "CONNECT_MESSAGING":
    case "FIX_MESSAGING":
      return "/owner/nrms/inquiries";
    case "INVITE_AGENTS":
      return "/owner/nrms/agents";
    case "REVIEW_AGENT_REQUESTS":
      return "/owner/nrms/agents/partnerships";
    case "COMPLETE_LISTING":
      return `/owner/properties/${propertyId}`;
    case "SHARE_BOOKING_LINK":
      return "/owner/nrms/qr-codes";
  }
}

const RANGE_OPTIONS = [
  { key: "month", label: "This month" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "year", label: "This year" },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeParams(range: RangeKey): { from: string; to: string } {
  const now = new Date();
  const to = dayKey(now);
  if (range === "month") return { from: `${to.slice(0, 8)}01`, to };
  if (range === "year") return { from: `${to.slice(0, 4)}-01-01`, to };
  const days = range === "30d" ? 29 : 89;
  return { from: dayKey(new Date(now.getTime() - days * 86_400_000)), to };
}

function moneyFormatter(currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  }
}

/**
 * Twelve columns of "TSh 45,762,500" is unreadable at a glance, so table cells
 * are compact and every one of them carries the exact figure as a tooltip.
 * The KPI cards and channel cards stay long-form.
 */
function compactMoneyFormatter(currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  } catch {
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  }
}

/**
 * Axis ticks. The old formatter divided by a thousand and always appended "k",
 * which turned 60,000,000 into "60000k". This steps through k, M and B.
 */
function axisNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))}B`;
  if (abs >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${Number((value / 1_000).toFixed(0))}k`;
  return String(Math.round(value));
}

const GRANULARITY_CAPTIONS: Record<"day" | "week" | "month", { sold: string; arrival: string }> = {
  day: { sold: "Each day a reservation was sold.", arrival: "Each day guests arrive." },
  week: { sold: "Each week a reservation was sold, from Monday.", arrival: "Each week guests arrive, from Monday." },
  month: { sold: "Each month a reservation was sold.", arrival: "Each month guests arrive." },
};

/** Hours below a day, so a 0.07 d lead time reads as "2 h" instead of nothing. */
function formatLeadTime(days: number): string {
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
  if (days < 10) return `${days.toFixed(1)} d`;
  return `${Math.round(days)} d`;
}

type SortKey = "reservations" | "roomNights" | "grossRevenue" | "netRevenue" | "revenueShare" | "adr" | "averageLeadTimeDays" | "settlementRate";

/**
 * Cell rules, as inset shadows because preflight is off and `border-b` renders
 * nothing. They are applied per cell rather than as `[&>td]:shadow-…` on the
 * row: a descendant selector outranks a class on the cell itself, so a row
 * level rule would silently erase the column group dividers. Two shadows on
 * one cell also have to be one class, since a second `shadow-*` replaces the
 * first rather than adding to it.
 */
const ROW_RULE = "shadow-[inset_0_-1px_0_0_#f8fafc]";
const ROW_RULE_DIVIDED = "shadow-[inset_1px_0_0_0_#f1f5f9,inset_0_-1px_0_0_#f8fafc]";
const HEAD_RULE = "shadow-[inset_0_-1px_0_0_#e2e8f0]";
const HEAD_RULE_DIVIDED = "shadow-[inset_1px_0_0_0_#f1f5f9,inset_0_-1px_0_0_#e2e8f0]";
const FOOT_RULE = "shadow-[inset_0_1px_0_0_#e2e8f0]";
const FOOT_RULE_DIVIDED = "shadow-[inset_1px_0_0_0_#f1f5f9,inset_0_1px_0_0_#e2e8f0]";
const GROUP_DIVIDER = "shadow-[inset_1px_0_0_0_#f1f5f9]";

export default function SalesChannelsPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [range, setRange] = useState<RangeKey>("90d");
  const [basis, setBasis] = useState<"BOOKED" | "STAY">("BOOKED");
  const [data, setData] = useState<SalesChannelResponse | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<SalesChannelResponse>(
        `/api/owner/nrms/sales-channels/property/${selectedPropertyId}`,
        { params: { ...rangeParams(range), basis } },
      );
      setData(response.data);
      setSelectedCurrency((current) => {
        if (response.data.currencies.some((entry) => entry.currency === current)) return current;
        return response.data.currencies[0]?.currency ?? response.data.property.currency ?? "";
      });
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Unable to load sales channel performance");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId, range, basis]);

  useEffect(() => { void load(); }, [load]);

  const report = useMemo(
    () => data?.currencies.find((entry) => entry.currency === selectedCurrency) ?? data?.currencies[0] ?? null,
    [data, selectedCurrency],
  );

  const currency = report?.currency || data?.property.currency || selectedProperty?.currency || "TZS";
  const formatMoney = useMemo(() => moneyFormatter(currency), [currency]);
  const formatCompact = useMemo(() => compactMoneyFormatter(currency), [currency]);
  const money = useCallback((value: number) => formatMoney.format(value), [formatMoney]);
  const compact = useCallback((value: number) => formatCompact.format(value), [formatCompact]);

  const producing = useMemo(() => (report?.channels ?? []).filter((row) => row.reservations > 0), [report]);

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "netRevenue", dir: "desc" });
  const applySort = useCallback((key: SortKey) => {
    // First click on a new column sorts biggest first, which is what anyone
    // scanning a league table wants. Clicking the same column flips it.
    setSort((current) => (current.key === key ? { key, dir: current.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }, []);

  const sortedRows = useMemo(() => {
    const factor = sort.dir === "desc" ? -1 : 1;
    return [...producing].sort((left, right) => {
      // Nulls (no lead time, no settlement) always sink, in both directions.
      const a = left[sort.key];
      const b = right[sort.key];
      if (a == null && b == null) return left.rank - right.rank;
      if (a == null) return 1;
      if (b == null) return -1;
      return (Number(a) - Number(b)) * factor || left.rank - right.rank;
    });
  }, [producing, sort]);

  // A column of seven identical "New" chips is noise. It only earns its place
  // once at least one channel has something to be compared against.
  const showTrend = useMemo(() => producing.some((row) => row.previousNetRevenue > 0), [producing]);
  const chartChannels = useMemo(() => producing.slice(0, 6).map((row) => row.key), [producing]);

  // Readiness carries the connection story, the currency report carries the
  // money. Joining them here is what stops a card reading "not connected"
  // beside several million shillings of revenue.
  const cards = useMemo(() => {
    const byKey = new Map((report?.channels ?? []).map((row) => [row.key, row]));
    return [...(data?.readiness ?? [])]
      .map((item) => ({ ...item, row: byKey.get(item.key) ?? null }))
      .sort((left, right) =>
        STATE_ORDER[left.state] - STATE_ORDER[right.state]
        || (right.row?.netRevenue ?? 0) - (left.row?.netRevenue ?? 0)
        || left.label.localeCompare(right.label));
  }, [data, report]);

  const counts = useMemo(() => ({
    live: cards.filter((card) => card.state === "LIVE").length,
    manual: cards.filter((card) => card.state === "MANUAL").length,
    attention: cards.filter((card) => card.state === "ATTENTION").length,
    unused: cards.filter((card) => card.state === "NOT_CONNECTED").length,
  }), [cards]);

  // The single most useful sentence on the page: the biggest pile of revenue
  // currently being handled by hand, or the loudest thing that is broken.
  const opportunity = useMemo(() => {
    const broken = cards.find((card) => card.state === "ATTENTION");
    if (broken) {
      return { tone: "rose" as const, title: `${broken.label} needs attention`, body: broken.detail, card: broken };
    }
    const manual = cards.filter((card) => card.state === "MANUAL").sort((left, right) => (right.row?.netRevenue ?? 0) - (left.row?.netRevenue ?? 0))[0];
    if (manual) {
      const amount = manual.row ? money(manual.row.netRevenue) : "Revenue";
      return {
        tone: "amber" as const,
        title: `${manual.label} is earning without being connected`,
        body: `${amount} came through ${manual.label} in this period, all typed in by hand. Connecting it removes the double entry and the risk of selling a room twice.`,
        card: manual,
      };
    }
    return null;
  }, [cards, money]);

  const badgeFor = useCallback((key: ChannelKey): Array<{ label: string; tone: string }> => {
    const highlights = report?.highlights;
    if (!highlights) return [];
    const badges: Array<{ label: string; tone: string }> = [];
    if (highlights.topRevenue === key) badges.push({ label: "Top earner", tone: "bg-emerald-50 text-emerald-700" });
    if (highlights.bestAdr === key) badges.push({ label: "Best rate", tone: "bg-violet-50 text-violet-700" });
    if (highlights.bestCollection === key) badges.push({ label: "Pays fastest", tone: "bg-blue-50 text-blue-700" });
    if (highlights.mostReliable === key) badges.push({ label: "Most reliable", tone: "bg-teal-50 text-teal-700" });
    if (highlights.fastestGrowing === key) badges.push({ label: "Fastest growing", tone: "bg-amber-50 text-amber-700" });
    return badges;
  }, [report]);

  const funnel = data?.funnel;
  const propertyId = data?.property.id ?? selectedPropertyId ?? 0;

  // The agency panel reads bookings and money from the agent list, but share
  // of the property's revenue only makes sense against the channel row.
  const agentRow = useMemo(() => (report?.channels ?? []).find((row) => row.key === "AGENT_PORTAL") ?? null, [report]);
  const agentSummary = useMemo(() => (data?.agents ?? []).reduce(
    (sum, agent) => ({ bookings: sum.bookings + agent.reservations, revenue: sum.revenue + agent.netRevenue }),
    { bookings: 0, revenue: 0 },
  ), [data]);

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 pb-10">
      <section className="flex flex-wrap items-center justify-between gap-4 px-1 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
            <TrendingUp className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Sales channels</h2>
            <p className="mb-0 mt-1 text-xs text-neutral-500">
              Every route a room can be sold through at {selectedProperty?.title ?? "this property"}, ranked by what it actually earns you.
            </p>
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-neutral-200 shadow-sm">
            {([["BOOKED", "Booked"], ["STAY", "Arrivals"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setBasis(value)}
                aria-pressed={basis === value}
                title={value === "BOOKED" ? "Count reservations by the day they were sold" : "Count reservations by the day the guest arrives"}
                className={`min-h-8 shrink-0 appearance-none rounded-lg border-0 px-3 text-[11px] font-bold transition ${basis === value ? "bg-neutral-900 text-white shadow-sm" : "bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-neutral-200 shadow-sm sm:flex-none">
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
            <label className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 text-xs font-bold text-neutral-700 ring-1 ring-neutral-200 shadow-sm">
              <CircleDollarSign className="h-3.5 w-3.5 text-neutral-400" />
              <span className="sr-only">Currency</span>
              <select value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)} className="border-0 bg-transparent p-0 text-xs font-bold outline-none">
                {data.currencies.map((entry) => <option key={entry.currency} value={entry.currency}>{entry.currency}</option>)}
              </select>
            </label>
          )}

          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh sales channels" className="inline-flex h-10 w-10 shrink-0 appearance-none items-center justify-center rounded-xl bg-white text-neutral-500 ring-1 ring-neutral-200 shadow-sm transition hover:text-emerald-700 hover:ring-emerald-200 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="appearance-none rounded-lg border-0 bg-red-100 px-3 py-2 text-xs font-bold text-red-800">Try again</button>
        </div>
      )}

      {loading && !data ? (
        <div className="flex min-h-72 items-center justify-center rounded-3xl bg-white text-neutral-500 ring-1 ring-neutral-200">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading sales channels…
        </div>
      ) : data ? (
        <>
          <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5" aria-label="Sales channel headlines">
            <KpiCard
              icon={Wallet}
              label="Net revenue"
              value={money(report?.summary.netRevenue ?? 0)}
              note={report?.summary.commission ? `After ${money(report.summary.commission)} commission` : "No commission deducted in this period"}
              tone="emerald"
              change={report?.summary.changePct ?? null}
            />
            <KpiCard icon={Store} label="Channels selling" value={`${report?.summary.activeChannels ?? 0} of ${data.readiness.length}`} note="Routes that produced at least one stay" tone="blue" />
            <KpiCard icon={Target} label="Commission free" value={`${(report?.highlights.commissionFreeShare ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`} note="Revenue you kept in full: direct, chat, on site" tone="violet" />
            <KpiCard icon={TrendingUp} label="Average daily rate" value={money(report?.summary.adr ?? 0)} note={`${(report?.summary.roomNights ?? 0).toLocaleString()} room nights sold`} tone="amber" />
            <KpiCard icon={Percent} label="Still owed" value={money(report?.summary.outstanding ?? 0)} note={`${report?.summary.cancellations ?? 0} cancelled, ${report?.summary.noShows ?? 0} no show`} tone={(report?.summary.outstanding ?? 0) > 0 ? "rose" : "emerald"} />
          </section>

          <section className="rounded-3xl bg-white p-5 ring-1 ring-neutral-200/80 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)] sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="m-0 text-lg font-bold text-neutral-950">Your sales force</h3>
                <p className="mb-0 mt-1 text-sm text-neutral-500">Who is selling your rooms right now, and which routes are still switched off.</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <CountChip value={counts.live} label="selling" dot="bg-emerald-500" />
                {counts.manual > 0 && <CountChip value={counts.manual} label="by hand" dot="bg-amber-500" />}
                {counts.attention > 0 && <CountChip value={counts.attention} label="need you" dot="bg-rose-500" />}
                <CountChip value={counts.unused} label="unused" dot="bg-neutral-300" />
              </div>
            </div>

            {opportunity && (
              <div className={`mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl p-4 ring-1 ${opportunity.tone === "rose" ? "bg-rose-50/70 ring-rose-200/70" : "bg-amber-50/70 ring-amber-200/70"}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${opportunity.tone === "rose" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                  <Lightbulb className="h-4 w-4" />
                </span>
                <div className="min-w-[16rem] flex-1">
                  <p className={`m-0 text-sm font-bold ${opportunity.tone === "rose" ? "text-rose-900" : "text-amber-900"}`}>{opportunity.title}</p>
                  <p className={`mb-0 mt-1 text-xs leading-4 ${opportunity.tone === "rose" ? "text-rose-800/80" : "text-amber-900/75"}`}>{opportunity.body}</p>
                </div>
                {opportunity.card.action && (
                  <Link
                    href={actionHref(opportunity.card.action, opportunity.card.key, propertyId)}
                    className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold text-white no-underline shadow-sm transition hover:no-underline ${opportunity.tone === "rose" ? "bg-rose-700 hover:bg-rose-800" : "bg-amber-700 hover:bg-amber-800"}`}
                  >
                    {ACTION_LABELS[opportunity.card.action]}<ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => {
                const style = STATE_STYLES[card.state];
                const Icon = FAMILY_ICONS[card.family];
                const revenue = card.row?.netRevenue ?? 0;
                const share = card.row?.revenueShare ?? 0;
                return (
                  <article
                    key={card.key}
                    className={`group flex flex-col rounded-2xl bg-white p-4 ring-1 transition hover:shadow-[0_16px_34px_-28px_rgba(15,23,42,0.6)] ${style.accent}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: CHANNEL_COLORS[card.key] }}>
                          {card.key === "INSTAGRAM" ? <Instagram className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                          <p className="m-0 truncate text-sm font-bold leading-5 text-neutral-900">{card.label}</p>
                          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">{FAMILY_LABELS[card.family]}</p>
                        </div>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${style.pill}`}>
                        {card.state === "MANUAL" ? <PenLine className="h-2.5 w-2.5" /> : <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />}
                        {style.label}
                      </span>
                    </div>

                    <div className="mt-3.5 flex items-end justify-between gap-3">
                      <p className={`m-0 text-lg font-bold leading-6 tabular-nums tracking-tight ${revenue > 0 ? "text-neutral-950" : "text-neutral-300"}`}>
                        {revenue > 0 ? money(revenue) : "No revenue yet"}
                      </p>
                      {card.reservations > 0 && (
                        <p className="m-0 shrink-0 text-[11px] font-semibold tabular-nums text-neutral-400">
                          {share > 0 ? `${share}% of revenue` : `${card.reservations} booked`}
                        </p>
                      )}
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${Math.min(100, Math.max(share > 0 ? 3 : 0, share))}%`, backgroundColor: CHANNEL_COLORS[card.key] }}
                      />
                    </div>

                    <p className="mb-0 mt-3.5 text-xs leading-4 text-neutral-500">{card.summary}</p>
                    <p className={`mb-0 mt-2 text-xs font-semibold leading-4 ${card.state === "MANUAL" ? "text-amber-800" : card.state === "ATTENTION" ? "text-rose-700" : "text-neutral-700"}`}>
                      {card.detail}
                    </p>

                    {card.action ? (
                      <Link
                        href={actionHref(card.action, card.key, propertyId)}
                        className="mt-auto inline-flex items-center gap-1 pt-3.5 text-xs font-bold text-emerald-700 no-underline transition hover:gap-1.5 hover:text-emerald-800 hover:no-underline"
                      >
                        {ACTION_LABELS[card.action]}<ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <span className="mt-auto inline-flex items-center gap-1 pt-3.5 text-xs font-semibold text-neutral-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />Nothing to do here
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {producing.length ? (
            <>
              <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                <article className="rounded-3xl bg-white p-5 ring-1 ring-neutral-200/80 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)] sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="m-0 text-lg font-bold text-neutral-950">Net revenue over time</h3>
                      <p className="mb-0 mt-1 text-sm text-neutral-500">
                        {basis === "BOOKED" ? GRANULARITY_CAPTIONS[data.granularity].sold : GRANULARITY_CAPTIONS[data.granularity].arrival}
                        {" "}Top {chartChannels.length} channel{chartChannels.length === 1 ? "" : "s"}, stacked.
                      </p>
                    </div>
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">
                      By {data.granularity}
                    </span>
                  </div>
                  <div className="mt-4 h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={52} tickFormatter={axisNumber} />
                        <Tooltip
                          cursor={{ fill: "rgba(15,23,42,0.04)" }}
                          formatter={(value: number, name: string) => [money(Number(value)), name]}
                          labelFormatter={(label: string) => (data.granularity === "week" ? `Week of ${label}` : label)}
                          contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }}
                          itemStyle={{ padding: "1px 0" }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={8} />
                        {chartChannels.map((key, index) => (
                          <Bar
                            key={key}
                            dataKey={key}
                            name={producing.find((row) => row.key === key)?.label ?? key}
                            stackId="channels"
                            fill={CHANNEL_COLORS[key]}
                            // Without a cap, a window with few buckets draws
                            // slabs the width of the card instead of a trend.
                            maxBarSize={44}
                            radius={index === chartChannels.length - 1 ? [3, 3, 0, 0] : undefined}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>

                <article className="flex flex-col rounded-3xl bg-white p-5 ring-1 ring-neutral-200/80 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)] sm:p-6">
                  <h3 className="m-0 text-lg font-bold text-neutral-950">Share of revenue</h3>
                  <p className="mb-0 mt-1 text-sm text-neutral-500">Gross accommodation and folio value before commission.</p>
                  <div className="mt-4 h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={producing} layout="vertical" margin={{ top: 2, right: 44, left: 4, bottom: 2 }} barCategoryGap="22%">
                        <XAxis type="number" domain={[0, 100]} hide />
                        <YAxis
                          type="category"
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "#475569" }}
                          tickLine={false}
                          axisLine={false}
                          width={104}
                          interval={0}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(15,23,42,0.04)" }}
                          formatter={(value: number, _name: string, item: any) => [`${value}% · ${money(item?.payload?.grossRevenue ?? 0)}`, "Share of gross"]}
                          contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }}
                        />
                        {/* minPointSize keeps a 0.13% channel visible as a sliver
                            rather than vanishing into the axis. */}
                        <Bar dataKey="revenueShare" radius={[0, 5, 5, 0]} minPointSize={3} maxBarSize={26}>
                          {producing.map((row) => <Cell key={row.key} fill={CHANNEL_COLORS[row.key]} />)}
                          <LabelList
                            dataKey="revenueShare"
                            position="right"
                            offset={8}
                            formatter={(value: number) => `${value >= 1 ? Math.round(value) : value}%`}
                            style={{ fontSize: 11, fontWeight: 700, fill: "#334155" }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>
              </section>

              <section className="overflow-hidden rounded-3xl bg-white ring-1 ring-neutral-200/80 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)]">
                <div className="flex flex-wrap items-end justify-between gap-3 p-5 pb-4 sm:p-6 sm:pb-4">
                  <div>
                    <h3 className="m-0 text-lg font-bold text-neutral-950">Channel league table</h3>
                    <p className="mb-0 mt-1 text-sm text-neutral-500">
                      Ranked by what reaches you after commission, for {data.range.from} to {data.range.to}. Click a column to re-sort.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
                    <Trophy className="h-3.5 w-3.5" />{producing[0]?.label ?? "No leader yet"}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] border-collapse text-sm">
                    <colgroup>
                      <col className="w-[248px]" />
                      <col span={2} className="w-[92px]" />
                      <col span={4} className="w-[116px]" />
                      <col span={2} className="w-[104px]" />
                      <col className="w-[168px]" />
                      {showTrend && <col className="w-[104px]" />}
                    </colgroup>
                    <thead>
                      {/* Group band: four ideas, not twelve columns. */}
                      <tr className="text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-300">
                        <th className="sticky left-0 z-20 bg-white px-5 pt-4 sm:px-6" />
                        <th colSpan={2} className="px-3 pt-4 text-right">Volume</th>
                        <th colSpan={4} className={`px-3 pt-4 text-right ${GROUP_DIVIDER}`}>Money</th>
                        <th colSpan={2} className={`px-3 pt-4 text-right ${GROUP_DIVIDER}`}>Rate and pace</th>
                        <th className={`px-3 pt-4 text-right ${GROUP_DIVIDER}`}>Settlement</th>
                        {showTrend && <th className={`px-5 pt-4 text-right sm:px-6 ${GROUP_DIVIDER}`}>Trend</th>}
                      </tr>
                      <tr className="text-left text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                        <th className={`sticky left-0 z-20 bg-white px-5 pb-3 pt-1.5 sm:px-6 ${HEAD_RULE}`}>Channel</th>
                        <SortableTh label="Bookings" sortKey="reservations" sort={sort} onSort={applySort} />
                        <SortableTh label="Nights" sortKey="roomNights" sort={sort} onSort={applySort} />
                        <SortableTh label="Gross" sortKey="grossRevenue" sort={sort} onSort={applySort} divider />
                        <th className={`px-3 pb-3 pt-1.5 text-right ${HEAD_RULE}`}>Commission</th>
                        <SortableTh label="Net" sortKey="netRevenue" sort={sort} onSort={applySort} />
                        <SortableTh label="Share" sortKey="revenueShare" sort={sort} onSort={applySort} />
                        <SortableTh label="ADR" sortKey="adr" sort={sort} onSort={applySort} divider />
                        <SortableTh label="Lead time" sortKey="averageLeadTimeDays" sort={sort} onSort={applySort} />
                        <SortableTh label="Paid / billed / due" sortKey="settlementRate" sort={sort} onSort={applySort} divider />
                        {showTrend && <th className={`px-5 pb-3 pt-1.5 text-right sm:px-6 ${HEAD_RULE_DIVIDED}`}>vs previous</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => (
                        <tr key={row.key} className="group transition hover:bg-neutral-50">
                          <td className={`sticky left-0 z-10 bg-white px-5 py-3.5 transition group-hover:bg-neutral-50 sm:px-6 ${ROW_RULE}`}>
                            <div className="flex items-center gap-3">
                              <span
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white tabular-nums shadow-sm"
                                style={{ backgroundColor: CHANNEL_COLORS[row.key] }}
                                title={`Rank ${row.rank} by net revenue`}
                              >
                                {row.rank}
                              </span>
                              <div className="min-w-0">
                                <p className="m-0 flex flex-wrap items-center gap-1.5 text-sm font-bold leading-5 text-neutral-900">
                                  {row.label}
                                  {badgeFor(row.key).map((badge) => (
                                    <span key={badge.label} className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] ${badge.tone}`}>{badge.label}</span>
                                  ))}
                                </p>
                                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">{FAMILY_LABELS[row.family]}</p>
                              </div>
                            </div>
                          </td>
                          <Num value={row.reservations} />
                          <Num value={row.roomNights} />
                          <Num value={row.grossRevenue} format={compact} title={money(row.grossRevenue)} divider />
                          <td className={`px-3 py-3.5 text-right text-[13px] tabular-nums ${ROW_RULE}`}>
                            {!row.commissionKnown ? (
                              <span className="cursor-help text-neutral-300" title="Charged by the OTA on their own invoice, outside NRMS">Not tracked</span>
                            ) : row.commission > 0 ? (
                              <span className="text-rose-600" title={money(row.commission)}>{compact(row.commission)}</span>
                            ) : (
                              <span className="text-emerald-600/70">None</span>
                            )}
                          </td>
                          <td className={`px-3 py-3.5 text-right text-[13px] font-bold tabular-nums text-neutral-950 ${ROW_RULE}`} title={money(row.netRevenue)}>{compact(row.netRevenue)}</td>
                          <td className={`px-3 py-3.5 ${ROW_RULE}`}>
                            <div className="flex items-center justify-end gap-2">
                              <span className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-neutral-100">
                                <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, row.revenueShare))}%`, backgroundColor: CHANNEL_COLORS[row.key] }} />
                              </span>
                              <span className="w-11 text-right text-[13px] tabular-nums text-neutral-700">{row.revenueShare}%</span>
                            </div>
                          </td>
                          <Num value={row.adr} format={compact} title={`${money(row.adr)} per room night`} divider />
                          <td className={`px-3 py-3.5 text-right text-[13px] tabular-nums text-neutral-500 ${ROW_RULE}`}>
                            {row.averageLeadTimeDays == null ? <span className="text-neutral-300">n/a</span> : formatLeadTime(row.averageLeadTimeDays)}
                          </td>
                          <td className={`px-3 py-3.5 ${ROW_RULE_DIVIDED}`}>
                            <SettlementBar row={row} money={money} />
                          </td>
                          {showTrend && <td className={`px-5 py-3.5 text-right sm:px-6 ${ROW_RULE_DIVIDED}`}><Trend value={row.changePct} /></td>}
                        </tr>
                      ))}
                    </tbody>
                    {report && (
                      <tfoot>
                        <tr className="bg-neutral-50/80 text-[13px] font-bold text-neutral-900">
                          <td className={`sticky left-0 z-10 bg-neutral-50/80 px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500 sm:px-6 ${FOOT_RULE}`}>
                            All channels
                          </td>
                          <td className={`px-3 py-3.5 text-right tabular-nums ${FOOT_RULE}`}>{report.summary.reservations}</td>
                          <td className={`px-3 py-3.5 text-right tabular-nums ${FOOT_RULE}`}>{report.summary.roomNights}</td>
                          <td className={`px-3 py-3.5 text-right tabular-nums ${FOOT_RULE_DIVIDED}`} title={money(report.summary.grossRevenue)}>{compact(report.summary.grossRevenue)}</td>
                          <td className={`px-3 py-3.5 text-right tabular-nums ${report.summary.commission > 0 ? "text-rose-600" : "text-neutral-400"} ${FOOT_RULE}`} title={money(report.summary.commission)}>
                            {report.summary.commission > 0 ? compact(report.summary.commission) : "None"}
                          </td>
                          <td className={`px-3 py-3.5 text-right tabular-nums ${FOOT_RULE}`} title={money(report.summary.netRevenue)}>{compact(report.summary.netRevenue)}</td>
                          <td className={`px-3 py-3.5 text-right tabular-nums text-neutral-400 ${FOOT_RULE}`}>100%</td>
                          <td className={`px-3 py-3.5 text-right tabular-nums ${FOOT_RULE_DIVIDED}`} title={`${money(report.summary.adr)} per room night`}>{compact(report.summary.adr)}</td>
                          <td className={`px-3 py-3.5 ${FOOT_RULE}`} />
                          <td className={`px-3 py-3.5 ${FOOT_RULE_DIVIDED}`}>
                            <SettlementBar
                              row={{
                                settled: report.summary.settled,
                                routed: report.summary.routed,
                                outstanding: report.summary.outstanding,
                                grossRevenue: report.summary.grossRevenue,
                              }}
                              money={money}
                            />
                          </td>
                          {showTrend && <td className={`px-5 py-3.5 text-right sm:px-6 ${FOOT_RULE_DIVIDED}`}><Trend value={report.summary.changePct} /></td>}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-neutral-50/60 px-5 py-3 shadow-[inset_0_1px_0_0_#f1f5f9] sm:px-6">
                  <LegendKey color="bg-emerald-500" label="Paid" />
                  <LegendKey color="bg-violet-500" label="On an agency bill" />
                  <LegendKey color="bg-amber-400" label="Still due" />
                  <p className="m-0 flex-1 text-[11px] leading-4 text-neutral-500">
                    Agency money sits on a master folio, not the guest folio, so a travel-agent row is billed rather than unpaid.
                    Marketplace commission comes from the payout invoice and is exact. OTA commission is invoiced by the OTA outside NRMS.
                  </p>
                </div>
              </section>
            </>
          ) : (
            // Rings cannot be dashed, so dashed edges use outline utilities.
            <section className="rounded-3xl bg-white px-6 py-16 text-center outline outline-1 outline-dashed outline-neutral-300">
              <TrendingUp className="mx-auto h-10 w-10 text-neutral-300" />
              <h3 className="mb-0 mt-4 text-lg font-bold text-neutral-800">No confirmed stays in this period</h3>
              <p className="mb-0 mt-1 text-sm text-neutral-500">Widen the date range, or connect a channel above to start selling through it.</p>
            </section>
          )}

          {funnel && (funnel.funnel.visits > 0 || funnel.funnel.inquiries > 0) && (
            <section className="rounded-3xl bg-white p-5 ring-1 ring-neutral-200/80 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)] sm:p-6">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="m-0 text-lg font-bold text-neutral-950">Enquiry to booking funnel</h3>
                  <p className="mb-0 mt-1 text-sm text-neutral-500">Where interest is lost before a reservation ever exists.</p>
                </div>
                {funnel.averageFirstResponseMinutes != null && (
                  <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 ring-1 ring-blue-100">
                    {funnel.averageFirstResponseMinutes} min average first reply
                  </span>
                )}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
                <FunnelStep label="Page views" value={funnel.funnel.visits} />
                <FunnelStep label="Enquiries" value={funnel.funnel.inquiries} rate={funnel.rates.visitToInquiryPct} rateLabel="of views" />
                <FunnelStep label="Answered" value={funnel.funnel.responded} />
                <FunnelStep label="Held rooms" value={funnel.funnel.holds} rate={funnel.rates.inquiryToHoldPct} rateLabel="of enquiries" />
                <FunnelStep label="Confirmed" value={funnel.funnel.confirmed} rate={funnel.rates.holdToConfirmedPct} rateLabel="of holds" tone="emerald" />
              </div>
              {funnel.sources.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400 [&>th]:shadow-[inset_0_-1px_0_0_#f1f5f9]">
                        <th className="py-2 pr-3">Source</th>
                        <th className="px-3 py-2 text-right">Views</th>
                        <th className="px-3 py-2 text-right">Enquiries</th>
                        <th className="px-3 py-2 text-right">Answered</th>
                        <th className="px-3 py-2 text-right">Held</th>
                        <th className="py-2 pl-3 text-right">Confirmed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnel.sources.map((source) => (
                        <tr key={source.source} className="[&>td]:shadow-[inset_0_-1px_0_0_#f8fafc] [&:last-child>td]:shadow-none">
                          <td className="py-2.5 pr-3 font-semibold text-neutral-800">{source.source.replaceAll("_", " ")}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{source.visits}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{source.inquiries}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{source.responded}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{source.holds}</td>
                          <td className="py-2.5 pl-3 text-right font-bold tabular-nums text-neutral-900">{source.confirmed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {(data.agents.length > 0 || data.agentPipeline.total > 0) && (
            <section className="rounded-3xl bg-white p-5 ring-1 ring-neutral-200/80 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.5)] sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="m-0 text-lg font-bold text-neutral-950">Travel agents selling for you</h3>
                  <p className="mb-0 mt-1 text-sm text-neutral-500">Approved agencies booking against your live inventory at their negotiated rates.</p>
                </div>
                <Link
                  href="/owner/nrms/agents"
                  className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3.5 text-xs font-bold text-neutral-700 no-underline ring-1 ring-neutral-200 transition hover:text-violet-700 hover:no-underline hover:ring-violet-200"
                >
                  Manage agencies<ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {/* Pending requests were only ever stated inside a chip, with no
                  way to act on them from here. They are the one thing on this
                  card that needs a decision, so they get their own row. */}
              {data.agentPipeline.pending > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/70">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800"><Inbox className="h-4 w-4" /></span>
                  <div className="min-w-[14rem] flex-1">
                    <p className="m-0 text-sm font-bold text-amber-900">
                      {data.agentPipeline.pending} partnership request{data.agentPipeline.pending === 1 ? "" : "s"} waiting for your decision
                    </p>
                    <p className="mb-0 mt-1 text-xs leading-4 text-amber-900/75">Each approval adds another agency selling your rooms at rates you set.</p>
                  </div>
                  <Link
                    href="/owner/nrms/agents/partnerships"
                    className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl bg-amber-700 px-3.5 text-xs font-bold text-white no-underline shadow-sm transition hover:bg-amber-800 hover:no-underline"
                  >
                    Review requests<ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-neutral-200/70 ring-1 ring-neutral-200/70 sm:grid-cols-4">
                <AgentStat label="Active agencies" value={String(data.agentPipeline.active)} />
                <AgentStat label="Bookings produced" value={String(agentSummary.bookings)} />
                <AgentStat label="Net revenue" value={agentRow ? money(agentRow.netRevenue) : money(agentSummary.revenue)} />
                <AgentStat
                  label="Share of revenue"
                  value={agentRow ? `${agentRow.revenueShare}%` : "0%"}
                  tone={agentRow && agentRow.revenueShare >= 50 ? "violet" : "neutral"}
                />
              </div>

              {data.agents.length ? (
                <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
                  {data.agents.map((agent, index) => {
                    const share = agentSummary.revenue > 0 ? Math.round((agent.netRevenue / agentSummary.revenue) * 100) : 0;
                    const perBooking = agent.reservations > 0 ? agent.netRevenue / agent.reservations : 0;
                    const format = moneyFormatter(agent.currency);
                    return (
                      <li key={`${agent.id}-${agent.currency}`} className="flex flex-col rounded-2xl bg-white p-4 ring-1 ring-neutral-200/70 transition hover:ring-violet-200">
                        <div className="flex items-start gap-3">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold tabular-nums ${index === 0 ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-700"}`}>
                            {index + 1}
                          </span>
                          {/* Wraps to two lines rather than truncating: an
                              agency name is how the owner identifies it. */}
                          <p className="m-0 line-clamp-2 min-w-0 flex-1 text-sm font-bold leading-5 text-neutral-900" title={agent.name}>
                            {agent.name}
                          </p>
                        </div>
                        <p className="mb-0 mt-3 text-lg font-bold leading-6 tabular-nums tracking-tight text-neutral-950">{format.format(agent.netRevenue)}</p>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                          <div className="h-full rounded-full bg-violet-500 transition-[width] duration-500" style={{ width: `${Math.max(3, share)}%` }} />
                        </div>
                        <p className="mb-0 mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
                          <span className="font-semibold text-neutral-700">{agent.reservations} booking{agent.reservations === 1 ? "" : "s"}</span>
                          <span className="text-neutral-300">·</span>
                          <span>{format.format(perBooking)} each</span>
                          {data.agents.length > 1 && (
                            <>
                              <span className="text-neutral-300">·</span>
                              <span>{share}% of agency sales</span>
                            </>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mt-3 flex flex-col items-center justify-center rounded-2xl bg-neutral-50/70 px-6 py-10 text-center outline outline-1 outline-dashed outline-neutral-300">
                  <Handshake className="h-8 w-8 text-neutral-300" />
                  <p className="mb-0 mt-3 text-sm font-bold text-neutral-700">
                    {data.agentPipeline.active > 0 ? "No agency booked in this period" : "No agency is selling your rooms yet"}
                  </p>
                  <p className="mb-0 mt-1 max-w-sm text-xs leading-4 text-neutral-500">
                    {data.agentPipeline.active > 0
                      ? "Your approved agencies have live access. Widen the date range to see earlier bookings."
                      : "Approved agencies book against the same inventory as your front desk, at rates you set, with no OTA commission."}
                  </p>
                  <Link
                    href="/owner/nrms/agents"
                    className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white no-underline shadow-sm transition hover:bg-violet-700 hover:no-underline"
                  >
                    {data.agentPipeline.active > 0 ? "Manage agencies" : "Invite an agency"}<ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}

function SortableTh({ label, sortKey, sort, onSort, divider = false }: {
  label: string; sortKey: SortKey; sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void; divider?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 pb-3 pt-1.5 text-right ${divider ? HEAD_RULE_DIVIDED : HEAD_RULE}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex w-full appearance-none items-center justify-end gap-1 border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-[0.08em] transition ${active ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700"}`}
      >
        {label}
        <ChevronDown className={`h-3 w-3 shrink-0 transition ${active ? (sort.dir === "asc" ? "rotate-180 opacity-100" : "opacity-100") : "opacity-0"}`} />
      </button>
    </th>
  );
}

/** Right-aligned numeric cell. Zeros are dimmed so real numbers stand out. */
function Num({ value, format, title, divider = false }: {
  value: number; format?: (value: number) => string; title?: string; divider?: boolean;
}) {
  return (
    <td
      title={title}
      className={`px-3 py-3.5 text-right text-[13px] tabular-nums ${value > 0 ? "text-neutral-700" : "text-neutral-300"} ${divider ? ROW_RULE_DIVIDED : ROW_RULE}`}
    >
      {format ? format(value) : value.toLocaleString()}
    </td>
  );
}

/**
 * One bar answering "where is this money?": cash received, sitting on an agency
 * bill, or still owed. A single "collected %" cannot say that, which is how a
 * fully billed travel-agent channel ended up reading as 0% collected.
 */
function SettlementBar({ row, money }: {
  row: { settled: number; routed: number; outstanding: number; grossRevenue: number };
  money: (value: number) => string;
}) {
  const total = Math.max(row.grossRevenue, row.settled + row.routed + row.outstanding, 1);
  const width = (value: number) => `${Math.max(0, (value / total) * 100)}%`;
  const label = [
    row.settled > 0 ? `${money(row.settled)} paid` : null,
    row.routed > 0 ? `${money(row.routed)} on an agency bill` : null,
    row.outstanding > 0 ? `${money(row.outstanding)} still due` : null,
  ].filter(Boolean).join(" · ") || "Nothing recorded";
  const accountedFor = Math.round(((row.settled + row.routed) / total) * 100);

  return (
    <div className="flex items-center justify-end gap-2.5" title={label}>
      <span className="flex h-2 w-24 shrink-0 overflow-hidden rounded-full bg-neutral-100">
        <span className="block h-full bg-emerald-500" style={{ width: width(row.settled) }} />
        <span className="block h-full bg-violet-500" style={{ width: width(row.routed) }} />
        <span className="block h-full bg-amber-400" style={{ width: width(row.outstanding) }} />
      </span>
      <span className={`w-10 text-right text-[13px] font-semibold tabular-nums ${accountedFor >= 100 ? "text-emerald-700" : accountedFor > 0 ? "text-neutral-700" : "text-neutral-300"}`}>
        {accountedFor}%
      </span>
    </div>
  );
}

/** One cell of the agency stat strip. Hairlines come from the parent's gap-px. */
function AgentStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "violet" }) {
  return (
    <div className="min-w-0 bg-white p-3.5">
      <p className="m-0 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">{label}</p>
      <p className={`mb-0 mt-1 truncate text-base font-bold tabular-nums ${tone === "violet" ? "text-violet-700" : "text-neutral-950"}`} title={value}>{value}</p>
    </div>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-neutral-600">
      <span className={`h-2 w-2 rounded-full ${color}`} />{label}
    </span>
  );
}

function CountChip({ value, label, dot }: { value: number; label: string; dot: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-neutral-600 ring-1 ring-neutral-200/80">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="tabular-nums text-neutral-900">{value}</span>
      <span className="font-semibold text-neutral-500">{label}</span>
    </span>
  );
}

function Trend({ value }: { value: number | null }) {
  if (value == null) return <span className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-400"><Minus className="h-3 w-3" />New</span>;
  if (value > 0) return <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><ArrowUpRight className="h-3.5 w-3.5" />{value}%</span>;
  if (value < 0) return <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700"><ArrowDownRight className="h-3.5 w-3.5" />{Math.abs(value)}%</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-400"><Minus className="h-3 w-3" />Flat</span>;
}

function KpiCard({ icon: Icon, label, value, note, tone, change }: {
  icon: typeof TrendingUp; label: string; value: string; note: string;
  tone: "emerald" | "rose" | "blue" | "amber" | "violet"; change?: number | null;
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return (
    <article className="flex min-h-[138px] flex-col rounded-xl bg-white p-4 ring-1 ring-neutral-200/80 shadow-[0_12px_30px_-30px_rgba(15,23,42,0.45)]">
      <div className="flex min-w-0 items-center justify-between gap-2.5">
        <p className="m-0 truncate text-[11px] font-semibold leading-4 text-neutral-500">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <p className="mb-0 mt-2 whitespace-nowrap text-base font-bold leading-5 tabular-nums tracking-tight text-neutral-950">{value}</p>
      {change !== undefined && (
        <p className="m-0 mt-1.5 flex items-center gap-1 text-[11px]"><Trend value={change} /><span className="text-neutral-400">vs previous period</span></p>
      )}
      <p className="mb-0 mt-auto pt-2 text-[11px] leading-4 text-neutral-500">{note}</p>
    </article>
  );
}

function FunnelStep({ label, value, rate, rateLabel, tone = "neutral" }: {
  label: string; value: number; rate?: number | null; rateLabel?: string; tone?: "neutral" | "emerald";
}) {
  return (
    <div className={`rounded-2xl p-4 ring-1 ${tone === "emerald" ? "bg-emerald-50/60 ring-emerald-200/70" : "bg-white ring-neutral-200/70"}`}>
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500">{label}</p>
      <p className="mb-0 mt-1.5 text-xl font-bold tabular-nums text-neutral-950">{value.toLocaleString()}</p>
      {rate != null && <p className="mb-0 mt-1 flex items-center gap-1 text-[11px] text-neutral-500"><CheckCircle2 className="h-3 w-3 text-emerald-600" />{rate}% {rateLabel}</p>}
    </div>
  );
}
