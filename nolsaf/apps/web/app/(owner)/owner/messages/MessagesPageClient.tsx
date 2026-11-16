"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";

export default function MessagesPage() {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [viewedCount, setViewedCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    (async () => {
      try {
        const ru = await fetch('/api/owner/notifications?tab=unread&page=1&pageSize=1', { credentials: 'include', signal: controller.signal });
        if (ru.ok) {
          const ju = await ru.json();
          if (mounted) setUnreadCount(Number(ju.total ?? 0));
        }

        const rv = await fetch('/api/owner/notifications?tab=viewed&page=1&pageSize=1', { credentials: 'include', signal: controller.signal });
        if (rv.ok) {
          const jv = await rv.json();
          if (mounted) setViewedCount(Number(jv.total ?? 0));
        }
      } catch (err) {
        // ignore
      }
    })();
    return () => { mounted = false; controller.abort(); };
  }, []);
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg w-full text-center space-y-4">
        <div className="flex justify-center">
          {/* Use the same smaller icon sizing as other centered headers */}
          <MessageCircle className="h-10 w-10 text-blue-600" aria-hidden />
        </div>

        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-gray-900">
          View and manage your messages
        </h1>

        {/* Placeholder paragraph removed per request; full messages UI will replace this later */}

        <div className="flex justify-center gap-3">
          <Link
            href="/owner/messages/unread"
            className={`inline-flex items-center px-4 py-1.5 rounded-md text-sm font-medium transition-colors border border-solid border-gray-200 text-gray-700 bg-white shadow-sm hover:bg-gray-50 no-underline hover:no-underline focus:outline-none focus:ring-4 focus:ring-indigo-300/40 focus:ring-offset-2 focus:ring-offset-white`}
          >
            Unread ({unreadCount})
          </Link>

          <Link
            href="/owner/messages/viewed"
            className={`inline-flex items-center px-4 py-1.5 rounded-md text-sm font-medium transition-colors border border-solid border-gray-200 text-gray-700 bg-white shadow-sm hover:bg-gray-50 no-underline hover:no-underline focus:outline-none focus:ring-4 focus:ring-indigo-300/40 focus:ring-offset-2 focus:ring-offset-white`}
          >
            Viewed ({viewedCount})
          </Link>
        </div>
      </div>
    </div>
  );
}
