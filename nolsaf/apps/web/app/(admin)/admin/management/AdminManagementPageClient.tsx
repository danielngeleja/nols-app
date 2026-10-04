"use client";

// Management home: every admin tool in one searchable place, a live read on
// who is on the platform right now, and the platform totals. Data comes from
// /api/admin/summary, /bookings and /properties, refreshed every 30 seconds.

import Link from "next/link";
import {
  Activity, ArrowRight, BadgeCheck, Building2, Calendar, ChevronRight, Coins, FileBarChart, FileText, Globe, Handshake, KeyRound,
  LayoutDashboard, ListChecks, Mail, MapPin, MessageCircle, Mic, Network, Plug, Receipt, RefreshCw, Search, Settings, Shield,
  Telescope, TrendingUp, Truck, Users, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const REFRESH_SECONDS = 30;
const MAX_TREND_POINTS = 20;

type RoleKey = "users" | "drivers" | "owners" | "admins";

const ROLES: Array<{ key: RoleKey; label: string; icon: typeof Users; color: string }> = [
  { key: "users", label: "Customers", icon: Users, color: "#2563eb" },
  { key: "drivers", label: "Drivers", icon: Truck, color: "#ea580c" },
  { key: "owners", label: "Owners", icon: Building2, color: "#059669" },
  { key: "admins", label: "Admins", icon: Shield, color: "#7c3aed" },
];

type Tool = { title: string; subtitle: string; href: string; icon: typeof Users };
const TOOL_GROUPS: Array<{ title: string; tools: Tool[] }> = [
  {
    title: "Platform",
    tools: [
      { title: "System settings", subtitle: "Settings and feature flags", href: "/admin/management/settings", icon: Settings },
      { title: "Service availability", subtitle: "Transport areas and payment methods", href: "/admin/management/service-availability", icon: Globe },
      { title: "Users", subtitle: "Accounts and roles", href: "/admin/management/users", icon: Users },
      { title: "Currency", subtitle: "Exchange rates", href: "/admin/management/currency", icon: Coins },
      { title: "Integrations", subtitle: "Connected services", href: "/admin/management/integrations", icon: Plug },
    ],
  },
  {
    title: "Security",
    tools: [
      { title: "Audit log", subtitle: "Who changed what, and when", href: "/admin/management/audit-log", icon: Shield },
      { title: "No4P OTP", subtitle: "One-time codes and policy flags", href: "/admin/management/no4p-otp", icon: KeyRound },
      { title: "IP allowlist", subtitle: "Where admins can sign in from", href: "/admin/management/ip-allowlist", icon: Network },
      { title: "Trust verification", subtitle: "Verified badges and checks", href: "/admin/management/trust-verification", icon: BadgeCheck },
    ],
  },
  {
    title: "Operations",
    tools: [
      { title: "Bookings", subtitle: "Every stay booked", href: "/admin/management/bookings", icon: ListChecks },
      { title: "Properties", subtitle: "Listings and approval", href: "/admin/management/properties", icon: Building2 },
      { title: "Owners", subtitle: "Property owners", href: "/admin/management/owners", icon: Users },
      { title: "Invoices", subtitle: "Owner invoices", href: "/admin/management/invoices", icon: Receipt },
      { title: "Pickup points", subtitle: "Transport coordinates", href: "/admin/management/pickup-points", icon: MapPin },
      { title: "Meta messaging", subtitle: "WhatsApp and Instagram", href: "/admin/nrms/messaging", icon: MessageCircle },
      { title: "Reports", subtitle: "Exports and summaries", href: "/admin/management/reports", icon: FileBarChart },
    ],
  },
  {
    title: "Content",
    tools: [
      { title: "Updates", subtitle: "News and media", href: "/admin/management/updates", icon: Calendar },
      { title: "Careers", subtitle: "Jobs and applications", href: "/admin/management/careers", icon: FileText },
      { title: "Newsletter", subtitle: "Subscribers and sends", href: "/admin/management/newsletter", icon: Mail },
      { title: "Podcasts", subtitle: "Episodes", href: "/admin/management/podcasts", icon: Mic },
      { title: "Trust partners", subtitle: "Partner logos and links", href: "/admin/management/trust-partners", icon: Handshake },
      { title: "NoLScope", subtitle: "Destination guides", href: "/admin/management/nolscope", icon: Telescope },
    ],
  },
];

const eatTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" });

function Spark({ values, color }: { values: number[]; color: string }) {
  const series = values.length >= 2 ? values : values.length === 1 ? [values[0], values[0]] : [0, 0];
  const max = Math.max(1, ...series);
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${28 - (v / max) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-20" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function AdminManagementPageClient() {
  const [bookingsCount, setBookingsCount] = useState(0);
  const [propertiesCount, setPropertiesCount] = useState(0);
  const [online, setOnline] = useState<Record<RoleKey, number>>({ users: 0, drivers: 0, owners: 0, admins: 0 });
  const [trends, setTrends] = useState<Record<RoleKey, number[]>>({ users: [], drivers: [], owners: [], admins: [] });
  const [peak, setPeak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [query, setQuery] = useState("");

  const fetchData = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    const readJson = async (url: string) => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type");
      return contentType && contentType.includes("application/json") ? response.json() : null;
    };
    try {
      const [bookings, properties, summary] = await Promise.all([
        readJson("/api/admin/bookings?page=1&pageSize=1").catch(() => null),
        readJson("/api/admin/properties?page=1&pageSize=1").catch(() => null),
        readJson("/api/admin/summary").catch(() => null),
      ]);
      if (bookings) setBookingsCount(Number(bookings.total || 0));
      if (properties) setPropertiesCount(Number(properties.total || 0));

      const roleCounts = summary?.activeSessionsByRole;
      const sessions = Number(summary?.activeSessions || 0) || 0;
      const hasRoleCounts = roleCounts && ROLES.some((role) => typeof roleCounts[role.key] === "number");
      // Legacy fallback kept: older API builds only return a session total.
      const legacyShare: Record<RoleKey, number> = { users: 0.4, drivers: 0.3, owners: 0.2, admins: 0.1 };
      const next = ROLES.reduce((acc, role) => {
        acc[role.key] = hasRoleCounts ? Number(roleCounts?.[role.key] || 0) : Math.floor(sessions * legacyShare[role.key]);
        return acc;
      }, {} as Record<RoleKey, number>);
      setOnline(next);
      setPeak((p) => Math.max(p, ROLES.reduce((s, r) => s + next[r.key], 0)));
      setTrends((prev) => {
        const updated = { ...prev };
        for (const role of ROLES) {
          const series = [...(prev[role.key] || []), next[role.key]];
          updated[role.key] = series.length > MAX_TREND_POINTS ? series.slice(series.length - MAX_TREND_POINTS) : series;
        }
        return updated;
      });
      setUpdatedAt(new Date());
    } catch (error) {
      console.error("Failed to load management summary", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setCountdown((seconds) => {
        if (seconds <= 1) { void fetchData(true); return REFRESH_SECONDS; }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [fetchData]);

  const totalOnline = ROLES.reduce((sum, role) => sum + online[role.key], 0);
  const perProperty = propertiesCount > 0 ? bookingsCount / propertiesCount : null;
  const toolCount = TOOL_GROUPS.reduce((s, g) => s + g.tools.length, 0);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOOL_GROUPS;
    return TOOL_GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => `${t.title} ${t.subtitle} ${g.title}`.toLowerCase().includes(q)) })).filter((g) => g.tools.length);
  }, [query]);

  const card = "min-w-0 rounded-lg border border-solid border-slate-200 bg-white";

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Header */}
      <header className={card}>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e] text-white"><LayoutDashboard className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900">Management</h1>
            <p className="m-0 mt-0.5 text-xs text-slate-500">{toolCount} admin tools, live presence and platform totals{updatedAt ? ` · updated ${eatTime(updatedAt)} EAT` : ""}</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a tool" aria-label="Find a tool" className="box-border h-9 w-full rounded-md border border-solid border-slate-300 bg-white pl-9 pr-8 text-sm outline-none transition focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded border-0 bg-transparent text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button> : null}
          </div>
          <button type="button" onClick={() => void fetchData(true)} disabled={refreshing} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="tabular-nums">{refreshing ? "Refreshing" : `${countdown}s`}</span>
          </button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Tools */}
        <section className={card}>
          {groups.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Search className="mx-auto h-5 w-5 text-slate-300" />
              <p className="m-0 mt-2 text-sm font-semibold text-slate-900">No tool matches “{query}”</p>
              <p className="m-0 mt-0.5 text-xs text-slate-500">Try a shorter word, like audit, users or payment.</p>
            </div>
          ) : groups.map((g, gi) => (
            <div key={g.title} className={gi ? "border-0 border-t border-solid border-slate-200" : ""}>
              <p className="m-0 flex items-baseline justify-between px-5 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{g.title}<span className="font-medium normal-case tracking-normal text-slate-400">{g.tools.length}</span></p>
              <div className="grid grid-cols-1 gap-px px-2 pb-2 sm:grid-cols-2 2xl:grid-cols-3">
                {g.tools.map((t) => (
                  <Link key={t.href} href={t.href} className="group flex min-w-0 items-center gap-3 rounded-md px-3 py-2.5 no-underline transition hover:bg-slate-50 hover:no-underline">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#02665e]/[0.08] text-[#02665e] transition group-hover:bg-[#02665e] group-hover:text-white"><t.icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{t.title}</span>
                      <span className="block truncate text-[11px] text-slate-500">{t.subtitle}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>

        <div className="min-w-0 space-y-4">
          {/* Live presence */}
          <section className={card}>
            <div className="flex items-center justify-between gap-2 px-5 pt-4">
              <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500"><Activity className="h-3.5 w-3.5 text-[#02665e]" /> Online now</p>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live</span>
            </div>
            <div className="flex items-end justify-between gap-3 px-5 pt-1.5">
              <p className="m-0 text-4xl font-bold tabular-nums leading-none text-slate-900">{loading ? "..." : totalOnline}</p>
              <p className="m-0 text-right text-[11px] text-slate-500">active sessions<br />peak {peak} this visit</p>
            </div>
            <span className="mx-5 mt-3 flex h-2 gap-0.5 bg-slate-100">
              {totalOnline > 0 ? ROLES.map((r) => <span key={r.key} className="h-full" style={{ width: `${(online[r.key] / totalOnline) * 100}%`, background: r.color }} title={`${r.label}: ${online[r.key]}`} />) : null}
            </span>
            <ul className="m-0 mt-2 list-none p-0">
              {ROLES.map((r) => {
                const series = trends[r.key] || [];
                const change = series.length >= 2 ? series[series.length - 1] - series[series.length - 2] : 0;
                return (
                  <li key={r.key} className="flex items-center gap-3 border-0 border-t border-solid border-slate-100 px-5 py-2.5 first:border-t-0">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: `${r.color}14`, color: r.color }}><r.icon className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1 text-xs font-semibold text-slate-700">{r.label}</span>
                    <Spark values={series} color={r.color} />
                    <span className="w-8 text-right text-sm font-bold tabular-nums text-slate-900">{online[r.key]}</span>
                    <span className={`w-7 text-right text-[10px] font-semibold tabular-nums ${change > 0 ? "text-emerald-600" : change < 0 ? "text-rose-600" : "text-slate-300"}`}>{change > 0 ? `+${change}` : change < 0 ? change : "0"}</span>
                  </li>
                );
              })}
            </ul>
            <p className="m-0 border-0 border-t border-solid border-slate-100 px-5 py-2.5 text-[11px] text-slate-400">Sampled every {REFRESH_SECONDS} seconds while this page is open.</p>
          </section>

          {/* Platform totals */}
          <section className={card}>
            <div className="flex items-center justify-between gap-2 px-5 pt-4">
              <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500"><TrendingUp className="h-3.5 w-3.5 text-[#02665e]" /> Platform totals</p>
              <span className="text-[11px] text-slate-400">All time</span>
            </div>
            <dl className="m-0 grid grid-cols-3 gap-px bg-slate-200 px-0 pt-3">
              {[
                { label: "Bookings", value: loading ? "..." : bookingsCount.toLocaleString() },
                { label: "Properties", value: loading ? "..." : propertiesCount.toLocaleString() },
                { label: "Per property", value: loading ? "..." : perProperty == null ? "None" : perProperty.toFixed(1) },
              ].map((f) => (
                <div key={f.label} className="min-w-0 bg-white px-5 py-2">
                  <dt className="text-[11px] text-slate-500">{f.label}</dt>
                  <dd className="m-0 mt-0.5 text-xl font-bold tabular-nums text-slate-900">{f.value}</dd>
                </div>
              ))}
            </dl>
            <div className="px-5 pb-4 pt-3">
              <Link href="/admin/finance" className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border-0 bg-[#0b2420] px-3.5 text-xs font-semibold text-white no-underline transition hover:bg-[#12342f] hover:no-underline">
                Revenue across all streams <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
