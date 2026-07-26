"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import SalesShell from "@/components/SalesShell";
import apiClient from "@/lib/apiClient";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type NotificationItem = {
  id: number | string;
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
  meta?: { actionPath?: string } | null;
};

const pageSize = 20;

export default function SalesNotificationsPage() {
  const [tab, setTab] = useState<"unread" | "viewed">("unread");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/sales/notifications", { params: { tab, page, pageSize } });
      setItems(response.data?.items || []);
      setTotal(Number(response.data?.total || 0));
      setTotalUnread(Number(response.data?.totalUnread || 0));
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, [page, tab]);

  useEffect(() => { void load(); }, [load]);

  const markRead = async (item: NotificationItem) => {
    try {
      await apiClient.post(`/api/sales/notifications/${item.id}/read`, {});
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not update this notification.");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <SalesShell>
      <div className="space-y-5">
        <SalesPageHeader
          icon={Bell}
          title="Notifications"
          description="Agreement, attribution, earnings and payout updates kept separate from your normal account activity."
        />

        {error && <p className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex items-center gap-1 border-b border-neutral-200">
          <button type="button" onClick={() => { setTab("unread"); setPage(1); }} className={`border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === "unread" ? "border-emerald-700 text-emerald-800" : "border-transparent text-neutral-500"}`}>
            Unread ({totalUnread})
          </button>
          <button type="button" onClick={() => { setTab("viewed"); setPage(1); }} className={`border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === "viewed" ? "border-emerald-700 text-emerald-800" : "border-transparent text-neutral-500"}`}>
            Read
          </button>
        </div>

        <section className="overflow-hidden border border-slate-200 bg-white shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
          {loading ? (
            <div className="grid min-h-64 place-items-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-6 text-center">
              <div><Bell className="mx-auto h-8 w-8 text-neutral-300" /><p className="mb-0 mt-3 text-sm font-bold text-neutral-700">No {tab} notifications</p><p className="mb-0 mt-1 text-xs text-neutral-500">Sales workspace updates will appear here.</p></div>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {items.map((item) => (
                <article key={String(item.id)} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="m-0 text-sm font-bold text-neutral-900">{item.title}</h2>
                      {item.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" aria-label="Unread" />}
                    </div>
                    <p className="mb-0 mt-1 text-sm leading-6 text-neutral-600">{item.body}</p>
                    <p className="mb-0 mt-2 text-[11px] text-neutral-400">{new Date(item.createdAt).toLocaleString("en-TZ")}</p>
                    {item.meta?.actionPath?.startsWith("/") && !item.meta.actionPath.startsWith("//") && (
                      <Link href={item.meta.actionPath} className="mt-2 inline-flex text-xs font-bold text-emerald-700 hover:underline">Open update</Link>
                    )}
                  </div>
                  {item.unread && <button type="button" onClick={() => void markRead(item)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 hover:border-emerald-300 hover:text-emerald-800"><CheckCircle2 className="h-4 w-4" />Mark read</button>}
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="flex items-center justify-between gap-3">
          <p className="m-0 text-xs text-neutral-500">Showing {total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} of {total}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-16 text-center text-xs font-semibold text-neutral-600">{page} / {totalPages}</span>
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages} className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </SalesShell>
  );
}
