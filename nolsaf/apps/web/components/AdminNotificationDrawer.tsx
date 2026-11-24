"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  Headphones,
  ChevronRight,
  CircleCheck,
  Info,
  Loader2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { adminRefOrId, useAdminHref } from "@/lib/adminRecordRefs";

type NotificationItem = {
  id: number;
  type?: string | null;
  title: string;
  body?: string | null;
  createdAt: string;
  unread: boolean;
  priority?: "normal" | "urgent";
  meta?: Record<string, unknown> | null;
  /** From the server registry (lib/adminNotificationKinds.ts), never guessed from the title. */
  severity?: "critical" | "attention" | "info";
  requiresAction?: boolean;
  state?: "unread" | "open" | "resolved";
  readBy?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  clearsAt?: string | null;
  /** Closed by the system because the matter was decided elsewhere. */
  autoResolved?: string | null;
};

type NotificationResponse = { items: NotificationItem[]; totalUnread: number };
const SOUND_KEY = "nolsaf:admin-notification-sound";

function notificationHref(item: NotificationItem, recordHref: ReturnType<typeof useAdminHref>) {
  const meta = item.meta ?? {};
  // Server-built deep link: accepted only as an internal admin path.
  if (typeof meta.href === "string" && /^\/admin\/[A-Za-z0-9_\-/%.]*(\?[A-Za-z0-9_\-%.=&]*)?$/.test(meta.href) && !meta.href.includes("..")) return meta.href;
  if (meta.conversationId && String(item.type) === "chatbot") return `/admin/agents/ai?conversation=${encodeURIComponent(String(meta.conversationId))}`;
  if (meta.propertyId) return `/admin/properties/previews?previewId=${encodeURIComponent(adminRefOrId("property", meta.propertyId))}`;
  if (meta.invoiceId) return recordHref("owner-invoice", meta.invoiceId);
  if (meta.requestId && String(item.type).toLowerCase().includes("cancel")) return recordHref("cancellation", meta.requestId);
  if (meta.tourBookingId) return "/admin/agents/tour-revenue";
  if (meta.transportBookingId) return "/admin/drivers/invoices";
  if (meta.groupBookingId) return "/admin/group-stays/bookings";
  return "/admin/messages";
}

/** Where an alert stands. Older socket items without a state count as unread. */
function stateOf(item: NotificationItem): "unread" | "open" | "resolved" {
  if (item.unread) return "unread";
  return item.state ?? (item.requiresAction && !item.resolvedAt ? "open" : "resolved");
}

/** "Waiting 19 days": how long an alert has been asking for someone. */
function waitingFor(value: string) {
  const hours = Math.max(0, (Date.now() - new Date(value).getTime()) / 3_600_000);
  if (hours < 1) return { text: "Just now", days: 0 };
  if (hours < 24) return { text: `Waiting ${Math.floor(hours)}h`, days: 0 };
  const days = Math.floor(hours / 24);
  return { text: `Waiting ${days} day${days === 1 ? "" : "s"}`, days };
}

