"use client";

// Admin home. Built on what the strongest product dashboards share: a written brief
// first, one hero native to the business (here, the map of Tanzania), one money
// number explained by where it came from, and a ranked queue that explains itself.
//
// Every figure names its window. Sources:
// - /api/admin/summary: pending listings, bookings and owner invoices in the last 24h, online now
// - /api/admin/payments/summary, /api/admin/drivers/summary, /api/admin/users/summary
// - /api/admin/performance/highlights?days=30: leaders and bookings per region (map)
// - /api/admin/properties?status=PENDING: the listings waiting, with their region (map dots)
// - /api/admin/finance/overview: revenue by stream, behind the finance code (OTP grant)
// - /api/admin/revenue/series, /api/admin/audits

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Activity, AlertTriangle, ArrowRight, Bell, Building2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Layers, Lock, MapPin, RefreshCw, ShieldAlert, Truck, TrendingUp, UserCog, UserRound, Wallet } from "lucide-react";

import { useAdminHomeKpis, useAdminMonitoring, useAdminPerformanceHighlights, useAdminRecentActivities } from "./adminHomeHooks";
import TanzaniaMap, { matchRegion, type PendingListing } from "./TanzaniaMap";
import { useSocket } from "@/hooks/useSocket";
import { adminRefOrId, useAdminHref } from "@/lib/adminRecordRefs";

const Chart = dynamic(() => import("../../../../components/Chart"), { ssr: false });

type RangeType = "hours" | "months" | "properties";
type Series = { labels: string[]; commission: number[]; subscription: number[] };
type Stream = { key: string; label: string; nolsafRevenue: number; realizedCount: number };
type Revenue = { state: "loading" } | { state: "locked" } | { state: "error" } | { state: "ok"; total: number; streams: Stream[] };

const tsh = (v: number) => `TSh ${Math.round(Number(v) || 0).toLocaleString()}`;
const humanize = (v: string) => String(v || "").replace(/[.]/g, "_").split(/_+/).filter(Boolean).map((t, i) => (i === 0 ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t.toLowerCase())).join(" ") || "Activity";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function eatStamp() {
  return new Date().toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function relTime(iso?: string | null) {
  if (!iso) return "";
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(sec)) return "";
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.round(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" });
}

function auditDetail(details: unknown) {
  let d: any = details;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return d.slice(0, 80); } }
  if (!d || typeof d !== "object") return "";
  const status = d.toStatus ?? d.status ?? d.result ?? "";
  const now = status ? `, now ${humanize(String(status)).toLowerCase()}` : "";
  if (d.propertyId) return `Property${now}`;
  if (d.invoiceId) return `Invoice${now}`;
  if (d.bookingId) return `Booking${now}`;
  if (typeof d.reason === "string") return d.reason.slice(0, 80);
  return "";
}

function auditKind(action: unknown) {
  const a = String(action ?? "").toUpperCase();
  if (a.includes("REJECT") || a.includes("SUSPEND") || a.includes("FAIL")) return { icon: ShieldAlert, tone: "bg-rose-50 text-rose-600" };
  if (a.includes("IMPERSONAT")) return { icon: UserCog, tone: "bg-violet-50 text-violet-600" };
  if (a.includes("NOTIFY") || a.includes("NOTIFICATION") || a.includes("MESSAGE")) return { icon: Bell, tone: "bg-sky-50 text-sky-600" };
  if (a.startsWith("INVOICE_") || a.includes("PAYMENT") || a.includes("PAYOUT")) return { icon: Wallet, tone: "bg-amber-50 text-amber-700" };
  if (a.startsWith("PROPERTY_") || a.includes("APPROVE")) return { icon: Building2, tone: "bg-emerald-50 text-emerald-700" };
  return { icon: Activity, tone: "bg-neutral-100 text-neutral-500" };
}

