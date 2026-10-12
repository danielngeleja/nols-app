"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellDot, Building2, CalendarCheck, CheckCheck, ChevronDown, ExternalLink, Inbox, Loader2, RefreshCw, Trash2, Wallet } from "lucide-react";
import { notificationDestination } from "./notificationDestination";

type Tab = "unread" | "viewed";
type Topic = "Bookings" | "Properties" | "Payments" | "NRMS" | "Updates";
type Note = { id: string; title: string; body: string; createdAt: string; meta: Record<string, unknown> };
type ApiNote = Omit<Note, "id" | "meta"> & { id: string | number; meta?: unknown };
type Response = { items?: ApiNote[]; total?: number; totalUnread?: number };
const PAGE_SIZE = 40;
const topics: Topic[] = ["Bookings", "Properties", "Payments", "NRMS", "Updates"];

function toNote(raw: ApiNote): Note {
  return { id: String(raw.id), title: raw.title || "Notification", body: raw.body || "", createdAt: raw.createdAt || "",
    meta: raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta) ? raw.meta as Record<string, unknown> : {} };
}

function topicOf(note: Note): Topic {
  const kind = String(note.meta.notificationKind || note.meta.kind || "").toLowerCase();
  const title = note.title.toLowerCase();
  if (kind.startsWith("nrms_") || title.includes("nrms") || title.includes("partnership")) return "NRMS";
  if (/payout|payment|invoice|recovery/.test(kind + title)) return "Payments";
  if (/booking|cancellation|guest_code/.test(kind + title)) return "Bookings";
  if (/property|listing/.test(kind + title)) return "Properties";
  return "Updates";
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" });
}

