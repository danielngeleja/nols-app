"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  Calendar, Download, CheckCircle, XCircle, Eye,
  ArrowRight, BookOpen, MapPin, Clock, CreditCard,
  Hash, BedDouble, DoorOpen, Printer, X, FileText,
} from "lucide-react";
import Link from "next/link";

const api = apiClient;

type Booking = {
  id: number;
  property: {
    id: number;
    title: string;
    type: string;
    regionName?: string;
    district?: string;
    city?: string;
    slug?: string;
  };
  checkIn: string;
  checkOut: string;
  status: string;
  totalAmount: number;
  roomType?: string;
  rooms?: number;
  services?: any;
  isValid: boolean;
  isPaid: boolean;
  bookingCode: string | null;
  codeStatus: string | null;
  invoice?: {
    invoiceNumber?: string;
    receiptNumber?: string;
    status?: string;
  };
  dashboardBucket?: "DRAFT" | "PAID" | string;
  draftExpiresAt?: string | null;
  draftExpiryStatus?: "ACTIVE" | "EXPIRED" | null;
  draftAvailability?: {
    available: boolean;
    status: "AVAILABLE" | "UNAVAILABLE" | "PROPERTY_UNAVAILABLE";
    reason: "AVAILABLE" | "BOOKED" | "BLOCKED" | "FULL" | "PROPERTY_UNAVAILABLE";
    message: string;
    checkedAt: string;
    requestedRooms: number;
    availableRooms: number;
    bookedRooms: number;
    blockedRooms: number;
    selectedRoomType: string | null;
  } | null;
  invoiceId?: number | null;
  invoiceAccessToken?: string | null;
  createdAt: string;
};

const isDraftBooking = (b: Booking) => String(b.dashboardBucket || "").toUpperCase() === "DRAFT";
const isExpiredDraftBooking = (b: Booking) =>
  isDraftBooking(b) && String(b.draftExpiryStatus || "").toUpperCase() === "EXPIRED";

function canRequestCancellation(b: Booking): boolean {
  if (!b.bookingCode) return false;
  if (b.status === "CANCELED") return false;
  if (b.codeStatus !== "ACTIVE") return false;
  const now = new Date();
  const checkIn = new Date(b.checkIn);
  return now < checkIn;
}

function BookingCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(0,0,0,0.05)]">
      <div className="absolute left-0 inset-y-0 w-[3px] rounded-l-3xl bg-slate-200 animate-pulse" />
      <div className="pl-6 pr-5 pt-5 pb-5 sm:pl-7 sm:pr-6 sm:pt-6 sm:pb-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 flex-1">
            <div className="w-11 h-11 rounded-2xl bg-slate-200 animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-52 bg-slate-200 rounded animate-pulse" />
              <div className="h-3 w-36 bg-slate-200 rounded animate-pulse" />
            </div>
          </div>
          <div className="h-6 w-20 bg-slate-200 rounded-full animate-pulse" />
        </div>
        <div className="flex flex-wrap gap-2">
          {[1,2,3,4].map(i => <div key={i} className="h-7 w-28 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
        <div className="flex gap-2 justify-end">
          <div className="h-9 w-24 bg-slate-100 rounded-xl animate-pulse" />
          <div className="h-9 w-9 bg-slate-100 rounded-xl animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "expired" | "draft">("all");
  const [entered, setEntered] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    loadBookings();
  }, []);

  // Gentle mount animation (clean + modern)
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const loadBookings = async () => {
    try {
      setLoading(true);
      const response = await api.get("/api/customer/bookings?pageSize=50");
      // The API already returns exactly what belongs here: unpaid drafts (NEW with an
      // unpaid invoice) + confirmed stays (CONFIRMED/CHECKED_IN/CHECKED_OUT with a code).
      // Keep them all so the count matches the dashboard, and so expired (checked-out)
      // stays still appear under the Expired tab. Cancelled bookings are excluded by the API.
      const items: Booking[] = response.data.items || [];
      const visible = items.filter((b) => isDraftBooking(b) || Boolean(b?.isPaid) || Boolean(b?.bookingCode));
      setBookings(visible);
    } catch (err: any) {
      // Keep UI clean: show a small toast instead of a big banner.
      const msg = err?.response?.data?.error || "Failed to load bookings";
      try {
        window.dispatchEvent(
          new CustomEvent("nols:toast", {
            detail: { type: "error", title: "Bookings", message: msg, duration: 4500 },
          })
        );
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  // Expired means: checkout date has passed (after a completed stay).
  const isExpired = (b: Booking) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const co = new Date(b.checkOut);
      co.setHours(0, 0, 0, 0);
      return co.getTime() < today.getTime();
    } catch {
      return false;
    }
  };
  const isActive = (b: Booking) => !isExpired(b);

  // Payable drafts, expired drafts, and confirmed paid stays.
  const drafts = bookings.filter((booking) => isDraftBooking(booking) && !isExpiredDraftBooking(booking));
  const expiredDrafts = bookings.filter(isExpiredDraftBooking);
  const paidStays = bookings.filter((b) => !isDraftBooking(b));

  const filteredBookings = bookings.filter((booking) => {
    if (filter === "draft") return isDraftBooking(booking) && !isExpiredDraftBooking(booking);
    if (isExpiredDraftBooking(booking)) return filter === "all" || filter === "expired";
    if (isDraftBooking(booking)) return filter === "all";
    if (filter === "active") return isActive(booking);
    if (filter === "expired") return isExpired(booking);
    return true; // "all"
  });

  const activeCount = paidStays.filter(isActive).length;
  const expiredCount = paidStays.filter(isExpired).length + expiredDrafts.length;
  const draftCount = drafts.length;

  // Time-left helper for draft payment windows.
  const draftTimeLeft = (b: Booking): string | null => {
    if (!b.draftExpiresAt) return null;
    const ms = new Date(b.draftExpiresAt).getTime() - nowTick;
    if (ms <= 0) return null;
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes <= 0) return "<1m";
    return `${minutes}m`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatAmount = (amount: number) => {
    return Number(amount).toLocaleString("en-US");
  };

  const nights = (checkIn: string, checkOut: string) => {
    const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    return Math.round(diff / 86400000);
  };

  // ── Receipt modal ──────────────────────────────────────────────────────────
  // Fetch the server-generated receipt HTML (proxied + cookie-authed) and render it
  // via the iframe's `srcdoc`. srcdoc iframes inherit the parent origin, so the styled
  // markup renders fully AND we can read contentDocument for print/PDF. The template
  // HTML-escapes all guest/property fields at the source, so no client sanitizing is
  // needed and the styling is preserved.
  const [receiptBookingId, setReceiptBookingId] = useState<number | null>(null);
  const [receiptHtml, setReceiptHtml] = useState<string>("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState(false);
  const receiptIframeRef = useRef<HTMLIFrameElement | null>(null);

  const openReceipt = useCallback(async (bookingId: number) => {
    setReceiptBookingId(bookingId);
    setReceiptHtml("");
    setReceiptError(false);
    setReceiptLoading(true);
    try {
      const r = await fetch(`/api/customer/bookings/${bookingId}/receipt.html`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "text/html" },
      });
      const html = await r.text();
      if (!r.ok || !/class=["']sheet["']/.test(html)) {
        throw new Error(`Receipt not available (${r.status})`);
      }
      setReceiptHtml(html);
    } catch {
      setReceiptError(true);
    } finally {
      setReceiptLoading(false);
    }
  }, []);

  useEffect(() => {
    const requestedReceiptId = Number(new URLSearchParams(window.location.search).get("receiptBookingId"));
    if (Number.isFinite(requestedReceiptId) && requestedReceiptId > 0) {
      openReceipt(requestedReceiptId);
    }
  }, [openReceipt]);

  const closeReceipt = useCallback(() => {
    setReceiptBookingId(null);
    setReceiptHtml("");
    setReceiptLoading(false);
    setReceiptError(false);
  }, []);

  const printReceipt = useCallback(() => {
    receiptIframeRef.current?.contentWindow?.focus();
    receiptIframeRef.current?.contentWindow?.print();
  }, []);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="relative overflow-hidden rounded-2xl h-36" style={{ background: "linear-gradient(135deg,#0e2a7a 0%,#0a5c82 42%,#02665e 100%)" }}>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-white/15 animate-pulse" />
            <div className="h-5 w-36 bg-white/15 rounded animate-pulse" />
            <div className="h-3 w-52 bg-white/10 rounded animate-pulse" />
          </div>
        </div>
        <div className="flex justify-center gap-2">
          {[1,2,3].map(i => <div key={i} className="h-9 w-24 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
        <div className="space-y-4">
          <BookingCardSkeleton />
          <BookingCardSkeleton />
          <BookingCardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className={["mx-auto w-full max-w-5xl space-y-6 transition-all duration-300 ease-out", entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"].join(" ")}>

      {/* ── Premium Header ── */}
      <div className="relative overflow-hidden rounded-2xl shadow-lg" style={{ background: "linear-gradient(135deg,#0e2a7a 0%,#0a5c82 42%,#02665e 100%)" }}>
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 900 120" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <circle cx="820" cy="10" r="120" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none"/>
          <polyline points="0,90 160,72 320,80 480,52 640,62 800,36 900,48" stroke="white" strokeOpacity="0.10" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          <polygon points="0,90 160,72 320,80 480,52 640,62 800,36 900,48 900,120 0,120" fill="white" fillOpacity="0.03"/>
        </svg>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"/>
        <div className="relative flex flex-col items-center text-center px-8 py-8">
          <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mb-4 shadow-lg">
            <BookOpen className="h-7 w-7 text-white" />
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <h1 className="text-2xl font-black text-white tracking-tight">My Bookings</h1>
            {bookings.length > 0 && (
              <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/25 text-white text-[10px] font-bold uppercase tracking-widest rounded-full px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"/>
                {bookings.length} {bookings.length === 1 ? "booking" : "bookings"}
              </span>
            )}
          </div>
          <p className="text-teal-300/80 text-sm mt-1 font-medium">View and manage all your confirmed stays</p>
        </div>
      </div>

      {/* ── Filter tabs + Cancellation link ── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          {([
            { key: "all" as const, label: "All", count: bookings.length },
            { key: "active" as const, label: "Active", count: activeCount },
            { key: "expired" as const, label: "Past", count: expiredCount },
            { key: "draft" as const, label: "Draft", count: draftCount },
          ]).map((t) => {
            const active = filter === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setFilter(t.key)}
                className={["inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold whitespace-nowrap transition-all duration-200 active:scale-[0.97]", active ? "shadow-sm text-white" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"].join(" ")}
                style={active ? { background: "linear-gradient(135deg,#0e2a7a,#02665e)" } : {}}
              >
                <span>{t.label}</span>
                <span className={["inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-black", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"].join(" ")}>{t.count}</span>
              </button>
            );
          })}
        </div>
        <Link
          href="/account/cancellations"
          className="no-underline inline-flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-[12px] font-bold text-red-600 hover:bg-red-100 hover:border-red-200 transition-colors"
        >
          <XCircle className="h-3.5 w-3.5" />
          Manage Cancellations
        </Link>
      </div>

      {/* ── Empty state ── */}
      {filteredBookings.length === 0 ? (
        <div className="rounded-3xl border border-slate-100 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg,#0e2a7a,#02665e)" }}>
            <BookOpen className="h-8 w-8 text-white" />
          </div>
          <div className="text-lg font-black text-slate-900">No bookings found</div>
          <div className="mt-1.5 text-sm text-slate-500 max-w-xs mx-auto">
            {filter === "active" ? "You have no active bookings right now." : filter === "expired" ? "No past or expired bookings yet." : filter === "draft" ? "No unpaid drafts. Bookings awaiting payment appear here." : "When you book a stay, it will appear here."}
          </div>
          {filter === "all" && (
            <div className="mt-6 flex justify-center">
              <Link href="/public/properties" className="group no-underline inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-sm hover:shadow-md active:scale-[0.99] transition-all" style={{ background: "linear-gradient(135deg,#0e2a7a,#02665e)" }}>
                Browse Properties
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredBookings.map((booking) => {
            const nightCount = nights(booking.checkIn, booking.checkOut);
            const location = [booking.property.regionName, booking.property.city, booking.property.district].filter(Boolean).join(" · ");

            // ── Draft (unpaid) card ──
            if (isDraftBooking(booking)) {
              const expired = String(booking.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
              const timeLeft = draftTimeLeft(booking);
              const unavailable = booking.draftAvailability && !booking.draftAvailability.available;
              const canPay = !expired && !unavailable && Boolean(booking.invoiceId && booking.invoiceAccessToken);
              const payHref = canPay
                ? `/public/booking/payment?invoiceId=${encodeURIComponent(String(booking.invoiceId))}&accessToken=${encodeURIComponent(String(booking.invoiceAccessToken))}`
                : null;
              const reselectHref = booking.property.slug
                ? `/public/properties/${encodeURIComponent(booking.property.slug)}`
                : "/public/properties";
              return (
                <div
                  key={booking.id}
                  className={["relative overflow-hidden rounded-3xl bg-white border shadow-[0_2px_16px_rgba(0,0,0,0.05)] transition-all duration-300", expired || unavailable ? "border-rose-100 opacity-95" : "border-amber-100 hover:shadow-[0_8px_32px_rgba(245,158,11,0.12)] hover:-translate-y-0.5"].join(" ")}
                >
                  <div className="absolute left-0 inset-y-0 w-[3px] rounded-l-3xl" style={{ background: expired || unavailable ? "linear-gradient(180deg,#fb7185,#e11d48)" : "linear-gradient(180deg,#f59e0b 0%,#d97706 100%)" }} />
                  <div className="pl-6 pr-5 pt-5 pb-5 sm:pl-7 sm:pr-6 sm:pt-6 sm:pb-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3.5 min-w-0">
                        <div className="mt-0.5 flex-shrink-0 w-11 h-11 rounded-2xl shadow-md flex items-center justify-center" style={{ background: expired ? "linear-gradient(135deg,#94a3b8,#64748b)" : "linear-gradient(135deg,#f59e0b 0%,#d97706 100%)" }}>
                          <FileText className="h-5 w-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-[16px] sm:text-[17px] font-extrabold text-slate-900 tracking-tight leading-tight line-clamp-1">{booking.property.title}</h3>
                          {location && (
                            <div className="mt-[3px] flex items-center gap-1.5 text-[12px] text-slate-500 font-medium">
                              <MapPin className="h-3 w-3 flex-shrink-0 text-amber-500" />
                              <span className="line-clamp-1">{location}</span>
                            </div>
                          )}
                          {booking.invoice?.invoiceNumber && (
                            <div className="mt-[3px] flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                              <Hash className="h-2.5 w-2.5 flex-shrink-0" />
                              {booking.invoice.invoiceNumber}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className={["flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold shadow-sm", expired || unavailable ? "bg-rose-50 border-rose-100 text-rose-600" : "bg-amber-50 border-amber-100 text-amber-700"].join(" ")}>
                        {expired || unavailable ? <XCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                        {expired ? "Expired" : unavailable ? "Unavailable" : "Draft"}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-teal-50 border border-teal-100 px-3 py-1.5 text-[11px] font-semibold text-teal-800">
                        <Calendar className="h-3 w-3 text-teal-500 flex-shrink-0" />
                        {formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}
                      </span>
                      {nightCount > 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-1.5 text-[11px] font-semibold text-indigo-800">
                          <Clock className="h-3 w-3 text-indigo-400 flex-shrink-0" />
                          {nightCount} {nightCount === 1 ? "night" : "nights"}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-100 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
                        <CreditCard className="h-3 w-3 text-amber-500 flex-shrink-0" />
                        {formatAmount(booking.totalAmount)} TZS
                      </span>
                      {!expired && timeLeft && (
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 border border-rose-100 px-3 py-1.5 text-[11px] font-semibold text-rose-700">
                          <Clock className="h-3 w-3 text-rose-400 flex-shrink-0" />
                          Pay within {timeLeft}
                        </span>
                      )}
                      {unavailable && (
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 border border-rose-100 px-3 py-1.5 text-[11px] font-semibold text-rose-700">
                          <XCircle className="h-3 w-3 text-rose-400 flex-shrink-0" />
                          {booking.draftAvailability?.reason === "BLOCKED" ? "Room blocked" : "Room booked"}
                        </span>
                      )}
                    </div>

                    {unavailable && (
                      <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-[12px] font-black text-rose-700">Selected room is no longer available</div>
                            <div className="mt-1 text-[12px] font-medium text-rose-600">
                              {booking.draftAvailability?.message || "Please select another room or choose a different property."}
                            </div>
                          </div>
                          <Link
                            href={reselectHref}
                            className="no-underline inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[12px] font-bold text-rose-700 border border-rose-100 hover:bg-rose-100 transition-colors"
                          >
                            Select another room
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[12px] text-slate-500 font-medium">
                        {expired
                          ? "This payment window has closed. Please make a new booking."
                          : unavailable
                            ? "Payment is disabled because live availability changed after this draft was created."
                          : "Complete payment to confirm this booking and receive your check-in code."}
                      </p>
                      {payHref && (
                        <Link
                          href={payHref}
                          className="no-underline inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-bold text-white shadow-sm transition-all hover:shadow-md hover:opacity-90"
                          style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          Complete Payment
                        </Link>
                      )}
                      {expired && (
                        <Link
                          href={reselectHref}
                          className="no-underline inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-[12px] font-bold text-teal-800 transition-colors hover:bg-teal-100"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                          Book again
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // ── Paid stay card ──
            const active = isActive(booking);
            return (
              <div
                key={booking.id}
                className="relative overflow-hidden rounded-3xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_8px_32px_rgba(2,102,94,0.10)] hover:-translate-y-0.5"
              >
                {/* Left accent bar */}
                <div className="absolute left-0 inset-y-0 w-[3px] rounded-l-3xl" style={{ background: active ? "linear-gradient(180deg,#0e2a7a 0%,#02665e 100%)" : "linear-gradient(180deg,#cbd5e1,#94a3b8)" }} />
                <div className="pointer-events-none absolute -right-16 -top-12 h-40 w-40 rounded-full blur-3xl" style={{ background: active ? "rgba(2,102,94,0.05)" : "rgba(148,163,184,0.06)" }} />

                <div className="pl-6 pr-5 pt-5 pb-5 sm:pl-7 sm:pr-6 sm:pt-6 sm:pb-6">
                  {/* ── Top row ── */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="mt-0.5 flex-shrink-0 w-11 h-11 rounded-2xl shadow-md flex items-center justify-center" style={{ background: active ? "linear-gradient(135deg,#0e2a7a 0%,#02665e 100%)" : "linear-gradient(135deg,#94a3b8,#64748b)" }}>
                        <BookOpen className="h-5 w-5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-[16px] sm:text-[17px] font-extrabold text-slate-900 tracking-tight leading-tight line-clamp-1">{booking.property.title}</h3>
                        {location && (
                          <div className="mt-[3px] flex items-center gap-1.5 text-[12px] text-slate-500 font-medium">
                            <MapPin className="h-3 w-3 flex-shrink-0 text-teal-500" />
                            <span className="line-clamp-1">{location}</span>
                          </div>
                        )}
                        {booking.bookingCode && (
                          <div className="mt-[3px] flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                            <Hash className="h-2.5 w-2.5 flex-shrink-0" />
                            {booking.bookingCode}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Status pill */}
                    <div className={["flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold shadow-sm", active ? "bg-teal-50 border-teal-100 text-teal-700" : "bg-slate-50 border-slate-200 text-slate-500"].join(" ")}>
                      <span className={["h-1.5 w-1.5 rounded-full", active ? "bg-teal-500" : "bg-slate-400"].join(" ")} />
                      {active ? <CheckCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                      {active ? "Active" : "Past"}
                    </div>
                  </div>

                  {/* ── Info chips ── */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-teal-50 border border-teal-100 px-3 py-1.5 text-[11px] font-semibold text-teal-800">
                      <Calendar className="h-3 w-3 text-teal-500 flex-shrink-0" />
                      {formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}
                    </span>
                    {nightCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-1.5 text-[11px] font-semibold text-indigo-800">
                        <Clock className="h-3 w-3 text-indigo-400 flex-shrink-0" />
                        {nightCount} {nightCount === 1 ? "night" : "nights"}
                      </span>
                    )}
                    {booking.roomType && (
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 border border-violet-100 px-3 py-1.5 text-[11px] font-semibold text-violet-800">
                        <BedDouble className="h-3 w-3 text-violet-400 flex-shrink-0" />
                        {booking.roomType}
                      </span>
                    )}
                    {booking.rooms && (
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-sky-50 border border-sky-100 px-3 py-1.5 text-[11px] font-semibold text-sky-800">
                        <DoorOpen className="h-3 w-3 text-sky-400 flex-shrink-0" />
                        {booking.rooms} {booking.rooms === 1 ? "room" : "rooms"}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-100 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
                      <CreditCard className="h-3 w-3 text-amber-500 flex-shrink-0" />
                      {formatAmount(booking.totalAmount)} TZS
                    </span>
                    {booking.invoice?.receiptNumber && (
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                        <Hash className="h-3 w-3 text-slate-400 flex-shrink-0" />
                        Receipt: {booking.invoice.receiptNumber}
                      </span>
                    )}
                  </div>

                  {/* ── Actions ── */}
                  <div className="mt-4 flex items-center justify-end gap-2 flex-wrap">
                    {canRequestCancellation(booking) && (
                      <Link
                        href={`/account/cancellations?code=${encodeURIComponent(booking.bookingCode!)}`}
                        className="no-underline inline-flex items-center gap-1.5 rounded-xl border border-red-100 bg-red-50 hover:bg-red-100 px-3 py-1.5 text-[11px] font-bold text-red-600 transition-colors"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancel
                      </Link>
                    )}
                    {booking.bookingCode && (
                      <button
                        type="button"
                        onClick={() => openReceipt(booking.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Receipt
                      </button>
                    )}
                    <Link
                      href={`/account/bookings/${booking.id}`}
                      className="no-underline inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition-all hover:shadow-md hover:opacity-90"
                      style={{ background: "linear-gradient(135deg,#0a5c82,#02665e)" }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View Details
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Receipt modal ── */}
      {receiptBookingId !== null && (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={closeReceipt}
          role="dialog"
          aria-modal="true"
          aria-label="Booking receipt"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-slate-100 shrink-0"
              style={{ borderTop: "3px solid #02665e" }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0" style={{ background: "rgba(2,102,94,0.08)" }}>
                  <FileText className="h-4 w-4" style={{ color: "#02665e" }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 leading-tight">Booking Receipt</p>
                  <p className="text-[11px] text-slate-400 leading-tight">NoLSAF · Proof of reservation</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={printReceipt}
                  disabled={receiptLoading || receiptError}
                  title="Print receipt"
                  className="h-9 w-9 flex items-center justify-center rounded-lg text-white shadow-sm transition hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "#02665e" }}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <div className="w-px h-5 bg-slate-200 mx-0.5" />
                <button
                  type="button"
                  onClick={closeReceipt}
                  title="Close"
                  className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition shrink-0"
                  aria-label="Close receipt"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Body — the iframe renders the fully-styled server receipt via srcdoc */}
            <div className="relative flex-1 min-h-0 bg-white">
              {receiptLoading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white">
                  <div className="w-8 h-8 border-2 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: "#02665e" }} />
                  <p className="text-sm text-slate-500">Loading receipt…</p>
                </div>
              )}
              {receiptError ? (
                <div className="flex flex-col items-center justify-center h-64 gap-2 text-center px-6">
                  <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                    <X className="h-5 w-5 text-red-400" />
                  </div>
                  <p className="text-sm font-semibold text-red-500">Receipt unavailable</p>
                  <p className="text-xs text-slate-400">Please try again or contact support.</p>
                </div>
              ) : receiptHtml ? (
                <iframe
                  ref={receiptIframeRef}
                  title="Booking receipt"
                  srcDoc={receiptHtml}
                  className="w-full h-[72vh] border-0 block bg-white"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
