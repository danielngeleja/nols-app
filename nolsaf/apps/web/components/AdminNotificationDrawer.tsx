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

function SectionTitle({ label, count, action }: { label: string; count: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-200/80 px-4 pb-1.5 pt-3 sm:px-5">
      <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label} <span className="font-semibold text-slate-400">{count}</span></h3>
      {action}
    </div>
  );
}

export default function AdminNotificationDrawer() {
  const recordHref = useAdminHref();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showDone, setShowDone] = useState(false);
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

  return (
    <div className={`fixed inset-0 z-[90] ${open ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!open}>
      <button aria-label="Close notifications" onClick={() => setOpen(false)} className={`absolute inset-0 bg-slate-950/35 backdrop-blur-[2px] transition-opacity ${open ? "opacity-100" : "opacity-0"}`} />
      <section role="dialog" aria-modal="true" aria-labelledby="admin-notification-title" className={`admin-drawer-surface absolute bottom-2 right-2 top-2 flex w-[30rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden transition-transform duration-200 sm:bottom-4 sm:right-4 sm:top-4 sm:max-w-[calc(100vw-2rem)] ${open ? "translate-x-0" : "translate-x-[110%]"}`}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
              <Bell className="h-5 w-5" />
              {unread > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">{unread > 99 ? "99+" : unread}</span> : null}
            </div>
            <div className="min-w-0">
              <h2 id="admin-notification-title" className="text-lg font-bold tracking-tight text-slate-950">Notifications</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {needsYou.length || updates.length
                  ? [
                      needsYou.length ? `${needsYou.length} need${needsYou.length === 1 ? "s" : ""} you` : "",
                      criticalCount ? `${criticalCount} critical` : "",
                      updates.length ? `${updates.length} update${updates.length === 1 ? "" : "s"}` : "",
                    ].filter(Boolean).join(" · ")
                  : "You're all caught up"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={toggleSound} className="grid h-9 w-9 place-items-center rounded-lg border-0 bg-transparent text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30" aria-label={soundEnabled ? "Mute notification sound" : "Enable notification sound"} title={soundEnabled ? "Sound on" : "Sound off"}>{soundEnabled ? <Volume2 className="h-[18px] w-[18px]" /> : <VolumeX className="h-[18px] w-[18px]" />}</button>
            <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg border-0 bg-transparent text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70">
          {loading && items.length === 0 ? <div className="flex h-40 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading alerts</div> : null}
          {!loading && !needsYou.length && !updates.length ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-8 py-8 text-center">
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCheck className="h-7 w-7" /></div>
              <p className="m-0 font-semibold text-slate-800">Nothing needs you</p>
              <p className="m-0 mt-1 max-w-64 text-sm leading-6 text-slate-500">Every alert is handled. New platform activity will appear here.</p>
            </div>
          ) : null}

          {/* Needs you: one card per open matter, critical first, oldest first. */}
          {needsYou.length ? (
            <section aria-label="Needs you">
              <SectionTitle label="Needs you" count={needsYou.length} />
              <div className="divide-y divide-slate-200/80 bg-white">
                {needsYou.map((item) => {
                  const presentation = tonePresentation(item);
                  const ToneIcon = presentation.Icon;
                  const wait = waitingFor(item.createdAt);
                  const late = wait.days >= 3 || item.severity === "critical";
                  return (
                    <article key={item.id} className={`relative px-4 py-4 sm:px-5 ${item.unread ? "bg-[#02665e]/[0.025]" : ""}`}>
                      {item.unread ? <span className="absolute bottom-4 left-0 top-4 w-0.5 rounded-r-full bg-[#02665e]" aria-hidden /> : null}
                      <div className="flex gap-3.5">
                        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-solid ${presentation.classes}`}><ToneIcon className="h-4 w-4" aria-hidden /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="mb-1 flex items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{presentation.label}</span>
                                {item.unread ? <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" aria-label="Unread" /> : null}
                              </div>
                              <h3 className="m-0 text-sm font-semibold leading-5 text-slate-900">{item.title}</h3>
                            </div>
                            <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${late ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{wait.text}</span>
                          </div>
                          {item.body ? <p className="m-0 mt-1.5 line-clamp-3 text-[13px] leading-5 text-slate-600">{item.body}</p> : null}
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <Link href={notificationHref(item, recordHref)} onClick={() => { void markRead(item); setOpen(false); }} className="inline-flex items-center gap-1 rounded-lg bg-[#02665e]/10 px-2.5 py-1.5 text-xs font-semibold text-[#02665e] no-underline transition-colors hover:bg-[#02665e]/15 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30">{String(item.type) === "chatbot" ? "Open chat" : "Open"} <ChevronRight className="h-3.5 w-3.5" /></Link>
                            <button type="button" onClick={() => void resolve(item)} disabled={resolving === item.id} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-[#02665e]/30 bg-white px-2.5 text-xs font-semibold text-[#02665e] transition-colors hover:bg-[#02665e]/10 disabled:opacity-50" title="The action is done" aria-label={`Resolve: ${item.title}`}>
                              {resolving === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />}Resolve
                            </button>
                          </div>
                          {item.readBy ? <p className="m-0 mt-2 text-[11px] text-slate-500">Seen by {item.readBy}, not resolved yet</p> : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Updates: information only, settled by reading. */}
          {updates.length ? (
            <section aria-label="Updates">
              <SectionTitle label="Updates" count={updates.length} action={<button type="button" onClick={() => void markAllRead()} className="inline-flex items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-[11px] font-semibold text-[#02665e] hover:bg-[#02665e]/10"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>} />
              <div className="divide-y divide-slate-200/80 bg-white">
                {updates.map((item) => (
                  <article key={item.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-solid border-slate-200 bg-slate-100 text-slate-500"><Info className="h-3.5 w-3.5" aria-hidden /></span>
                    <Link href={notificationHref(item, recordHref)} onClick={() => { void markRead(item); setOpen(false); }} className="min-w-0 flex-1 text-inherit no-underline hover:no-underline">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-slate-900">{item.title}</span>
                        <time className="shrink-0 text-[11px] text-slate-400">{relativeTime(item.createdAt)}</time>
                      </span>
                      {item.body ? <span className="mt-0.5 line-clamp-2 block text-[12px] leading-5 text-slate-500">{item.body}</span> : null}
                    </Link>
                    <button type="button" onClick={() => void markRead(item)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#02665e]" title="Mark as read" aria-label={`Mark as read: ${item.title}`}><Check className="h-4 w-4" /></button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {/* Done recently: folded, one line each, with who handled it and when it clears. */}
          {done.length ? (
            <section aria-label="Done recently">
              <SectionTitle
                label="Done recently"
                count={done.length}
                action={<button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="inline-flex items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-200/60 hover:text-slate-800">{showDone ? "Hide" : "Show"}<ChevronRight className={`h-3.5 w-3.5 transition-transform ${showDone ? "rotate-90" : ""}`} /></button>}
              />
              {showDone ? (
                <div className="divide-y divide-slate-200/80 bg-white">
                  {done.map((item) => {
                    const clears = daysUntil(item.clearsAt);
                    const who = item.autoResolved
                      ? `Closed automatically: ${item.autoResolved.replace(/\.$/, "")}`
                      : item.requiresAction && item.resolvedBy ? `Resolved by ${item.resolvedBy}` : item.readBy ? `Read by ${item.readBy}` : "Handled";
                    return (
                      <Link key={item.id} href={notificationHref(item, recordHref)} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-2.5 text-inherit no-underline hover:bg-slate-50 hover:no-underline sm:px-5">
                        <CircleCheck className={`mt-0.5 h-4 w-4 shrink-0 ${item.requiresAction ? "text-emerald-600" : "text-slate-300"}`} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-slate-700">{item.title}</span>
                          <span className="block truncate text-[11px] text-slate-400">{who}{clears != null ? `. Clears ${clears === 0 ? "today" : `in ${clears} day${clears === 1 ? "" : "s"}`}` : ""}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
        <footer className="border-t border-slate-200 bg-white p-3 sm:px-5"><p className="m-0 mb-2 text-center text-[11px] text-slate-400">Alerts cannot be deleted. Read and resolved ones clear after 7 days.</p><Link href="/admin/messages" onClick={() => setOpen(false)} className="flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-slate-700 no-underline transition-colors hover:bg-slate-100 hover:text-slate-950 hover:no-underline">Open notification centre <ChevronRight className="h-4 w-4" /></Link></footer>
      </section>
    </div>
  );
}