export default function OwnerInbox({ initialTab }: { initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [items, setItems] = useState<Note[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [read, setRead] = useState(0);
  const [page, setPage] = useState(1);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingRead, setClearingRead] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (selected: Tab, nextPage = 1) => {
    const request = ++requestId.current;
    if (nextPage === 1) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(`/api/owner/notifications?tab=${selected}&page=${nextPage}&pageSize=${PAGE_SIZE}`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load your inbox. Please try again.");
      const data = await response.json() as Response;
      if (request !== requestId.current) return;
      const nextItems = (data.items ?? []).map(toNote);
      setItems((current) => nextPage === 1 ? nextItems : [...current, ...nextItems]);
      setTotal(Number(data.total ?? nextItems.length));
      setUnread(Number(data.totalUnread ?? 0));
      if (selected === "viewed") setRead(Number(data.total ?? nextItems.length));
      setPage(nextPage);
    } catch (cause) {
      if (request === requestId.current) setError(cause instanceof Error ? cause.message : "Could not load your inbox.");
    } finally {
      if (request === requestId.current) { setLoading(false); setLoadingMore(false); }
    }
  }, []);

  useEffect(() => { void load(tab); setTopic(null); setExpanded(null); setConfirmClear(false); }, [tab, load]);
  useEffect(() => {
    let active = true;
    fetch("/api/owner/notifications?tab=viewed&page=1&pageSize=1", { credentials: "include" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data) setRead(Number(data.total ?? 0)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const shown = useMemo(() => topic ? items.filter((item) => topicOf(item) === topic) : items, [items, topic]);
  const counts = useMemo(() => Object.fromEntries(topics.map((item) => [item, items.filter((note) => topicOf(note) === item).length])) as Record<Topic, number>, [items]);
  const changed = () => window.dispatchEvent(new Event("nols:owner-notifications-changed"));

  async function markRead(id: string) {
    if (busy) return;
    setBusy(id); setError(null);
    try {
      const response = await fetch(`/api/owner/notifications/${encodeURIComponent(id)}/mark-read`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Could not mark this notification as read.");
      setItems((current) => current.filter((item) => item.id !== id));
      setTotal((count) => Math.max(0, count - 1));
      setUnread((count) => Math.max(0, count - 1));
      setRead((count) => count + 1);
      changed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the notification."); }
    finally { setBusy(null); }
  }

  async function markAllRead() {
    if (markingAll || tab !== "unread" || unread === 0) return;
    setMarkingAll(true); setError(null);
    try {
      const response = await fetch("/api/owner/notifications/mark-all-read", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Could not mark all notifications as read.");
      const data = await response.json() as { updated?: number };
      setRead((count) => count + Number(data.updated ?? unread));
      setUnread(0); setTotal(0); setItems([]);
      changed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update notifications."); }
    finally { setMarkingAll(false); }
  }

  async function deleteRead(id: string) {
    if (busy) return;
    setBusy(id); setError(null);
    try {
      const response = await fetch(`/api/owner/notifications/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Could not delete this notification.");
      setItems((current) => current.filter((item) => item.id !== id));
      setTotal((count) => Math.max(0, count - 1));
      setRead((count) => Math.max(0, count - 1));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete this notification."); }
    finally { setBusy(null); }
  }

  async function clearRead() {
    if (clearingRead || tab !== "viewed") return;
    setClearingRead(true); setError(null);
    try {
      const response = await fetch("/api/owner/notifications/read", { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Could not clear read notifications.");
      setItems([]); setTotal(0); setRead(0); setConfirmClear(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not clear read notifications."); }
    finally { setClearingRead(false); }
  }

  return <div className="space-y-5 pb-8">
    <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_130%_at_100%_0%,rgba(52,211,153,0.18),transparent_62%)]" />
      <div className="relative flex flex-col gap-5 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><p className="m-0 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">Owner workspace · Inbox</p><h1 className="m-0 mt-2 flex items-center gap-3 text-2xl font-bold tracking-tight sm:text-3xl"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-emerald-300"><Inbox className="h-5 w-5" /></span>Notifications</h1><p className="m-0 mt-2 text-sm text-white/65">Bookings, properties, payments, and NRMS updates in one place.</p></div>
        <div className="flex flex-wrap items-center gap-2"><span className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white"><BellDot className="h-4 w-4 text-rose-300" />{unread} unread</span><button type="button" onClick={() => void load(tab)} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>{tab === "unread" && unread > 0 && <button type="button" onClick={() => void markAllRead()} disabled={markingAll} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-emerald-400 px-3 text-xs font-bold text-[#0b2420] transition hover:bg-emerald-300 disabled:opacity-50">{markingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}Mark all read</button>}</div>
      </div>
      <div className="relative flex flex-wrap gap-2 border-0 border-t border-solid border-white/10 px-5 py-3 sm:px-7" aria-label="Owner shortcuts">{[{ href: "/owner/bookings/recent", label: "Bookings", Icon: CalendarCheck }, { href: "/owner/properties/approved", label: "Properties", Icon: Building2 }, { href: "/owner/payouts", label: "Payouts", Icon: Wallet }].map(({ href, label, Icon }) => <Link key={href} href={href} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white/70 no-underline transition hover:bg-white/10 hover:text-white"><Icon className="h-3.5 w-3.5" />{label}<ArrowRight className="h-3 w-3" /></Link>)}</div>
    </section>

    {tab === "viewed" && read > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3"><p className="m-0 text-xs text-neutral-500">Read notifications can be removed from your history.</p>{confirmClear ? <div className="flex gap-2"><button type="button" onClick={() => setConfirmClear(false)} disabled={clearingRead} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700">Cancel</button><button type="button" onClick={() => void clearRead()} disabled={clearingRead} className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{clearingRead && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Confirm clear</button></div> : <button type="button" onClick={() => setConfirmClear(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"><Trash2 className="h-3.5 w-3.5" />Clear read history</button>}</div>}

    <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 pt-3 sm:px-6"><div className="flex gap-1" role="tablist" aria-label="Notification status">{([{ key: "unread", label: "Unread", count: unread, Icon: BellDot }, { key: "viewed", label: "Read", count: read, Icon: CheckCheck }] as const).map(({ key, label, count, Icon }) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`relative inline-flex h-11 items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold ${tab === key ? "text-[#02665e]" : "text-neutral-500 hover:text-neutral-800"}`}><Icon className="h-4 w-4" />{label}<span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-600">{count}</span>{tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-600" />}</button>)}</div><span className="pb-3 text-xs text-neutral-400">{loading ? "Loading…" : `${total} ${tab === "unread" ? "unread" : "read"} notifications`}</span></div>
      <div className="flex flex-wrap gap-1.5 px-5 py-3 sm:px-6" aria-label="Filter by topic"><button type="button" aria-pressed={topic === null} onClick={() => setTopic(null)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${topic === null ? "border-[#02665e] bg-[#02665e] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}>All</button>{topics.map((item) => <button key={item} type="button" aria-pressed={topic === item} onClick={() => setTopic(item)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${topic === item ? "border-[#02665e] bg-[#02665e] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{item}{counts[item] > 0 ? ` · ${counts[item]}` : ""}</button>)}</div>
    </section>

    {error && <div role="alert" className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
    {loading ? <div role="status" className="flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white py-16 text-sm text-neutral-500"><Loader2 className="h-5 w-5 animate-spin" />Loading inbox…</div>
      : shown.length === 0 ? <div className="rounded-2xl border border-neutral-200 bg-white px-6 py-16 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Inbox className="h-5 w-5" /></span><h2 className="m-0 mt-3 text-base font-bold text-neutral-900">{topic ? `No ${topic.toLowerCase()} updates here` : tab === "unread" ? "You're all caught up" : "No read notifications yet"}</h2><p className="m-0 mt-1 text-sm text-neutral-500">{topic ? "Choose another topic to see more." : tab === "unread" ? "New updates will appear here." : "Notifications you mark as read will appear here."}</p></div>
      : <div className="space-y-2.5">{shown.map((note) => {
        const destination = notificationDestination(note.meta);
        const isExpanded = expanded === note.id;
        return <article key={note.id} className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm transition hover:border-emerald-200 hover:shadow-md"><div className="flex gap-3 p-4 sm:gap-4 sm:p-5"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tab === "unread" ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"}`}>{tab === "unread" ? <BellDot className="h-5 w-5" /> : <CheckCheck className="h-5 w-5" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"><div className="flex items-center gap-2"><h2 className="m-0 text-sm font-bold text-neutral-900">{note.title}</h2>{tab === "unread" && <span className="h-2 w-2 rounded-full bg-rose-500" aria-label="Unread" />}</div><time className="text-[11px] text-neutral-400" dateTime={note.createdAt}>{dateLabel(note.createdAt)}</time></div><p className="m-0 mt-1 text-xs font-semibold text-emerald-700">{topicOf(note)}</p><p className={`m-0 mt-2 text-sm leading-6 text-neutral-600 ${isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{note.body}</p><div className="mt-3 flex flex-wrap items-center gap-2">{destination && <Link href={destination.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0b2420] px-3 text-xs font-semibold text-white no-underline hover:bg-[#123a33] hover:text-white">{destination.label}<ExternalLink className="h-3.5 w-3.5" /></Link>}{note.body.length > 140 && <button type="button" onClick={() => setExpanded(isExpanded ? null : note.id)} aria-expanded={isExpanded} className="inline-flex h-8 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">{isExpanded ? "Less" : "Read more"}<ChevronDown className={`h-3.5 w-3.5 transition ${isExpanded ? "rotate-180" : ""}`} /></button>}{tab === "unread" ? <button type="button" disabled={busy === note.id || markingAll} onClick={() => void markRead(note.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">{busy === note.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}Mark read</button> : <button type="button" disabled={busy === note.id} onClick={() => void deleteRead(note.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-100 bg-white px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">{busy === note.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Delete</button>}</div></div></div></article>;
      })}</div>}
    {!loading && items.length < total && <div className="flex justify-center"><button type="button" disabled={loadingMore} onClick={() => void load(tab, page + 1)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50">{loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}Load more</button></div>}
  </div>;
}
