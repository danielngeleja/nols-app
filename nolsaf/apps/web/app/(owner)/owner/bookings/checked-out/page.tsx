"use client";

import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { Calendar, Loader2, Search, RotateCw, X, History, CheckCircle2 } from "lucide-react";
import TableRow from "@/components/TableRow";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type CheckedOutItem = {
  id: number;
  property?: { id: number; title: string };
  codeVisible?: string | null;
  validatedAt?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  roomType?: string | null;
  roomCode?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  checkoutConfirmedAt?: string | null;
  overdueHours?: number | null;
  overdueDays?: number | null;
  checkoutTiming?: "OVERDUE" | "NORMAL" | "UNKNOWN" | string | null;
  status?: string | null;
  totalAmount?: number | null;
  transportFare?: number | string | null;
  ownerBaseAmount?: number | string | null;
  createdAt?: string | null;
};

type AuditItem = {
  confirmedAt: string;
  note: string | null;
  rating: number | null;
  feedback: string | null;
  clientIp?: string | null;
  clientUa?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
};

function formatDateTime(v: any) {
  try {
    const d = new Date(String(v ?? ""));
    const t = d.getTime();
    if (!Number.isFinite(t)) return "—";
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatCurrencyTZS(amount: any) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-TZ", {
    style: "currency",
    currency: "TZS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function OwnerCheckedOutPage() {
  const [list, setList] = useState<CheckedOutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<CheckedOutItem | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const url = "/api/owner/bookings/checked-out";

  const load = async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (silent) setRefreshing(true);
    else setLoading(true);

    setError(null);
    try {
      const r = await api.get<unknown>(url);
      const raw: any = (r as any).data;
      const normalized: any[] = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.data)
          ? raw.data
          : (Array.isArray(raw?.items)
            ? raw.items
            : []));
      setList(normalized as CheckedOutItem[]);
    } catch (e: any) {
      if (!silent) setList([]);
      setError(e?.response?.data?.error ?? e?.message ?? "Failed to load checked-out history");
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openAudit(b: CheckedOutItem) {
    setAuditOpen(true);
    setAuditTarget(b);
    setAuditLoading(true);
    setAuditItems([]);

    const auditUrl = `/api/owner/bookings/${b.id}/audit`;
    try {
      const r = await api.get(auditUrl);
      const items = Array.isArray((r as any).data?.items) ? (r as any).data.items : [];
      setAuditItems(items);
    } catch (e: any) {
      setAuditItems([]);
      setError(e?.response?.data?.error ?? e?.message ?? "Failed to load audit history");
    } finally {
      setAuditLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((b) => {
      const name = String(b.guestName ?? "").toLowerCase();
      const phone = String(b.guestPhone ?? "").toLowerCase();
      const email = String(b.guestEmail ?? "").toLowerCase();
      const code = String(b.codeVisible ?? "").toLowerCase();
      const prop = String(b.property?.title ?? "").toLowerCase();
      const room = String(b.roomType ?? b.roomCode ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || email.includes(q) || code.includes(q) || prop.includes(q) || room.includes(q);
    });
  }, [list, search]);

  const stats = useMemo(() => {
    const now = Date.now();
    let last7d = 0;
    let last30d = 0;
    for (const b of list) {
      const t = new Date(String(b.checkOut ?? "")).getTime();
      if (!Number.isFinite(t)) continue;
      const diffDays = (now - t) / 86400000;
      if (diffDays <= 7) last7d += 1;
      if (diffDays <= 30) last30d += 1;
    }
    return { total: list.length, last7d, last30d };
  }, [list]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="relative mb-6">
          <span className="absolute inset-0 rounded-full bg-slate-400/20 animate-ping" />
          <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Checked-out</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">Loading check-out history…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-6 px-3 pb-10 sm:px-5 lg:px-6 xl:px-8">
      {/* Audit modal */}
      {auditOpen && auditTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl ring-1 ring-black/10 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Audit History</div>
                <div className="text-base sm:text-lg font-bold text-slate-900 truncate">{auditTarget.property?.title ?? "—"}</div>
              </div>
              <button
                type="button"
                onClick={() => { setAuditOpen(false); setAuditTarget(null); setAuditItems([]); }}
                className="h-9 w-9 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:scale-[0.99] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 inline-flex items-center justify-center"
                aria-label="Close audit dialog"
                title="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="p-4 sm:p-5">
              {auditLoading ? (
                <div className="py-10 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-600 mx-auto" />
                  <div className="text-sm text-slate-600 mt-3">Loading audit…</div>
                </div>
              ) : auditItems.length === 0 ? (
                <div className="py-10 text-center">
                  <History className="h-10 w-10 text-slate-300 mx-auto" aria-hidden />
                  <div className="text-sm font-semibold text-slate-800 mt-3">No audit records found</div>
                  <div className="text-xs text-slate-500 mt-1">This booking may predate audit logging.</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditItems.map((it, idx) => (
                    <div key={idx} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">
                          {String(it.note ?? "").toLowerCase() === "checkout" ? "CHECK-OUT" : String(it.note ?? "").toLowerCase() === "checkin" ? "CHECK-IN" : (it.note ?? "event")}
                        </div>
                        <div className="text-xs text-slate-600">{formatDateTime(it.confirmedAt)}</div>
                      </div>
                      <div className="mt-2 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          By: <span className="font-semibold text-slate-900">{it.actorName ?? "—"}</span>
                        </span>
                        <span>
                          Rating: <span className="font-semibold text-slate-900">{typeof it.rating === "number" ? `${it.rating}/5` : "—"}</span>
                        </span>
                        {it.feedback ? (
                          <span className="min-w-0">
                            Feedback: <span className="font-semibold text-slate-900">{it.feedback}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-xl shadow-slate-100/70">
        <div className="pointer-events-none select-none absolute right-0 bottom-0 text-[100px] font-black text-slate-100/80 leading-none tracking-tighter pr-4 pb-1" aria-hidden>HISTORY</div>
        <div className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-[0.035]" style={{ backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)", backgroundSize: "18px 18px" }} />
        <div className="relative pl-8 pr-6 pt-6 pb-6 sm:pt-7 sm:pb-7 sm:pr-8 lg:pt-8 lg:pb-8 lg:pr-10 lg:pl-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-slate-100 border border-slate-200">
                <CheckCircle2 className="h-5 w-5 text-slate-700" aria-hidden />
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                Check-out history
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => load({ silent: true })}
                disabled={refreshing}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.97] transition-all duration-150 shadow-sm disabled:opacity-50"
                aria-label="Refresh" title="Refresh"
              >
                <RotateCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
              </button>
              <Link
                href="/owner/bookings/check-out"
                className="no-underline inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.97] transition-all duration-150 shadow-sm"
                aria-label="Back to check-out queue" title="Check-out queue"
              >
                <Calendar className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
          <div className="mt-5">
            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight leading-none">Checked-out</h1>
            <p className="mt-2.5 text-sm text-slate-500 max-w-md leading-relaxed">View bookings you've already checked out. Use audit history to see ratings and notes.</p>
          </div>
          <div className="mt-6 h-px bg-gradient-to-r from-slate-200 via-slate-100 to-transparent" />
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Total */}
        <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total checked-out</div>
          <div className="mt-2 text-3xl font-black text-slate-900 leading-none">{stats.total.toLocaleString()}</div>
          <div className="mt-1 text-xs text-slate-400">All time records</div>
        </div>
        {/* Last 7d */}
        <div className="relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70">Last 7 days</div>
          <div className="mt-2 text-3xl font-black text-emerald-400 leading-none">{stats.last7d.toLocaleString()}</div>
          <div className="mt-1 text-xs text-emerald-600">Recent check-outs</div>
        </div>
        {/* Last 30d */}
        <div className="relative overflow-hidden rounded-2xl bg-slate-800 border border-slate-700 p-5 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400/70">Last 30 days</div>
          <div className="mt-2 text-3xl font-black text-slate-300 leading-none">{stats.last30d.toLocaleString()}</div>
          <div className="mt-1 text-xs text-slate-500">Monthly activity</div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-14 flex flex-col items-center justify-center text-center gap-4">
          <CheckCircle2 className="h-12 w-12 text-gray-300 mx-auto mb-4" aria-hidden />
          <p className="text-sm text-gray-700 font-semibold">No checked-out bookings found.</p>
          <p className="text-xs text-gray-500 mt-2">If you just confirmed a check-out, refresh this page.</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => load({ silent: true })}
              disabled={refreshing}
              className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-slate-900 bg-slate-900 text-white shadow-sm hover:bg-slate-800 active:scale-[0.99] transition disabled:opacity-60"
              aria-label="Refresh"
              title="Refresh"
            >
              <RotateCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            </button>
            <Link
              href="/owner/bookings/check-out"
              className="no-underline inline-flex items-center justify-center h-10 w-10 rounded-md bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition"
              aria-label="Go to check-out queue"
              title="Go to check-out"
            >
              <Calendar className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="text-sm font-bold text-slate-900 tracking-tight">
              Checked-out <span className="ml-1 text-xs font-medium text-slate-400">{filtered.length}</span>
            </div>
            <div className="flex items-center gap-1.5 h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100 focus-within:bg-white transition-all duration-200">
              <Search className="h-3.5 w-3.5 text-slate-400 pointer-events-none flex-shrink-0" aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-36 sm:w-52 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none" aria-label="Search checked-out history" />
              {search ? (
                <button type="button" onClick={() => setSearch("")} className="flex-shrink-0 inline-flex h-4 w-4 items-center justify-center rounded text-slate-400 hover:text-slate-700 transition" aria-label="Clear search">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          <div className={`overflow-x-auto ${refreshing ? "opacity-60" : ""} transition-opacity duration-200`}>
            <table className="w-full min-w-[1400px] table-fixed text-sm">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[7%]" />
                <col className="w-[15%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Property</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Code</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Guest</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Phone</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Check-in</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Check-out</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Overdue</th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Amount</th>
                  <th className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((b) => (
                  <TableRow key={b.id} className="align-middle">
                    <td className="px-5 py-3.5">
                      <div className="min-w-0">
                        <div className="truncate whitespace-nowrap text-sm font-semibold text-slate-900" title={b.property?.title ?? "—"}>{b.property?.title ?? "—"}</div>
                      </div>
                    </td>
                    <td className="overflow-hidden px-4 py-3.5 whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-900 tracking-widest text-xs">{b.codeVisible ?? "—"}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="truncate whitespace-nowrap text-sm font-semibold text-slate-900" title={b.guestName ?? "—"}>{b.guestName ?? "—"}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{b.roomType ?? b.roomCode ?? ""}</div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-slate-600 text-xs">{b.guestPhone ?? "—"}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-slate-600 text-xs">{formatDateTime(b.checkIn)}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-slate-600 text-xs">{formatDateTime(b.checkOut)}</td>
                    <td className="overflow-hidden px-4 py-3.5 whitespace-nowrap">
                      {String(b.checkoutTiming ?? "UNKNOWN").toUpperCase() === "OVERDUE" ? (
                        <span
                          className="inline-flex max-w-full items-center whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                          title={b.checkoutConfirmedAt ? `Confirmed: ${formatDateTime(b.checkoutConfirmedAt)}` : "Overdue"}
                        >
                          {typeof b.overdueDays === "number" || typeof b.overdueHours === "number"
                            ? `${typeof b.overdueDays === "number" ? `${b.overdueDays}d` : ""}${typeof b.overdueDays === "number" && typeof b.overdueHours === "number" ? " " : ""}${typeof b.overdueHours === "number" ? `${b.overdueHours}h` : ""} overdue`
                            : "OVERDUE"}
                        </span>
                      ) : String(b.checkoutTiming ?? "UNKNOWN").toUpperCase() === "NORMAL" ? (
                        <span
                          className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                          title={b.checkoutConfirmedAt ? `Confirmed: ${formatDateTime(b.checkoutConfirmedAt)}` : "Normal"}
                        >
                          NORMAL
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700"
                          title="No confirmation timestamp found for this record"
                        >
                          UNKNOWN
                        </span>
                      )}
                    </td>
                    <td className="overflow-hidden px-3 py-3.5 whitespace-nowrap text-[13px] font-semibold tabular-nums text-slate-900">{formatCurrencyTZS(b.ownerBaseAmount ?? Math.max(0, Number(b.totalAmount ?? 0) - Number(b.transportFare ?? 0)))}</td>
                    <td className="px-3 py-3.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => openAudit(b)}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-sm active:scale-[0.97] transition"
                        aria-label="View audit"
                        title="Audit"
                      >
                        <History className="h-4 w-4" aria-hidden />
                      </button>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
