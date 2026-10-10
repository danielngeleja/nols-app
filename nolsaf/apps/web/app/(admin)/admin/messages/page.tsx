"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  Building2,
  CalendarCheck,
  Check,
  CheckCheck,
  ChevronDown,
  ExternalLink,
  Inbox,
  Loader2,
  LockKeyhole,
  Mail,
  MessageSquare,
  MonitorSmartphone,
  Settings2,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { adminRefOrId, useAdminHref } from "@/lib/adminRecordRefs";

type Message = {
  id: string;
  type?: string | null;
  title: string;
  body: string;
  date?: string;
  createdAt?: string;
  unread: boolean;
  meta?: any;
};

type Category = "system" | "privacy" | "money" | "bookings" | "properties" | "transport" | "other";

const PAGE_SIZE = 50;

const CATEGORIES: Array<{ key: Category; label: string; icon: typeof Bell; text: string; tile: string; bar: string }> = [
  { key: "system", label: "Security and system", icon: ShieldAlert, text: "text-rose-700", tile: "bg-rose-50 text-rose-600", bar: "bg-rose-500" },
  { key: "privacy", label: "Privacy and data", icon: LockKeyhole, text: "text-violet-700", tile: "bg-violet-50 text-violet-700", bar: "bg-violet-500" },
  { key: "money", label: "Payments and payouts", icon: Wallet, text: "text-emerald-700", tile: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  { key: "bookings", label: "Bookings", icon: CalendarCheck, text: "text-sky-700", tile: "bg-sky-50 text-sky-700", bar: "bg-sky-500" },
  { key: "properties", label: "Properties", icon: Building2, text: "text-indigo-700", tile: "bg-indigo-50 text-indigo-700", bar: "bg-indigo-500" },
  { key: "transport", label: "Transport", icon: Truck, text: "text-amber-700", tile: "bg-amber-50 text-amber-700", bar: "bg-amber-400" },
  { key: "other", label: "Other", icon: Bell, text: "text-neutral-600", tile: "bg-neutral-100 text-neutral-600", bar: "bg-neutral-400" },
];

/** Groups the inbox by what the notification is about, from its type and template. */
function categoryOf(m: Message): Category {
  const kind = String(m.meta?.notificationKind || "");
  const type = String(m.type || "");
  // Customer data copies: legal, dispute and locked-download alerts live together.
  if (kind.startsWith("data_export") || kind === "security_data_export_locked") return "privacy";
  if (kind.startsWith("security_") || type === "system") return "system";
  if (type === "invoice" || kind.startsWith("payment") || kind.includes("payout")) return "money";
  if (type === "booking" || type === "cancellation" || kind.startsWith("group_stay")) return "bookings";
  if (type === "ride" || kind.startsWith("transport")) return "transport";
  if (type === "property" && !kind.startsWith("nrms") && !kind.startsWith("sales")) return "properties";
  return "other";
}

/** Alerts that want a person now: security, money stuck or mismatched, approvals waiting on another admin. */
const URGENT_KINDS = new Set([
  "payment_amount_mismatch",
  "payment_stuck_unsettled",
  "payment_unmatched",
  "nrms_payment_reconcile_needed",
  "nrms_stop_sell_approval_requested",
  "transport_auto_dispatch_takeover",
  "data_export_legal",
]);

function isUrgent(m: Message): boolean {
  const kind = String(m.meta?.notificationKind || "");
  if (kind.startsWith("security_") || URGENT_KINDS.has(kind)) return true;
  if (kind === "nrms_channel_health_alert" && m.meta?.severity === "CRITICAL") return true;
  return String(m.type || "") === "system";
}

function eatDay(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" });
}

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-50";

function stamp(m: Message) {
  return m.createdAt ?? m.date ?? "";
}

function ago(iso: string) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes < 1 ? "Just now" : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return days === 1 ? "Yesterday" : `${days} days ago`;
  return `${Math.floor(days / 30.4)} mo ago`;
}

