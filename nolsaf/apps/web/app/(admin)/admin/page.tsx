"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Eye,
  EyeOff,
  Landmark,
  ReceiptText,
  RefreshCw,
  ScanLine,
  Users,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import GeneralReports from "@/components/GeneralReports";
import CheckinCodeCard from "@/components/admin/CheckinCodeCard";

// Relative paths go through the Next.js rewrites (no CORS).
const API = "";

type Overview = {
  ownersCount?: number;
  propertiesCount?: number;
  totalPayment?: number;
  companyRevenue?: number;
  companyRevenueTour?: number;
  companyRevenueTourCurrency?: string;
  owedToPayees?: number;
  owedToPayeesCount?: number;
  disbursedToPayees?: number;
  lastUpdated?: string;
};
type StageTotal = { stage: string; label: string; count: number; netPayable: number };

/** Property review states, in the order an admin works them. */
const PROPERTY_ROWS: Array<{ key: string; label: string; bar: string; attention?: boolean }> = [
  { key: "PENDING", label: "Awaiting review", bar: "bg-amber-400", attention: true },
  { key: "NEEDS_FIXES", label: "Sent back for fixes", bar: "bg-orange-400", attention: true },
  { key: "SUSPENDED", label: "Suspended", bar: "bg-rose-400" },
  { key: "APPROVED", label: "Live", bar: "bg-emerald-500" },
  { key: "REJECTED", label: "Rejected", bar: "bg-neutral-400" },
];

/** Payout stages shown on the dashboard (see lib/invoiceMoneyStage.ts on the API). */
const PAYOUT_ROWS: Array<{ keys: string[]; label: string; bar: string; attention?: boolean }> = [
  { keys: ["GUEST_PAID"], label: "Guest paid, not claimed", bar: "bg-sky-500" },
  { keys: ["IN_REVIEW"], label: "Claims in review", bar: "bg-amber-400", attention: true },
  { keys: ["DISBURSING"], label: "Disbursing", bar: "bg-violet-500" },
  { keys: ["ON_HOLD", "FAILED"], label: "On hold or failed", bar: "bg-rose-500", attention: true },
  { keys: ["DISBURSED"], label: "Disbursed", bar: "bg-emerald-500" },
];

const SHORTCUTS: Array<{ href: string; label: string; detail: string; icon: typeof Users }> = [
  { href: "/admin/properties/previews", label: "Property previews", detail: "Review and approve listings", icon: Building2 },
  { href: "/admin/owners", label: "Owners", detail: "Accounts, KYC and statements", icon: Users },
  { href: "/admin/management/invoices", label: "Invoices", detail: "Payout claims and receipts", icon: ReceiptText },
  { href: "/admin/disbursements", label: "Disbursements", detail: "Batches and transfers", icon: Landmark },
  { href: "/admin/finance", label: "Finance overview", detail: "Revenue across all streams", icon: WalletCards },
];

const MASK = "••••••";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function compactTzs(amount: number) {
  if (amount >= 1_000_000_000) return `TSh ${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `TSh ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 10_000) return `TSh ${Math.round(amount / 1000)}K`;
  return `TSh ${fmt(amount)}`;
}