const eatDay = (iso: string | number | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" });

function parseSeries(json: any): Series {
  if (Array.isArray(json)) {
    return {
      labels: json.map((r: any) => String(r?.label ?? "")),
      commission: json.map((r: any) => Number(r?.commission ?? r?.commission_total ?? 0)),
      subscription: json.map((r: any) => Number(r?.subscription ?? r?.subscription_total ?? 0)),
    };
  }
  return {
    labels: Array.isArray(json?.labels) ? json.labels.map(String) : [],
    commission: Array.isArray(json?.commission) ? json.commission.map((n: any) => Number(n || 0)) : [],
    subscription: Array.isArray(json?.subscription) ? json.subscription.map((n: any) => Number(n || 0)) : [],
  };
}

export default function AdminHomePage() {
  const recordHref = useAdminHref();
  const { socket } = useSocket(undefined, { enabled: true, joinDriverRoom: false });
  const { monitoring } = useAdminMonitoring();
  const { recentActivities, refresh: refreshRecentActivities } = useAdminRecentActivities();
  const { driversPending, usersNew, paymentsWaiting, paymentExceptions, payoutsInProgress } = useAdminHomeKpis();
  const { highlights } = useAdminPerformanceHighlights(30);

  const [stamp, setStamp] = useState<string>("");
  const [pending, setPending] = useState<Array<PendingListing & { updatedAt?: string }>>([]);
  const [revenue, setRevenue] = useState<Revenue>({ state: "loading" });
  const [region, setRegion] = useState<string | null>(null);
  const [rangeType, setRangeType] = useState<RangeType>("months");
  const [hoursWindow, setHoursWindow] = useState(24);
  const [monthsWindow, setMonthsWindow] = useState(6);
  const [series, setSeries] = useState<Series | null>(null);
  const [nonce, setNonce] = useState(0);
  const refreshTimer = useRef<number | null>(null);
  const briefRail = useRef<HTMLDivElement | null>(null);
  const [briefScroll, setBriefScroll] = useState({ overflow: false, start: true, end: true });

  const updateBriefScroll = useCallback(() => {
    const rail = briefRail.current;
    if (!rail) return;
    const overflow = rail.scrollWidth > rail.clientWidth + 2;
    const next = {
      overflow,
      start: rail.scrollLeft <= 2,
      end: rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2,
    };
    setBriefScroll((current) => current.overflow === next.overflow && current.start === next.start && current.end === next.end ? current : next);
  }, []);

  const scrollBrief = (direction: -1 | 1) => {
    const rail = briefRail.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * rail.clientWidth * 0.8, behavior: "smooth" });
  };

  // EAT clock, set after mount so server and client HTML match.
  useEffect(() => {
    setStamp(eatStamp());
    const t = window.setInterval(() => setStamp(eatStamp()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const schedule = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => { setNonce((n) => n + 1); refreshRecentActivities(); }, 350);
    };
    socket.on("admin:invoice:paid", schedule);
    socket.on("admin:invoice:status", schedule);
    socket.on("admin:property:status", schedule);
    return () => {
      socket.off("admin:invoice:paid", schedule);
      socket.off("admin:invoice:status", schedule);
      socket.off("admin:property:status", schedule);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [socket, refreshRecentActivities]);

  // Listings waiting for review, with their region, for the map and the queue.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/properties?status=PENDING&pageSize=100&includeTotal=false", { credentials: "include" });
        const json = res.ok ? await res.json() : null;
        const items = Array.isArray(json?.items) ? json.items : [];
        setPending(items.map((p: any) => ({ title: String(p.title || "Untitled listing"), regionName: p.regionName ?? null, updatedAt: p.updatedAt })));
      } catch {
        setPending([]);
      }
    })();
  }, [nonce]);

  // Revenue by stream, 30 days. Platform revenue sits behind the finance code; plain
  // fetch so loading the home page never pops the code prompt by itself.
  const loadRevenue = useCallback(async () => {
    setRevenue({ state: "loading" });
    try {
      const now = new Date();
      const q = new URLSearchParams({ from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: now.toISOString() });
      const res = await fetch(`/api/admin/finance/overview?${q}`, { credentials: "include" });
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        setRevenue(body?.require2fa ? { state: "locked" } : { state: "error" });
        return;
      }
      if (!res.ok) { setRevenue({ state: "error" }); return; }
      const json = await res.json();
      const streams: Stream[] = (Array.isArray(json?.streams) ? json.streams : []).map((s: any) => ({
        key: String(s.key), label: String(s.label), nolsafRevenue: Number(s.nolsafRevenue || 0), realizedCount: Number(s.realizedCount || 0),
      }));
      setRevenue({ state: "ok", total: Number(json?.totals?.nolsafRevenue || 0), streams });
    } catch {
      setRevenue({ state: "error" });
    }
  }, []);
  useEffect(() => { void loadRevenue(); }, [loadRevenue, nonce]);
  useEffect(() => {
    const onGranted = () => void loadRevenue();
    window.addEventListener("finance-grant-granted", onGranted);
    return () => window.removeEventListener("finance-grant-granted", onGranted);
  }, [loadRevenue]);

  // Revenue over time.
  useEffect(() => {
    (async () => {
      try {
        if (rangeType === "properties") {
          const res = await fetch(`/api/admin/revenue/properties?top=5`);
          if (!res.ok) throw new Error();
          const json = await res.json();
          const rows = (Array.isArray(json) ? json : []).map((it: any) => ({
            label: String(it.name ?? it.title ?? "Property"),
            commission: Number(it.commission ?? it.commission_total ?? it.commissionAmount ?? 0),
            subscription: Number(it.subscription ?? it.subscription_total ?? it.subscriptionAmount ?? 0),
          })).sort((a: any, b: any) => b.commission + b.subscription - (a.commission + a.subscription)).slice(0, 5);
          setSeries({ labels: rows.map((r: any) => r.label), commission: rows.map((r: any) => r.commission), subscription: rows.map((r: any) => r.subscription) });
          return;
        }
        const now = new Date();
        const interval = rangeType === "hours" ? "hour" : "month";
        const from = rangeType === "hours"
          ? new Date(now.getTime() - (Math.max(1, hoursWindow) - 1) * 3_600_000)
          : new Date(now.getFullYear(), now.getMonth() - (Math.max(1, monthsWindow) - 1), 1);
        const res = await fetch(`/api/admin/revenue/series?${new URLSearchParams({ from: from.toISOString(), to: now.toISOString(), interval })}`);
        if (!res.ok) throw new Error();
        setSeries(parseSeries(await res.json()));
      } catch {
        setSeries({ labels: [], commission: [], subscription: [] });
      }
    })();
  }, [rangeType, hoursWindow, monthsWindow, nonce]);

  // ── The queue: everything waiting on an admin, with why ──
  // Waiting listings, oldest first, with whole days waited (since their last update).
  const waitingListings = useMemo(
    () =>
      pending
        .map((p) => ({ ...p, days: p.updatedAt ? Math.max(0, Math.floor((Date.now() - new Date(p.updatedAt).getTime()) / 86_400_000)) : 0 }))
        .sort((a, b) => b.days - a.days),
    [pending],
  );
  const oldestPending = useMemo(() => {
    const dated = pending.filter((p) => p.updatedAt).sort((a, b) => new Date(a.updatedAt!).getTime() - new Date(b.updatedAt!).getTime());
    if (!dated.length) return null;
    const days = Math.max(0, Math.floor((Date.now() - new Date(dated[0].updatedAt!).getTime()) / 86_400_000));
    return { title: dated[0].title, days };
  }, [pending]);
  const pendingCount = monitoring?.pendingApprovals ?? pending.length;
  const queue = [
    {
      key: "listings", count: pendingCount, label: "Listings to review", href: "/admin/properties/previews",
      why: oldestPending ? `Oldest waiting ${oldestPending.days === 0 ? "since today" : plural(oldestPending.days, "day", "days")}: ${oldestPending.title}` : "New and edited listings",
    },
    { key: "payouts", count: Number(paymentsWaiting ?? 0), label: "Owner payouts to send", href: "/admin/payments", why: "Approved invoices, money not yet sent" },
    { key: "exceptions", count: Number(paymentExceptions ?? 0), label: "Payments to match", href: "/admin/payments", why: "Money received with no booking attached" },
    { key: "trips", count: Number(driversPending ?? 0), label: "Driver trips to settle", href: "/admin/drivers", why: "Completed trips not yet paid" },
  ];
  const live = queue.filter((q) => q.count > 0).sort((a, b) => b.count - a.count);
  const clear = queue.filter((q) => q.count === 0);
  const queueReady = Boolean(monitoring) && paymentsWaiting != null;

  // ── The brief: three plain sentences from the live numbers ──
  // The brief as small cards: the day's facts, each tinted by meaning (amber waits on
  // you, green is good, grey is quiet) and linked to where you act on it.
  type BriefCard = { key: string; value: string; caption: string; tone: "amber" | "green" | "grey"; href: string; icon: typeof Lock };
  const brief = useMemo<BriefCard[] | null>(() => {
    if (!monitoring) return null;
    const META: Record<string, [string, string, typeof Lock]> = {
      listings: ["listing waits for review", "listings wait for review", Building2],
      payouts: ["owner payout to send", "owner payouts to send", Wallet],
      exceptions: ["payment to match", "payments to match", AlertTriangle],
      trips: ["driver trip to settle", "driver trips to settle", Truck],
    };
    const cards: BriefCard[] = live.length
      ? live.map((q) => {
          const [one, many, icon] = META[q.key];
          return { key: q.key, value: String(q.count), caption: q.count === 1 ? one : many, tone: "amber" as const, href: q.href, icon };
        })
      : [{ key: "clear", value: "All clear", caption: "nothing waits on you", tone: "green", href: "/admin/properties/previews", icon: CheckCircle2 }];
    const bookings = monitoring.bookings;
    cards.push({ key: "bookings", value: String(bookings), caption: bookings === 1 ? "new booking, last 24 hours" : "new bookings, last 24 hours", tone: bookings ? "green" : "grey", href: "/admin/bookings", icon: CalendarDays });
    const top = highlights?.mostBookedRegion;
    if (top && top.bookings > 0) {
      cards.push({ key: "region", value: matchRegion(top.regionName)?.name ?? humanize(top.regionName), caption: `led the month, ${plural(top.bookings, "booking", "bookings")}`, tone: "green", href: "/admin/bookings", icon: MapPin });
    }
    return cards;
  }, [monitoring, live, highlights]);
  useEffect(() => {
    const rail = briefRail.current;
    if (!rail) return;
    updateBriefScroll();
    const observer = new ResizeObserver(updateBriefScroll);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [brief?.length, updateBriefScroll]);
  const CARD_TONE = {
    amber: { box: "border-amber-200 bg-amber-50 hover:bg-amber-100/70", icon: "bg-amber-100 text-amber-700", value: "text-amber-950", caption: "text-amber-800/80" },
    green: { box: "border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50", icon: "bg-emerald-100 text-emerald-700", value: "text-emerald-950", caption: "text-emerald-800/80" },
    grey: { box: "border-neutral-200 bg-white hover:bg-neutral-50", icon: "bg-neutral-100 text-neutral-500", value: "text-neutral-500", caption: "text-neutral-500" },
  } as const;
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const tp = highlights?.topProperty;
  const leaders = [
    {
      label: "Top property", icon: Building2, value: tp?.title,
      sub: tp ? `${plural(tp.bookings, "booking", "bookings")} · ${humanize(tp.type || "").toLowerCase()}` : null,
      meta: tp?.interactionsBreakdown && tp.interactions > 0 ? `${plural(tp.interactionsBreakdown.reviews, "review", "reviews")}, ${plural(tp.interactionsBreakdown.saves, "save", "saves")}` : null,
      rule: "Ranked by bookings, then reviews and saves",
      href: tp?.propertyId ? `/admin/properties/previews?previewId=${adminRefOrId("property", tp.propertyId)}` : "/admin/properties/previews",
    },
    {
      label: "Top type", icon: Layers, value: highlights?.bestPropertyType?.type ? humanize(highlights.bestPropertyType.type) : null,
      sub: highlights?.bestPropertyType ? plural(highlights.bestPropertyType.bookings, "booking", "bookings") : null,
      meta: highlights?.bestPropertyType && highlights.bestPropertyType.interactions > 0 ? plural(highlights.bestPropertyType.interactions, "review or save", "reviews and saves") : null,
      rule: "Ranked by bookings across all listings", href: "/admin/properties/previews",
    },
    {
      label: "Top owner", icon: UserRound, value: highlights?.bestOwner?.name,
      sub: highlights?.bestOwner ? `${tsh(highlights.bestOwner.nolsRevenue)} commission` : null,
      meta: highlights?.bestOwner ? plural(highlights.bestOwner.bookings, "booking", "bookings") : null,
      rule: "Ranked by commission on approved invoices",
      href: highlights?.bestOwner?.ownerId ? recordHref("owner", highlights.bestOwner.ownerId) : "/admin/owners",
    },
    {
      label: "Top driver", icon: Truck, value: highlights?.bestDriver?.name,
      sub: highlights?.bestDriver ? `${tsh(highlights.bestDriver.nolsRevenue)} commission` : null,
      meta: highlights?.bestDriver ? plural(highlights.bestDriver.bookings, "trip", "trips") : null,
      rule: "Ranked by commission on approved invoices",
      href: highlights?.bestDriver?.driverId ? recordHref("driver", highlights.bestDriver.driverId) : "/admin/drivers",
    },
  ];
  const rankedLeaders = leaders.filter((leader) => Boolean(leader.value));
  const waitingForBookings = leaders.filter((leader) => !leader.value && (leader.label === "Top property" || leader.label === "Top type"));
  const waitingForInvoices = leaders.filter((leader) => !leader.value && (leader.label === "Top owner" || leader.label === "Top driver"));
  const leaderColumns = rankedLeaders.length >= 4 ? "lg:grid-cols-4" : rankedLeaders.length === 3 ? "lg:grid-cols-3" : rankedLeaders.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1";

  const totalC = series ? series.commission.reduce((s, v) => s + v, 0) : 0;
  const totalS = series ? series.subscription.reduce((s, v) => s + v, 0) : 0;
  const hasSeries = Boolean(series && series.labels.length && totalC + totalS > 0);
  const unit = rangeType === "hours" ? "hour" : rangeType === "months" ? "month" : "property";
  const windowCaption = rangeType === "properties" ? "Top 5 properties by earnings" : rangeType === "hours" ? `Last ${hoursWindow} hours` : `Last ${monthsWindow} months, this month so far included`;
  const peak = useMemo(() => {
    if (!series || !hasSeries) return null;
    let at = 0;
    series.labels.forEach((_, i) => { if (series.commission[i] + series.subscription[i] > series.commission[at] + series.subscription[at]) at = i; });
    return { label: series.labels[at], value: series.commission[at] + series.subscription[at] };
  }, [series, hasSeries]);
  const revenueStats: Array<{ label: string; value: string; dot?: string; muted?: boolean }> = [
    { label: "Commission", value: tsh(totalC), dot: "bg-[#02665e]", muted: !totalC },
    { label: "Subscription", value: tsh(totalS), dot: "bg-amber-600", muted: !totalS },
    { label: `Best ${unit}`, value: peak ? `${peak.label}, ${tsh(peak.value)}` : "None yet", muted: !peak },
    rangeType === "properties"
      ? { label: "Commission share", value: totalC + totalS > 0 ? `${Math.round((totalC / (totalC + totalS)) * 100)}%` : "None yet", muted: totalC + totalS === 0 }
      : { label: `Average per ${unit}`, value: series && series.labels.length && totalC + totalS > 0 ? tsh((totalC + totalS) / series.labels.length) : "None yet", muted: totalC + totalS === 0 },
  ];
  const axisLabels = series && rangeType !== "properties" && series.labels.length
    ? series.labels.filter((_, i, all) => all.length <= 6 || i % Math.ceil(all.length / 6) === 0 || i === all.length - 1)
    : [];
  const emptyTitle = rangeType === "properties"
    ? "No property has earned commission yet"
    : series && series.labels.length ? `Nothing recorded from ${series.labels[0]} to ${series.labels[series.labels.length - 1]}` : "Nothing recorded in this window";

  const activityDays = useMemo(() => {
    const today = eatDay(Date.now());
    const yesterday = eatDay(Date.now() - 86_400_000);
    const groups: Array<{ key: string; label: string; items: any[] }> = [];
    (recentActivities ?? []).slice(0, 6).forEach((a: any) => {
      const key = a.createdAt ? eatDay(a.createdAt) : "unknown";
      let g = groups.find((x) => x.key === key);
      if (!g) {
        const label = key === today ? "Today" : key === yesterday ? "Yesterday" : a.createdAt ? new Date(a.createdAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" }) : "Undated";
        g = { key, label, items: [] };
        groups.push(g);
      }
      g.items.push(a);
    });
    return groups;
  }, [recentActivities]);
  const CARD = "min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white";
  const LABEL = "m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500";

  return (
    <div id="admin-home" className="w-full min-w-0 space-y-5 px-3 py-5 sm:px-4">
      <style>{`#admin-home, #admin-home * { box-sizing: border-box; } #admin-home .brief-rail { scrollbar-width: none; } #admin-home .brief-rail::-webkit-scrollbar { display: none; }`}</style>

      {/* The brief */}
      <header className="px-1">
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs font-medium text-neutral-500">
            {stamp ? <><span className="font-semibold text-[#02665e]">{greeting}</span><span aria-hidden className="text-neutral-300">·</span><span>{stamp}</span></> : " "}
          </p>
          <button type="button" onClick={() => { setNonce((n) => n + 1); refreshRecentActivities(); }} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="mt-3 flex min-h-7 items-center justify-between gap-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">At a glance</p>
          {briefScroll.overflow ? (
            <div className="flex items-center gap-1" aria-label="Overview navigation">
              <button type="button" onClick={() => scrollBrief(-1)} disabled={briefScroll.start} aria-label="Previous overview cards" className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:cursor-default disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={() => scrollBrief(1)} disabled={briefScroll.end} aria-label="Next overview cards" className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:cursor-default disabled:opacity-40"><ChevronRight className="h-4 w-4" aria-hidden /></button>
            </div>
          ) : null}
        </div>
        <div ref={briefRail} onScroll={updateBriefScroll} aria-label="Admin overview" className="brief-rail mt-2 flex snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain scroll-smooth pb-0.5">
          {brief
            ? brief.map((c) => {
                const t = CARD_TONE[c.tone];
                return (
                  <Link key={c.key} href={c.href} className={`group flex min-h-[82px] w-[78%] shrink-0 snap-start items-center gap-3 rounded-xl border border-solid px-3 py-2.5 no-underline transition hover:no-underline sm:w-[46%] lg:w-[31%] xl:w-[calc(25%_-_0.46875rem)] ${t.box}`}>
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${t.icon}`}><c.icon className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className={`block break-words text-base font-semibold tabular-nums leading-snug ${t.value}`}>{c.value}</span>
                      <span className={`block text-xs leading-snug ${t.caption}`}>{c.caption}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-600" aria-hidden />
                  </Link>
                );
              })
            : Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[82px] w-[78%] shrink-0 animate-pulse rounded-xl bg-neutral-100 sm:w-[46%] lg:w-[31%] xl:w-[calc(25%_-_0.46875rem)]" />)}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Hero: the map */}
        <section className={`${CARD} p-5`} aria-label="Activity across Tanzania">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={LABEL}>Across Tanzania, last {highlights?.windowDays ?? 30} days</p>
            <p className="m-0 flex items-center gap-3 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-solid border-neutral-500 bg-white" /> Bookings, sized by count</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-600" /> Waiting for review</span>
            </p>
          </div>
          <div className="mx-auto mt-2 max-w-[560px]">
            <TanzaniaMap regions={highlights?.regions ?? []} pending={pending} selected={region} onSelect={setRegion} />
          </div>
          <dl className="m-0 mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-neutral-100">
            {[
              { label: "Bookings", value: monitoring?.bookings, note: "last 24 hours" },
              { label: "Owner invoices", value: monitoring?.invoicesReceived, note: "last 24 hours" },
              { label: "New customers", value: usersNew, note: "last 7 days" },
            ].map((f) => (
              <div key={f.label} className="min-w-0 bg-white px-3 py-2.5 first:pl-4">
                <dt className="truncate text-[11px] text-neutral-500">{f.label}</dt>
                <dd className={`m-0 mt-0.5 text-lg font-semibold tabular-nums leading-none ${Number(f.value) ? "text-neutral-950" : "text-neutral-300"}`}>{f.value ?? "…"}</dd>
                <dd className="m-0 mt-0.5 text-[10px] text-neutral-400">{f.note}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="min-w-0 space-y-5">
          {/* Money: one number, and where it came from */}
          <section className={`${CARD} p-5`} aria-label="Revenue, last 30 days">
            <div className="flex items-center justify-between gap-2">
              <p className={LABEL}>NoLSAF revenue, last 30 days</p>
              {revenue.state === "locked" ? <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-500"><Lock className="h-3 w-3" aria-hidden /> Locked</span> : null}
            </div>
            {revenue.state === "ok" ? (
              <>
                <p className="m-0 mt-1 text-[32px] font-semibold tabular-nums leading-tight tracking-tight text-neutral-950">{tsh(revenue.total)}</p>
                <ul className="m-0 mt-4 list-none space-y-2.5 p-0">
                  {revenue.streams.map((s) => {
                    const max = Math.max(1, ...revenue.streams.map((x) => x.nolsafRevenue));
                    const share = revenue.total > 0 ? Math.round((s.nolsafRevenue / revenue.total) * 100) : 0;
                    return (
                      <li key={s.key} className="grid grid-cols-[96px_minmax(0,1fr)_88px] items-center gap-3 text-xs">
                        <span className={s.nolsafRevenue ? "font-medium text-neutral-800" : "text-neutral-400"}>{s.label}</span>
                        <span className="block h-2 overflow-hidden rounded-full bg-neutral-100">
                          <span className="block h-full rounded-full bg-[#02665e]" style={{ width: `${(s.nolsafRevenue / max) * 100}%` }} />
                        </span>
                        <span className="text-right tabular-nums text-neutral-700">{s.nolsafRevenue ? `${share}%` : "none"}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="m-0 mt-3 text-[11px] text-neutral-400">Realised revenue in TSh, by stream. <Link href="/admin/finance" className="font-semibold text-[#02665e] no-underline hover:underline">Open finance</Link></p>
              </>
            ) : revenue.state === "locked" ? (
              <div className="mt-1">
                {/* The shape of what unlocks: real stream names, values masked, no invented proportions */}
                <p className="m-0 flex items-center gap-2 text-[32px] font-semibold leading-tight tracking-tight text-neutral-300">
                  TSh <span className="inline-flex gap-1" aria-hidden>{Array.from({ length: 6 }).map((_, k) => <span key={k} className="h-2.5 w-2.5 rounded-full bg-neutral-200" />)}</span>
                  <span className="sr-only">Hidden</span>
                </p>
                <ul className="m-0 mt-4 list-none space-y-2.5 p-0" aria-hidden>
                  {["Accommodation", "Tours", "Transport", "Group stay", "Subscriptions"].map((label) => (
                    <li key={label} className="grid grid-cols-[96px_minmax(0,1fr)_40px] items-center gap-3 text-xs">
                      <span className="text-neutral-500">{label}</span>
                      <span className="block h-2 rounded-full bg-[repeating-linear-gradient(135deg,#e5e7eb_0_4px,#f3f4f6_4px_8px)]" />
                      <span className="text-right text-neutral-300">••%</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("finance-grant-required"))}
                  className="mt-5 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#0b2420] text-sm font-semibold text-white transition hover:bg-[#12342f]"
                >
                  <Lock className="h-4 w-4 text-emerald-300" aria-hidden /> Unlock with your finance code
                </button>
                <p className="m-0 mt-2 text-center text-[11px] text-neutral-400">Platform totals stay hidden until you verify. It lasts for this session.</p>
              </div>
            ) : revenue.state === "error" ? (
              <p className="m-0 mt-3 text-sm text-neutral-500">Revenue did not load. <button type="button" onClick={() => void loadRevenue()} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#02665e] hover:underline">Try again</button></p>
            ) : (
              <div className="mt-3 space-y-2"><div className="h-9 w-48 animate-pulse rounded bg-neutral-100" /><div className="h-24 animate-pulse rounded-xl bg-neutral-100" /></div>
            )}
          </section>

          {/* Queue: the actual work, oldest first, with how long each item has waited */}
          <section className={`${CARD} p-5`} aria-label="Your queue">
            <div className="flex items-baseline justify-between">
              <p className={LABEL}>Your queue</p>
              {queueReady ? <span className={`text-[11px] font-semibold ${live.length ? "text-amber-700" : "text-emerald-700"}`}>{live.length ? `${live.reduce((n, q) => n + q.count, 0)} waiting` : "All clear"}</span> : null}
            </div>

            {!queueReady ? (
              <div className="mt-3 h-24 animate-pulse rounded-xl bg-neutral-100" />
            ) : (
              <div className="mt-3 space-y-4">
                {live.map((q) =>
                  q.key === "listings" && waitingListings.length ? (
                    <div key={q.key}>
                      <p className="m-0 mb-1.5 flex items-center justify-between text-xs font-semibold text-neutral-800">
                        <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-amber-600" aria-hidden /> Listings to review</span>
                        <Link href={q.href} className="font-semibold text-[#02665e] no-underline hover:underline">Review all {q.count}</Link>
                      </p>
                      <ul className="m-0 list-none overflow-hidden rounded-xl border border-solid border-neutral-200 p-0">
                        {waitingListings.slice(0, 3).map((w, i) => (
                          <li key={i} className="flex items-center gap-3 border-0 border-t border-solid border-neutral-100 px-3 py-2.5 first:border-t-0">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-neutral-900">{w.title}</span>
                              <span className="block truncate text-[11px] text-neutral-500">{matchRegion(w.regionName)?.name ?? (w.regionName ? humanize(w.regionName) : "Region not set")}</span>
                            </span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${w.days > 14 ? "bg-rose-50 text-rose-700" : w.days > 3 ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>
                              {w.days === 0 ? "Today" : `${w.days}d waiting`}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {q.count > 3 ? <p className="m-0 mt-1.5 text-[11px] text-neutral-400">and {q.count - 3} more</p> : null}
                    </div>
                  ) : (
                    <Link key={q.key} href={q.href} className="group flex items-center gap-3 rounded-xl border border-solid border-amber-200 bg-amber-50/60 px-3 py-2.5 no-underline hover:bg-amber-50 hover:no-underline">
                      <span className="w-8 shrink-0 text-right text-xl font-bold tabular-nums text-amber-700">{q.count}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-neutral-900">{q.label}</span>
                        <span className="block truncate text-[11px] text-neutral-500">{q.why}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-amber-400 transition group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  ),
                )}

                {clear.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {clear.map((q) => (
                      <span key={q.key} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                        <CheckCircle2 className="h-3 w-3" aria-hidden /> {q.label.replace(/ to (review|send|match|settle)$/, "")} clear
                      </span>
                    ))}
                  </div>
                ) : null}
                {payoutsInProgress ? <p className="m-0 text-[11px] text-neutral-400">{plural(payoutsInProgress, "payout is", "payouts are")} already moving through Disbursements.</p> : null}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Leaders: give real results room; keep unranked categories compact. */}
      <section className={`${CARD} p-4 sm:p-5`} aria-label={`Leaders, last ${highlights?.windowDays ?? 30} days`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={LABEL}>Performance · last {highlights?.windowDays ?? 30} days</p>
            <h2 className="m-0 mt-0.5 text-lg font-semibold leading-tight text-neutral-950">Leaders</h2>
          </div>
          <Link href="/admin/analytics" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[#02665e] no-underline hover:bg-emerald-50 hover:no-underline">View analytics <ChevronRight className="h-3.5 w-3.5" aria-hidden /></Link>
        </div>
        {rankedLeaders.length ? (
          <ul className={`m-0 mt-4 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 ${leaderColumns}`}>
            {rankedLeaders.map((leader) => {
              const Icon = leader.icon;
              return (
                <li key={leader.label} className="min-w-0">
                  <Link href={leader.href} title={leader.rule} className="group flex h-full min-h-[96px] items-start gap-3 rounded-xl border border-solid border-neutral-200 bg-neutral-50/50 p-3.5 no-underline transition hover:border-emerald-200 hover:bg-emerald-50/50 hover:no-underline">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-[#02665e]"><Icon className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{leader.label}</span>
                      <span className="mt-1 line-clamp-2 block break-words text-base font-semibold leading-snug text-neutral-950" title={leader.value || undefined}>{leader.value}</span>
                      <span className="mt-1 block text-xs leading-snug text-neutral-600">{leader.sub}</span>
                      {leader.meta ? <span className="mt-1 block text-[11px] text-neutral-500">{leader.meta}</span> : null}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-5 text-sm text-neutral-600">Rankings will appear as bookings and approved invoices come in.</div>
        )}
        {rankedLeaders.length && (waitingForBookings.length || waitingForInvoices.length) ? (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-solid border-neutral-100 pt-3 text-[11px] text-neutral-500">
            {waitingForBookings.length ? <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> Bookings needed to rank {waitingForBookings.map((leader) => leader.label.replace("Top ", "")).join(" and ")}</span> : null}
            {waitingForInvoices.length ? <span className="inline-flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" aria-hidden /> Approved invoices needed to rank {waitingForInvoices.map((leader) => leader.label.replace("Top ", "")).join(" and ")}</span> : null}
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Revenue over time */}
        <section className={CARD} aria-label="Revenue over time">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-2 pt-4">
            <div className="min-w-0">
              <p className={LABEL}>Commission and subscriptions</p>
              <p className="m-0 mt-1 text-[26px] font-semibold leading-tight tabular-nums tracking-tight text-neutral-950">{series ? tsh(totalC + totalS) : "…"}</p>
              <p className="m-0 mt-0.5 text-[11px] text-neutral-500">{windowCaption}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" role="tablist" aria-label="Revenue range">
                {([["months", "Months"], ["hours", "Hours"], ["properties", "Top properties"]] as const).map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={rangeType === k} onClick={() => setRangeType(k)} className={`h-7 cursor-pointer rounded-md border-0 px-2.5 text-xs font-semibold transition ${rangeType === k ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>{label}</button>
                ))}
              </div>
              {rangeType !== "properties" ? (
                <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" role="group" aria-label="Window">
                  {(rangeType === "hours" ? [6, 24, 48] : [3, 6, 12]).map((n) => {
                    const on = rangeType === "hours" ? hoursWindow === n : monthsWindow === n;
                    return (
                      <button key={n} type="button" aria-pressed={on} onClick={() => (rangeType === "hours" ? setHoursWindow(n) : setMonthsWindow(n))} className={`h-7 cursor-pointer rounded-md border-0 px-2 text-xs font-semibold tabular-nums transition ${on ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>
                        {n}{rangeType === "hours" ? "h" : "m"}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          <div className="px-5 pb-5 pt-2">
            <div className="h-52">
              {series === null ? (
                <div className="h-full animate-pulse rounded-xl bg-neutral-100" />
              ) : hasSeries ? (
                <Chart
                  type={rangeType === "properties" ? "bar" : "line"}
                  data={{
                    labels: series.labels,
                    datasets: [
                      { label: "Commission", data: series.commission, borderColor: "#02665e", backgroundColor: rangeType === "properties" ? "rgba(2,102,94,0.75)" : "rgba(2,102,94,0.08)", tension: 0.35, borderWidth: 2, pointRadius: 0, fill: rangeType !== "properties" },
                      { label: "Subscription", data: series.subscription, borderColor: "#d97706", backgroundColor: rangeType === "properties" ? "rgba(217,119,6,0.6)" : "rgba(217,119,6,0.05)", tension: 0.35, borderWidth: 2, pointRadius: 0, fill: false },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                      y: { beginAtZero: true, border: { display: false }, grid: { color: "rgba(15,23,42,0.06)", drawTicks: false }, ticks: { display: false } },
                      x: { border: { display: false }, grid: { display: false }, ticks: { color: "rgba(82,82,82,0.8)", autoSkip: true, maxRotation: 0, callback: (v: any) => { const s = String(series.labels[Number(v)] ?? v); return s.length > 14 ? `${s.slice(0, 13)}…` : s; } } },
                    },
                  }}
                />
              ) : (
                // Nothing earned: keep the real axis so the window still reads, with a flat baseline.
                <div className="flex h-full flex-col">
                  <div className="grid flex-1 place-items-center text-center">
                    <div>
                      <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-400"><TrendingUp className="h-5 w-5" aria-hidden /></span>
                      <p className="m-0 mt-2 text-sm font-semibold text-neutral-800">{emptyTitle}</p>
                      <p className="m-0 mt-1 text-xs text-neutral-500">Commission and subscription income draws here as it lands.</p>
                    </div>
                  </div>
                  {axisLabels.length ? (
                    <div>
                      <div className="h-px w-full bg-[repeating-linear-gradient(90deg,#d4d4d4_0_6px,transparent_6px_12px)]" />
                      <div className="mt-2 flex justify-between gap-2 text-[11px] text-neutral-400">
                        {axisLabels.map((t, i) => <span key={i} className="truncate">{t}</span>)}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <dl className="m-0 mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-4">
              {revenueStats.map((s) => (
                <div key={s.label} className="min-w-0 bg-white px-3 py-2.5">
                  <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                    {s.dot ? <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden /> : null}{s.label}
                  </dt>
                  <dd className={`m-0 mt-1 truncate text-[13px] font-semibold tabular-nums ${s.muted ? "text-neutral-400" : "text-neutral-900"}`}>{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Recent activity, grouped by day in EAT */}
        <section className={`${CARD} self-start`} aria-label="Recent activity">
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
            <p className={LABEL}>Recent activity</p>
            <Link href="/admin/management/audit-log" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">Audit log <ChevronRight className="h-3.5 w-3.5" aria-hidden /></Link>
          </div>
          {recentActivities === null ? (
            <ul className="m-0 list-none space-y-3 px-5 pb-5 pt-1">{Array.from({ length: 5 }).map((_, i) => <li key={i} className="h-9 animate-pulse rounded-lg bg-neutral-100" />)}</ul>
          ) : recentActivities.length === 0 ? (
            <p className="m-0 px-5 pb-6 pt-2 text-sm text-neutral-400">No recorded activity yet.</p>
          ) : (
            <div className="px-5 pb-5 pt-1">
              {activityDays.map((day) => (
                <div key={day.key} className="mt-2 first:mt-0">
                  <p className="m-0 mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{day.label}</p>
                  <ol className="m-0 list-none p-0">
                    {day.items.map((a: any, i: number) => {
                      const kind = auditKind(a.action);
                      const Icon = kind.icon;
                      const detail = auditDetail(a.details);
                      return (
                        <li key={a.id ?? `${a.action}-${i}`} className="flex items-center gap-3 rounded-lg py-2">
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${kind.tone}`}><Icon className="h-4 w-4" aria-hidden /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-neutral-900">{humanize(String(a.action || ""))}</span>
                            {detail ? <span className="block truncate text-[11px] text-neutral-500">{detail}</span> : null}
                          </span>
                          <time className="shrink-0 text-[11px] tabular-nums text-neutral-400" title={a.createdAt ? `${relTime(a.createdAt)}, ${new Date(a.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} EAT` : undefined}>
                            {a.createdAt ? new Date(a.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) : ""}
                          </time>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
              <p className="m-0 mt-2 text-[10px] text-neutral-400">Times in EAT</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
