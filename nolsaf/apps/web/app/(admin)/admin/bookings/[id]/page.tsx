"use client";
import React, { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Home, User, CheckCircle2, Clock, Key, KeyRound, AlertCircle, AlertTriangle, Loader2, MessageSquare, RefreshCw, Star, Copy, Check, Mail, Phone } from "lucide-react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

function authify() {}

// Input sanitization helper
function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

// Validate booking ID
/** A booking URL segment: the opaque bk_ reference, or a legacy numeric id that gets swapped for one. */
function isBookingRouteRef(value: string): boolean {
  return /^bk_[A-Za-z0-9_-]{22}$/.test(value) || /^BKG-/i.test(value) || /^\d+$/.test(value);
}

function isValidBookingId(id: number | null | undefined): boolean {
  return id !== null && id !== undefined && Number.isInteger(id) && id > 0;
}

// Toast notification helper
function showToast(type: "success" | "error" | "info" | "warning", title: string, message?: string, duration?: number) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("nols:toast", {
        detail: { type, title, message, duration: duration ?? 5000 },
      })
    );
  }
}

// Header status pill, on the dark band. Same vocabulary as the bookings management record.
const STATUS_META: Record<string, { label: string; pill: string }> = {
  NEW: { label: "Awaiting payment", pill: "bg-amber-400/20 text-amber-200" },
  CONFIRMED: { label: "Confirmed", pill: "bg-emerald-400/20 text-emerald-200" },
  PENDING_CHECKIN: { label: "Checking in", pill: "bg-sky-400/20 text-sky-200" },
  CHECKED_IN: { label: "In house", pill: "bg-sky-400/20 text-sky-200" },
  CHECKED_OUT: { label: "Checked out", pill: "bg-violet-400/20 text-violet-200" },
  CANCELED: { label: "Cancelled", pill: "bg-rose-400/20 text-rose-200" },
};

function humanize(value: string) {
  const s = String(value || "").replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Title-cases stored values such as "DAR-ES-SALAAM" or "HOTEL" for display. */
function tidy(value: string | null | undefined) {
  const s = String(value || "").trim();
  if (!s) return "";
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase()) : s;
}

