"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  FileSignature,
  Mail,
  MailOpen,
  WalletCards,
} from "lucide-react";
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

function getNotificationVisual(item: NotificationItem) {
  const content = `${item.title} ${item.body}`.toLowerCase();

  if (content.includes("agreement") || content.includes("contract")) {
    return {
      icon: FileSignature,
      iconClassName: "bg-violet-50 text-violet-700 ring-violet-100",
    };
  }

  if (content.includes("earning") || content.includes("payout") || content.includes("commission")) {
    return {
      icon: WalletCards,
      iconClassName: "bg-amber-50 text-amber-700 ring-amber-100",
    };
  }

  if (content.includes("property") || content.includes("attribution") || content.includes("lead")) {
    return {
      icon: Building2,
      iconClassName: "bg-sky-50 text-sky-700 ring-sky-100",
    };
  }

  return {
    icon: Bell,
    iconClassName: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  };
}

function formatNotificationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-TZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function SalesNotificationsPage() {
  const [tab, setTab] = useState<"unread" | "viewed">("unread");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
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

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (item: NotificationItem) => {
    setMarkingId(String(item.id));
    try {
      await apiClient.post(`/api/sales/notifications/${item.id}/read`, {});
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not update this notification.");
    } finally {
      setMarkingId(null);
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

        {error && (
          <p className="m-0 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-2 shadow-[0_10px_30px_-26px_rgba(15,23,42,0.45)]">
          <div className="inline-flex rounded-xl bg-neutral-100 p-1" role="tablist" aria-label="Notification status">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "unread"}
              onClick={() => { setTab("unread"); setPage(1); }}
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition ${
                tab === "unread"
                  ? "bg-white text-emerald-800 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              <Mail className="h-4 w-4" />
              Unread
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                tab === "unread" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-600"
              }`}>
                {totalUnread}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "viewed"}
              onClick={() => { setTab("viewed"); setPage(1); }}
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition ${
                tab === "viewed"
                  ? "bg-white text-emerald-800 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              <MailOpen className="h-4 w-4" />
              Read
            </button>
          </div>
          <p className="m-0 px-2 text-xs font-medium text-neutral-500">
            {tab === "unread"
              ? `${totalUnread} update${totalUnread === 1 ? "" : "s"} waiting for review`
              : "Previously reviewed updates"}
          </p>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.55)]">
          <div className="flex items-center justify-between gap-4 border-b border-neutral-100 px-5 py-4 sm:px-6">
            <div>
              <h2 className="m-0 text-sm font-bold text-neutral-900">
                {tab === "unread" ? "New updates" : "Read updates"}
              </h2>
              <p className="mb-0 mt-1 text-xs text-neutral-500">
                {tab === "unread" ? "The latest activity that needs your attention." : "Updates you have already reviewed."}
              </p>
            </div>
            {!loading && (
              <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-bold text-neutral-600">
                {total} total
              </span>
            )}
          </div>

          {loading ? (
            <div className="divide-y divide-neutral-100" aria-label="Loading notifications">
              {[0, 1, 2].map((placeholder) => (
                <div key={placeholder} className="grid animate-pulse grid-cols-[44px_minmax(0,1fr)] gap-4 px-5 py-5 sm:px-6">
                  <span className="h-11 w-11 rounded-xl bg-neutral-100" />
                  <div className="space-y-2.5">
                    <span className="block h-4 w-44 max-w-full rounded bg-neutral-100" />
                    <span className="block h-3 w-full rounded bg-neutral-100" />
                    <span className="block h-3 w-2/3 rounded bg-neutral-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                  {tab === "unread" ? <Check className="h-6 w-6" /> : <MailOpen className="h-6 w-6" />}
                </span>
                <p className="mb-0 mt-4 text-sm font-bold text-neutral-800">
                  {tab === "unread" ? "You are all caught up" : "No read notifications yet"}
                </p>
                <p className="mb-0 mt-1 text-xs text-neutral-500">
                  {tab === "unread" ? "New sales workspace updates will appear here." : "Notifications move here after you mark them as read."}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {items.map((item) => {
                const visual = getNotificationVisual(item);
                const ItemIcon = visual.icon;
                const isMarking = markingId === String(item.id);
                const actionPath = item.meta?.actionPath;
                const actionHref = actionPath?.startsWith("/") && !actionPath.startsWith("//") ? actionPath : null;

                return (
                  <article
                    key={String(item.id)}
                    className={`group grid grid-cols-[44px_minmax(0,1fr)] gap-4 px-5 py-5 transition-colors sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:px-6 ${
                      item.unread ? "bg-emerald-50/30 hover:bg-emerald-50/55" : "hover:bg-neutral-50/80"
                    }`}
                  >
                    <span className={`grid h-11 w-11 place-items-center rounded-xl ring-1 ${visual.iconClassName}`}>
                      <ItemIcon className="h-5 w-5" />
                    </span>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="m-0 text-sm font-bold text-neutral-900">{item.title}</h3>
                        {item.unread && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                            New
                          </span>
                        )}
                      </div>
                      <p className="mb-0 mt-1.5 max-w-5xl text-sm leading-6 text-neutral-600">{item.body}</p>

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <time dateTime={item.createdAt} className="text-[11px] font-medium text-neutral-400">
                          {formatNotificationDate(item.createdAt)}
                        </time>
                        {actionHref && (
                          <Link
                            href={actionHref}
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-bold text-emerald-700 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:no-underline"
                          >
                            View details
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                    </div>

                    {item.unread && (
                      <button
                        type="button"
                        onClick={() => void markRead(item)}
                        disabled={isMarking}
                        className="col-start-2 inline-flex h-9 w-fit items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-wait disabled:opacity-60 sm:col-start-3 sm:row-start-1"
                      >
                        <Check className={`h-4 w-4 ${isMarking ? "animate-pulse" : ""}`} />
                        {isMarking ? "Updating" : "Mark read"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
          <p className="m-0 text-xs text-neutral-500">
            Showing {total ? (page - 1) * pageSize + 1 : 0}&ndash;{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-emerald-300 hover:text-emerald-800 disabled:pointer-events-none disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-16 text-center text-xs font-semibold text-neutral-600">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-emerald-300 hover:text-emerald-800 disabled:pointer-events-none disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </SalesShell>
  );
}
