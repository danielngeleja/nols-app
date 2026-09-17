"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Download, Loader2, Mail, Search } from "lucide-react";

const api = axios.create({ baseURL: "" });

type Subscriber = {
  id: number;
  email: string;
  status: "PENDING" | "SUBSCRIBED" | "UNSUBSCRIBED";
  source: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
};

type Counts = { PENDING: number; SUBSCRIBED: number; UNSUBSCRIBED: number };

const STATUS_TABS: { key: "" | keyof Counts; label: string }[] = [
  { key: "SUBSCRIBED", label: "Subscribed" },
  { key: "PENDING", label: "Awaiting confirmation" },
  { key: "UNSUBSCRIBED", label: "Unsubscribed" },
  { key: "", label: "All" },
];

const CHIP: Record<Subscriber["status"], string> = {
  SUBSCRIBED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PENDING: "bg-amber-50 text-amber-800 ring-amber-200",
  UNSUBSCRIBED: "bg-neutral-100 text-neutral-600 ring-neutral-200",
};

function fmt(date: string | null) {
  if (!date) return "Not yet";
  return new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function NewsletterSubscribersPage() {
  const [status, setStatus] = useState<"" | keyof Counts>("SUBSCRIBED");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Subscriber[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>({ PENDING: 0, SUBSCRIBED: 0, UNSUBSCRIBED: 0 });
  const [notMigrated, setNotMigrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/api/admin/newsletter", { params: { status, q: debounced || undefined, page, pageSize } });
      setItems(res.data?.items ?? []);
      setTotal(res.data?.total ?? 0);
      setCounts(res.data?.counts ?? { PENDING: 0, SUBSCRIBED: 0, UNSUBSCRIBED: 0 });
      setNotMigrated(Boolean(res.data?.notMigrated));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not load subscribers.");
    } finally {
      setLoading(false);
    }
  }, [status, debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#02665e] text-white">
            <Mail className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="m-0 text-[20px] font-bold tracking-tight text-neutral-900">Newsletter</h1>
            <p className="m-0 text-[13px] text-neutral-500">Footer signups. Only confirmed addresses are exported.</p>
          </div>
        </div>
        <a
          href="/api/admin/newsletter/export.csv"
          className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[13.5px] font-semibold no-underline ${
            counts.SUBSCRIBED > 0 ? "bg-[#02665e] text-white hover:bg-[#014e47]" : "pointer-events-none bg-neutral-100 text-neutral-400"
          }`}
          aria-disabled={counts.SUBSCRIBED === 0}
        >
          <Download className="h-4 w-4" aria-hidden />
          Export CSV ({counts.SUBSCRIBED})
        </a>
      </div>

      {notMigrated && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900 ring-1 ring-inset ring-amber-200">
          The newsletter table has not been created yet. Signups will appear here once the migration is applied.
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {([
          { key: "SUBSCRIBED", label: "Subscribed", tone: "text-emerald-700" },
          { key: "PENDING", label: "Awaiting confirmation", tone: "text-amber-700" },
          { key: "UNSUBSCRIBED", label: "Unsubscribed", tone: "text-neutral-600" },
        ] as const).map((c) => (
          <div key={c.key} className="rounded-xl bg-white px-4 py-3 ring-1 ring-inset ring-neutral-200">
            <p className="m-0 text-[12px] font-medium text-neutral-500">{c.label}</p>
            <p className={`m-0 mt-1 text-[22px] font-bold tabular-nums ${c.tone}`}>{counts[c.key].toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-neutral-200">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3">
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.label}
                type="button"
                onClick={() => {
                  setStatus(tab.key);
                  setPage(1);
                }}
                className={`rounded-md border-0 px-3 py-1.5 text-[12.5px] font-semibold ${
                  status === tab.key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <label className="relative ml-auto w-full sm:w-64">
            <span className="sr-only">Search by email</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search email"
              className="box-border h-9 w-full rounded-lg border border-solid border-neutral-200 bg-neutral-50 pl-8 pr-3 text-[13px] outline-none focus:border-[#02665e] focus:bg-white"
            />
          </label>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
          </div>
        ) : error ? (
          <p className="m-0 px-4 py-6 text-[13px] text-rose-700">{error}</p>
        ) : items.length === 0 ? (
          <p className="m-0 px-4 py-10 text-center text-[13px] text-neutral-500">No subscribers here yet.</p>
        ) : (
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-neutral-50 text-[11px] uppercase tracking-[0.08em] text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Email</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Signed up</th>
                <th className="px-4 py-2 font-semibold">Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-0 border-t border-solid border-neutral-100">
                  <td className="px-4 py-2.5 font-medium text-neutral-900">{s.email}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${CHIP[s.status]}`}>
                      {s.status === "PENDING" ? "Awaiting" : s.status === "SUBSCRIBED" ? "Subscribed" : "Unsubscribed"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-600">{fmt(s.createdAt)}</td>
                  <td className="px-4 py-2.5 text-neutral-600">{fmt(s.confirmedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-0 border-t border-solid border-neutral-200 px-4 py-2.5 text-[12.5px] text-neutral-500">
            <span>
              Page {page} of {pages} · {total.toLocaleString()} total
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-solid border-neutral-200 bg-white px-3 py-1 font-semibold disabled:opacity-40">
                Previous
              </button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-solid border-neutral-200 bg-white px-3 py-1 font-semibold disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
