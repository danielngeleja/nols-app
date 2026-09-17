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
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type NotificationItem = {
  id: number;
  type?: string | null;
  title: string;
  body?: string | null;
  createdAt: string;
  unread: boolean;
  priority?: "normal" | "urgent";
  meta?: Record<string, unknown> | null;
};

type NotificationResponse = { items: NotificationItem[]; totalUnread: number };
const SOUND_KEY = "nolsaf:admin-notification-sound";

function notificationHref(item: NotificationItem) {
  const meta = item.meta ?? {};
  if (meta.conversationId && String(item.type) === "chatbot") return `/admin/agents/ai?conversation=${encodeURIComponent(String(meta.conversationId))}`;
  if (meta.propertyId) return `/admin/properties/previews?previewId=${encodeURIComponent(String(meta.propertyId))}`;
  if (meta.invoiceId) return `/admin/revenue/${encodeURIComponent(String(meta.invoiceId))}`;
  if (meta.requestId && String(item.type).toLowerCase().includes("cancel")) return `/admin/cancellations/${encodeURIComponent(String(meta.requestId))}`;
  if (meta.tourBookingId) return "/admin/agents/tour-revenue";
  if (meta.transportBookingId) return "/admin/drivers/invoices";
  if (meta.groupBookingId) return "/admin/group-stays/bookings";
  return "/admin/messages";
}

