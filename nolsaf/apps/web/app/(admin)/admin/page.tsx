"use client";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AlertTriangle, Bell, CalendarDays, CheckCheck, ChevronDown, ChevronUp, Clock3, Eye, EyeOff, FileCheck2, FileBadge, LayoutDashboard, Building2, Moon, RefreshCw, ShieldCheck, UserRound, Users, WalletCards, BarChart3, LineChart, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import GeneralReports from '@/components/GeneralReports';
  // Read-only widget limits (used by loaders). Persisted UI control was removed in favor of header-level prefs.
  const limits = (() => {
    if (typeof window === 'undefined') return { approvals: 6, invoices: 5, bookings: 6 };
    try { 
      const raw = localStorage.getItem('admin.widgetLimits');
      if (!raw || raw === '') return { approvals: 6, invoices: 5, bookings: 6 };
      return JSON.parse(raw) || { approvals: 6, invoices: 5, bookings: 6 }; 
    } catch { 
      return { approvals: 6, invoices: 5, bookings: 6 }; 
    }
  })();
// Use relative paths in browser to leverage Next.js rewrites (avoids CORS issues)
// Only use absolute URL for server-side or when explicitly needed
const API = '';

// Send a lightweight analytics event to the API (non-blocking)
async function sendAnalytics(eventName: string, payload: any = {}) {
  try {
    // fire-and-forget; don't await in callers unless necessary
    void fetch(`${API}/admin/analytics/event`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventName, payload }),
    });
  } catch {
    // swallow errors to avoid interfering with UX
  }
}

function QLink({ href, label, Icon, color = '' }: { href: string; label: string; Icon: any; color?: string }) {
  // color is a tailwind bg class (e.g. 'bg-emerald-600') or custom style
  const base = `qlink w-full h-16 flex items-center justify-center gap-3 text-white ${color}`;
  return (
    <div className="qlink-wrapper w-full h-full relative">
      <Link href={href} className={base}>
        <Icon className="h-5 w-5" />
        <span className="ml-2 font-medium truncate">{label}</span>
      </Link>
      {/* Interactive popup: outside the anchor so pointer events don't trigger navigation */}
      <div className="qlink-popup hidden absolute left-1/2 -translate-x-1/2 -top-2 transform -translate-y-full mt-1 w-auto max-w-xs rounded-md bg-white text-gray-900 text-sm p-2 shadow-lg">
        <div tabIndex={0} className="outline-none">{label}</div>
      </div>
    </div>
  );
}