function eatClock(iso?: string) {
  if (!iso) return "";
  return `${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

function StatusRows({
  rows,
  total,
  loading,
}: {
  rows: Array<{ label: string; count: number; detail?: string; bar: string; attention?: boolean }>;
  total: number;
  loading: boolean;
}) {
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((row) => {
        const share = total ? Math.round((row.count / total) * 100) : 0;
        const flagged = row.attention && row.count > 0;
        return (
          <li key={row.label} className="border-0 border-t border-solid border-neutral-100 px-4 py-2.5 first:border-t-0">
            <div className="flex items-center justify-between gap-3">
              <span className={`inline-flex min-w-0 items-center gap-2 text-sm ${flagged ? "font-semibold text-neutral-900" : "text-neutral-700"}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${row.bar}`} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {row.detail ? <span className="text-[11px] tabular-nums text-neutral-400">{row.detail}</span> : null}
                <span className={`text-sm font-bold tabular-nums ${flagged ? "text-amber-700" : "text-neutral-900"}`}>{loading ? "..." : row.count.toLocaleString()}</span>
              </span>
            </div>
            <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-100">
              <span className={`block h-full rounded-full ${row.bar}`} style={{ width: `${row.count > 0 ? Math.max(share, 3) : 0}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminHome() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(true);
  const [showAmounts, setShowAmounts] = useState(false);
  const [propertyCounts, setPropertyCounts] = useState<Record<string, number>>({});
  const [loadingProperties, setLoadingProperties] = useState(true);
  const [payoutStages, setPayoutStages] = useState<StageTotal[]>([]);
  const [loadingPayouts, setLoadingPayouts] = useState(true);


  // All-time platform figures. /admin/stats/overview has no date window.
  const loadKpis = useCallback(async () => {
    setLoadingKpis(true);
    try {
      const res = await fetch(`${API}/admin/stats/overview`, { credentials: "include" });
      setOverview(res.ok ? await res.json() : null);
    } catch {
      setOverview(null);
    } finally {
      setLoadingKpis(false);
    }
  }, []);

  // True counts per review state (the old widget counted one page of rows, capped at 6).
  const loadProperties = useCallback(async () => {
    setLoadingProperties(true);
    try {
      const res = await fetch(`${API}/api/admin/properties/counts`, { credentials: "include" });
      setPropertyCounts(res.ok ? await res.json() : {});
    } catch {
      setPropertyCounts({});
    } finally {
      setLoadingProperties(false);
    }
  }, []);

  // Payout invoices by money stage, the same figures as the Invoices page.
  const loadPayouts = useCallback(async () => {
    setLoadingPayouts(true);
    try {
      const res = await fetch(`${API}/api/admin/invoices?page=1&pageSize=1`, { credentials: "include" });
      const json = res.ok ? await res.json() : null;
      setPayoutStages(Array.isArray(json?.stages) ? json.stages : []);
    } catch {
      setPayoutStages([]);
    } finally {
      setLoadingPayouts(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    void loadKpis();
    void loadProperties();
    void loadPayouts();
  }, [loadKpis, loadProperties, loadPayouts]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Refresh when a payment lands.
  useEffect(() => {
    // WebSockets bypass the Next.js rewrite for upgrades in some setups, so an
    // explicit socket URL wins; otherwise this site's own origin, which proxies
    // /socket.io to the API. Never localhost in production.
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
    if (!url) return;

    const s: Socket = io(url, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    s.on("connect", () => {
      s.emit("join-admin-room", (response: any) => {
        if (response?.error) console.warn("[Socket.IO] Failed to join admin room:", response.error);
      });
    });
    s.on("connect_error", (error: Error) => console.warn("[Socket.IO] Connection error:", error.message));
    const onPaid = () => { void loadKpis(); void loadPayouts(); };
    s.on("admin:invoice:paid", onPaid);
    return () => {
      s.off("admin:invoice:paid", onPaid);
      s.emit("leave-admin-room", () => {});
      s.disconnect();
    };
  }, [loadKpis, loadPayouts]);

  const money = (value: number | undefined) => (showAmounts ? compactTzs(Number(value ?? 0)) : MASK);
  const tourRevenue = Number(overview?.companyRevenueTour ?? 0);
  const facts = [
    { label: "Active owners", value: loadingKpis ? "..." : fmt(Number(overview?.ownersCount ?? 0)), detail: "verified, with a live property", tone: "text-white" },
    { label: "Live properties", value: loadingKpis ? "..." : fmt(Number(overview?.propertiesCount ?? 0)), detail: "approved listings", tone: "text-white" },
    { label: "Guest bookings", value: loadingKpis ? "..." : money(overview?.totalPayment), detail: "confirmed stays, all time", tone: "text-white" },
    {
      label: "Owed to payees",
      value: loadingKpis ? "..." : money(overview?.owedToPayees),
      detail: `${fmt(Number(overview?.owedToPayeesCount ?? 0))} invoices · ${showAmounts ? compactTzs(Number(overview?.disbursedToPayees ?? 0)) : MASK} delivered`,
      tone: Number(overview?.owedToPayeesCount ?? 0) > 0 ? "text-amber-300" : "text-white",
    },
    {
      label: "NoLSAF revenue",
      value: loadingKpis ? "..." : money(overview?.companyRevenue),
      detail: tourRevenue > 0 ? `commission · plus ${showAmounts ? `${overview?.companyRevenueTourCurrency ?? "USD"} ${fmt(tourRevenue)}` : MASK} tours` : "commission, property and transport",
      tone: "text-emerald-300",
    },
  ];

  const propertyTotal = PROPERTY_ROWS.reduce((sum, row) => sum + Number(propertyCounts[row.key] ?? 0), 0);
  const propertyAttention = Number(propertyCounts.PENDING ?? 0) + Number(propertyCounts.NEEDS_FIXES ?? 0);
  const stageCount = (keys: string[]) => payoutStages.filter((s) => keys.includes(s.stage)).reduce((sum, s) => sum + s.count, 0);
  const stageNet = (keys: string[]) => payoutStages.filter((s) => keys.includes(s.stage)).reduce((sum, s) => sum + s.netPayable, 0);
  const payoutTotal = PAYOUT_ROWS.reduce((sum, row) => sum + stageCount(row.keys), 0);
  const payoutAttention = stageCount(["IN_REVIEW", "ON_HOLD", "FAILED"]);

  const cardClass = "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm";
  const cardHead = "flex items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3";
  const cardIcon = "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300";
  const heroButton =
    "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Control centre</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Owners control dashboard</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Owners, properties and the money moving between guests, NoLSAF and payees, live.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => setShowAmounts((v) => !v)} className={heroButton} aria-pressed={showAmounts}>
                {showAmounts ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showAmounts ? "Hide amounts" : "Show amounts"}
              </button>
              <button type="button" onClick={refreshAll} disabled={loadingKpis} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loadingKpis ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-5 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 lg:pl-5" : ""} ${index > 0 && index % 2 === 0 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50" title={fact.detail}>{fact.detail}</dd>
              </div>
            ))}
          </dl>
          {overview?.lastUpdated && <p className="m-0 mt-4 text-[11px] text-white/40">Updated {eatClock(overview.lastUpdated)} · all-time figures</p>}
        </div>
      </section>

      {/* Needs attention */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className={cardClass}>
          <div className={cardHead}>
            <span className={cardIcon}><Building2 className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Property approvals</h2>
              <p className="m-0 text-xs text-neutral-500">{loadingProperties ? "Loading..." : propertyAttention ? `${propertyAttention} waiting on an admin` : "Nothing waiting"}</p>
            </div>
            <Link href="/admin/properties/previews" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">
              Open <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <StatusRows
            loading={loadingProperties}
            total={propertyTotal}
            rows={PROPERTY_ROWS.map((row) => ({ label: row.label, count: Number(propertyCounts[row.key] ?? 0), bar: row.bar, attention: row.attention }))}
          />
        </section>

        <section className={cardClass}>
          <div className={cardHead}>
            <span className={cardIcon}><ReceiptText className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Payout invoices</h2>
              <p className="m-0 text-xs text-neutral-500">{loadingPayouts ? "Loading..." : payoutAttention ? `${payoutAttention} need an admin` : "Nothing needs action"}</p>
            </div>
            <Link href="/admin/management/invoices" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">
              Open <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <StatusRows
            loading={loadingPayouts}
            total={payoutTotal}
            rows={PAYOUT_ROWS.map((row) => ({
              label: row.label,
              count: stageCount(row.keys),
              detail: showAmounts && stageCount(row.keys) ? compactTzs(stageNet(row.keys)) : undefined,
              bar: row.bar,
              attention: row.attention,
            }))}
          />
        </section>

        <section className={cardClass}>
          <div className={cardHead}>
            <span className={cardIcon}><ScanLine className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Check-in code</h2>
              <p className="m-0 text-xs text-neutral-500">Validate a guest&apos;s code for an owner who cannot</p>
            </div>
          </div>
          <CheckinCodeCard />
        </section>
      </div>


      {/* Shortcuts */}
      <nav aria-label="Shortcuts" className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-neutral-200 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        {SHORTCUTS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="group flex min-w-0 items-center gap-3 bg-white px-4 py-3 no-underline transition-colors hover:bg-neutral-50 hover:no-underline">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><Icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-neutral-900">{item.label}</span>
                <span className="block truncate text-[11px] text-neutral-500">{item.detail}</span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-neutral-300 transition-colors group-hover:text-[#02665e]" />
            </Link>
          );
        })}
      </nav>

      <GeneralReports />
    </div>
  );
}
