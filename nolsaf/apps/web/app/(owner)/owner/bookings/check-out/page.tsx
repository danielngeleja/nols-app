"use client";

import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { AlarmClock, AlertTriangle, ArrowRight, BedDouble, CheckCircle2, Clock, DoorOpen, History, Loader2, LogOut, Mail, PhoneCall, RotateCw, Search, Star, X } from "lucide-react";

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

/** "2h 15m", "45m" or "3d 4h": short enough for the countdown box. */
function duration(hours: number) {
  const mins = Math.max(0, Math.round(hours * 60));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function formatEat(v: any) {
  const d = new Date(String(v ?? ""));
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })} EAT`;
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
      const code = String((b as any).bookingReference ?? b.id ?? "").toLowerCase();
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

  const styles = `
    #owner-departures, #owner-departures * { box-sizing: border-box; }
    @keyframes od-shimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
    #owner-departures .od-sk { background: linear-gradient(90deg, #eef2f1 0%, #f8faf9 40%, #eef2f1 80%); background-size: 800px 100%; animation: od-shimmer 1.3s linear infinite; }
    #owner-departures .od-sk-dark { background: linear-gradient(90deg, rgba(255,255,255,.06) 0%, rgba(255,255,255,.14) 40%, rgba(255,255,255,.06) 80%); background-size: 800px 100%; animation: od-shimmer 1.3s linear infinite; }
  `;

  if (loading) {
    return (
      <div id="owner-departures" className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6" aria-busy="true" aria-label="Loading check-outs">
        <style>{styles}</style>
        <div className="rounded-3xl bg-[#012a26] px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="space-y-2.5">
            <div className="od-sk-dark h-3 w-24 rounded-full" />
            <div className="od-sk-dark h-8 w-44 rounded-lg" />
            <div className="od-sk-dark h-3.5 w-72 rounded-full" />
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => <div key={i} className="od-sk-dark h-[76px] rounded-2xl" />)}
          </div>
        </div>
        {[0, 1, 2].map((i) => <div key={i} className="od-sk h-[92px] rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div id="owner-departures" className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <style>{styles}</style>
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
                  Booking reference <span className="font-mono font-semibold text-slate-900">{(auditTarget as any).bookingReference ?? `#${auditTarget.id}`}</span>
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

      {/* ── Header band ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)", WebkitMaskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Front desk</p>
              <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">Departures</h1>
              <p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">
                Guests due to leave within the next 7 hours, or already past their check-out. Confirm each one once the guest has gone.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => load({ silent: true })}
                disabled={refreshing}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                <RotateCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden /> Refresh
              </button>
              <Link
                href="/owner/bookings/checked-out"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5eead4] px-3.5 text-sm font-bold text-[#012a26] no-underline transition hover:bg-[#8ff3e1]"
              >
                <History className="h-4 w-4" aria-hidden /> History
              </Link>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2.5 sm:gap-3">
            {[
              { label: "Due to leave", value: stats.total - stats.urgent - stats.overdue, Icon: Clock, tone: "text-[#5eead4]", ring: "border-white/10 bg-white/[0.04]" },
              { label: "Within 1 hour", value: stats.urgent, Icon: AlarmClock, tone: "text-amber-300", ring: stats.urgent ? "border-amber-300/40 bg-amber-300/[0.07]" : "border-white/10 bg-white/[0.04]" },
              { label: "Past check-out", value: stats.overdue, Icon: AlertTriangle, tone: "text-rose-300", ring: stats.overdue ? "border-rose-300/40 bg-rose-400/[0.08]" : "border-white/10 bg-white/[0.04]" },
            ].map((s) => (
              <div key={s.label} className={`min-w-0 rounded-2xl border border-solid px-4 py-3 ${s.ring}`}>
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
                  <s.Icon className={`h-3.5 w-3.5 ${s.tone}`} aria-hidden />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className={`mt-1 block text-2xl font-bold tabular-nums ${s.value > 0 ? "text-white" : "text-white/35"}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}

      {list.length === 0 ? (
        <section className="grid overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-24px_rgba(15,23,42,0.35)] md:grid-cols-2">
          <div className="p-7">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <DoorOpen className="h-6 w-6" aria-hidden />
            </span>
            <p className="m-0 mt-4 text-lg font-bold text-slate-900">No departures in the next 7 hours</p>
            <p className="m-0 mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">
              A guest appears here automatically 7 hours before their check-out, and stays until you confirm they have left.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2.5 border-0 border-t border-solid border-slate-200 bg-slate-50 p-7 md:border-l md:border-t-0">
            <Link
              href="/owner/bookings/checked-in"
              className="group inline-flex h-12 items-center justify-between gap-2 rounded-xl bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white no-underline transition hover:bg-[#02665e]"
            >
              See guests in house
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5eead4] text-[#012a26]">
                <ArrowRight className="h-4 w-4" aria-hidden />
              </span>
            </Link>
            <Link
              href="/owner/bookings/checked-out"
              className="inline-flex h-12 items-center justify-between gap-2 rounded-xl border border-solid border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-100"
            >
              Check-out history
              <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
            </Link>
          </div>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-slate-600">
              <span className="font-bold text-slate-900">{filtered.length}</span> {filtered.length === 1 ? "departure" : "departures"}, soonest to leave at the top
            </p>
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Search departures</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search guest, phone or property"
                className="h-10 w-full rounded-xl border border-solid border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
              />
            </label>
          </div>

          <ul className={`m-0 list-none space-y-3 p-0 transition-opacity ${refreshing ? "opacity-60" : ""}`}>
            {[...filtered]
              .sort((a, b) => new Date(String(a.checkOut ?? "")).getTime() - new Date(String(b.checkOut ?? "")).getTime())
              .map((b) => {
                const h = hoursLeft(b.checkOut);
                const overdue = typeof h === "number" && h < 0;
                const urgent = typeof h === "number" && h >= 0 && h <= 1;
                const phone = String(b.guestPhone ?? "").trim();
                const email = String(b.guestEmail ?? "").trim();
                const name = b.guestName ?? "Guest";
                const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "G";
                const clock = overdue
                  ? { big: duration(Math.abs(h as number)), small: "past check-out", box: "bg-rose-600 text-white", bar: "shadow-[inset_4px_0_0_#e11d48]" }
                  : urgent
                    ? { big: duration(h as number), small: "left", box: "bg-amber-500 text-white", bar: "shadow-[inset_4px_0_0_#f59e0b]" }
                    : { big: typeof h === "number" ? duration(h) : "Soon", small: "left", box: "bg-[#012a26] text-white", bar: "" };
                return (
                  <li
                    key={b.id}
                    className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-2xl border border-solid border-slate-300/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-26px_rgba(15,23,42,0.4)] sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] ${clock.bar}`}
                  >
                    {/* Countdown */}
                    <div className={`flex w-[92px] flex-col items-center justify-center rounded-xl px-2 py-2.5 text-center ${clock.box}`}>
                      <span className="text-lg font-bold leading-tight tabular-nums">{clock.big}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-80">{clock.small}</span>
                    </div>

                    {/* Who and when */}
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-700">{initials}</span>
                        <p className="m-0 truncate text-base font-bold text-slate-900">{name}</p>
                        {overdue ? <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-inset ring-rose-200">Overdue</span> : null}
                      </div>
                      <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1"><BedDouble className="h-3.5 w-3.5 text-slate-400" aria-hidden />{b.property?.title ?? "Your property"}</span>
                        <span className="inline-flex items-center gap-1"><LogOut className="h-3.5 w-3.5 text-slate-400" aria-hidden />Check-out {formatEat(b.checkOut)}</span>
                        {phone ? <span className="inline-flex items-center gap-1"><PhoneCall className="h-3.5 w-3.5 text-slate-400" aria-hidden />{phone}</span> : null}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1 lg:justify-end">
                      <a
                        href={phone ? `tel:${phone}` : undefined}
                        aria-disabled={!phone}
                        className={`inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid px-3 text-sm font-semibold no-underline transition ${phone ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "pointer-events-none border-slate-200 bg-slate-50 text-slate-300"}`}
                        title={phone ? "Call guest" : "No phone number"}
                      >
                        <PhoneCall className="h-4 w-4" aria-hidden /> Call
                      </a>
                      <a
                        href={email ? `mailto:${email}` : undefined}
                        aria-disabled={!email}
                        className={`grid h-10 w-10 place-items-center rounded-xl border border-solid no-underline transition ${email ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "pointer-events-none border-slate-200 bg-slate-50 text-slate-300"}`}
                        title={email ? "Email guest" : "No email"}
                        aria-label="Email guest"
                      >
                        <Mail className="h-4 w-4" aria-hidden />
                      </a>
                      <button
                        type="button"
                        onClick={() => openAudit(b)}
                        className="grid h-10 w-10 place-items-center rounded-xl border border-solid border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50"
                        title="Audit history"
                        aria-label="Audit history"
                      >
                        <History className="h-4 w-4" aria-hidden />
                      </button>
                      {b.property?.nrmsActivatedAt ? (
                        <Link
                          href="/owner/nrms"
                          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#012a26] px-4 text-sm font-bold text-white no-underline transition hover:bg-[#02665e]"
                          title="NRMS manages check-out for this property"
                        >
                          Check out in NRMS <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setConfirmTarget(b); setConfirmOpen(true); setError(null); setRating(0); setFeedback(""); setAgreeToTerms(false); }}
                          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-[#012a26] bg-[#012a26] px-4 text-sm font-bold text-white transition hover:bg-[#02665e]"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirm check-out
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </div>
  );
}