function eat(iso: string) {
  if (!iso) return "";
  return `${new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

function describeError(err: any): string {
  const msg: string = err?.message ?? "";
  if (err?.name === "AbortError" || msg.toLowerCase().includes("aborted")) return "The server took too long to respond. It may be starting up, wait a moment and retry.";
  if (msg.startsWith("SERVER_502") || msg.startsWith("SERVER_503")) return "The server is temporarily unavailable. It may be starting up, wait a moment and retry.";
  if (msg.startsWith("SERVER_")) return `Server error (${msg.replace("SERVER_", "")}). Please retry.`;
  if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("networkerror")) return "Network error. Check your connection and retry.";
  return "Failed to load notifications. Please try again.";
}

function toast(type: "success" | "error", title: string, message: string) {
  window.dispatchEvent(new CustomEvent("nols:toast", { detail: { type, title, message, duration: type === "error" ? 5_000 : 3_000 } }));
}

export default function Page() {
  const recordHref = useAdminHref();
  const [tab, setTab] = useState<"unread" | "viewed">("unread");
  const [unread, setUnread] = useState<Message[]>([]);
  const [viewed, setViewed] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [channels, setChannels] = useState<{ email: boolean; sms: boolean } | null>(null);

  // Delivery channels come from System settings; this page only reports them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/admin/settings", { credentials: "include" });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setChannels({ email: Boolean(data?.emailEnabled), sms: Boolean(data?.smsEnabled) });
      } catch {
        // channel status is informational; leave it unknown
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchTab = useCallback(async (t: "unread" | "viewed") => {
    setLoading(true);
    setFetchError(null);
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 10_000);
    try {
      const q = new URLSearchParams({ tab: t, page: "1", pageSize: String(PAGE_SIZE) });
      const r = await fetch(`/api/admin/notifications?${q.toString()}`, { credentials: "include", signal: ac.signal });
      if (!r.ok) throw new Error(r.status >= 500 ? `SERVER_${r.status}` : `Fetch failed ${r.status}`);
      const data = await r.json();
      const items: Message[] = data.items ?? [];
      if (t === "unread") setUnread(items);
      else setViewed(items);
    } catch (err: any) {
      setFetchError(describeError(err));
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void fetchTab("unread");
    void fetchTab("viewed");
  }, [fetchTab]);

  useEffect(() => { refresh(); }, [refresh]);

  const markRead = useCallback(async (m: Message) => {
    if (!m.unread) return;
    try {
      const r = await fetch(`/api/admin/notifications/${m.id}/mark-read`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(`Mark read failed ${r.status}`);
      setUnread((u) => u.filter((x) => x.id !== m.id));
      setViewed((v) => [{ ...m, unread: false }, ...v.filter((x) => x.id !== m.id)]);
    } catch (err) {
      console.error("mark read failed", err);
      toast("error", "Could not mark as read", "Please try again.");
    }
  }, []);

  // No bulk endpoint exists, so this walks the per-item route one at a time.
  const markAllRead = useCallback(async () => {
    const targets = (category ? unread.filter((m) => categoryOf(m) === category) : unread).slice();
    if (!targets.length) return;
    setMarkingAll(true);
    let done = 0;
    for (const m of targets) {
      try {
        const r = await fetch(`/api/admin/notifications/${m.id}/mark-read`, { method: "POST", credentials: "include" });
        if (!r.ok) continue;
        done += 1;
        setUnread((u) => u.filter((x) => x.id !== m.id));
        setViewed((v) => [{ ...m, unread: false }, ...v.filter((x) => x.id !== m.id)]);
      } catch {
        // keep going; the count below reports what actually changed
      }
    }
    setMarkingAll(false);
    if (done === targets.length) toast("success", "All caught up", `${done} ${done === 1 ? "notification" : "notifications"} marked as read.`);
    else toast("error", "Some were not marked", `${done} of ${targets.length} marked as read. Refresh and try again.`);
  }, [category, unread]);

  const deleteViewed = useCallback(async (message: Message) => {
    if (message.unread || deletingIds.has(message.id)) return;
    const originalIndex = viewed.findIndex((item) => item.id === message.id);
    setDeletingIds((current) => new Set(current).add(message.id));
    setViewed((current) => current.filter((item) => item.id !== message.id));
    setOpenId((current) => (current === message.id ? null : current));
    try {
      const response = await fetch(`/api/admin/notifications/${message.id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(`Delete failed ${response.status}`);
      toast("success", "Notification deleted", "The viewed notification was removed.");
    } catch (error) {
      console.error("delete notification failed", error);
      setViewed((current) => {
        if (current.some((item) => item.id === message.id)) return current;
        const restored = [...current];
        restored.splice(Math.max(0, originalIndex), 0, message);
        return restored;
      });
      toast("error", "Could not delete notification", "The notification was restored. Please try again.");
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  }, [deletingIds, viewed]);

  const currentItems = tab === "unread" ? unread : viewed;
  const counts = useMemo(() => {
    const out: Record<Category, number> = { system: 0, privacy: 0, money: 0, bookings: 0, properties: 0, transport: 0, other: 0 };
    for (const m of currentItems) out[categoryOf(m)] += 1;
    return out;
  }, [currentItems]);
  const visible = category ? currentItems.filter((m) => categoryOf(m) === category) : currentItems;
  const all = [...unread, ...viewed];
  const newest = all.reduce<string>((max, m) => (stamp(m) > max ? stamp(m) : max), "");
  const shownCategories = CATEGORIES.filter((c) => counts[c.key] > 0 || category === c.key);

  const needsAttention = unread.filter(isUrgent);
  const unreadMix = CATEGORIES.map((c) => ({ ...c, n: unread.filter((m) => categoryOf(m) === c.key).length })).filter((c) => c.n > 0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    const key = eatDay(d);
    return {
      key,
      label: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Africa/Dar_es_Salaam" }),
      n: all.filter((m) => stamp(m) && eatDay(new Date(stamp(m))) === key).length,
    };
  });
  const weekMax = Math.max(1, ...week.map((d) => d.n));
  const weekTotal = week.reduce((sum, d) => sum + d.n, 0);

  const openAttention = () => {
    setTab("unread");
    setCategory(null);
    const first = needsAttention[0];
    if (first) {
      setCategory(categoryOf(first));
      setOpenId(first.id);
    }
  };

  const selectTab = (next: "unread" | "viewed") => {
    setTab(next);
    setCategory(null);
    setOpenId(null);
  };

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header: dark band with the inbox at a glance and the two views as tabs */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Inbox</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Notifications</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">System events, approvals, payments and security alerts for the admin team.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tab === "unread" && unread.length > 0 && (
                <button type="button" onClick={() => void markAllRead()} disabled={markingAll} className={heroButton}>
                  {markingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  {category ? `Mark ${counts[category]} read` : `Mark all ${unread.length} read`}
                </button>
              )}
              <Link href="/admin/management/settings#notifications" className={`${heroButton} no-underline hover:no-underline`}>
                <Settings2 className="h-3.5 w-3.5" /> Channels
              </Link>
              <button type="button" onClick={refresh} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-y-5 border-0 border-t border-solid border-white/10 pt-4 md:grid-cols-2 xl:grid-cols-[1.1fr_1.2fr_1.2fr_1fr]">
            {/* Needs attention */}
            <div className="min-w-0 pr-5">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Needs attention</p>
              <div className="mt-1.5 flex items-end gap-2">
                <span className={`text-3xl font-bold leading-none tabular-nums ${needsAttention.length ? "text-rose-300" : "text-emerald-300"}`}>{loading && !all.length ? "..." : needsAttention.length}</span>
                <span className="pb-0.5 text-xs text-white/50">{needsAttention.length ? "urgent unread" : "nothing urgent"}</span>
              </div>
              {needsAttention.length > 0 ? (
                <button type="button" onClick={openAttention} className="mt-2 block max-w-full truncate border-0 bg-transparent p-0 text-left text-xs font-semibold text-rose-200 hover:text-white">
                  {needsAttention[0].title || "Notification"} <span className="text-white/40">· {ago(stamp(needsAttention[0]))}</span>
                </button>
              ) : (
                <p className="m-0 mt-2 text-xs text-white/50">Security, payment and approval alerts land here first.</p>
              )}
            </div>

            {/* Unread mix */}
            <div className="min-w-0 md:border-0 md:border-l md:border-solid md:border-white/10 md:pl-5 xl:pr-5">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Unread by type</p>
              <div className="mt-1.5 flex items-end gap-2">
                <span className="text-3xl font-bold leading-none tabular-nums text-white">{unread.length}{unread.length >= PAGE_SIZE ? "+" : ""}</span>
                <span className="pb-0.5 text-xs text-white/50">{unread.length ? "waiting" : "all caught up"}</span>
              </div>
              <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                {unreadMix.map((c) => (
                  <span key={c.key} className={c.bar} style={{ width: `${(c.n / Math.max(1, unread.length)) * 100}%` }} title={`${c.label}: ${c.n}`} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {unreadMix.slice(0, 4).map((c) => (
                  <button key={c.key} type="button" onClick={() => { setTab("unread"); setCategory(c.key); }} className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[11px] text-white/60 hover:text-white">
                    <span className={`h-1.5 w-1.5 rounded-full ${c.bar}`} /> {c.label} <span className="tabular-nums text-white/40">{c.n}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Last 7 days */}
            <div className="min-w-0 xl:border-0 xl:border-l xl:border-solid xl:border-white/10 xl:pl-5 xl:pr-5">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Last 7 days</p>
              <div className="mt-1.5 flex items-end gap-2">
                <span className="text-3xl font-bold leading-none tabular-nums text-white">{weekTotal}</span>
                <span className="pb-0.5 text-xs text-white/50">received · last {newest ? ago(newest).toLowerCase() : "never"}</span>
              </div>
              <div className="mt-2 flex h-9 items-end gap-1.5" aria-label="Notifications per day">
                {week.map((d, i) => (
                  <span key={d.key} className="flex flex-1 flex-col items-center gap-1" title={`${d.label}: ${d.n}`}>
                    <span className={`block w-full rounded-sm ${i === 6 ? "bg-emerald-400" : "bg-white/25"}`} style={{ height: `${Math.max(3, (d.n / weekMax) * 28)}px` }} />
                    <span className={`text-[9px] ${i === 6 ? "font-semibold text-emerald-300" : "text-white/40"}`}>{i === 6 ? "Today" : d.label.slice(0, 2)}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Delivery channels */}
            <div className="min-w-0 md:border-0 md:border-l md:border-solid md:border-white/10 md:pl-5">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Delivery channels</p>
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                {[
                  { label: "In-app inbox", hint: "this page and the bell", on: true as boolean | null, icon: MonitorSmartphone },
                  { label: "Email", hint: "invoices and key actions", on: channels ? channels.email : null, icon: Mail },
                  { label: "SMS", hint: "urgent operational alerts", on: channels ? channels.sms : null, icon: MessageSquare },
                ].map((ch) => {
                  const Icon = ch.icon;
                  return (
                    <li key={ch.label} className="flex items-center gap-2 text-xs">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-white/50" />
                      <span className="min-w-0 flex-1 truncate text-white/80">{ch.label} <span className="text-white/35">· {ch.hint}</span></span>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${ch.on === null ? "text-white/40" : ch.on ? "text-emerald-300" : "text-amber-300"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${ch.on === null ? "bg-white/30" : ch.on ? "bg-emerald-400" : "bg-amber-400"}`} />
                        {ch.on === null ? "..." : ch.on ? "On" : "Off"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="mt-5 flex gap-1" role="tablist" aria-label="Notification views">
            {([["unread", "Unread", unread.length], ["viewed", "Viewed", viewed.length]] as const).map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => selectTab(key)}
                className={`relative inline-flex h-11 items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${tab === key ? "text-white" : "text-white/50 hover:text-white/80"}`}
              >
                {label}
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${tab === key ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/60"}`}>{n}{n >= PAGE_SIZE ? "+" : ""}</span>
                {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Categories: what the current view is about, doubling as a filter */}
      {shownCategories.length > 1 && (
        <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-2 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {shownCategories.map((c) => {
              const Icon = c.icon;
              const selected = category === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(selected ? null : c.key)}
                  aria-pressed={selected}
                  className={`inline-flex h-10 items-center gap-2 rounded-xl border border-solid px-3 text-xs font-semibold transition-all ${selected ? "border-neutral-900 bg-white text-neutral-900" : "border-transparent bg-neutral-50 text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:bg-white"}`}
                >
                  <span className={`grid h-6 w-6 place-items-center rounded-md ${c.tile}`}><Icon className="h-3.5 w-3.5" /></span>
                  {c.label}
                  <span className="tabular-nums text-neutral-400">{counts[c.key]}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Inbox */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{category ? CATEGORIES.find((c) => c.key === category)?.label : tab === "unread" ? "Unread" : "Viewed"}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading..." : `${visible.length} ${visible.length === 1 ? "notification" : "notifications"}`}</p>
          </div>
          {category && (
            <button type="button" onClick={() => setCategory(null)} className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
              <X className="h-3 w-3" /> Show all
            </button>
          )}
          {tab === "viewed" && viewed.length > 0 && <span className="ml-auto text-[11px] text-neutral-400">Viewed notifications can be deleted.</span>}
        </div>

        {loading && currentItems.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading notifications
          </div>
        ) : fetchError ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-5 sm:px-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><AlertTriangle className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-neutral-900">Could not load notifications</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">{fetchError}</p>
            </div>
            <button type="button" onClick={refresh} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white hover:bg-[#12342f]">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-5 sm:px-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Inbox className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-neutral-900">{tab === "unread" ? "All caught up" : "Nothing viewed yet"}</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">{tab === "unread" ? "New alerts and approvals will appear here." : "Notifications you open move here."}</p>
            </div>
          </div>
        ) : (
          <div>
            {visible.map((m, idx) => {
              const c = CATEGORIES.find((x) => x.key === categoryOf(m))!;
              const Icon = c.icon;
              const isOpen = openId === m.id;
              const when = stamp(m);
              const meta = m.meta || {};
              const details: Array<{ label: string; value: React.ReactNode }> = [];
              if (meta.propertyId) {
                details.push({
                  label: "Property",
                  value: (
                    <Link href={`/admin/properties/previews?previewId=${adminRefOrId("property", meta.propertyId)}`} className="inline-flex items-center gap-1 font-semibold text-neutral-900 no-underline hover:text-emerald-700">
                      {meta.propertyTitle || `Property #${meta.propertyId}`} <ExternalLink className="h-3 w-3" />
                    </Link>
                  ),
                });
              }
              if (meta.ownerId || meta.ownerName) {
                details.push({
                  label: "Owner",
                  value: meta.ownerId ? (
                    <Link href={recordHref("owner", meta.ownerId)} className="inline-flex items-center gap-1 font-semibold text-neutral-900 no-underline hover:text-emerald-700">
                      {meta.ownerName || `Owner #${meta.ownerId}`} <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : meta.ownerName,
                });
              }
              if (meta.approvedBy) details.push({ label: "Approved by", value: meta.approvedByName || `Admin #${meta.approvedBy}` });
              // Customer data alerts: who, where they live, why, how it was asked for. Never the data itself.
              const isDataAlert = categoryOf(m) === "privacy";
              if (isDataAlert && meta.userId) {
                details.push({
                  label: "Customer",
                  value: (
                    <Link href={recordHref("user", meta.userId, { suffix: "?tab=karibu" })} className="inline-flex items-center gap-1 font-semibold text-neutral-900 no-underline hover:text-emerald-700">
                      {meta.customerName || "Customer record"} <ExternalLink className="h-3 w-3" />
                    </Link>
                  ),
                });
              }
              if (isDataAlert && meta.country) details.push({ label: "Lives in", value: meta.country });
              if (isDataAlert && (meta.reasonLabel || meta.otherReason)) details.push({ label: "Reason given", value: [meta.reasonLabel, meta.otherReason ? `"${meta.otherReason}"` : null].filter(Boolean).join(" ") });
              if (isDataAlert && meta.format) details.push({ label: "Format", value: meta.format === "json" ? "Machine-readable (JSON)" : "Readable document (PDF)" });
              if (isDataAlert && meta.sentVia) details.push({ label: "Code sent by", value: meta.sentVia === "phone" ? "Text message" : "Email" });
              if (isDataAlert && meta.attempts) details.push({ label: "Wrong codes", value: String(meta.attempts) });
              if (isDataAlert && meta.ip) details.push({ label: "IP address", value: <span className="font-mono text-xs">{meta.ip}</span> });
              if (when) details.push({ label: "Received", value: eat(when) });

              return (
                <article key={m.id} className={`${idx ? "border-0 border-t border-solid border-neutral-200" : ""} ${m.unread ? "bg-emerald-50/30" : ""}`}>
                  <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                    <span className={`relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${c.tile}`}>
                      <Icon className="h-4 w-4" />
                      {m.unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" aria-label="Unread" />}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = isOpen ? null : m.id;
                        setOpenId(next);
                        if (m.unread && next === m.id) void markRead(m);
                      }}
                      aria-expanded={isOpen}
                      className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={`text-sm text-neutral-900 ${m.unread ? "font-bold" : "font-semibold"}`}>{m.title || "Notification"}</span>
                        <span className={`text-[11px] font-semibold ${c.text}`}>{c.label}</span>
                      </span>
                      {!isOpen && m.body && <span className="mt-0.5 block truncate text-xs text-neutral-500">{m.body}</span>}
                      <span className="mt-1 block text-[11px] text-neutral-400">{ago(when)}{when ? ` · ${eat(when)}` : ""}</span>
                    </button>
                    <span className="flex shrink-0 items-center gap-1">
                      {m.unread && (
                        <button type="button" onClick={() => void markRead(m)} title="Mark as read" className="inline-flex h-8 items-center gap-1 rounded-lg border-0 bg-transparent px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                          <Check className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Mark read</span>
                        </button>
                      )}
                      {!m.unread && (
                        <button
                          type="button"
                          onClick={() => void deleteViewed(m)}
                          disabled={deletingIds.has(m.id)}
                          aria-label={`Delete ${m.title}`}
                          title="Delete"
                          className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                        >
                          {deletingIds.has(m.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenId(isOpen ? null : m.id)}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                        className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                    </span>
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-4 sm:pl-[68px] sm:pr-5">
                      <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{m.body}</p>
                      {details.length > 0 && (
                        <dl className="m-0 mt-3 flex flex-wrap gap-px overflow-hidden rounded-lg bg-neutral-200 ring-1 ring-inset ring-neutral-200">
                          {details.map((d) => (
                            <div key={d.label} className="min-w-[200px] flex-1 bg-neutral-50 px-3 py-2.5">
                              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{d.label}</dt>
                              <dd className="m-0 mt-1 truncate text-sm text-neutral-800">{d.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {isDataAlert && meta.userId && (
                        <Link href={recordHref("user", meta.userId, { suffix: "?tab=karibu" })} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3.5 text-xs font-semibold text-white no-underline transition hover:bg-[#123a33] hover:no-underline">
                          {String(meta.notificationKind) === "security_data_export_locked" ? "Review and unlock" : "Open customer record"} <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {(meta.note || meta.reasons) && (
                        <div className="mt-3 space-y-2">
                          {meta.note && (
                            <p className="m-0 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700 ring-1 ring-inset ring-neutral-200"><span className="font-semibold text-neutral-900">Note: </span>{meta.note}</p>
                          )}
                          {meta.reasons && (
                            <p className="m-0 rounded-lg bg-amber-50/70 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"><span className="font-semibold">Reasons: </span>{Array.isArray(meta.reasons) ? meta.reasons.join(", ") : meta.reasons}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