// Times are shown in East Africa Time, whatever the viewer's browser is set to.
function eat(iso: string) {
  return `${new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}
function eatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}
function eatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Africa/Dar_es_Salaam" });
}
function eatYear(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}
function tzs(value: number | string | null | undefined) {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? "Not set" : `TSh ${Math.round(n).toLocaleString("en-US")}`;
}

// Confirmation Modal Component
function ConfirmModal({ 
  open, 
  title, 
  message, 
  confirmLabel, 
  onConfirm, 
  onCancel 
}: { 
  open: boolean; 
  title: string; 
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void; 
  onCancel: () => void; 
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-lg p-5 z-10 w-full max-w-md shadow-lg">
        <div className="font-semibold text-lg mb-2">{title}</div>
        {message && <div className="text-sm text-gray-600 mb-4">{message}</div>}
        <div className="flex justify-end gap-3">
          <button 
            onClick={onCancel}
            aria-label="Cancel action"
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors"
          >
            Cancel
          </button>
          <button 
            autoFocus 
            onClick={onConfirm}
            aria-label={confirmLabel || "Confirm action"}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
          >
            {confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * Every owner request to get this booking's check-in code back to the guest,
 * and how it ended. The code itself is never part of a request.
 */
function GuestCodeHistory({ bookingId, card }: { bookingId: number; card: string }) {
  const [rows, setRows] = useState<Array<{ id: number; status: string; channel: string | null; destinationMasked: string | null; reason: string | null; adminNote: string | null; resolvedBy: string | null; createdAt: string; owner: { name: string } | null }> | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<any>("/api/admin/guest-code-requests", { params: { status: "ALL", bookingId, pageSize: 20 } })
      .then((r) => { if (alive) setRows(r.data?.requests ?? []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [bookingId]);
  if (!rows || rows.length === 0) return null;
  const label: Record<string, string> = { SENT: "Sent automatically", RESOLVED: "Resent by admin", NEEDS_REVIEW: "Needs checking", UNREACHABLE: "Guest unreachable", REJECTED: "Closed" };
  const open = rows.some((row) => row.status === "NEEDS_REVIEW" || row.status === "UNREACHABLE");
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
        <p className="m-0 text-sm font-bold text-neutral-900">Guest code requests</p>
        {open ? <Link href="/admin/bookings/code-requests" className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 no-underline ring-1 ring-inset ring-amber-200">Needs action</Link> : null}
      </div>
      <ul className="m-0 list-none space-y-2 px-4 py-3 sm:px-5">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl bg-neutral-50 px-3 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-neutral-800">{label[row.status] ?? row.status}</span>
              <span className="text-neutral-400">{new Date(row.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })} EAT</span>
            </div>
            <p className="m-0 mt-0.5 text-neutral-500">
              Asked by {row.owner?.name ?? "the owner"}
              {row.channel ? ` · ${row.channel === "SMS" ? "SMS" : "inbox"}${row.destinationMasked ? ` ${row.destinationMasked}` : ""}` : ""}
              {row.resolvedBy ? ` · ${row.resolvedBy}` : ""}
            </p>
            {row.reason ? <p className="m-0 mt-0.5 text-amber-700">{row.reason}</p> : null}
            {row.adminNote ? <p className="m-0 mt-0.5 text-neutral-600">Note: {row.adminNote}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AdminBookingDetail() {
  const params = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(params?.id) ? params?.id?.[0] : params?.id;
  const ref = String(idParam ?? "").trim();
  const router = useRouter();
  const [b, setB] = useState<any>(null);
  // The numeric id is only used for API calls after the booking has loaded; the URL carries the reference.
  const id = Number(b?.id);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");
  
  // Modal and message states
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    } catch {
      showToast("error", "Copy failed", "Your browser blocked the clipboard.");
    }
  }, []);

  const load = useCallback(async () => {
    if (!isBookingRouteRef(ref)) {
      setError("Invalid booking ID");
      setLoading(false);
      showToast("error", "Invalid Booking", "Invalid booking ID provided");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      authify();
      const r = await api.get<any>(`/api/admin/bookings/${encodeURIComponent(ref)}`);
      setB(r.data);
      // An old numeric link: swap the address bar to the opaque reference.
      if (/^\d+$/.test(ref) && r.data?.reference) router.replace(`/admin/bookings/${r.data.reference}`);
      setRoomCode(r.data.roomCode ?? "");
    } catch (err: any) {
      console.error("Failed to load booking:", err);
      const errorMessage = err?.response?.status === 404
        ? "Booking not found"
        : err?.response?.data?.error || err?.message || "Failed to load booking details";
      setError(errorMessage);
      showToast("error", "Failed to Load Booking", errorMessage);
    } finally {
      setLoading(false);
    }
  }, [ref, router]);

  useEffect(() => {
    authify();
    load();
  }, [load]);


  const reassign = useCallback(async () => {
    if (!isValidBookingId(id)) {
      showToast("error", "Invalid Booking", "Invalid booking ID provided");
      return;
    }

    const sanitizedCode = sanitizeInput(roomCode);
    if (!sanitizedCode.trim()) {
      showToast("error", "Room Code Required", "Please enter a room code");
      return;
    }

    if (sanitizedCode.length > 50) {
      showToast("error", "Room Code Too Long", "Room code must be less than 50 characters");
      return;
    }

    setBusy(true);
    try {
      authify();
      await api.post(`/api/admin/bookings/${id}/reassign-room`, { roomCode: sanitizedCode });
      await load();
      showToast("success", "Room Reassigned", "Room reassigned successfully");
    } catch (e: any) {
      const errorMessage = e?.response?.data?.error || e?.message || "Failed to reassign room";
      showToast("error", "Failed to Reassign Room", errorMessage);
    } finally {
      setBusy(false);
    }
  }, [id, roomCode, load]);

  const handleVoidCode = useCallback(async () => {
    setShowVoidConfirm(false);
    if (!b?.code?.id) {
      showToast("error", "No Code", "No check-in code found to void");
      return;
    }

    if (!isValidBookingId(id)) {
      showToast("error", "Invalid Booking", "Invalid booking ID provided");
      return;
    }

    setBusy(true);
    try {
      authify();
      await api.post(`/api/admin/bookings/codes/${b.code.id}/void`, { reason: "Voided from admin detail" });
      await load();
      showToast("success", "Code Voided", "Check-in code voided successfully");
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to void code";
      showToast("error", "Failed to Void Code", errorMessage);
    } finally {
      setBusy(false);
    }
  }, [b, id, load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading booking
      </div>
    );
  }

  if (error || !b) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-solid border-neutral-300 bg-white px-5 py-6 shadow-sm">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><AlertCircle className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold text-neutral-900">{error || "Booking not found"}</p>
          <p className="m-0 mt-0.5 text-xs text-neutral-500">It may have been removed, or the link is wrong.</p>
        </div>
        {error && (
          <button type="button" onClick={load} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white hover:bg-[#12342f]">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        )}
        <Link href="/admin/bookings" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50">
          <ArrowLeft className="h-3.5 w-3.5" /> All bookings
        </Link>
      </div>
    );
  }

  const nights = Math.max(0, Math.round((new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / 86_400_000));
  const statusKey = String(b.status || "").toUpperCase();
  const statusMeta = STATUS_META[statusKey] ?? { label: humanize(b.status), pill: "bg-white/10 text-white/80" };
  const guestName = b.guestName || b.user?.name || "Guest not named";
  const guestEmail = b.user?.email || null;
  const guestPhone = b.guestPhone || b.user?.phone || null;
  const owner = b.property?.owner;
  const place = [tidy(b.property?.district), tidy(b.property?.regionName)].filter(Boolean).join(", ");
  const total = Number(b.totalAmount || 0);
  const codeVisible: string | null = b.code?.codeVisible || null;

  const facts = [
    { label: "Stay", value: `${nights} ${nights === 1 ? "night" : "nights"}`, detail: `${eatDay(b.checkIn)} to ${eatDay(b.checkOut)}` },
    { label: "Guest", value: guestName, detail: guestPhone || guestEmail || "No contact on file" },
    { label: "Amount", value: tzs(total), detail: statusKey === "NEW" ? "Not paid yet" : statusMeta.label },
    { label: "Per night", value: nights > 0 ? tzs(total / nights) : tzs(total), detail: b.roomCode ? `Room ${b.roomCode}` : tidy(b.property?.type) || "Room not set" },
  ];

  const copyButton = (key: string, text: string, label: string, dark = false) => (
    <button
      type="button"
      onClick={() => void copy(key, text)}
      aria-label={`Copy ${label}`}
      title={copied === key ? "Copied" : `Copy ${label}`}
      className={`inline-grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 transition-colors ${dark ? "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white" : "bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"}`}
    >
      {copied === key ? <Check className={`h-3.5 w-3.5 ${dark ? "text-emerald-300" : "text-emerald-600"}`} /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );

  /** One contact line: icon, value, copy, and the native action (mail or call). */
  const contactRow = (key: string, kind: "mail" | "tel", value: string | null | undefined) => (
    <div key={key} className="flex min-w-0 items-center gap-2 rounded-lg bg-neutral-50 px-2.5 py-1.5 ring-1 ring-inset ring-neutral-200">
      {kind === "mail" ? <Mail className="h-3.5 w-3.5 shrink-0 text-neutral-400" /> : <Phone className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
      <span className={`min-w-0 flex-1 truncate text-sm ${value ? "text-neutral-800" : "text-neutral-400"} ${kind === "tel" ? "tabular-nums" : ""}`} title={value || undefined}>
        {value || (kind === "mail" ? "No email on file" : "No phone on file")}
      </span>
      {value ? (
        <>
          {copyButton(key, value, kind === "mail" ? "email" : "phone")}
          <a href={kind === "mail" ? `mailto:${value}` : `tel:${value}`} className="inline-flex h-7 shrink-0 items-center rounded-md bg-[#0b2420] px-2 text-[11px] font-semibold text-white no-underline hover:bg-[#12342f] hover:no-underline">
            {kind === "mail" ? "Email" : "Call"}
          </a>
        </>
      ) : null}
    </div>
  );

  const sectionHead = (icon: React.ReactNode, title: string, aside?: React.ReactNode) => (
    <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300">{icon}</span>
      <h2 className="m-0 min-w-0 flex-1 text-sm font-bold text-neutral-900">{title}</h2>
      {aside}
    </div>
  );

  const fieldGrid = (fields: Array<[string, React.ReactNode]>) => (
    <dl className="m-0 flex flex-wrap gap-px bg-neutral-200">
      {fields.map(([label, value]) => (
        <div key={label} className="min-w-[160px] flex-1 bg-white px-4 py-3 sm:px-5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{label}</dt>
          <dd className={`m-0 mt-1 break-words text-sm font-semibold ${value ? "text-neutral-900" : "text-neutral-400"}`}>{value || "Not recorded"}</dd>
        </div>
      ))}
    </dl>
  );

  const card = "overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm";

  // Check-out summary, for stays that are in house or finished.
  const scheduledOut = new Date(b.checkOut);
  const actualOut = statusKey === "CHECKED_OUT" && b.updatedAt ? new Date(b.updatedAt) : null;
  const isCurrentlyOverdue = statusKey === "CHECKED_IN" && Date.now() > scheduledOut.getTime();
  const wasOverdue = Boolean(statusKey === "CHECKED_OUT" && actualOut && actualOut > scheduledOut);
  const overdueDays = wasOverdue && actualOut
    ? Math.round((actualOut.getTime() - scheduledOut.getTime()) / 86_400_000)
    : isCurrentlyOverdue
      ? Math.round((Date.now() - scheduledOut.getTime()) / 86_400_000)
      : 0;
  const review = Array.isArray(b.reviews) && b.reviews.length > 0 ? b.reviews[0] : null;

  return (
    <>
      <ConfirmModal
        open={showVoidConfirm}
        title="Void check-in code"
        message="Void this active check-in code? The guest will not be able to use it, and this cannot be undone."
        confirmLabel="Void code"
        onConfirm={handleVoidCode}
        onCancel={() => setShowVoidConfirm(false)}
      />

      {/* The admin layout owns the gutter and width. */}
      <div className="w-full min-w-0 space-y-5">
        {/* Header */}
        <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
          <div className="relative px-5 py-5 sm:px-6 sm:py-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <Link href="/admin/bookings" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80 no-underline hover:text-emerald-200">
                  <ArrowLeft className="h-3.5 w-3.5" /> Bookings
                </Link>
                <h1 className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-bold tracking-tight text-white sm:text-2xl">
                  Booking #{b.id}
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusMeta.pill}`}>{statusMeta.label}</span>
                </h1>
                <p className="m-0 mt-1 max-w-2xl truncate text-sm text-white/60">
                  {tidy(b.property?.title) || "Property removed"}{place ? ` · ${place}` : ""}{b.roomCode ? ` · Room ${b.roomCode}` : ""}
                </p>
              </div>
              {/* Codes are issued automatically once payment is confirmed; unpaid bookings simply wait. */}
              {statusKey === "NEW" && (
                <span className="inline-flex max-w-md items-start gap-2 rounded-xl bg-amber-400/15 px-3 py-2 text-xs font-medium leading-snug text-amber-100 ring-1 ring-inset ring-amber-300/25">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                  Awaiting payment. The check-in code is issued automatically once it is paid.
                </span>
              )}
            </div>

            <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
              {facts.map((fact, index) => (
                <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                  <dd className="m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums text-white" title={String(fact.value)}>{fact.value}</dd>
                  <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Booking pass: the identifiers someone will ask for, ready to copy */}
        <section className="relative flex flex-col overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm sm:flex-row" aria-label="Booking pass">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Booking</p>
              <p className="m-0 mt-0.5 flex items-center gap-1 font-mono text-2xl font-bold tracking-tight text-neutral-900">
                #{b.id} {copyButton("id", String(b.id), "booking number")}
              </p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Check-in</p>
              <p className="m-0 mt-0.5 text-sm font-semibold text-neutral-900">{eatDay(b.checkIn)}, {eatYear(b.checkIn)}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Check-out</p>
              <p className="m-0 mt-0.5 text-sm font-semibold text-neutral-900">{eatDay(b.checkOut)}, {eatYear(b.checkOut)}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Booked</p>
              <p className="m-0 mt-0.5 text-sm text-neutral-700">{b.createdAt ? eat(b.createdAt) : "Not recorded"}</p>
            </div>
          </div>
          {/* Tear line between the record and the code stub */}
          <div className="relative hidden w-0 border-0 border-l-2 border-dashed border-neutral-300 sm:block" aria-hidden>
            <span className="absolute -left-[9px] -top-[9px] h-4 w-4 rounded-full border border-solid border-neutral-300 bg-neutral-100" />
            <span className="absolute -bottom-[9px] -left-[9px] h-4 w-4 rounded-full border border-solid border-neutral-300 bg-neutral-100" />
          </div>
          <div className={`flex shrink-0 items-center gap-3 border-0 border-t-2 border-dashed border-neutral-300 px-5 py-4 sm:border-t-0 ${codeVisible ? "bg-[#0b2420] text-white" : "bg-neutral-50"}`}>
            <div className="min-w-0">
              <p className={`m-0 text-[10px] font-semibold uppercase tracking-[0.16em] ${codeVisible ? "text-emerald-300/80" : "text-neutral-400"}`}>Check-in code</p>
              {codeVisible ? (
                <p className="m-0 mt-0.5 flex items-center gap-1.5 font-mono text-2xl font-bold tracking-[0.18em]">
                  {codeVisible} {copyButton("code", codeVisible, "check-in code", true)}
                </p>
              ) : (
                <p className="m-0 mt-0.5 text-sm font-semibold text-neutral-500">{statusKey === "NEW" ? "Issued after payment" : "No active code"}</p>
              )}
              {b.code?.status && <p className={`m-0 mt-0.5 text-[11px] ${codeVisible ? "text-white/50" : "text-neutral-400"}`}>{humanize(b.code.status)}{b.code.usedAt ? ` · used ${eatDate(b.code.usedAt)}` : ""}</p>}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Main column */}
          <div className="min-w-0 space-y-5 lg:col-span-2">
            <section className={card}>
              {sectionHead(<Home className="h-4 w-4" />, "Property")}
              {fieldGrid([
                ["Property", tidy(b.property?.title)],
                ["Type", tidy(b.property?.type)],
                ["Country", tidy(b.property?.country)],
                ["Region", tidy(b.property?.regionName)],
                ["City", tidy(b.property?.city)],
                ["District", tidy(b.property?.district)],
                ["Ward", tidy(b.property?.ward)],
              ])}
            </section>

            <section className={card}>
              {sectionHead(<User className="h-4 w-4" />, "Guest")}
              <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5">
                <div className="min-w-0 sm:col-span-2">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Name</p>
                  <p className="m-0 mt-0.5 text-sm font-semibold text-neutral-900">{guestName}</p>
                </div>
                {contactRow("guest-email", "mail", guestEmail)}
                {contactRow("guest-phone", "tel", guestPhone)}
              </div>
            </section>

            <section className={card}>
              {sectionHead(<KeyRound className="h-4 w-4" />, "Room assignment", b.roomCode ? <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-neutral-700">Now {b.roomCode}</span> : null)}
              <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:px-5">
                <input
                  className="h-10 min-w-0 flex-1 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                  value={roomCode}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value.length <= 50) setRoomCode(value);
                  }}
                  placeholder="Room code, for example A-101"
                  aria-label="Room code"
                  maxLength={50}
                  disabled={busy}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={reassign}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#12342f] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? "Updating" : "Reassign room"}
                </button>
              </div>
            </section>

            {b.notes ? (
              <section className={card}>
                {sectionHead(<MessageSquare className="h-4 w-4" />, "Notes")}
                <p className="m-0 whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-neutral-700 sm:px-5">{b.notes}</p>
              </section>
            ) : null}
          </div>

          {/* Side column */}
          <div className="min-w-0 space-y-5">
            <section className={card}>
              {sectionHead(<Key className="h-4 w-4" />, "Check-in code")}
              <div className="px-4 py-4 sm:px-5">
                {codeVisible ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0b2420] px-4 py-3 text-white">
                      <span className="font-mono text-xl font-bold tracking-[0.18em]">{codeVisible}</span>
                      {copyButton("code-side", codeVisible, "check-in code", true)}
                    </div>
                    {fieldGrid([
                      ["Status", humanize(b.code.status)],
                      ["Issued", b.code.generatedAt ? eat(b.code.generatedAt) : null],
                      ...(b.code.usedAt ? ([["Used", eat(b.code.usedAt)]] as Array<[string, React.ReactNode]>) : []),
                    ])}
                    {b.code.status === "ACTIVE" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setShowVoidConfirm(true)}
                        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-solid border-rose-200 bg-white text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {busy ? "Voiding" : "Void code"}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-neutral-500">
                    {statusKey === "NEW" ? "No code yet. It is issued automatically as soon as the booking is paid." : "No active code on this booking."}
                  </p>
                )}
              </div>
            </section>

            {Number.isFinite(id) && id > 0 ? <GuestCodeHistory bookingId={id} card={card} /> : null}

            <section className={card}>
              {sectionHead(<User className="h-4 w-4" />, "Owner")}
              <div className="grid gap-2 px-4 py-4 sm:px-5">
                <p className="m-0 text-sm font-semibold text-neutral-900">{owner?.name || "Owner not on record"}</p>
                {contactRow("owner-phone", "tel", owner?.phone)}
                {contactRow("owner-email", "mail", owner?.email)}
              </div>
            </section>

            {(statusKey === "CHECKED_OUT" || statusKey === "CHECKED_IN") && (
              <section className={card}>
                {sectionHead(
                  wasOverdue || isCurrentlyOverdue ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />,
                  "Check-out",
                  statusKey === "CHECKED_OUT" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"><CheckCircle2 className="h-3 w-3" /> Confirmed</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200"><Clock className="h-3 w-3" /> In house</span>
                  ),
                )}
                <div className="space-y-3 px-4 py-4 sm:px-5">
                  {(wasOverdue || isCurrentlyOverdue) && (
                    <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <div className="text-xs leading-snug">
                        <span className="font-bold text-amber-800">
                          {isCurrentlyOverdue ? "Overdue: the guest has not checked out" : `Late check-out: ${overdueDays} ${overdueDays === 1 ? "day" : "days"} past schedule`}
                        </span>
                        <div className="mt-0.5 text-amber-700">
                          Scheduled {eatDate(b.checkOut)}
                          {wasOverdue && actualOut ? <> · actual {eatDate(actualOut.toISOString())}</> : null}
                        </div>
                      </div>
                    </div>
                  )}

                  {review ? (
                    <div className="space-y-2">
                      <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Guest review</p>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star key={s} className={`h-4 w-4 ${s <= review.rating ? "fill-amber-400 text-amber-400" : "text-neutral-200"}`} />
                        ))}
                        <span className="ml-1 text-xs font-bold text-neutral-700">{review.rating}/5</span>
                      </div>
                      {review.title && <p className="m-0 text-sm font-semibold text-neutral-900">{review.title}</p>}
                      {review.comment && <p className="m-0 text-xs leading-relaxed text-neutral-600">{review.comment}</p>}
                      <p className="m-0 text-[10px] text-neutral-400">{eatDate(review.createdAt)}</p>
                      {review.ownerResponse && (
                        <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-inset ring-neutral-200">
                          <div className="mb-1.5 flex items-center gap-1.5">
                            <MessageSquare className="h-3.5 w-3.5 text-[#02665e]" />
                            <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-600">Owner response</span>
                            {review.ownerResponseAt && <span className="ml-auto text-[10px] text-neutral-400">{eatDate(review.ownerResponseAt)}</span>}
                          </div>
                          <p className="m-0 text-xs leading-relaxed text-neutral-700">{review.ownerResponse}</p>
                        </div>
                      )}
                    </div>
                  ) : statusKey === "CHECKED_OUT" ? (
                    <p className="m-0 text-xs italic text-neutral-400">No review submitted for this stay.</p>
                  ) : null}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
