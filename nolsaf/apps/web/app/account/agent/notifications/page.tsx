"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, BellDot, BellRing, CalendarDays, Check, CheckCheck, ClipboardList, FileSignature,
  FolderOpen, HandCoins, Inbox, Loader2, MessageSquareWarning, RefreshCw, ShieldCheck, Trash2, X,
} from "lucide-react";
import { useSocket } from "@/hooks/useSocket";
import { agentNotificationDestination } from "./notificationDestination";

type Tab = "unread" | "viewed";
type Topic = "bookings" | "cancellations" | "earnings" | "account" | "assignments" | "updates";
type Action = { topic: Topic; href: string | null; label: string | null; needsAction: boolean };
type Note = { id: string; title: string; body: string; createdAt: string; meta: Record<string, unknown>; action: Action };
type ApiNote = { id: string | number; title?: string; body?: string; createdAt?: string; meta?: unknown; action?: Partial<Action> | null };
type InboxResponse = { items?: ApiNote[]; total?: number; totalUnread?: number };

const PAGE_SIZE = 40;
const TZ = "Africa/Dar_es_Salaam";

const TOPICS: Array<{ key: Topic; label: string; Icon: typeof CalendarDays; tile: string }> = [
  { key: "bookings", label: "Bookings", Icon: CalendarDays, tile: "bg-[#02665e]/10 text-[#02665e]" },
  { key: "cancellations", label: "Cancellations", Icon: MessageSquareWarning, tile: "bg-amber-50 text-amber-700" },
  { key: "earnings", label: "Earnings", Icon: HandCoins, tile: "bg-emerald-50 text-emerald-700" },
  { key: "account", label: "Account", Icon: ShieldCheck, tile: "bg-sky-50 text-sky-700" },
  { key: "assignments", label: "Assignments", Icon: ClipboardList, tile: "bg-violet-50 text-violet-700" },
  { key: "updates", label: "Other updates", Icon: BellDot, tile: "bg-neutral-100 text-neutral-600" },
];
const TOPIC_BY_KEY = Object.fromEntries(TOPICS.map((t) => [t.key, t])) as Record<Topic, (typeof TOPICS)[number]>;

const SHORTCUTS = [
  { href: "/account/agent/bookings", label: "Bookings", Icon: CalendarDays },
  { href: "/account/agent/revenues", label: "Earnings", Icon: HandCoins },
  { href: "/account/agent/cancellations", label: "Cancellation cases", Icon: MessageSquareWarning },
  { href: "/account/agent/contract", label: "Agreement", Icon: FileSignature },
  { href: "/account/agent/documents", label: "Documents", Icon: FolderOpen },
];

/** Used only for notifications from an API that does not send `action` yet. */
function fallbackTopic(meta: Record<string, unknown>, title: string): Topic {
  const text = `${String(meta.notificationKind ?? meta.kind ?? "")} ${title}`.toLowerCase();
  if (/cancel|refund|case/.test(text)) return "cancellations";
  if (/payout|advance|balance|earning|claim|revenue/.test(text)) return "earnings";
  if (/assignment/.test(text)) return "assignments";
  if (/profile|document|verification|contract|agreement|account|partnership/.test(text)) return "account";
  if (/booking|tour/.test(text)) return "bookings";
  return "updates";
}

function toNote(raw: ApiNote): Note {
  const meta = raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta) ? (raw.meta as Record<string, unknown>) : {};
  const title = raw.title || "Notification";
  const server = raw.action && typeof raw.action === "object" ? raw.action : null;
  const legacy = server ? null : agentNotificationDestination(meta);
  const topic = server?.topic && TOPIC_BY_KEY[server.topic as Topic] ? (server.topic as Topic) : fallbackTopic(meta, title);
  return {
    id: String(raw.id),
    title,
    body: raw.body || "",
    createdAt: raw.createdAt || "",
    meta,
    action: {
      topic,
      href: server ? server.href ?? null : legacy?.href ?? null,
      label: server ? server.label ?? null : legacy?.label ?? null,
      needsAction: Boolean(server?.needsAction),
    },
  };
}

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function dayHeading(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const now = new Date();
  const key = dayKey(d);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(d);
}

function timeLabel(value: string): { short: string; full: string } {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { short: "", full: "" };
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const full = `${new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(d)}, ${clock} EAT`;
  if (mins < 1) return { short: "Just now", full };
  if (mins < 60) return { short: `${mins} min ago`, full };
  if (mins < 6 * 60) return { short: `${Math.floor(mins / 60)} h ago`, full };
  return { short: clock, full };
}