function tone(item: NotificationItem) {
  const value = `${item.type ?? ""} ${item.title ?? ""}`.toLowerCase();
  if (item.priority === "urgent" || /critical|failed|error|danger/.test(value)) return "danger";
  if (/pending|review|warning|attention|claim/.test(value)) return "attention";
  if (/approved|complete|success|paid|resolved/.test(value)) return "success";
  return "neutral";
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
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const unread = useMemo(() => items.filter((item) => item.unread).length, [items]);
  const visibleItems = useMemo(
    () => filter === "unread" ? items.filter((item) => item.unread) : items,
    [filter, items]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [unreadResponse, viewedResponse] = await Promise.all([
        apiClient.get<NotificationResponse>("/api/admin/notifications", { params: { tab: "unread", pageSize: 16 } }),
        apiClient.get<NotificationResponse>("/api/admin/notifications", { params: { tab: "viewed", pageSize: 8 } }),
      ]);
      const combined = [...unreadResponse.data.items, ...viewedResponse.data.items]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 20);
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
      }, ...current].slice(0, 20));
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
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry));
    window.dispatchEvent(new CustomEvent("nols:admin-unread-change", { detail: { delta: -1 } }));
    try { await apiClient.post(`/api/admin/notifications/${item.id}/mark-read`); }
    catch {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, unread: true } : entry));
      window.dispatchEvent(new CustomEvent("nols:admin-unread-change", { detail: { delta: 1 } }));
    }
  };

  const remove = async (item: NotificationItem) => {
    if (item.unread) return;
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    try { await apiClient.delete(`/api/admin/notifications/${item.id}`); }
    catch { void load(); }
  };

  const markAllRead = async () => {
    const unreadItems = items.filter((item) => item.unread);
    if (unreadItems.length === 0) return;

    setItems((current) => current.map((item) => ({ ...item, unread: false })));
    window.dispatchEvent(new CustomEvent("nols:admin-unread-change", { detail: { delta: -unreadItems.length } }));
    try {
      await Promise.all(unreadItems.map((item) => apiClient.post(`/api/admin/notifications/${item.id}/mark-read`)));
    } catch {
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
    if (String(item.type) === "chatbot") return { label: "Support chat", Icon: Headphones, classes: "border-amber-200 bg-amber-50 text-amber-700" };
    const itemTone = tone(item);
    if (itemTone === "danger") return { label: "Critical", Icon: AlertTriangle, classes: "border-red-100 bg-red-50 text-red-700" };
    if (itemTone === "attention") return { label: "Attention", Icon: AlertTriangle, classes: "border-amber-100 bg-amber-50 text-amber-700" };
    if (itemTone === "success") return { label: "Resolved", Icon: CircleCheck, classes: "border-emerald-100 bg-emerald-50 text-emerald-700" };
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
              <p className="mt-0.5 text-sm text-slate-500">{unread ? `${unread} item${unread === 1 ? "" : "s"} need your attention` : "You're all caught up"}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button onClick={toggleSound} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30" aria-label={soundEnabled ? "Mute notification sound" : "Enable notification sound"} title={soundEnabled ? "Sound on" : "Sound off"}>{soundEnabled ? <Volume2 className="h-[18px] w-[18px]" /> : <VolumeX className="h-[18px] w-[18px]" />}</button>
            <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-5">
          <div className="flex rounded-lg bg-slate-200/70 p-1" aria-label="Filter notifications">
            <button onClick={() => setFilter("all")} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${filter === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>All <span className="ml-1 text-slate-400">{items.length}</span></button>
            <button onClick={() => setFilter("unread")} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${filter === "unread" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Unread <span className="ml-1 text-slate-400">{unread}</span></button>
          </div>
          <button onClick={() => void markAllRead()} disabled={unread === 0} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#02665e] transition-colors hover:bg-[#02665e]/10 disabled:cursor-default disabled:text-slate-400 disabled:hover:bg-transparent"><CheckCheck className="h-4 w-4" />Mark all read</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70">
          {loading && items.length === 0 ? <div className="flex h-40 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading alerts</div> : null}
          {!loading && visibleItems.length === 0 ? <div className="flex h-full min-h-64 flex-col items-center justify-center px-8 text-center"><div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCheck className="h-7 w-7" /></div><p className="font-semibold text-slate-800">{filter === "unread" ? "Nothing needs your attention" : "No recent notifications"}</p><p className="mt-1 max-w-64 text-sm leading-6 text-slate-500">{filter === "unread" ? "You have reviewed every recent update." : "New platform activity will appear here."}</p></div> : null}
          <div className="divide-y divide-slate-200/80 bg-white">
            {visibleItems.map((item) => {
              const presentation = tonePresentation(item);
              const ToneIcon = presentation.Icon;
              return <article key={item.id} className={`group relative px-4 py-4 transition-colors hover:bg-slate-50 sm:px-5 ${item.unread ? "bg-[#02665e]/[0.025]" : ""}`}>
                {item.unread ? <span className="absolute bottom-4 left-0 top-4 w-0.5 rounded-r-full bg-[#02665e]" aria-hidden /> : null}
                <div className="flex gap-3.5">
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${presentation.classes}`}><ToneIcon className="h-4 w-4" aria-hidden /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{presentation.label}</span>{item.unread ? <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" aria-label="Unread" /> : null}</div>
                        <h3 className="text-sm font-semibold leading-5 text-slate-900">{item.title}</h3>
                      </div>
                      <time className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] font-medium text-slate-400">{relativeTime(item.createdAt)}</time>
                    </div>
                    {item.body ? <p className="mt-1.5 line-clamp-3 text-[13px] leading-5 text-slate-600">{item.body}</p> : null}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <Link href={notificationHref(item)} onClick={() => { void markRead(item); setOpen(false); }} className="inline-flex items-center gap-1 rounded-lg bg-[#02665e]/10 px-2.5 py-1.5 text-xs font-semibold text-[#02665e] no-underline transition-colors hover:bg-[#02665e]/15 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30">{String(item.type) === "chatbot" ? "Open chat" : "View details"} <ChevronRight className="h-3.5 w-3.5" /></Link>
                      <div className="flex items-center gap-1">
                        {item.unread ? <button onClick={() => void markRead(item)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-[#02665e] hover:shadow-sm" title="Mark as read" aria-label="Mark as read"><Check className="h-4 w-4" /><span className="hidden sm:inline">Done</span></button> : <button onClick={() => void remove(item)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700" title="Delete viewed notification" aria-label="Delete viewed notification"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    </div>
                  </div>
                </div>
              </article>;
            })}
          </div>
        </div>
        <footer className="border-t border-slate-200 bg-white p-3 sm:px-5"><Link href="/admin/messages" onClick={() => setOpen(false)} className="flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-slate-700 no-underline transition-colors hover:bg-slate-100 hover:text-slate-950 hover:no-underline">Open notification centre <ChevronRight className="h-4 w-4" /></Link></footer>
      </section>
    </div>
  );
}
