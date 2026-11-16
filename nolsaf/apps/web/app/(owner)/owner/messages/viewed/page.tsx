"use client";
import React, { useEffect, useState } from "react";
import { MessageCircle, ArrowLeft } from "lucide-react";
import ReplyIcon from "@/components/ReplyIcon";
import DeleteButton from "@/components/DeleteButton";

type Msg = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
};

// start empty; we'll fetch viewed messages

export default function ViewedMessagesPage() {
  const [items, setItems] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/owner/notifications?tab=viewed&page=1&pageSize=50', { credentials: 'include', signal: controller.signal });
        if (!mounted) return;
        if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
        const j = await r.json();
        setItems((j?.items ?? []).map((it: any) => ({ id: String(it.id), from: it.type ?? 'NoLSAF', subject: it.title ?? '', snippet: it.body ?? '', receivedAt: it.createdAt ?? new Date().toISOString() })));
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.debug('Could not load viewed messages', err);
        setError(String(err?.message ?? err));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; controller.abort(); };
  }, []);

  async function markAsUnread(id: string) {
    const before = items;
    setItems((prev) => prev.filter((m) => m.id !== id));
    try {
      const endpoint = `/api/owner/notifications/${encodeURIComponent(id)}`;
      const r = await fetch(endpoint, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
    } catch (err) {
      console.error('deleteNotification failed', err);
      setItems(before);
      alert('Could not delete notification. Please try again.');
    }
  }

  return (
    <div className="min-h-[60vh] px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg mx-auto text-center space-y-4 py-8">
        <div className="flex justify-center">
          <MessageCircle className="h-10 w-10 text-gray-600" aria-hidden />
        </div>

        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-gray-900">
          Showing {items.length} viewed message{items.length !== 1 ? "s" : ""}
        </h1>

        <p className="text-sm text-gray-600">These are messages you have already viewed.</p>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : error ? (
          <p className="text-sm text-rose-600">Error loading messages: {error}</p>
        ) : null}
      </div>

      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-sm p-4 space-y-4">
        {items.length === 0 ? (
          <div className="text-center py-8 text-gray-600">No viewed messages.</div>
        ) : (
          items.map((m) => (
            <article key={m.id} className="border border-solid rounded-md p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-gray-900 truncate">{m.subject}</h3>
                  <p className="text-xs text-gray-500">From {m.from} • {new Date(m.receivedAt).toLocaleString()}</p>
                  <p className="mt-2 text-sm text-gray-700 truncate">{m.snippet}</p>
                </div>

                <div className="ml-4 flex-shrink-0 flex flex-col gap-2">
                  <DeleteButton onClick={() => markAsUnread(m.id)} label="Delete" />

                  <ReplyIcon href={`mailto:owner@example.com?subject=Re:%20${encodeURIComponent(m.subject)}`} label="Reply" />
                </div>
              </div>
            </article>
          ))
        )}
      </div>

        <div className="text-right">
          <div className="inline-block">
            <a href="/owner/messages" className="inline-flex items-center gap-2 group no-underline hover:no-underline" aria-label="Back to messages">
              <span className="inline-flex items-center justify-center p-2 rounded-full bg-white border border-solid border-gray-200 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <ArrowLeft className="h-4 w-4 text-gray-700 group-hover:text-blue-600" />
              </span>
              <span className="hidden group-hover:inline-block group-focus:inline-block transition-opacity text-sm text-black no-underline">Back to messages</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