function daysUntil(value: string | null | undefined) {
  if (!value) return null;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AdminNotificationDrawer() {
  const recordHref = useAdminHref();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Latest first: what just happened is always on top.
  const [tab, setTab] = useState<"latest" | "needs" | "updates" | "done">("latest");
  const [showOlder, setShowOlder] = useState(false);
  const [resolving, setResolving] = useState<number | null>(null);

  const unread = useMemo(() => items.filter((item) => item.unread).length, [items]);
  // Three piles, each in the order that matters for it.
  const { needsYou, updates, done } = useMemo(() => {
    const rank = (item: NotificationItem) => (item.severity === "critical" || item.priority === "urgent" ? 0 : 1);
    const time = (item: NotificationItem) => new Date(item.createdAt).getTime();
    return {
      // Critical first, then whatever has waited longest.
      needsYou: items.filter((item) => item.requiresAction && stateOf(item) !== "resolved").sort((a, b) => rank(a) - rank(b) || time(a) - time(b)),
      updates: items.filter((item) => !item.requiresAction && item.unread).sort((a, b) => time(b) - time(a)),
      done: items.filter((item) => stateOf(item) === "resolved").sort((a, b) => new Date(b.resolvedAt ?? b.createdAt).getTime() - new Date(a.resolvedAt ?? a.createdAt).getTime()),
    };
  }, [items]);
  const criticalCount = needsYou.filter((item) => item.severity === "critical" || item.priority === "urgent").length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Unread first, then anything still waiting to be resolved, then recent settled ones.
      const [unreadResponse, openResponse, viewedResponse] = await Promise.all([
        apiClient.get<NotificationResponse>("/api/admin/notifications", { params: { tab: "unread", pageSize: 16 } }),
        apiClient.get<NotificationResponse>("/api/admin/notifications", { params: { tab: "open", pageSize: 16 } }),
        apiClient.get<NotificationResponse>("/api/admin/notifications", { params: { tab: "viewed", pageSize: 8 } }),
      ]);
      const seen = new Set<number>();
      const combined = [...unreadResponse.data.items, ...openResponse.data.items, ...viewedResponse.data.items]
        .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 30);
      setItems(combined);
      window.dispatchEvent(new CustomEvent("nols:admin-unread-change", { detail: { count: unreadResponse.data.totalUnread } }));
    } catch {
      window.dispatchEvent(new CustomEvent("nols:toast", {
        detail: { type: "error", title: "Notifications unavailable", message: "Please try again in a moment." },
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSoundEnabled(localStorage.getItem(SOUND_KEY) !== "off");
    const show = () => { setOpen(true); void load(); };
    const incoming = (event: Event) => {
      const detail = (event as CustomEvent<Partial<NotificationItem>>).detail;
      if (!detail?.id) return;
      setItems((current) => current.some((item) => item.id === Number(detail.id)) ? current : [{
        id: Number(detail.id), title: detail.title || "New notification", body: detail.body,
        type: detail.type, priority: detail.priority, createdAt: detail.createdAt || new Date().toISOString(), unread: true, meta: detail.meta,
        severity: detail.severity, requiresAction: detail.requiresAction, state: "unread" as const,
      }, ...current].slice(0, 30));
    };
    window.addEventListener("nols:admin-notifications:open", show);
    window.addEventListener("nols:admin-notification", incoming);
    return () => {
      window.removeEventListener("nols:admin-notifications:open", show);
      window.removeEventListener("nols:admin-notification", incoming);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);

  const markRead = async (item: NotificationItem) => {
    if (!item.unread) return;
    const next: NotificationItem["state"] = item.requiresAction ? "open" : "resolved";
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, unread: false, state: next } : entry));
    window.dispatchEvent(new CustomEvent("nols:admin-unread-change", { detail: { delta: -1 } }));
    try { await apiClient.post(`/api/admin/notifications/${item.id}/mark-read`); }
    catch {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, unread: true, state: "unread" } : entry));
      window.dispatchEvent(new CustomEvent("nols:admin-unread-change", { detail: { delta: 1 } }));
    }
  };

  // The action this alert asked for is done. Recorded with the admin's name; it then clears itself after 7 days.
  const resolve = async (item: NotificationItem) => {
    setResolving(item.id);
    try {
      await apiClient.post(`/api/admin/notifications/${item.id}/resolve`);
      if (item.unread) window.dispatchEvent(new CustomEvent("nols:admin-unread-change", { detail: { delta: -1 } }));
      void load();
    } catch {
      window.dispatchEvent(new CustomEvent("nols:toast", { detail: { type: "error", title: "Not resolved", message: "Please try again in a moment." } }));
    } finally {
      setResolving(null);
    }
  };

  // Server side, so it covers every unread alert, not only the ones loaded here.
  const markAllRead = async () => {
    if (unread === 0) return;
    try {
      await apiClient.post("/api/admin/notifications/mark-all-read");
    } finally {
      void load();
    }
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    window.dispatchEvent(new CustomEvent("nols:admin-notification-sound-change", { detail: { enabled: next } }));
  };

  const tonePresentation = (item: NotificationItem) => {
    // A person waiting in a Twiga chat: amber headset, the same colour the
    // visitor sees for NoLSAF Support in the widget.
    if (String(item.type) === "chatbot" && stateOf(item) !== "resolved") return { label: "Support chat", Icon: Headphones, classes: "border-amber-200 bg-amber-50 text-amber-700" };
    // "Resolved" now means someone handled it, never a guess from the title.
    if (stateOf(item) === "resolved") return { label: item.requiresAction ? "Resolved" : "Update", Icon: item.requiresAction ? CircleCheck : Info, classes: item.requiresAction ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600" };
    if (item.severity === "critical" || item.priority === "urgent") return { label: "Critical", Icon: AlertTriangle, classes: "border-red-100 bg-red-50 text-red-700" };
    if (item.requiresAction) return { label: "Needs action", Icon: AlertTriangle, classes: "border-amber-100 bg-amber-50 text-amber-700" };
    return { label: "Update", Icon: Info, classes: "border-slate-200 bg-slate-100 text-slate-600" };
  };

  // The same alert raised again and again (a repeating server error) is one matter, not ten cards.
  const groupOf = (list: NotificationItem[]) => {
    const groups = new Map<string, NotificationItem[]>();
    for (const item of list) {
      const isLongStay = String(item.meta?.notificationKind ?? "").startsWith("long_stay_");
      const key = isLongStay ? `long-stay:${item.id}` : `${item.title}|${item.severity ?? ""}|${item.requiresAction ? 1 : 0}|${String(item.type ?? "")}|${item.meta?.accountOwnerId ?? ""}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(item);
      else groups.set(key, [item]);
    }
    return [...groups.values()].map((members) => {
      const sorted = [...members].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return { latest: sorted[0], oldest: sorted[sorted.length - 1], members: sorted };
    });
  };
  type Group = ReturnType<typeof groupOf>[number];

  const resolveGroup = async (group: Group) => {
    if (group.members.length === 1) return resolve(group.latest);
    setResolving(group.latest.id);
    let failed = 0;
    for (const member of group.members) {
      try {
        await apiClient.post(`/api/admin/notifications/${member.id}/resolve`);
        if (member.unread) window.dispatchEvent(new CustomEvent("nols:admin-unread-change", { detail: { delta: -1 } }));
      } catch {
        failed += 1;
      }
    }
    if (failed) window.dispatchEvent(new CustomEvent("nols:toast", { detail: { type: "error", title: "Some not resolved", message: `${failed} could not be resolved. Please try again.` } }));
    setResolving(null);
    void load();
  };

  const isCritical = (item: NotificationItem) => item.severity === "critical" || item.priority === "urgent";
  const active = [...needsYou, ...updates];
  // Latest: everything still open, newest first, so what just happened is always on top.
  const latestGroups = groupOf(active).sort((a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime());
  // Needs you: critical first, then newest.
  const needsGroups = groupOf(needsYou).sort((a, b) => Number(isCritical(b.latest)) - Number(isCritical(a.latest)) || new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime());
  const updateGroups = groupOf(updates).sort((a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime());
  const freshCount = active.filter((item) => Date.now() - new Date(item.createdAt).getTime() < 86_400_000).length;

  const tabs: Array<{ key: typeof tab; label: string; count: number }> = [
    { key: "latest", label: "Latest", count: latestGroups.length },
    { key: "needs", label: "Needs you", count: needsYou.length },
    { key: "updates", label: "Updates", count: updates.length },
    { key: "done", label: "Done", count: done.length },
  ];

  /** Today, Yesterday, This week, then a folded pile of older matters. */
  const bucketOf = (value: string) => {
    const age = Date.now() - new Date(value).getTime();
    const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" });
    if (day(new Date(value)) === day(new Date())) return "Today";
    if (day(new Date(value)) === day(new Date(Date.now() - 86_400_000))) return "Yesterday";
    if (age < 7 * 86_400_000) return "This week";
    return "Older";
  };

  const renderGroup = (group: Group) => {
    const item = group.latest;
    const presentation = tonePresentation(item);
    const ToneIcon = presentation.Icon;
    const needs = Boolean(item.requiresAction) && stateOf(item) !== "resolved";
    const wait = waitingFor(group.oldest.createdAt);
    const anyUnread = group.members.some((m) => m.unread);
    const fresh = Date.now() - new Date(item.createdAt).getTime() < 3_600_000;
    return (
      <li key={`${item.id}-${group.members.length}`} className={`group/row relative flex gap-3 px-4 py-3 transition-colors hover:bg-slate-50 sm:px-5 ${anyUnread ? "bg-[#02665e]/[0.03]" : "bg-white"}`}>
        <span className={`relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-solid ${presentation.classes}`}>
          <ToneIcon className="h-4 w-4" aria-hidden />
          {anyUnread ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#02665e] ring-2 ring-white" aria-label="Unread" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <Link
              href={notificationHref(item, recordHref)}
              onClick={() => { for (const m of group.members) void markRead(m); setOpen(false); }}
              className={`min-w-0 truncate text-[13px] leading-5 text-slate-900 no-underline hover:text-[#02665e] hover:no-underline ${anyUnread ? "font-semibold" : "font-medium"}`}
            >
              {item.title}
            </Link>
            <time className={`shrink-0 text-[11px] tabular-nums ${fresh ? "font-semibold text-[#02665e]" : "text-slate-400"}`} dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
          </div>
          {item.body ? <p className="m-0 mt-0.5 line-clamp-1 text-[12px] leading-5 text-slate-500" title={item.body}>{item.body}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={`rounded px-1.5 py-0.5 font-semibold ${presentation.classes.replace(/border-\S+/g, "")}`}>{presentation.label}</span>
            {group.members.length > 1 ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">{group.members.length} times</span> : null}
            {needs ? <span className={`rounded px-1.5 py-0.5 font-medium ${wait.days >= 3 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{group.members.length > 1 ? `First ${relativeTime(group.oldest.createdAt)}` : wait.text}</span> : null}
            {item.readBy && needs ? <span className="text-slate-400">Seen by {item.readBy}</span> : null}
            <span className="ml-auto flex items-center gap-1">
              <Link
                href={notificationHref(item, recordHref)}
                onClick={() => { for (const m of group.members) void markRead(m); setOpen(false); }}
                className="inline-flex h-7 items-center gap-0.5 rounded-md px-2 font-semibold text-[#02665e] no-underline hover:bg-[#02665e]/10 hover:no-underline"
              >
                {String(item.meta?.notificationKind).startsWith("owner_account_") ? "View owner activity" : String(item.type) === "chatbot" ? "Open chat" : "Open"}<ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
              {needs ? (
                <button
                  type="button"
                  onClick={() => void resolveGroup(group)}
                  disabled={resolving === item.id}
                  className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-solid border-[#02665e]/30 bg-white px-2 font-semibold text-[#02665e] transition-colors hover:bg-[#02665e]/10 disabled:opacity-50"
                  title={group.members.length > 1 ? `Resolve all ${group.members.length}` : "The action is done"}
                  aria-label={`Resolve: ${item.title}`}
                >
                  {resolving === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleCheck className="h-3.5 w-3.5" />}
                  {group.members.length > 1 ? `Resolve ${group.members.length}` : "Resolve"}
                </button>
              ) : anyUnread ? (
                <button
                  type="button"
                  onClick={() => { for (const m of group.members) void markRead(m); }}
                  className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#02665e]"
                  title="Mark as read"
                  aria-label={`Mark as read: ${item.title}`}
                >
                  <Check className="h-4 w-4" />
                </button>
              ) : null}
            </span>
          </div>
        </div>
      </li>
    );
  };

  /** A list in time buckets; matters older than a week fold away until asked for. */
  const renderBucketed = (groups: Group[]) => {
    const buckets = new Map<string, Group[]>();
    for (const g of groups) {
      const b = bucketOf(g.latest.createdAt);
      buckets.set(b, [...(buckets.get(b) ?? []), g]);
    }
    return ["Today", "Yesterday", "This week", "Older"].filter((b) => buckets.has(b)).map((b) => {
      const list = buckets.get(b)!;
      const folded = b === "Older" && !showOlder;
      return (
        <section key={b} aria-label={b}>
          <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 bg-slate-50/95 px-4 py-1.5 backdrop-blur sm:px-5">
            <h3 className="m-0 text-[11px] font-semibold text-slate-500">{b} <span className="font-normal text-slate-400">{list.length}</span></h3>
            {b === "Older" ? (
              <button type="button" onClick={() => setShowOlder((v) => !v)} aria-expanded={showOlder} className="inline-flex cursor-pointer items-center gap-0.5 rounded border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-200/60 hover:text-slate-800">
                {showOlder ? "Hide" : "Show"}<ChevronRight className={`h-3.5 w-3.5 transition-transform ${showOlder ? "rotate-90" : ""}`} />
              </button>
            ) : null}
          </div>
          {folded ? (
            <p className="m-0 bg-white px-4 py-2.5 text-[12px] text-slate-500 sm:px-5">
              {list.length} older matter{list.length === 1 ? "" : "s"} still open. Resolve what is done so new alerts stand out.
            </p>
          ) : (
            <ul className="m-0 list-none divide-y divide-solid divide-slate-100 p-0">{list.map(renderGroup)}</ul>
          )}
        </section>
      );
    });
  };

  return (
    <div className={`fixed inset-0 z-[90] ${open ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!open}>
      <button aria-label="Close notifications" onClick={() => setOpen(false)} className={`absolute inset-0 border-0 bg-slate-950/35 backdrop-blur-[2px] transition-opacity ${open ? "opacity-100" : "opacity-0"}`} />
      <section role="dialog" aria-modal="true" aria-labelledby="admin-notification-title" className={`admin-drawer-surface absolute bottom-2 right-2 top-2 flex w-[30rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden !rounded-lg transition-transform duration-200 sm:bottom-4 sm:right-4 sm:top-4 sm:max-w-[calc(100vw-2rem)] ${open ? "translate-x-0" : "translate-x-[110%]"}`}>
        <header className="border-0 border-b border-solid border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e] text-white">
                <Bell className="h-5 w-5" />
                {unread > 0 ? <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">{unread > 99 ? "99+" : unread}</span> : null}
              </div>
              <div className="min-w-0">
                <h2 id="admin-notification-title" className="m-0 text-base font-semibold tracking-tight text-slate-950">Notifications</h2>
                <p className="m-0 mt-0.5 truncate text-[12.5px] text-slate-500">
                  {active.length
                    ? [
                        freshCount ? `${freshCount} new today` : "Nothing new today",
                        criticalCount ? `${criticalCount} critical` : "",
                        needsYou.length ? `${needsYou.length} open` : "",
                      ].filter(Boolean).join(" · ")
                    : "You're all caught up"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {unread > 0 ? (
                <button type="button" onClick={() => void markAllRead()} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-2 text-[12px] font-semibold text-[#02665e] hover:bg-[#02665e]/10" title="Mark every unread alert as read">
                  <CheckCheck className="h-4 w-4" />Read all
                </button>
              ) : null}
              <button type="button" onClick={toggleSound} className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30" aria-label={soundEnabled ? "Mute notification sound" : "Enable notification sound"} title={soundEnabled ? "Sound on" : "Sound off"}>{soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
          </div>
          <nav className="flex gap-1 px-3 sm:px-4" role="tablist" aria-label="Notification views">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`relative inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2 text-[12.5px] font-semibold transition-colors ${tab === t.key ? "text-[#02665e]" : "text-slate-500 hover:text-slate-800"}`}
              >
                {t.label}
                <span className={`rounded px-1 text-[10.5px] tabular-nums ${tab === t.key ? "bg-[#02665e]/10" : "bg-slate-100 text-slate-500"} ${t.key === "needs" && criticalCount ? "!bg-red-50 !text-red-700" : ""}`}>{t.count}</span>
                {tab === t.key ? <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-[#02665e]" aria-hidden /> : null}
              </button>
            ))}
          </nav>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70">
          {loading && items.length === 0 ? <div className="flex h-40 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading alerts</div> : null}

          {!loading && tab !== "done" && (tab === "latest" ? latestGroups : tab === "needs" ? needsGroups : updateGroups).length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-8 py-8 text-center">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-md bg-emerald-50 text-emerald-600"><CheckCheck className="h-6 w-6" /></div>
              <p className="m-0 font-semibold text-slate-800">{tab === "updates" ? "No unread updates" : "Nothing needs you"}</p>
              <p className="m-0 mt-1 max-w-64 text-[13px] leading-5 text-slate-500">New platform activity appears here as it happens.</p>
            </div>
          ) : null}

          {tab === "latest" ? renderBucketed(latestGroups) : null}
          {tab === "needs" ? renderBucketed(needsGroups) : null}
          {tab === "updates" ? renderBucketed(updateGroups) : null}

          {tab === "done" ? (
            done.length ? (
              <ul className="m-0 list-none divide-y divide-solid divide-slate-100 bg-white p-0">
                {done.map((item) => {
                  const clears = daysUntil(item.clearsAt);
                  const who = item.autoResolved
                    ? `Closed automatically: ${item.autoResolved.replace(/\.$/, "")}`
                    : item.requiresAction && item.resolvedBy ? `Resolved by ${item.resolvedBy}` : item.readBy ? `Read by ${item.readBy}` : "Handled";
                  return (
                    <li key={item.id}>
                      <Link href={notificationHref(item, recordHref)} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-2.5 text-inherit no-underline hover:bg-slate-50 hover:no-underline sm:px-5">
                        <CircleCheck className={`mt-0.5 h-4 w-4 shrink-0 ${item.requiresAction ? "text-emerald-600" : "text-slate-300"}`} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-slate-700">{item.title}</span>
                          <span className="block truncate text-[11px] text-slate-400">{who}{clears != null ? `. Clears ${clears === 0 ? "today" : `in ${clears} day${clears === 1 ? "" : "s"}`}` : ""}</span>
                        </span>
                        <time className="shrink-0 text-[11px] text-slate-400">{relativeTime(item.resolvedAt ?? item.createdAt)}</time>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="m-0 px-5 py-10 text-center text-[13px] text-slate-500">Nothing resolved in the last 7 days.</p>
            )
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-200 bg-white px-4 py-2.5 sm:px-5">
          <p className="m-0 text-[11px] leading-4 text-slate-400">Alerts are never deleted. Handled ones clear after 7 days.</p>
          <Link href="/admin/messages" onClick={() => setOpen(false)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-[12.5px] font-semibold text-slate-700 no-underline transition-colors hover:bg-slate-100 hover:text-slate-950 hover:no-underline">
            Notification centre <ChevronRight className="h-4 w-4" />
          </Link>
        </footer>
      </section>
    </div>
  );
}