export default function AgentNotificationsPage() {
  const [tab, setTab] = useState<Tab>("unread");
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [read, setRead] = useState(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingRead, setClearingRead] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const { socket } = useSocket(undefined, { enabled: true, joinDriverRoom: false });

  const load = useCallback(async (selected: Tab, nextPage = 1, quiet = false) => {
    const request = ++requestId.current;
    if (!quiet) { if (nextPage === 1) setLoading(true); else setLoadingMore(true); }
    setError(null);
    try {
      const otherTab: Tab = selected === "unread" ? "viewed" : "unread";
      const [response, otherResponse] = await Promise.all([
        fetch(`/api/agent/notifications?tab=${selected}&page=${nextPage}&pageSize=${PAGE_SIZE}`, { credentials: "include" }),
        fetch(`/api/agent/notifications?tab=${otherTab}&page=1&pageSize=1`, { credentials: "include" }),
      ]);
      if (!response.ok || !otherResponse.ok) throw new Error("Could not load your notifications. Try again.");
      const data = (await response.json()) as InboxResponse;
      const otherData = (await otherResponse.json()) as InboxResponse;
      if (request !== requestId.current) return;
      const nextItems = (data.items ?? []).map(toNote);
      setItems((current) => (nextPage === 1 ? nextItems : [...current, ...nextItems]));
      setTotal(Number(data.total ?? nextItems.length));
      setUnread(Number(data.totalUnread ?? (selected === "unread" ? data.total : otherData.total) ?? 0));
      setRead(Number((selected === "viewed" ? data.total : otherData.total) ?? 0));
      setPage(nextPage);
    } catch (cause) {
      if (request === requestId.current) setError(cause instanceof Error ? cause.message : "Could not load your notifications.");
    } finally {
      if (request === requestId.current) { setLoading(false); setLoadingMore(false); }
    }
  }, []);

  useEffect(() => { void load(tab); setTopic(null); setConfirmClear(false); }, [tab, load]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("agent:notifications:unreadCount", { detail: { count: unread } }));
  }, [unread]);
  useEffect(() => {
    if (!socket) return;
    const onNew = (payload: { type?: string }) => {
      if (["agent", "cancellation", "system"].includes(String(payload?.type))) void load(tab, 1, true);
    };
    socket.on("notification:new", onNew);
    return () => { socket.off("notification:new", onNew); };
  }, [socket, tab, load]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(TOPICS.map((t) => [t.key, 0])) as Record<Topic, number>;
    for (const n of items) c[n.action.topic] += 1;
    return c;
  }, [items]);
  const shown = useMemo(() => (topic ? items.filter((n) => n.action.topic === topic) : items), [items, topic]);
  const attention = useMemo(() => (tab === "unread" ? items.filter((n) => n.action.needsAction && n.action.href) : []), [items, tab]);
  const groups = useMemo(() => {
    const out: Array<{ heading: string; notes: Note[] }> = [];
    for (const n of shown) {
      const heading = dayHeading(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.heading === heading) last.notes.push(n);
      else out.push({ heading, notes: [n] });
    }
    return out;
  }, [shown]);

  function dropUnread(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setUnread((count) => Math.max(0, count - 1));
    setRead((count) => count + 1);
    setTotal((count) => Math.max(0, count - 1));
  }

  async function markRead(id: string) {
    if (busy) return;
    setBusy(id); setError(null);
    try {
      const response = await fetch(`/api/agent/notifications/${encodeURIComponent(id)}/mark-read`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Could not mark this notification as read.");
      dropUnread(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the notification."); }
    finally { setBusy(null); }
  }

  /** Opening a notification's shortcut counts as reading it. */
  function openShortcut(note: Note) {
    if (tab !== "unread") return;
    void fetch(`/api/agent/notifications/${encodeURIComponent(note.id)}/mark-read`, { method: "POST", credentials: "include", keepalive: true })
      .then((r) => { if (r.ok) dropUnread(note.id); })
      .catch(() => undefined);
  }

  async function markAllRead() {
    if (markingAll || tab !== "unread" || unread === 0) return;
    setMarkingAll(true); setError(null);
    try {
      const response = await fetch("/api/agent/notifications/mark-all-read", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Could not mark all notifications as read.");
      const data = (await response.json()) as { updated?: number };
      setRead((count) => count + Number(data.updated ?? unread));
      setUnread(0); setItems([]); setTotal(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update notifications."); }
    finally { setMarkingAll(false); }
  }

  async function deleteRead(id: string) {
    if (busy) return;
    setBusy(id); setError(null);
    try {
      const response = await fetch(`/api/agent/notifications/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Could not delete this notification.");
      setItems((current) => current.filter((item) => item.id !== id));
      setRead((count) => Math.max(0, count - 1));
      setTotal((count) => Math.max(0, count - 1));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete the notification."); }
    finally { setBusy(null); }
  }

  async function clearRead() {
    if (clearingRead || tab !== "viewed") return;
    setClearingRead(true); setError(null);
    try {
      const response = await fetch("/api/agent/notifications/read", { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Could not clear read notifications.");
      setItems([]); setRead(0); setTotal(0); setConfirmClear(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not clear read notifications."); }
    finally { setClearingRead(false); }
  }

  return (
    <div id="agent-inbox" className="w-full min-w-0 space-y-4 pb-8">
      <style>{`#agent-inbox, #agent-inbox * { box-sizing: border-box; }`}</style>

      {/* Header */}
      <section className="rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#02665e] text-white">
              <BellRing className="h-5 w-5" aria-hidden />
              {unread > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <h1 className="m-0 text-lg font-semibold text-neutral-900">Notifications</h1>
              <p className="m-0 mt-0.5 text-sm text-neutral-500">
                {unread === 0 ? "You are up to date." : `${unread} unread${attention.length ? `, ${attention.length} waiting on you` : ""}.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tab === "unread" && unread > 0 && (
              <button type="button" onClick={() => void markAllRead()} disabled={markingAll} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
                {markingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}Mark all read
              </button>
            )}
            <button type="button" onClick={() => void load(tab)} disabled={loading} aria-label="Refresh" className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      {/* Waiting on you: the shortcuts that need the operator */}
      {attention.length > 0 && !topic && (
        <section aria-label="Waiting on you" className="rounded-lg border border-solid border-amber-200 bg-amber-50/60 p-3 sm:p-4">
          <p className="m-0 mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <BellDot className="h-3.5 w-3.5" aria-hidden /> Waiting on you
          </p>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {attention.slice(0, 6).map((note) => {
              const t = TOPIC_BY_KEY[note.action.topic];
              return (
                <Link
                  key={note.id}
                  href={note.action.href!}
                  onClick={() => openShortcut(note)}
                  className="group flex min-w-0 items-center gap-3 rounded-md border border-solid border-amber-200 bg-white px-3 py-2.5 no-underline transition hover:border-amber-300 hover:shadow-sm"
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${t.tile}`}><t.Icon className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-neutral-900">{note.title}</span>
                    <span className="block truncate text-xs font-semibold text-amber-800">{note.action.label}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-amber-700 transition group-hover:translate-x-0.5" aria-hidden />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Rail */}
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-solid border-neutral-200 bg-white p-1" role="tablist" aria-label="Notification status">
            {([
              { key: "unread", label: "Unread", count: unread },
              { key: "viewed", label: "Read", count: read },
            ] as const).map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 text-[13px] font-semibold transition ${tab === key ? "bg-[#02665e] text-white" : "bg-transparent text-neutral-600 hover:bg-neutral-50"}`}
              >
                {label}
                <span className={`rounded px-1.5 text-[11px] tabular-nums ${tab === key ? "bg-white/20" : "bg-neutral-100 text-neutral-600"}`}>{count}</span>
              </button>
            ))}
          </div>

          <nav aria-label="Filter by topic" className="flex gap-1 overflow-x-auto rounded-lg border border-solid border-neutral-200 bg-white p-1 lg:flex-col lg:overflow-visible">
            {[{ key: null as Topic | null, label: "Everything", Icon: Inbox, tile: "" }, ...TOPICS].map(({ key, label, Icon }) => {
              const active = topic === key;
              const count = key ? counts[key] : items.length;
              if (key && count === 0 && !active) return null;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTopic(key)}
                  className={`flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border-0 px-2.5 text-left text-[13px] font-medium transition lg:w-full ${active ? "bg-[#02665e]/[0.08] text-[#02665e]" : "bg-transparent text-neutral-600 hover:bg-neutral-50"}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="flex-1 whitespace-nowrap">{label}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{count}</span>
                </button>
              );
            })}
          </nav>

          <div className="hidden rounded-lg border border-solid border-neutral-200 bg-white p-1 lg:block">
            <p className="m-0 px-2.5 pb-1 pt-2 text-[11px] font-semibold text-neutral-400">Go to</p>
            {SHORTCUTS.map(({ href, label, Icon }) => (
              <Link key={href} href={href} className="flex h-9 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-neutral-600 no-underline hover:bg-neutral-50 hover:text-neutral-900">
                <Icon className="h-4 w-4 shrink-0" aria-hidden />{label}
              </Link>
            ))}
          </div>
        </aside>

        {/* Feed */}
        <section className="min-w-0 space-y-3">
          {tab === "viewed" && read > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-4 py-2.5">
              <p className="m-0 text-xs text-neutral-500">Read notifications stay here until you clear them.</p>
              {confirmClear ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmClear(false)} disabled={clearingRead} className="h-8 cursor-pointer rounded-md border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700">Keep them</button>
                  <button type="button" onClick={() => void clearRead()} disabled={clearingRead} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-50">
                    {clearingRead && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Clear {read}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmClear(true)} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" />Clear read history
                </button>
              )}
            </div>
          )}

          {error && <div role="alert" className="rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

          {loading ? (
            <div role="status" className="flex items-center justify-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white py-16 text-sm text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin" />Loading notifications…
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-lg border border-solid border-neutral-200 bg-white px-6 py-14 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><Check className="h-5 w-5" /></span>
              <h2 className="m-0 mt-3 text-base font-semibold text-neutral-900">
                {topic ? `No ${TOPIC_BY_KEY[topic].label.toLowerCase()} here` : tab === "unread" ? "Nothing new" : "No read notifications"}
              </h2>
              <p className="m-0 mt-1 text-sm text-neutral-500">
                {topic ? "Pick another topic to see more." : tab === "unread" ? "New bookings, payouts and NoLSAF decisions appear here as they happen." : "Notifications you read move here."}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.heading} className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
                <h2 className="m-0 border-0 border-b border-solid border-neutral-100 bg-neutral-50/70 px-4 py-2 text-xs font-semibold text-neutral-500">{group.heading}</h2>
                <ul className="m-0 list-none divide-y divide-solid divide-neutral-100 p-0">
                  {group.notes.map((note) => {
                    const t = TOPIC_BY_KEY[note.action.topic];
                    const when = timeLabel(note.createdAt);
                    const isUnread = tab === "unread";
                    return (
                      <li key={note.id} className="flex gap-3 bg-white px-4 py-3.5 transition hover:bg-neutral-50/60">
                        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md ${t.tile}`}><t.Icon className="h-4 w-4" aria-hidden /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={`m-0 flex items-center gap-2 text-sm ${isUnread ? "font-semibold text-neutral-900" : "font-medium text-neutral-700"}`}>
                                {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-[#02665e]" aria-label="Unread" />}
                                <span className="min-w-0">{note.title}</span>
                              </p>
                              <p className="m-0 mt-0.5 text-[11px] text-neutral-400">
                                {t.label} · <time dateTime={note.createdAt} title={when.full}>{when.short}</time>
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {isUnread ? (
                                <button type="button" disabled={busy === note.id || markingAll} onClick={() => void markRead(note.id)} aria-label="Mark as read" title="Mark as read" className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50">
                                  {busy === note.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                </button>
                              ) : (
                                <button type="button" disabled={busy === note.id} onClick={() => void deleteRead(note.id)} aria-label="Delete" title="Delete" className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">
                                  {busy === note.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                </button>
                              )}
                            </div>
                          </div>
                          {note.body && <p className="m-0 mt-1.5 whitespace-pre-wrap text-[13px] leading-6 text-neutral-600">{note.body}</p>}
                          {note.action.href && note.action.label && (
                            <Link
                              href={note.action.href}
                              onClick={() => openShortcut(note)}
                              className={`mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold no-underline transition ${
                                note.action.needsAction && isUnread
                                  ? "bg-[#02665e] text-white hover:bg-[#014e47] hover:text-white"
                                  : "border border-solid border-neutral-200 bg-white text-neutral-700 hover:border-[#02665e]/40 hover:text-[#02665e]"
                              }`}
                            >
                              {note.action.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}

          {!loading && items.length < total && (
            <div className="flex justify-center">
              <button type="button" disabled={loadingMore} onClick={() => void load(tab, page + 1)} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-solid border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}Show older
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