export default function AdminHome() {
  // simple date ranges for KPIs (Today/7d/30d)
  type Range = "today" | "7d" | "30d";
  const [range] = useState<Range>(() => {
    if (typeof window === "undefined") return "7d";
    return (localStorage.getItem("admin.range") as Range) || "7d";
  });
  const { from, to } = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    const start = new Date(now);
    if (range === "today") {
      start.setHours(0,0,0,0);
    } else if (range === "7d") {
      start.setDate(start.getDate() - 6);
      start.setHours(0,0,0,0);
    } else {
      start.setDate(start.getDate() - 29);
      start.setHours(0,0,0,0);
    }
    return { from: start.toISOString(), to: end.toISOString() };
  }, [range]);

  // Chart-specific range (only affects the Compact overview chart)
  // Compact overview removed — replaced by GeneralReports component

  // KPI and widget state
  const [overview, setOverview] = useState<any>(null);
  const [loadingKpis, setLoadingKpis] = useState<boolean>(true);
  const [revealedCards, setRevealedCards] = useState<Set<string>>(new Set());
  // Properties (Approvals widget)
  const [propNew, setPropNew] = useState<any>({ items: [], total: 0 }); // NEW = PENDING (submitted, not yet handled)
  const [propPending, setPropPending] = useState<any>({ items: [], total: 0 }); // PENDING bucket = SUSPENDED
  const [propApproved, setPropApproved] = useState<any>({ items: [] }); // APPROVED
  const [propRejected, setPropRejected] = useState<any>({ items: [] }); // REJECTED
  const [loadingApprovals, setLoadingApprovals] = useState<boolean>(true);
  const [invNew, setInvNew] = useState<any>({ items: [] });
  const [invApproved, setInvApproved] = useState<any>({ items: [] });
  const [invPaid, setInvPaid] = useState<any>({ items: [] });
  const [invRejected, setInvRejected] = useState<any>({ items: [] });
  const [loadingInv, setLoadingInv] = useState<boolean>(true);
  // Validation lookup state — booking code check-in validation
  const [validationCode, setValidationCode] = useState<string>("");
  const [validationResult, setValidationResult] = useState<any>(null); // = details
  const [vCodeStatus, setVCodeStatus] = useState<string | null>(null);  // USED | VOID | ACTIVE
  const [vWindowStatus, setVWindowStatus] = useState<string | null>(null); // IN_WINDOW | BEFORE_CHECKIN | AFTER_CHECKOUT
  const [vCanValidate, setVCanValidate] = useState<boolean>(false);
  const [vWindowReason, setVWindowReason] = useState<string | null>(null);
  const [loadingValidation, setLoadingValidation] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [vConfirming, setVConfirming] = useState(false);
  const [vSuccess, setVSuccess] = useState<{ bookingId: number; ownerName: string } | null>(null);
  const [vConfirmError, setVConfirmError] = useState<string | null>(null);
  const validationRef = useRef<HTMLDivElement | null>(null);
  // Notification-to-owner panel
  const [vNotifSubject, setVNotifSubject] = useState("");
  const [vNotifMsg, setVNotifMsg] = useState("");
  const [vNotifSending, setVNotifSending] = useState(false);
  const [vNotifSent, setVNotifSent] = useState<string | null>(null);
  const [vNotifError, setVNotifError] = useState<string | null>(null);
  const [vNotifOpen, setVNotifOpen] = useState(false);
  // Session timer (30 min countdown while modal is open)
  const [vSessionSecs, setVSessionSecs] = useState(1800);

  // Auto-lookup when validationCode changes (debounced)
  useEffect(() => {
    if (!validationCode || !validationCode.trim()) {
      setValidationResult(null); setValidationError(null); setVSuccess(null);
      setVCodeStatus(null); setVWindowStatus(null); setVCanValidate(false); setVWindowReason(null);
      return;
    }
    const t = setTimeout(async () => {
      setLoadingValidation(true); setValidationError(null); setValidationResult(null);
      setVSuccess(null); setVConfirmError(null);
      setVCodeStatus(null); setVWindowStatus(null); setVCanValidate(false); setVWindowReason(null);
      try {
        const res = await fetch(`${API}/api/admin/help-owners/validate`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: validationCode.trim() }),
        });
        const json = await res.json();
        if (!res.ok) {
          setValidationError(json?.error ?? "Code not found or invalid.");
        } else {
          setValidationResult(json.details ?? null);
          setVCodeStatus(json.codeStatus ?? null);
          setVWindowStatus(json.windowStatus ?? null);
          setVCanValidate(json.canValidate ?? false);
          setVWindowReason(json.windowReason ?? null);
          setValidationModalOpen(true);
        }
      } catch { setValidationError("Network error — could not reach server."); }
      finally { setLoadingValidation(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [validationCode]);

  async function vConfirmCheckin() {
    if (!validationResult?.bookingId) return;
    setVConfirming(true); setVConfirmError(null);
    try {
      const res = await fetch(`${API}/api/admin/help-owners/confirm-checkin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: validationResult.bookingId }),
      });
      const json = await res.json();
      if (!res.ok) { setVConfirmError(json?.error ?? "Confirmation failed."); }
      else {
        setVSuccess({ bookingId: validationResult.bookingId, ownerName: validationResult.property?.owner?.name ?? "Owner" });
        setValidationResult(null);
        sendAnalytics('admin.booking.checkin_confirmed', { bookingId: validationResult.bookingId });
      }
    } catch { setVConfirmError("Network error during confirmation."); }
    finally { setVConfirming(false); }
  }

  function vCloseModal() {
    setValidationModalOpen(false);
    setValidationCode("");
    setValidationResult(null);
    setValidationError(null);
    setVSuccess(null);
    setVConfirmError(null);
    setVCodeStatus(null);
    setVWindowStatus(null);
    setVCanValidate(false);
    setVWindowReason(null);
    setVNotifSubject(""); setVNotifMsg(""); setVNotifSent(null); setVNotifError(null); setVNotifOpen(false);
    setVSessionSecs(1800);
  }

  // Session countdown while modal is open
  useEffect(() => {
    if (!validationModalOpen) { setVSessionSecs(1800); return; }
    const id = setInterval(() => setVSessionSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [validationModalOpen]);

  async function vSendNotif() {
    const ownerId = validationResult?.property?.owner?.id;
    if (!ownerId || !vNotifSubject.trim() || !vNotifMsg.trim()) return;
    setVNotifSending(true); setVNotifError(null); setVNotifSent(null);
    try {
      const res = await fetch(`${API}/api/admin/owners/${ownerId}/notify`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: vNotifSubject.trim(), message: vNotifMsg.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setVNotifError(json?.error ?? "Failed to send."); }
      else { setVNotifSent("Notification sent to owner successfully."); setVNotifSubject(""); setVNotifMsg(""); }
    } catch { setVNotifError("Network error."); }
    finally { setVNotifSending(false); }
  }

  // Reusable booking details grid (shared across all modal states)
  function VBookingDetails({ d, accent = "#34d399" }: { d: any; accent?: string }) {
    const fmt = (iso: string | null | undefined) =>
      iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
    const fmtTs = (iso: string | null | undefined) =>
      iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
    return (
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: `${accent}18`, border: `1px solid ${accent}35` }}>
              <Building2 className="h-5 w-5" style={{ color: accent }} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: accent }}>Property</div>
              <div className="mt-1 truncate text-xl font-black tracking-tight text-white">{d.property?.title ?? "—"}</div>
            </div>
          </div>
          {d.property?.type ? (
            <span className="w-fit shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">
              {d.property.type}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/15 p-3.5">
            <CalendarDays className="h-4 w-4" style={{ color: accent }} />
            <div className="mt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Check-in</div>
            <div className="mt-1 text-sm font-extrabold text-white">{fmt(d.booking?.checkIn)}</div>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/15 p-3.5">
            <CalendarDays className="h-4 w-4" style={{ color: accent }} />
            <div className="mt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Check-out</div>
            <div className="mt-1 text-sm font-extrabold text-white">{fmt(d.booking?.checkOut)}</div>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/15 p-3.5">
            <Moon className="h-4 w-4" style={{ color: accent }} />
            <div className="mt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Nights</div>
            <div className="mt-1 text-sm font-extrabold text-white">{d.booking?.nights ?? "—"}</div>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/15 p-3.5">
            <WalletCards className="h-4 w-4" style={{ color: accent }} />
            <div className="mt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Amount</div>
            <div className="mt-1 break-words text-sm font-extrabold text-white">{d.booking?.currency ?? "TZS"} {Number(d.booking?.totalAmount ?? 0).toLocaleString()}</div>
          </div>
        </div>

        <div className="grid gap-3 border-t border-white/10 px-4 py-4 sm:grid-cols-2 sm:px-5 sm:py-5">
          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-slate-300">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Owner</div>
              <div className="mt-1 break-words text-sm font-bold text-white">{d.property?.owner?.name ?? "—"}</div>
              <div className="mt-1 break-words text-[11px] text-slate-500">{d.property?.owner?.phone ?? d.property?.owner?.email ?? ""}</div>
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-slate-300">
              <UserRound className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Guest</div>
              <div className="mt-1 break-words text-sm font-bold text-white">{d.guest?.fullName ?? d.customer?.name ?? "—"}</div>
              <div className="mt-1 break-words text-[11px] text-slate-500">{d.guest?.phone ?? d.customer?.phone ?? ""}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3 text-[10px] font-medium tabular-nums text-slate-500">
          <Clock3 className="h-3.5 w-3.5" />
          <span>Code generated {fmtTs(d.generatedAt)}</span>
        </div>
      </div>
    );
  }

  // totalInvoicesCount removed (not displayed in header anymore)
  
  // Global search removed (not used in current build)
  // confirmation modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<{ action: 'verify' | 'validate'; invId?: number | string } | null>(null);
  // property filter state (Approvals widget)
  const [propertyFilter, setPropertyFilter] = useState<'new' | 'pending' | 'approved' | 'rejected'>('pending');
  // invoice filter state (clickable cards) — only status-specific filters (no 'all')
  const [invoiceFilter, setInvoiceFilter] = useState<'new' | 'approved' | 'paid' | 'rejected'>('new');

  function openSection(status: 'new' | 'approved' | 'paid' | 'rejected') {
    setInvoiceFilter(status);
  }

  const loadApprovals = useCallback(async () => {
    setLoadingApprovals(true);
    try {
      const pageSize = Number(limits.approvals) || 6;
      const response = await fetch(`${API}/api/admin/properties?statuses=PENDING,SUSPENDED,APPROVED,REJECTED&page=1&pageSize=${pageSize * 4}&includeTotal=false`, { credentials: "include" });
      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const byStatus = (status: string) => items.filter((item: any) => String(item?.status || "").toUpperCase() === status).slice(0, pageSize);

      const pendingItems = byStatus("PENDING");
      const suspendedItems = byStatus("SUSPENDED");
      const approvedItems = byStatus("APPROVED");
      const rejectedItems = byStatus("REJECTED");
      setPropNew({ items: pendingItems, total: pendingItems.length });
      setPropPending({ items: suspendedItems, total: suspendedItems.length });
      setPropApproved({ items: approvedItems, total: approvedItems.length });
      setPropRejected({ items: rejectedItems, total: rejectedItems.length });
    } catch (e: any) {
      setPropNew({ items: [], total: 0 });
      setPropPending({ items: [], total: 0 });
      setPropApproved({ items: [] });
      setPropRejected({ items: [] });
    } finally {
      setLoadingApprovals(false);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setLoadingInv(true);
    try {
      const invoiceLimit = Number(limits.invoices) || 5;
      const [rNew, rApproved, rPaid, rRejected] = await Promise.all([
        fetch(`${API}/admin/revenue/invoices?statuses=REQUESTED,VERIFIED&page=1&pageSize=${invoiceLimit}&includeTotal=false`, { credentials: "include" }),
        fetch(`${API}/admin/revenue/invoices?status=APPROVED&page=1&pageSize=${invoiceLimit}&includeTotal=false`, { credentials: "include" }),
        fetch(`${API}/admin/revenue/invoices?status=PAID&page=1&pageSize=${invoiceLimit}&includeTotal=false`, { credentials: "include" }),
        fetch(`${API}/admin/revenue/invoices?status=REJECTED&page=1&pageSize=${invoiceLimit}&includeTotal=false`, { credentials: "include" }),
      ]);
      const jNew = await rNew.json();
      const jApproved = await rApproved.json();
      const jPaid = await rPaid.json();
      const jRejected = await rRejected.json();
      setInvNew(jNew ?? { items: [] });
      setInvApproved(jApproved ?? { items: [] });
      setInvPaid(jPaid ?? { items: [] });
      setInvRejected(jRejected ?? { items: [] });
    } catch {
      setInvNew({ items: [] });
      setInvApproved({ items: [] });
      setInvPaid({ items: [] });
      setInvRejected({ items: [] });
    } finally {
      setLoadingInv(false);
    }
  }, []);

  const loadKpis = useCallback(async () => {
    setLoadingKpis(true);
    try {
      const res = await fetch(
        `${API}/admin/stats/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { credentials: "include" }
      );
      const json = await res.json();
      setOverview(json);
    } catch {
      setOverview(null);
    } finally {
      setLoadingKpis(false);
    }
  }, [from, to]);

  

  useEffect(() => { loadKpis(); }, [loadKpis]);
  useEffect(() => { loadApprovals(); loadInvoices(); }, [loadApprovals, loadInvoices]);

  // export helpers removed for compact overview

  // Refresh KPIs and invoices when payments land
  useEffect(() => {
    // For WebSocket connections, we need to connect directly to the API server
    // because Next.js rewrites don't support WebSocket upgrades
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || 
                process.env.NEXT_PUBLIC_API_URL || 
                (typeof window !== 'undefined' ? "http://localhost:4000" : "");
    
    if (!url) {
      console.warn("Socket.IO: No API URL configured, skipping connection");
      return;
    }
    
    const s: Socket = io(url, {
      transports: ['websocket', 'polling'],
      withCredentials: true, // Send cookies automatically
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    
    s.on('connect', () => {
      console.debug('[Socket.IO] Connected to admin room');
      // Join admin room after connection
      s.emit('join-admin-room', (response: any) => {
        if (response?.error) {
          console.warn('[Socket.IO] Failed to join admin room:', response.error);
        } else {
          console.debug('[Socket.IO] Joined admin room');
        }
      });
    });
    
    s.on('connect_error', (error: Error) => {
      console.warn('[Socket.IO] Connection error:', error.message);
    });
    
    s.on('disconnect', (reason: string) => {
      console.log('[Socket.IO] Disconnected:', reason);
    });
    
    const onPaid = () => { loadKpis(); loadInvoices(); };
    s.on("admin:invoice:paid", onPaid);
    
    return () => { 
      s.off("admin:invoice:paid", onPaid);
      s.emit('leave-admin-room', () => {});
      s.disconnect();
    };
  }, [loadKpis, loadInvoices]);

  // Persist selected date range and widget limits
  useEffect(() => { try { localStorage.setItem("admin.range", range); } catch {} }, [range]);
  // compact chartRange persistence removed
  // limits is read-only here; persisted elsewhere if needed

  // Global search removed


  // small confirm modal component (accessible)
  function ConfirmModal({ open, title, onConfirm, onCancel }: { open: boolean; title: string; onConfirm: ()=>void; onCancel: ()=>void; }) {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
        <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-lg p-4 z-10 w-full max-w-md shadow-lg">
          <div className="font-medium mb-2">{title}</div>
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1 rounded bg-gray-100">Cancel</button>
            <button autoFocus onClick={onConfirm} className="px-3 py-1 rounded bg-brand text-white">Confirm</button>
          </div>
        </div>
      </div>
    );
  }

  async function handleConfirm() {
    if (!confirmPayload) return;
    const { action, invId } = confirmPayload;
    setConfirmOpen(false);
    try {
      if (action === 'verify') {
        await fetch(`${API}/admin/revenue/invoices/${invId}/verify`, { method: 'POST', credentials: "include", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'Verified from dashboard' }) });
      } else if (action === 'validate') {
        await fetch(`${API}/admin/revenue/invoices/${invId}/verify`, { method: 'POST', credentials: "include", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'Validated from dashboard' }) });
      }
    } catch {
      // ignore
    } finally {
      loadInvoices();
      loadKpis();
      setConfirmPayload(null);
    }
  }

  // search helpers removed

  

  return (
    <div className="space-y-6">
      <ConfirmModal open={confirmOpen} title={confirmPayload?.action === 'validate' ? 'Confirm validation' : 'Confirm verification'} onConfirm={handleConfirm} onCancel={() => { setConfirmOpen(false); setConfirmPayload(null); }} />
      {/* ── Premium Dashboard Header + KPI banner ── */}
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)" }}
      >
        {/* Decorative sparkline viz */}
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 900 260"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="870" cy="50"  r="220" stroke="white" strokeOpacity="0.055" strokeWidth="1" fill="none" />
          <circle cx="870" cy="50"  r="168" stroke="white" strokeOpacity="0.048" strokeWidth="1" fill="none" />
          <circle cx="830" cy="18"  r="125" stroke="white" strokeOpacity="0.042" strokeWidth="1" fill="none" />
          <circle cx="28"  cy="245" r="145" stroke="white" strokeOpacity="0.038" strokeWidth="1" fill="none" />
          {[52, 104, 156, 208].map((y) => (
            <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="rgba(255,255,255,0.028)" strokeWidth="1" />
          ))}
          <polyline
            points="0,218 80,195 160,208 240,172 320,188 400,150 480,166 560,128 640,145 720,108 800,124 880,90"
            fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
          <polygon
            points="0,218 80,195 160,208 240,172 320,188 400,150 480,166 560,128 640,145 720,108 800,124 880,90 900,260 0,260"
            fill="white" fillOpacity="0.025"
          />
          <polyline
            points="0,232 100,218 200,226 300,205 400,214 500,194 600,202 700,182 800,190 900,170"
            fill="none" stroke="white" strokeOpacity="0.065" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          />
          {([[720,108],[560,128],[880,90],[240,172]] as [number,number][]).map(([px,py]) => (
            <circle key={`${px}-${py}`} cx={px} cy={py} r="3.5" fill="white" fillOpacity="0.22" />
          ))}
          <radialGradient id="dashHeaderGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(10,92,130,0.45)" />
            <stop offset="100%" stopColor="rgba(10,92,130,0)" />
          </radialGradient>
          <ellipse cx="450" cy="130" rx="320" ry="160" fill="url(#dashHeaderGlow)" />
        </svg>

        {/* Content */}
        <div className="relative z-10 px-6 pt-8 pb-7 sm:px-8 sm:pt-10">
          {/* Title row */}
          <div className="flex items-center gap-3 mb-6">
            <div
              className="inline-flex items-center justify-center rounded-xl flex-shrink-0"
              style={{
                width: 46, height: 46,
                background: "rgba(255,255,255,0.10)",
                border: "1.5px solid rgba(255,255,255,0.18)",
                boxShadow: "0 0 0 6px rgba(255,255,255,0.04)",
              }}
            >
              <LayoutDashboard className="h-5 w-5" style={{ color: "rgba(255,255,255,0.90)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: "#fff", textShadow: "0 2px 10px rgba(0,0,0,0.35)" }}>
                Owners Control Dashboard
              </h1>
              <p className="text-xs sm:text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.48)" }}>
                Live overview of platform activity
              </p>
            </div>
          </div>

          {/* KPI chips */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {loadingKpis ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-xl h-20"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.08)" }}
                />
              ))
            ) : (
              [
                { label: "No. Owners",      value: String(overview?.ownersCount ?? overview?.ownerCount ?? 0),                                               accent: "rgba(56,189,248,0.22)",  border: "rgba(56,189,248,0.35)",  text: "#7dd3fc",  mask: false },
                { label: "No. Properties",  value: String(overview?.propertiesCount ?? overview?.propertyCount ?? 0),                                        accent: "rgba(16,185,129,0.20)",  border: "rgba(16,185,129,0.32)",  text: "#6ee7b7",  mask: false },
                { label: "Total Payment",   value: fmt(overview?.totalPayment ?? 0),                                                                          accent: "rgba(245,158,11,0.18)",  border: "rgba(245,158,11,0.30)",  text: "#fcd34d",  mask: true  },
                { label: "Net Payable",     value: fmt(overview?.ownerPayouts ?? overview?.netPayable ?? 0),                                                  accent: "rgba(239,68,68,0.18)",   border: "rgba(239,68,68,0.30)",   text: "#fca5a5",  mask: true  },
                { label: "NoLSAF Revenue",  value: fmt(overview?.companyRevenue ?? overview?.nolsRevenue ?? 0),                                               accent: "rgba(99,102,241,0.20)",  border: "rgba(99,102,241,0.32)",  text: "#a5b4fc",  mask: true  },
              ].map(({ label, value, accent, border, text, mask }) => {
                const revealed = revealedCards.has(label);
                const toggle = () => setRevealedCards(prev => {
                  const next = new Set(prev);
                  if (revealed) { next.delete(label); } else { next.add(label); }
                  return next;
                });
                return (
                  <div
                    key={label}
                    className="rounded-xl px-4 py-3"
                    style={{ background: accent, border: `1px solid ${border}` }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.42)" }}>{label}</p>
                      {mask && (
                        <button onClick={toggle} className="p-0 leading-none opacity-40 hover:opacity-80 transition-opacity" style={{ background: 'none', border: 'none' }}>
                          {revealed ? <EyeOff className="h-3 w-3" style={{ color: text }} /> : <Eye className="h-3 w-3" style={{ color: text }} />}
                        </button>
                      )}
                    </div>
                    <p className="text-xl sm:text-2xl font-black tabular-nums leading-none select-none" style={{ color: text }}>
                      {mask && !revealed ? '••••••' : value}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Compact invoice status controls: moved into the Invoices section header below; removed large summary cards */}

      {/* Needs attention + Quick links (3-column grid; needs attention spans 2) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Needs attention */}
        <div className="lg:col-span-2 card">
          <div className="card-section">
            {/* Three columns inside: Approvals, Invoices, Bookings */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 divide-y-2 divide-brand md:divide-y-0 md:divide-x md:divide-gray-200">
              {/* Approvals */}
              <div className="md:pr-4 md:border-r-2 md:border-gray-300">
                <div className="flex items-center mb-2">
                  <div className="flex items-center gap-2 font-medium text-gray-800">
                    <FileBadge className="h-4 w-4" /> Approvals
                  </div>
                </div>
                <div className="flex">
                  {/* Vertical status controls, confined to the approvals box */}
                  <div className="w-28 pr-3 hidden md:flex flex-col items-start gap-3 border-r border-gray-100">
                    <div className="pt-0.5" />
                    <div className="flex flex-col items-start gap-2 mt-1">
                      <button
                        onClick={() => setPropertyFilter('new')}
                        className={`w-full px-2 py-1 rounded text-xs flex items-center justify-between ${propertyFilter==='new' ? 'bg-gray-100 text-gray-800' : 'hover:bg-gray-50'}`}
                      >
                        <span className="truncate">New</span>
                        <span className="ml-2 text-[11px] text-gray-500">{propNew?.total ?? (propNew?.items?.length ?? 0)}</span>
                      </button>
                      <button
                        onClick={() => setPropertyFilter('pending')}
                        className={`w-full px-2 py-1 rounded text-xs flex items-center justify-between ${propertyFilter==='pending' ? 'bg-yellow-100 text-yellow-800' : 'hover:bg-gray-50'}`}
                      >
                        <span className="truncate">Pending</span>
                        <span className="ml-2 text-[11px] text-gray-500">{propPending?.total ?? (propPending?.items?.length ?? 0)}</span>
                      </button>
                      <button
                        onClick={() => setPropertyFilter('approved')}
                        className={`w-full px-2 py-1 rounded text-xs flex items-center justify-between ${propertyFilter==='approved' ? 'bg-green-100 text-green-800' : 'hover:bg-gray-50'}`}
                      >
                        <span className="truncate">Approved</span>
                        <span className="ml-2 text-[11px] text-gray-500">{propApproved?.total ?? (propApproved?.items?.length ?? 0)}</span>
                      </button>
                      <button
                        onClick={() => setPropertyFilter('rejected')}
                        className={`w-full px-2 py-1 rounded text-xs flex items-center justify-between ${propertyFilter==='rejected' ? 'bg-red-100 text-red-800' : 'hover:bg-gray-50'}`}
                      >
                        <span className="truncate">Rejected</span>
                        <span className="ml-2 text-[11px] text-gray-500">{propRejected?.total ?? (propRejected?.items?.length ?? 0)}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 pl-3">
                    <div className="mb-3" />
                    {loadingApprovals ? (
                      <div className="space-y-2">{Array.from({ length: 4 }).map((_,i) => <div key={i} className="skeleton h-8" />)}</div>
                    ) : (
                      <div className="min-w-0" />
                    )}
                  </div>
                </div>
              </div>

              {/* Invoices grouped by status */}
              <div className="md:px-4">
                <div className="flex items-center mb-2">
                  <div className="flex items-center gap-2 font-medium text-gray-800">
                    <FileCheck2 className="h-4 w-4" /> Invoices
                  </div>
                </div>
                <div className="flex">
                  {/* Vertical status controls, confined to the invoices box */}
                  <div className="w-28 pr-3 hidden md:flex flex-col items-start gap-3 border-r border-gray-100">
                    <div className="pt-0.5" />
                    <div className="flex flex-col items-start gap-2 mt-1">
                      <button onClick={() => openSection('new')} className={`w-full px-2 py-1 rounded text-xs flex items-center justify-between ${invoiceFilter==='new' ? 'bg-yellow-100 text-yellow-800' : 'hover:bg-gray-50'}`}>
                        <span className="truncate">New</span>
                        <span className="ml-2 text-[11px] text-gray-500">{invNew?.items?.length ?? 0}</span>
                      </button>
                      <button onClick={() => openSection('approved')} className={`w-full px-2 py-1 rounded text-xs flex items-center justify-between ${invoiceFilter==='approved' ? 'bg-green-100 text-green-800' : 'hover:bg-gray-50'}`}>
                        <span className="truncate">Approved</span>
                        <span className="ml-2 text-[11px] text-gray-500">{invApproved?.items?.length ?? 0}</span>
                      </button>
                      <button onClick={() => openSection('paid')} className={`w-full px-2 py-1 rounded text-xs flex items-center justify-between ${invoiceFilter==='paid' ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-50'}`}>
                        <span className="truncate">Paid</span>
                        <span className="ml-2 text-[11px] text-gray-500">{invPaid?.items?.length ?? 0}</span>
                      </button>
                      <button onClick={() => openSection('rejected')} className={`w-full px-2 py-1 rounded text-xs flex items-center justify-between ${invoiceFilter==='rejected' ? 'bg-red-100 text-red-800' : 'hover:bg-gray-50'}`}>
                        <span className="truncate">Rejected</span>
                        <span className="ml-2 text-[11px] text-gray-500">{invRejected?.items?.length ?? 0}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 pl-3">
                    {/* Validation input is shown in its own column below; placeholder here remains empty */}
                    <div className="mb-3" />
                    {/* header left intentionally empty; icon+label shown to the left to avoid duplication */}

                    {loadingInv ? (
                      <div className="space-y-2">{Array.from({ length: 4 }).map((_,i) => <div key={i} className="skeleton h-8" />)}</div>
                    ) : (
                      <div className="min-w-0" />
                    )}
                  </div>
                </div>
              </div>

              {/* Validation column */}
              {/* Third column */}
              <div className="md:pl-4 md:border-l-2 md:border-gray-200">
                <div className="flex items-center mb-3">
                  <div className="flex items-center gap-2 font-semibold text-gray-800">
                    <FileCheck2 className="h-5 w-5 text-blue-600" /> Validation
                  </div>
                </div>
                <div ref={validationRef} className="min-w-0 space-y-3 overflow-hidden">
                  {/* Input field */}
                  <div className="flex justify-center w-full">
                    <input
                      value={validationCode}
                      onChange={(e) => setValidationCode(e.target.value)}
                      placeholder="Paste validation code"
                      className="w-full max-w-xs px-4 py-2.5 text-sm font-mono tracking-wider border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all duration-200 placeholder:text-gray-400 bg-white text-center"
                      aria-label="Validation code"
                    />
                  </div>

                  {/* Loading state */}
                  {loadingValidation && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <div className="flex gap-1">
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce" />
                      </div>
                      <span>Checking code…</span>
                    </div>
                  )}

                  {/* Error inline */}
                  {validationError && !loadingValidation && (
                    <div className="w-full rounded-lg bg-red-50 border border-red-200 p-3 animate-in fade-in duration-200">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <p className="text-sm text-red-700">{validationError}</p>
                      </div>
                    </div>
                  )}

                  {/* Preview found — prompt to open popup */}
                  {validationResult && !loadingValidation && !validationModalOpen && (
                    <button
                      type="button"
                      onClick={() => setValidationModalOpen(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow transition-all active:scale-95"
                    >
                      <ShieldCheck className="h-4 w-4" /> View &amp; Confirm
                    </button>
                  )}
                </div>
              </div>

              {/* ── Booking Validation Popup Modal ── */}
              {validationModalOpen && createPortal((() => {
                const d = validationResult;
                const fmtTs = (iso: string | null | undefined) =>
                  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

                const isUsed   = vCodeStatus === "USED";
                const isVoid   = vCodeStatus === "VOID";
                const isBefore = vCodeStatus === "ACTIVE" && vWindowStatus === "BEFORE_CHECKIN";
                const isAfter  = vCodeStatus === "ACTIVE" && vWindowStatus === "AFTER_CHECKOUT";
                const canGo    = vCodeStatus === "ACTIVE" && vCanValidate;

                // Session timer display
                const sessionMm = String(Math.floor(vSessionSecs / 60)).padStart(2, "0");
                const sessionSs = String(vSessionSecs % 60).padStart(2, "0");
                const sessionWarn = vSessionSecs < 120;

                // Accent colors per state
                const accentColor = isUsed ? "#38bdf8" : isVoid ? "#f87171" : (isBefore || isAfter) ? "#fbbf24" : "#34d399";
                const modalBg = isUsed
                  ? "linear-gradient(155deg,#060f1e 0%,#091928 55%,#020e0a 100%)"
                  : isVoid
                  ? "linear-gradient(155deg,#120505 0%,#1e0808 55%,#080a0d 100%)"
                  : (isBefore || isAfter)
                  ? "linear-gradient(155deg,#100b04 0%,#1a1204 55%,#080a0d 100%)"
                  : "linear-gradient(155deg,#060f1e 0%,#071e28 45%,#011a10 100%)";

                const badgeEl = isUsed
                  ? <span className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/15 px-2.5 py-1 text-[10px] font-bold text-sky-300 uppercase tracking-widest"><CheckCheck className="h-3 w-3" />Already Validated</span>
                  : isVoid
                  ? <span className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-[10px] font-bold text-red-300 uppercase tracking-widest"><X className="h-3 w-3" />{d?.cancellation ? "Cancelled" : "Voided"}</span>
                  : (isBefore || isAfter)
                  ? <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/12 px-2.5 py-1 text-[10px] font-bold text-amber-300 uppercase tracking-widest"><AlertTriangle className="h-3 w-3" />{isBefore ? "Awaiting Check-in" : "After Checkout"}</span>
                  : <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/12 px-2.5 py-1 text-[10px] font-bold text-emerald-300 uppercase tracking-widest"><ShieldCheck className="h-3 w-3" />Ready to Validate</span>;

                // State-aware suggested reply for the notify-owner panel
                const vOwnerFirst = (d?.property?.owner?.name ?? "there").split(" ")[0];
                const vBookingRef = d?.bookingId ? `booking #${d.bookingId}` : "this booking";
                const vCodeUp = validationCode.toUpperCase();
                const vSuggested = isUsed
                  ? {
                      subject: `Your ${vBookingRef} is already validated`,
                      message: `Hello ${vOwnerFirst}, we reviewed code ${vCodeUp} and it was already validated on ${fmtTs(d?.usedAt)}. The guest check-in is confirmed in the system and no further action is needed. If you did not perform this validation, please reply to us immediately.`,
                    }
                  : isVoid
                  ? {
                      subject: `Code for ${vBookingRef} is no longer valid`,
                      message: d?.cancellation
                        ? `Hello ${vOwnerFirst}, code ${vCodeUp} cannot be validated because this booking has a cancellation on record (status: ${d.cancellation.status}). Please do not check the guest in with this code. Contact us if you need help with this booking.`
                        : `Hello ${vOwnerFirst}, code ${vCodeUp} has been voided and can no longer be used for check-in. Please contact us if you believe this is a mistake.`,
                    }
                  : isBefore
                  ? {
                      subject: `Check-in for ${vBookingRef} is not open yet`,
                      message: `Hello ${vOwnerFirst}, code ${vCodeUp} is valid but the stay has not started. Check-in opens on ${d?.booking?.checkIn ? new Date(d.booking.checkIn).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "the check-in date"}. Please validate the code again on that day when the guest arrives.`,
                    }
                  : isAfter
                  ? {
                      subject: `Checkout date for ${vBookingRef} has passed`,
                      message: `Hello ${vOwnerFirst}, code ${vCodeUp} could not be validated because the checkout date has already passed. If the guest actually stayed, please contact us so we can review and resolve this booking.`,
                    }
                  : null;

                return (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
                    style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(16px)" }}
                    role="dialog" aria-modal="true" aria-label="Booking Validation"
                    onClick={(e) => { if (e.target === e.currentTarget) vCloseModal(); }}
                  >
                    <div
                      className="relative flex w-full max-w-[760px] flex-col overflow-hidden rounded-[30px]"
                      style={{
                        background: modalBg,
                        boxShadow: `0 40px 100px -24px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.08), 0 0 60px -20px ${accentColor}28, inset 0 1px 0 rgba(255,255,255,0.09)`,
                        maxHeight: "min(860px, 92vh)",
                      }}
                    >
                      {/* Top accent bar */}
                      <div className="h-[2px] w-full flex-shrink-0" style={{ background: `linear-gradient(90deg, transparent 5%, ${accentColor}90 50%, transparent 95%)` }} />

                      {/* Header — 2-row, fixed */}
                      <div className="flex-shrink-0 px-5 pb-4 pt-5 sm:px-7" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                        {/* Row 1: icon + title + close */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl"
                              style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}35` }}>
                              <ShieldCheck className="h-5 w-5" style={{ color: accentColor }} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-base font-extrabold tracking-tight text-white sm:text-lg">Booking Code Verification</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px] text-slate-400 font-mono tracking-[0.15em]">{validationCode.toUpperCase()}</span>
                                {d?.bookingId && (
                                  <span className="inline-flex items-center rounded-md border border-white/10 bg-white/6 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                                    #{d.bookingId}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <button type="button" onClick={vCloseModal}
                            className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition"
                            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                            aria-label="Close"><X className="h-3.5 w-3.5 text-white" /></button>
                        </div>
                        {/* Row 2: status badge + session timer */}
                        <div className="flex items-center justify-between mt-2.5 gap-2">
                          {badgeEl}
                          <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-mono tabular-nums font-semibold flex-shrink-0 ${
                            sessionWarn ? "bg-red-500/15 border border-red-500/25 text-red-300" : "bg-white/5 border border-white/8 text-slate-500"
                          }`}>
                            <span className="text-[9px] opacity-60 uppercase tracking-wider">session</span>
                            <span>{sessionMm}:{sessionSs}</span>
                          </div>
                        </div>
                      </div>

                      {/* Body — scrollable between fixed header and footer so no content is ever clipped */}
                      <div
                        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-5 sm:px-7"
                        style={{ overscrollBehavior: "contain", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.18) transparent" }}
                      >

                        {/* ─ POST-CONFIRM SUCCESS ─ */}
                        {vSuccess ? (
                          <div className="space-y-4">
                            <div className="flex flex-col items-center gap-3 py-6 text-center">
                              {/* Animated ring */}
                              <div className="relative">
                                <div className="absolute inset-0 rounded-full animate-ping" style={{ background: "rgba(52,211,153,0.15)" }} />
                                <div className="relative h-16 w-16 rounded-full border-2 border-emerald-500/50 bg-emerald-500/15 flex items-center justify-center">
                                  <CheckCheck className="h-8 w-8 text-emerald-400" />
                                </div>
                              </div>
                              <div>
                                <p className="text-lg font-extrabold text-emerald-300 tracking-tight">Check-in Confirmed!</p>
                                <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                                  Booking <span className="font-mono font-bold text-white">#{vSuccess.bookingId}</span> check-in confirmed on behalf of owner{" "}
                                  <span className="font-bold text-white">{vSuccess.ownerName}</span>
                                </p>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">
                                <Bell className="h-3.5 w-3.5 flex-shrink-0" />
                                <span>Owner notified automatically via the system</span>
                              </div>
                            </div>

                            {/* Post-confirm: send additional note to owner, same table style as the booking details card */}
                            <div className="space-y-2.5">
                              <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.035)" }}>
                                {/* Header row with accent bar */}
                                <div className="px-4 py-3" style={{ borderLeft: "3px solid #34d399", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="text-[9px] font-bold uppercase tracking-widest mb-1 text-emerald-400">Owner Notification</div>
                                      <div className="text-[13px] font-extrabold text-white leading-tight">Send a note to the owner</div>
                                      <div className="mt-0.5 text-[10px] text-slate-500">Delivered instantly to the owner inside the system</div>
                                    </div>
                                    <span className="text-[10px] text-slate-500 font-medium flex-shrink-0">Optional</span>
                                  </div>
                                </div>
                                {vNotifSent ? (
                                  <div className="flex items-center gap-2 px-3.5 py-3">
                                    <CheckCheck className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                                    <span className="text-xs text-emerald-300">{vNotifSent}</span>
                                  </div>
                                ) : (
                                  <>
                                    {/* To / Regarding */}
                                    <div className="grid grid-cols-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                                      <div className="px-3.5 py-2.5" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">To</div>
                                        <div className="text-xs font-bold text-white leading-snug break-words">{vSuccess.ownerName}</div>
                                      </div>
                                      <div className="px-3.5 py-2.5">
                                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Regarding</div>
                                        <div className="text-xs font-bold text-white leading-snug">Booking #{vSuccess.bookingId}</div>
                                        <div className="text-[10px] text-slate-500 mt-0.5 font-mono tracking-wider">{vCodeUp}</div>
                                      </div>
                                    </div>
                                    {/* Suggested message row */}
                                    <button type="button"
                                      onClick={() => {
                                        setVNotifSubject(`Check-in confirmed for booking #${vSuccess.bookingId}`);
                                        setVNotifMsg(`Hello ${String(vSuccess.ownerName ?? "there").split(" ")[0]}, we validated code ${vCodeUp} and confirmed the guest check-in for booking #${vSuccess.bookingId} on your behalf. The booking is now marked as checked in. No further action is needed.`);
                                      }}
                                      className="w-full px-3.5 py-2.5 text-left transition hover:brightness-125"
                                      style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(52,211,153,0.04)" }}>
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5">
                                          <Bell className="h-3 w-3 flex-shrink-0 text-emerald-400" />
                                          <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400">Suggested message</span>
                                        </div>
                                        <span className="text-[9px] font-semibold uppercase tracking-wider rounded-md px-1.5 py-0.5 flex-shrink-0 text-emerald-400" style={{ border: "1px solid rgba(52,211,153,0.35)" }}>Tap to fill</span>
                                      </div>
                                      <div className="text-xs font-semibold text-white mt-1.5 leading-snug break-words">Check-in confirmed for booking #{vSuccess.bookingId}</div>
                                      <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed break-words">A ready-to-send confirmation note for the owner. Tap to fill, then edit freely before sending.</div>
                                    </button>
                                    {/* Subject cell */}
                                    <div className="px-3.5 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Subject</div>
                                      <input value={vNotifSubject} onChange={e => setVNotifSubject(e.target.value)}
                                        placeholder="e.g. Check-in confirmed"
                                        className="w-full bg-transparent text-xs font-semibold text-white placeholder:text-slate-600 outline-none" />
                                    </div>
                                    {/* Message cell */}
                                    <div className="px-3.5 py-2.5">
                                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Message</div>
                                      <textarea value={vNotifMsg} onChange={e => setVNotifMsg(e.target.value)} rows={4}
                                        placeholder="Write the note the owner will receive..."
                                        className="w-full bg-transparent text-xs text-white placeholder:text-slate-600 outline-none resize-none leading-relaxed" />
                                    </div>
                                  </>
                                )}
                              </div>
                              {!vNotifSent && (
                                <>
                                  {vNotifError && (
                                    <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2">
                                      <AlertTriangle className="h-3 w-3 text-red-400 flex-shrink-0" />
                                      <p className="text-[11px] text-red-400">{vNotifError}</p>
                                    </div>
                                  )}
                                  <button type="button" onClick={vSendNotif} disabled={vNotifSending || !vNotifSubject.trim() || !vNotifMsg.trim()}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ background: "rgba(52,211,153,0.14)", border: "1px solid rgba(52,211,153,0.3)", color: "#6ee7b7" }}
                                    onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "rgba(52,211,153,0.24)"; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(52,211,153,0.14)"; }}>
                                    {vNotifSending
                                      ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Sending...</>
                                      : <><Bell className="h-3.5 w-3.5" /> Send to {vSuccess.ownerName}</>}
                                  </button>
                                </>
                              )}
                            </div>

                            <button type="button" onClick={vCloseModal}
                              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-slate-300 text-sm font-semibold transition"
                              style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}
                              onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.55)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.35)"; }}>
                              Done
                            </button>
                          </div>

                        ) : d ? (
                          <div className="space-y-4">
                            <VBookingDetails d={d} accent={accentColor} />

                            {/* ─ USED ─ */}
                            {isUsed && (
                              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/8 p-4 space-y-3">
                                <div className="flex items-center gap-2">
                                  <CheckCheck className="h-4 w-4 text-sky-400 flex-shrink-0" />
                                  <p className="text-sm font-bold text-sky-300">This code has already been validated</p>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
                                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Validated at</div>
                                    <div className="font-semibold text-white leading-snug">{fmtTs(d.usedAt)}</div>
                                  </div>
                                  <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
                                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Validated by</div>
                                    <div className="font-semibold text-white break-words">{d.usedBy?.name ?? d.property?.owner?.name ?? "—"}</div>
                                    <div className="text-[10px] text-slate-500 break-words">{d.usedBy?.phone ?? d.property?.owner?.phone ?? ""}</div>
                                  </div>
                                </div>
                                <div className="flex items-start gap-2 rounded-xl bg-sky-500/6 border border-sky-500/15 px-3 py-2.5">
                                  <Bell className="h-3.5 w-3.5 text-sky-400 flex-shrink-0 mt-0.5" />
                                  <p className="text-[11px] text-sky-300/80 leading-relaxed">
                                    This booking was validated on <span className="font-semibold text-sky-200">{fmtTs(d.usedAt)}</span> and the guest check-in is confirmed in the system. No further action is needed. If the owner asks about this code, use the notify panel below to send them a ready-made reply.
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* ─ VOID ─ */}
                            {isVoid && (
                              <div className="rounded-2xl border border-red-500/20 bg-red-500/6 p-4 space-y-3">
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
                                  <p className="text-sm font-bold text-red-300">{d.cancellation ? "Booking Cancellation" : "Code Voided"}</p>
                                </div>
                                {d.cancellation ? (
                                  <div className="space-y-2 text-xs">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
                                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Status</div>
                                        <div className="font-bold text-red-300 uppercase tracking-wide">{d.cancellation.status}</div>
                                      </div>
                                      <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
                                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Requested at</div>
                                        <div className="font-semibold text-white leading-snug">{fmtTs(d.cancellation.createdAt)}</div>
                                      </div>
                                    </div>
                                    {d.cancellation.reason && (
                                      <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
                                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Reason</div>
                                        <p className="text-white/85 leading-relaxed">{d.cancellation.reason}</p>
                                      </div>
                                    )}
                                    {d.cancellation.policyRefundPercent != null && (
                                      <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2.5">
                                        <span className="text-[11px] text-amber-300 font-semibold">{d.cancellation.policyRefundPercent}% refund</span>
                                        {d.cancellation.policyRule && <span className="text-[10px] text-amber-300/60">· {d.cancellation.policyRule}</span>}
                                      </div>
                                    )}
                                    {d.cancellation.decisionNote && (
                                      <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
                                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Admin decision note</div>
                                        <p className="text-slate-300 text-[11px] leading-relaxed">{d.cancellation.decisionNote}</p>
                                      </div>
                                    )}
                                    {d.cancellation.requestedBy && (
                                      <p className="text-[10px] text-slate-500 pt-1">Requested by: <span className="text-slate-300 font-semibold">{d.cancellation.requestedBy.name}</span>{d.cancellation.requestedBy.email ? ` · ${d.cancellation.requestedBy.email}` : ""}</p>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-2 text-xs">
                                    {d.voidedAt && (
                                      <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
                                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Voided at</div>
                                        <div className="font-semibold text-white">{fmtTs(d.voidedAt)}</div>
                                      </div>
                                    )}
                                    {d.voidReason && (
                                      <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
                                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Void reason</div>
                                        <p className="text-white/85 leading-relaxed">{d.voidReason}</p>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* ─ BEFORE / AFTER ─ */}
                            {(isBefore || isAfter) && (
                              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/6 p-4 space-y-2.5">
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
                                  <p className="text-sm font-bold text-amber-300">
                                    {isBefore ? "Booking Is Valid — Check-in Not Yet Reached" : "Check-out Date Has Passed"}
                                  </p>
                                </div>
                                <p className="text-xs text-amber-200/75 leading-relaxed">{vWindowReason}</p>
                                {isBefore && (
                                  <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5 text-xs">
                                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Check-in opens on</div>
                                    <div className="font-bold text-white">{d.booking?.checkIn ? new Date(d.booking.checkIn).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "—"}</div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* ─ IN WINDOW: confirm ─ */}
                            {canGo && (
                              <div className="space-y-3">
                                {vConfirmError && (
                                  <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                                    <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-sm text-red-300">{vConfirmError}</p>
                                  </div>
                                )}
                                <button type="button" onClick={vConfirmCheckin} disabled={vConfirming}
                                  className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl font-bold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
                                  style={{
                                    background: "linear-gradient(135deg,rgba(16,185,129,0.25) 0%,rgba(5,150,105,0.18) 100%)",
                                    border: "1px solid rgba(52,211,153,0.3)",
                                    color: "#6ee7b7",
                                    boxShadow: "0 0 50px -20px rgba(52,211,153,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
                                  }}
                                >
                                  {vConfirming
                                    ? <><RefreshCw className="h-4 w-4 animate-spin" /> Confirming check-in…</>
                                    : <><ShieldCheck className="h-4.5 w-4.5" /> Confirm Check-in for {d.property?.owner?.name ?? "Owner"}</>}
                                </button>
                                <p className="text-center text-[10px] text-slate-600">Owner will be notified immediately upon confirmation.</p>
                              </div>
                            )}

                            {/* ─ NOTIFY OWNER PANEL (all non-confirmable states) ─ */}
                            {!canGo && d?.property?.owner?.id && (
                              <div className="space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "12px" }}>
                                <button type="button" onClick={() => setVNotifOpen(v => !v)}
                                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition"
                                  style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.50)')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.35)')}>
                                  <div className="flex items-center gap-2.5">
                                    <div className="h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0"
                                      style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.07)' }}>
                                      <Bell className="h-3 w-3 text-slate-500" />
                                    </div>
                                    <div className="text-left">
                                      <div className="text-xs font-semibold text-slate-300 tracking-wide">Notify owner directly</div>
                                      <div className="text-[10px] text-slate-600 mt-0.5">Send a quick note about this verification result</div>
                                    </div>
                                  </div>
                                  {vNotifOpen
                                    ? <ChevronUp className="h-3.5 w-3.5 text-slate-600" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
                                  }
                                </button>

                                {vNotifOpen && (
                                  vNotifSent ? (
                                    <div className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-3 text-xs text-emerald-300">
                                      <CheckCheck className="h-3.5 w-3.5 flex-shrink-0" /> {vNotifSent}
                                    </div>
                                  ) : (
                                    <div className="space-y-2.5">
                                      {/* Unified compose card, same table style as the booking details card */}
                                      <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.035)" }}>
                                        {/* Header row with accent bar */}
                                        <div className="px-4 py-3" style={{ borderLeft: `3px solid ${accentColor}`, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                                          <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: accentColor }}>Owner Notification</div>
                                          <div className="text-[13px] font-extrabold text-white leading-tight">Direct message about this verification</div>
                                          <div className="mt-0.5 text-[10px] text-slate-500">Delivered instantly to the owner inside the system</div>
                                        </div>
                                        {/* To / Regarding */}
                                        <div className="grid grid-cols-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                                          <div className="px-3.5 py-2.5" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                                            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">To</div>
                                            <div className="text-xs font-bold text-white leading-snug break-words">{d.property?.owner?.name ?? "Owner"}</div>
                                            <div className="text-[10px] text-slate-500 mt-0.5 break-all">{d.property?.owner?.email ?? d.property?.owner?.phone ?? ""}</div>
                                          </div>
                                          <div className="px-3.5 py-2.5">
                                            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Regarding</div>
                                            <div className="text-xs font-bold text-white leading-snug">{d.bookingId ? `Booking #${d.bookingId}` : "This booking"}</div>
                                            <div className="text-[10px] text-slate-500 mt-0.5 font-mono tracking-wider">{vCodeUp}</div>
                                          </div>
                                        </div>
                                        {/* Suggested message row */}
                                        {vSuggested && (
                                          <button type="button"
                                            onClick={() => { setVNotifSubject(vSuggested.subject); setVNotifMsg(vSuggested.message); }}
                                            className="w-full px-3.5 py-2.5 text-left transition hover:brightness-125"
                                            style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: `${accentColor}0a` }}>
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="flex items-center gap-1.5">
                                                <Bell className="h-3 w-3 flex-shrink-0" style={{ color: accentColor }} />
                                                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: accentColor }}>Suggested message</span>
                                              </div>
                                              <span className="text-[9px] font-semibold uppercase tracking-wider rounded-md px-1.5 py-0.5 flex-shrink-0" style={{ color: accentColor, border: `1px solid ${accentColor}35` }}>Tap to fill</span>
                                            </div>
                                            <div className="text-xs font-semibold text-white mt-1.5 leading-snug break-words">{vSuggested.subject}</div>
                                            <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed break-words">{vSuggested.message}</div>
                                          </button>
                                        )}
                                        {/* Subject cell */}
                                        <div className="px-3.5 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                                          <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Subject</div>
                                          <input value={vNotifSubject} onChange={e => setVNotifSubject(e.target.value)}
                                            placeholder="e.g. Update on your booking"
                                            className="w-full bg-transparent text-xs font-semibold text-white placeholder:text-slate-600 outline-none" />
                                        </div>
                                        {/* Message cell */}
                                        <div className="px-3.5 py-2.5">
                                          <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Message</div>
                                          <textarea value={vNotifMsg} onChange={e => setVNotifMsg(e.target.value)} rows={4}
                                            placeholder="Write the note the owner will receive..."
                                            className="w-full bg-transparent text-xs text-white placeholder:text-slate-600 outline-none resize-none leading-relaxed" />
                                        </div>
                                      </div>
                                      {vNotifError && (
                                        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2">
                                          <AlertTriangle className="h-3 w-3 text-red-400 flex-shrink-0" />
                                          <p className="text-[11px] text-red-400">{vNotifError}</p>
                                        </div>
                                      )}
                                      <button type="button" onClick={vSendNotif}
                                        disabled={vNotifSending || !vNotifSubject.trim() || !vNotifMsg.trim()}
                                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                                        style={{
                                          background: `linear-gradient(135deg,${accentColor}22,${accentColor}10)`,
                                          border: `1px solid ${accentColor}35`, color: accentColor,
                                        }}
                                      >
                                        {vNotifSending
                                          ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Sending...</>
                                          : <><Bell className="h-3.5 w-3.5" />Send to {d.property?.owner?.name ?? "Owner"}</>}
                                      </button>
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>

                      {/* Footer — sticky action bar */}
                      <div className="flex-shrink-0 px-5 py-4 sm:px-7" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={vCloseModal}
                            className="flex-1 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition"
                            style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.85)' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.65)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(226,232,240,1)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.45)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(148,163,184,0.85)'; }}>
                            Close
                          </button>
                          {!vSuccess && (
                            <button type="button" onClick={vCloseModal}
                              className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition"
                              style={{
                                background: `linear-gradient(135deg,${accentColor}22,${accentColor}10)`,
                                border: `1px solid ${accentColor}30`,
                                color: accentColor,
                              }}
                            >
                              New Verification
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Bottom accent bar */}
                      <div className="h-[2px] w-full flex-shrink-0" style={{ background: `linear-gradient(90deg, transparent 5%, ${accentColor}40 50%, transparent 95%)` }} />
                    </div>
                  </div>
                );
              })(), document.body)}
            </div>
          </div>
        </div>

        {/* Quick links */}
        <div className="card">
          <div className="card-section">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 text-gray-800 font-medium">
                  <LayoutDashboard className="h-5 w-5 text-gray-700" />
                  <div>Quick links</div>
                </div>
                <div className="text-xs text-gray-500">Common admin tasks</div>
              </div>
            </div>
            {/* Equal-height grid for quick-links: two columns, two rows, matching tile heights */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 auto-rows-fr">
              <div className="h-full">
                <QLink href="/admin/properties/previews" label="Manage Properties" Icon={Building2} color="bg-[#02665e]" />
              </div>
              <div className="h-full">
                <QLink href="/admin/owners" label="View Owners" Icon={Users} color="bg-sky-600" />
              </div>
              <div className="h-full">
                <QLink href="/admin" label="Analytics" Icon={BarChart3} color="bg-violet-600" />
              </div>
              <div className="h-full">
                <QLink href="/admin/revenue" label="Revenue" Icon={LineChart} color="bg-emerald-600" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Compact overview removed; replaced by GeneralReports below */}
      {/* General reports section (new) */}
      <GeneralReports />
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

/* ---------- Small helper components ---------- */
// Section component removed (search removed)

 
