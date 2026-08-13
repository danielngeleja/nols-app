"use client";

import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { Calendar, Loader2, PhoneCall, Mail, CheckCircle2, Clock, X, History, Star, Search, RotateCw } from "lucide-react";
import TableRow from "@/components/TableRow";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type CheckoutItem = {
  id: number;
  property?: { id: number; title: string; nrmsActivatedAt?: string | null };
  codeVisible?: string | null;
  validatedAt?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  status?: string | null;
};

type AuditItem = {
  confirmedAt: string;
  note: string | null;
  rating: number | null;
  feedback: string | null;
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

function hoursLeft(checkOut: any) {
  const t = new Date(String(checkOut ?? "")).getTime();
  if (!Number.isFinite(t)) return null;
  const diffH = (t - Date.now()) / 3600000;
  return diffH;
}

export default function OwnerCheckoutPage() {
  const [list, setList] = useState<CheckoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<CheckoutItem | null>(null);
  const [rating, setRating] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>("");
  const [agreeToTerms, setAgreeToTerms] = useState(false);

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<CheckoutItem | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const url = "/api/owner/bookings/for-checkout?source=check-out-page";

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
      setList(normalized as CheckoutItem[]);
    } catch (e: any) {
      if (!silent) setList([]);
      setError(e?.response?.data?.error ?? e?.message ?? "Failed to load check-out queue");
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((b) => {
      const name = String(b.guestName ?? "").toLowerCase();
      const phone = String(b.guestPhone ?? "").toLowerCase();
      const email = String(b.guestEmail ?? "").toLowerCase();
      const code = String(b.codeVisible ?? "").toLowerCase();
      const prop = String(b.property?.title ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || email.includes(q) || code.includes(q) || prop.includes(q);
    });
  }, [list, search]);

  const stats = useMemo(() => {
    let overdueCount = 0;
    let urgentCount = 0;
    for (const b of filtered) {
      const h = hoursLeft(b.checkOut);
      if (typeof h !== "number") continue;
      if (h < 0) overdueCount += 1;
      else if (h <= 1) urgentCount += 1;
    }
    return {
      total: filtered.length,
      overdue: overdueCount,
      urgent: urgentCount,
    };
  }, [filtered]);

  async function confirmCheckout(id: number) {
    if (!rating || rating < 1 || rating > 5) {
      return setError("Please rate the guest (1–5) before confirming check-out.");
    }
    if (!agreeToTerms) {
      return setError("Please agree to the Terms of Service before confirming check-out.");
    }
    setConfirmingId(id);
    setError(null);
    try {
      await api.post(`/api/owner/bookings/${id}/confirm-checkout`, { rating, feedback: feedback.trim() || null });
      // Refresh list + let sidebar update counts
      window.dispatchEvent(new Event("nols:checkout-changed"));
      setConfirmOpen(false);
      setConfirmTarget(null);
      setRating(0);
      setFeedback("");
      setAgreeToTerms(false);
      await load();
    } catch (e: any) {
      if (e?.response?.data?.code === "NRMS_CHECKOUT_MANAGED") {
        window.location.assign(e.response.data.redirectTo || "/owner/nrms");
        return;
      }
      setError(e?.response?.data?.error ?? e?.message ?? "Failed to confirm check-out");
    } finally {
      setConfirmingId(null);
    }
  }

  async function openAudit(b: CheckoutItem) {
    setAuditOpen(true);
    setAuditTarget(b);
    setAuditLoading(true);
    setAuditItems([]);
    const url = `/api/owner/bookings/${b.id}/audit`;
    try {
      const r = await api.get(url);
      const items = Array.isArray((r as any).data?.items) ? (r as any).data.items : [];
      setAuditItems(items);
    } catch (e: any) {
      setAuditItems([]);
      setError(e?.response?.data?.error ?? e?.message ?? "Failed to load audit history");
    } finally {
      setAuditLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-100 mb-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900">Check-out</h1>
        <p className="text-sm text-slate-600 mt-2 max-w-2xl">Loading upcoming check-outs…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
      {/* Confirm modal (rating required) */}
      {confirmOpen && confirmTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[3px]">
          <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-2xl ring-1 ring-black/8 overflow-hidden">

            {/* Header */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Confirm Check-out</div>
                <div className="text-sm font-bold text-white truncate mt-0.5">{confirmTarget.property?.title ?? "—"}</div>
                <div className="text-[11px] text-slate-300 mt-0.5">
                  Guest: <span className="font-semibold text-white">{confirmTarget.guestName ?? "—"}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setConfirmTarget(null); setRating(0); setFeedback(""); setAgreeToTerms(false); }}
                className="h-7 w-7 rounded-lg bg-white/10 hover:bg-white/20 text-white active:scale-[0.97] transition-all duration-150 focus:outline-none inline-flex items-center justify-center shrink-0 mt-0.5"
                aria-label="Close confirm dialog"
                title="Close"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>

            {/* Body */}
            <div className="px-4 py-3 space-y-2.5 min-w-0 overflow-hidden">

              {/* Rating */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 space-y-2">
                <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Rate this guest <span className="text-rose-400">*</span></div>
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRating(v)}
                      className={`h-7 w-7 rounded-md border transition-all duration-150 inline-flex items-center justify-center ${
                        rating >= v
                          ? "bg-amber-400 border-amber-400 shadow-sm"
                          : "bg-white border-slate-200 hover:border-amber-300 hover:bg-amber-50"
                      }`}
                      aria-label={`Rate ${v} star`}
                    >
                      <Star className={`h-3 w-3 ${rating >= v ? "text-white fill-white" : "text-slate-300"}`} aria-hidden />
                    </button>
                  ))}
                  <span className="ml-2 text-xs font-semibold text-slate-500">
                    {rating ? `${rating} / 5` : "tap to rate"}
                  </span>
                </div>
              </div>

              {/* Feedback */}
              <div className="space-y-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Note (optional)</div>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={2}
                  className="w-full box-border rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-all duration-200 resize-none"
                  placeholder="Short note about the guest (optional)…"
                  aria-label="Guest rating feedback"
                />
              </div>

              {/* Terms – toggle switch */}
              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600 cursor-pointer select-none transition-colors hover:border-[#02665e]/20">
                <span>I agree to the{" "}
                  <Link href="/terms" target="_blank" className="font-semibold text-[#02665e] underline underline-offset-2 hover:text-[#034e47]">Terms of Service</Link>.
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={agreeToTerms}
                  onClick={() => setAgreeToTerms(!agreeToTerms)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 ${agreeToTerms ? 'bg-[#02665e]' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${agreeToTerms ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                </button>
                <input
                  type="checkbox"
                  checked={agreeToTerms}
                  onChange={(e) => setAgreeToTerms(e.target.checked)}
                  className="sr-only"
                  aria-hidden="true"
                />
              </label>
            </div>

            {/* Footer */}
            <div className="px-4 pb-4 pt-1 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => openAudit(confirmTarget)}
                className="h-8 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all duration-150 focus:outline-none inline-flex items-center gap-1.5"
              >
                <History className="h-3.5 w-3.5" aria-hidden />
                Audit History
              </button>
              <button
                type="button"
                onClick={() => confirmCheckout(confirmTarget.id)}
                disabled={confirmingId === confirmTarget.id || !agreeToTerms}
                className="h-8 rounded-xl bg-emerald-700 text-white px-4 text-xs font-bold hover:bg-emerald-800 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-500/30 inline-flex items-center gap-1.5"
              >
                {confirmingId === confirmTarget.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                Confirm Check-out
              </button>
            </div>

          </div>
        </div>
      ) : null}

      {/* Audit modal */}
      {auditOpen && auditTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-2xl rounded-3xl bg-white border border-slate-200 shadow-xl ring-1 ring-black/10 overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Audit History</div>
                <div className="text-lg font-bold text-slate-900 truncate">{auditTarget.property?.title ?? "—"}</div>
                <div className="text-xs text-slate-600 mt-1">
                  Booking #{auditTarget.id} • Code <span className="font-mono font-semibold text-slate-900">{auditTarget.codeVisible ?? "—"}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setAuditOpen(false); setAuditTarget(null); setAuditItems([]); }}
                className="h-10 w-10 rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:scale-[0.99] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 inline-flex items-center justify-center"
                aria-label="Close audit dialog"
                title="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="p-5 sm:p-6">
              {auditLoading ? (
                <div className="flex items-center gap-3 text-slate-700">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  Loading audit history…
                </div>
              ) : auditItems.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                  No audit history found yet for this booking.
                </div>
              ) : (
                <div className="w-full overflow-x-auto">
                  <table className="min-w-[700px] w-full text-sm">
                    <thead className="bg-slate-50 border border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-left">Action</th>
                        <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-left">By</th>
                        <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-left">Confirmed At</th>
                        <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-left">Rating</th>
                        <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-left">Feedback</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 border border-slate-200 border-t-0">
                      {auditItems.map((it, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {String(it.note ?? "").toLowerCase() === "checkout" ? "CHECK-OUT" : String(it.note ?? "").toLowerCase() === "checkin" ? "CHECK-IN" : (it.note ?? "—")}
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                            {it.actorName ? it.actorName : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDateTime(it.confirmedAt)}</td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{typeof it.rating === "number" ? `${it.rating}/5` : "—"}</td>
                          <td className="px-4 py-3 text-slate-700">{it.feedback ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Header (clean, consistent) */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center mb-4">
            <Calendar className="h-8 w-8 text-emerald-700" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Check-out</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Bookings appear here automatically when they are within <span className="font-semibold text-gray-900">7 hours</span> of check-out (or overdue).
            Use this page to remind guests and confirm check-out once they leave.
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm min-w-0">
          <div className="text-[11px] sm:text-xs font-medium text-gray-500">Total in queue</div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-gray-900 truncate">{stats.total.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm min-w-0">
          <div className="text-[11px] sm:text-xs font-medium text-gray-500">Urgent (≤ 1h)</div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-amber-700 truncate">{stats.urgent.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm min-w-0">
          <div className="text-[11px] sm:text-xs font-medium text-gray-500">Overdue</div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-red-700 truncate">{stats.overdue.toLocaleString()}</div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 sm:p-12 text-center shadow-sm">
          <Clock className="h-12 w-12 text-gray-300 mx-auto mb-4" aria-hidden />
          <p className="text-sm text-gray-700 font-semibold">No bookings are ready for check-out.</p>
          <p className="text-xs text-gray-500 mt-2">This list updates automatically as check-outs get close.</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => load({ silent: true })}
              disabled={refreshing}
              className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 active:scale-[0.99] transition disabled:opacity-60"
              aria-label="Refresh"
              title="Refresh"
            >
              <RotateCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            </button>
            <Link
              href="/owner/bookings/checked-in"
              className="no-underline inline-flex items-center justify-center h-10 w-10 rounded-md bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition"
              aria-label="Checked-In"
              title="Checked-In"
            >
              <Calendar className="h-4 w-4" aria-hidden />
            </Link>

            <Link
              href="/owner/bookings/checked-out"
              className="no-underline inline-flex items-center justify-center h-10 w-10 rounded-md bg-slate-900 text-white shadow-sm hover:bg-slate-800 active:scale-[0.99] transition"
              aria-label="Checked-Out"
              title="Checked-Out"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="sticky top-0 z-10 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900">Upcoming check-outs</div>
              <div className="text-xs text-gray-500 mt-0.5">Confirm check-out after the guest leaves.</div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" aria-hidden />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-4 w-4 rounded text-slate-400 hover:text-slate-700 transition"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                ) : null}
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="h-8 w-36 sm:w-48 pl-8 pr-6 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:bg-white transition-all duration-200"
                  aria-label="Search check-out queue"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => load({ silent: true })}
                  disabled={refreshing}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:scale-[0.99] transition disabled:opacity-60"
                  aria-label="Refresh check-out list"
                  title="Refresh"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
                </button>

                <Link
                  href="/owner/bookings/checked-in"
                  className="no-underline inline-flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 active:scale-[0.99] transition"
                  aria-label="Checked-In"
                  title="Checked-In"
                >
                  <Calendar className="h-3.5 w-3.5" aria-hidden />
                </Link>

                <Link
                  href="/owner/bookings/checked-out"
                  className="no-underline inline-flex items-center justify-center h-8 w-8 rounded-lg bg-slate-900 text-white hover:bg-slate-800 active:scale-[0.99] transition"
                  aria-label="Checked-Out"
                  title="Checked-Out"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </div>
          </div>

          <div className={`overflow-x-auto ${refreshing ? "opacity-60" : ""} transition-opacity duration-200`}>
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Property</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Code</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Guest</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Validated</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Check-out</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">State</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((b) => {
                  const h = hoursLeft(b.checkOut);
                  const urgent = typeof h === "number" ? h <= 1 : false;
                  const overdue = typeof h === "number" ? h < 0 : false;
                  const phone = String(b.guestPhone ?? "").trim();
                  const email = String(b.guestEmail ?? "").trim();

                  return (
                    <TableRow key={b.id} className="align-middle">
                      <td className="px-6 py-4">
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900 truncate">{b.property?.title ?? "—"}</div>
                          <div className="text-xs text-gray-500 mt-0.5">Booking #{b.id}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono font-semibold text-gray-900">{b.codeVisible ?? "—"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-900">{b.guestName ?? "—"}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-gray-700">{phone || "—"}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                        {b.validatedAt ? formatDateTime(b.validatedAt) : "—"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-gray-900 font-semibold">{formatDateTime(b.checkOut)}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {typeof h === "number" ? (h < 0 ? `${Math.abs(h).toFixed(1)}h overdue` : `${h.toFixed(1)}h left`) : "—"}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          overdue
                            ? "bg-red-50 text-red-700 border-red-200"
                            : urgent
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}>
                          <Clock className="h-3 w-3 stroke-current" aria-hidden />
                          {overdue ? "OVERDUE" : urgent ? "URGENT" : "DUE SOON"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => openAudit(b)}
                            className="inline-flex items-center justify-center h-9 rounded-md border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 active:scale-[0.99] transition"
                            aria-label="View audit history"
                            title="Audit history"
                          >
                            <History className="h-4 w-4 stroke-amber-500" aria-hidden />
                          </button>
                          <a
                            href={phone ? `tel:${phone}` : undefined}
                            className={`no-underline inline-flex items-center justify-center h-9 rounded-md px-3 text-sm font-semibold border shadow-sm transition ${
                              phone
                                ? "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                                : "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed pointer-events-none"
                            }`}
                            aria-label="Call guest"
                            title={phone ? "Call guest" : "No phone number"}
                          >
                            <PhoneCall className={`h-4 w-4 ${phone ? "stroke-emerald-600" : "stroke-slate-400"}`} aria-hidden />
                          </a>
                          <a
                            href={email ? `mailto:${email}` : undefined}
                            className={`no-underline inline-flex items-center justify-center h-9 rounded-md px-3 text-sm font-semibold border shadow-sm transition ${
                              email
                                ? "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                                : "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed pointer-events-none"
                            }`}
                            aria-label="Email guest"
                            title={email ? "Email guest" : "No email"}
                          >
                            <Mail className={`h-4 w-4 ${email ? "stroke-slate-900" : "stroke-slate-400"}`} aria-hidden />
                          </a>
                          {b.property?.nrmsActivatedAt ? (
                            <Link
                              href="/owner/nrms"
                              className="no-underline inline-flex items-center justify-center gap-2 h-9 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition"
                              aria-label="Manage check-out in NRMS"
                              title="NRMS manages check-out for this property"
                            >
                              <CheckCircle2 className="h-4 w-4" aria-hidden />
                              NRMS
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setConfirmTarget(b); setConfirmOpen(true); setError(null); setRating(0); setFeedback(""); setAgreeToTerms(false); }}
                              className="inline-flex items-center justify-center h-9 rounded-md border border-gray-200 bg-white px-4 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-gray-50 active:scale-[0.99] transition"
                              aria-label="Confirm check-out"
                            >
                              <CheckCircle2 className="h-4 w-4 stroke-indigo-700" aria-hidden />
                            </button>
                          )}
                        </div>
                      </td>
                    </TableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


