"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  Calendar, Download, CheckCircle, XCircle, Eye,
  ArrowRight, BookOpen, MapPin, Clock, CreditCard,
  Hash, BedDouble, DoorOpen,
} from "lucide-react";
import Link from "next/link";

const api = apiClient;

type Booking = {
  id: number;
  bookingReference: string;
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

  const daysUntil = (dateString: string) => {
    const d = new Date(dateString);
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  };

  // The soonest upcoming paid stay, for the header
  const nextStay = paidStays
    .filter((b) => daysUntil(b.checkOut) >= 0)
    .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())[0];
  const nextStayLabel = (() => {
    if (!nextStay) return null;
    const d = daysUntil(nextStay.checkIn);
    if (d <= 0) return `${nextStay.property.title} · staying now`;
    if (d === 1) return `${nextStay.property.title} · tomorrow`;
    return `${nextStay.property.title} · in ${d} days`;
  })();

  const tabs = [
    { key: "all" as const, label: "All", count: bookings.length },
    { key: "active" as const, label: "Upcoming", count: activeCount },
    { key: "expired" as const, label: "Past", count: expiredCount },
    { key: "draft" as const, label: "Awaiting payment", count: draftCount },
  ];

  const CalendarTile = ({ date, muted }: { date: string; muted?: boolean }) => {
    const d = new Date(date);
    return (
      <div
        className={[
          "flex h-16 w-14 flex-shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-solid text-center",
          muted ? "border-slate-200 bg-slate-50" : "border-[#02665e]/25 bg-white",
        ].join(" ")}
      >
        <span className={["w-full py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white", muted ? "bg-slate-400" : "bg-[#02665e]"].join(" ")}>
          {d.toLocaleDateString("en-US", { month: "short" })}
        </span>
        <span className={["flex-1 pt-1 text-[22px] font-extrabold leading-none tabular-nums", muted ? "text-slate-500" : "text-slate-900"].join(" ")}>
          {d.getDate()}
        </span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4" aria-busy="true">
        <span role="status" className="sr-only">Loading bookings</span>
        <div className="rounded-2xl bg-[#0a1110] px-5 py-5 sm:px-6">
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="mt-3 h-7 w-48 rounded-lg bg-white/15" />
          <div className="mt-2 h-3 w-64 rounded bg-white/10" />
          <div className="mt-5 flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 w-24 rounded-lg bg-white/10" />
            ))}
          </div>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-2xl border border-solid border-slate-200 bg-white p-4">
            <div className="h-16 w-14 rounded-xl bg-slate-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-52 rounded bg-slate-100" />
              <div className="h-3 w-40 rounded bg-slate-100" />
              <div className="h-3 w-64 rounded bg-slate-100" />
            </div>
            <div className="hidden w-40 space-y-2 sm:block">
              <div className="ml-auto h-5 w-28 rounded bg-slate-100" />
              <div className="ml-auto h-9 w-32 rounded-lg bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={["mx-auto w-full max-w-5xl space-y-4 transition-all duration-300 ease-out", entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"].join(" ")}>
      {/* ── Header band ── */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0a1110] text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.8)]" style={{ isolation: "isolate" }}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.6), rgba(2,102,94,0))" }} />
        <div className="px-5 pb-4 pt-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#5ec8bb]">
                <BookOpen className="h-3.5 w-3.5" aria-hidden />
                Your stays
              </div>
              <h1 className="m-0 mt-1.5 text-[26px] font-bold leading-tight text-white">
                My bookings
                {bookings.length > 0 ? <span className="ml-2 align-middle text-[14px] font-semibold text-white/50">{bookings.length}</span> : null}
              </h1>
              <p className="m-0 mt-1 text-[13.5px] text-white/60">
                {nextStayLabel ? (
                  <>
                    Next stay: <span className="font-semibold text-white">{nextStayLabel}</span>
                  </>
                ) : (
                  "Every stay you have booked, paid or awaiting payment."
                )}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <Link
                href="/account/cancellations"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/20 bg-white/5 px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-white/10"
              >
                <XCircle className="h-4 w-4" aria-hidden />
                Manage cancellations
              </Link>
              <Link
                href="/public/properties"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#03786f]"
              >
                Browse stays
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>

          {/* Filters as a segmented control */}
          <div role="tablist" aria-label="Filter bookings" className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-solid border-white/10 bg-white/[0.04] p-1 [scrollbar-width:none]">
            {tabs.map((t) => {
              const on = filter === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setFilter(t.key)}
                  style={{ fontFamily: "inherit" }}
                  className={[
                    "inline-flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border-0 px-3 py-2 text-[13.5px] font-semibold transition-colors",
                    on ? "bg-white text-slate-900" : "bg-transparent text-white/70 hover:bg-white/[0.06] hover:text-white",
                  ].join(" ")}
                >
                  {t.label}
                  <span className={["inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-px text-[11.5px] font-bold tabular-nums", on ? "bg-[#02665e] text-white" : "bg-white/10 text-white/80"].join(" ")}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Empty state ── */}
      {filteredBookings.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
            <BookOpen className="h-6 w-6" aria-hidden />
          </span>
          <div className="mt-3 text-[16px] font-bold text-slate-900">No bookings here yet</div>
          <div className="mt-1 max-w-xs text-sm text-slate-500">
            {filter === "active"
              ? "You have no upcoming stays right now."
              : filter === "expired"
                ? "Past stays will appear here after check-out."
                : filter === "draft"
                  ? "Nothing is waiting for payment."
                  : "When you book a stay, it will appear here."}
          </div>
          {filter === "all" ? (
            <Link
              href="/public/properties"
              className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
            >
              Browse stays
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBookings.map((booking) => {
            const nightCount = nights(booking.checkIn, booking.checkOut);
            const location = [booking.property.district, booking.property.city, booking.property.regionName].filter(Boolean).join(", ");
            const facts = [
              `${formatDate(booking.checkIn)} to ${formatDate(booking.checkOut)}`,
              nightCount > 0 ? `${nightCount} ${nightCount === 1 ? "night" : "nights"}` : "",
              booking.roomType || "",
              booking.rooms ? `${booking.rooms} ${booking.rooms === 1 ? "room" : "rooms"}` : "",
            ].filter(Boolean);

            // ── Awaiting payment ──
            if (isDraftBooking(booking)) {
              const expired = String(booking.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
              const timeLeft = draftTimeLeft(booking);
              const unavailable = booking.draftAvailability && !booking.draftAvailability.available;
              const canPay = !expired && !unavailable && Boolean(booking.invoiceId && booking.invoiceAccessToken);
              const payHref = canPay
                ? `/public/booking/payment?invoiceId=${encodeURIComponent(String(booking.invoiceId))}&accessToken=${encodeURIComponent(String(booking.invoiceAccessToken))}`
                : null;
              const reselectHref = booking.property.slug ? `/public/properties/${encodeURIComponent(booking.property.slug)}` : "/public/properties";
              const blocked = expired || unavailable;
              return (
                <div
                  key={booking.id}
                  className={[
                    "rounded-2xl border border-solid bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5",
                    blocked ? "border-rose-200" : "border-amber-300",
                  ].join(" ")}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-4">
                      <CalendarTile date={booking.checkIn} muted={blocked || undefined} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="m-0 truncate text-[16px] font-bold text-slate-900">{booking.property.title}</h3>
                          <span
                            className={[
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                              blocked ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800",
                            ].join(" ")}
                          >
                            {blocked ? <XCircle className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
                            {expired ? "Payment window closed" : unavailable ? "Room no longer available" : "Awaiting payment"}
                          </span>
                        </div>
                        {location ? (
                          <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-slate-500">
                            <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                            <span className="truncate">{location}</span>
                          </div>
                        ) : null}
                        <div className="mt-1.5 text-[13px] text-slate-700">{facts.join(" · ")}</div>
                        {booking.invoice?.invoiceNumber ? (
                          <div className="mt-1 font-mono text-[11.5px] text-slate-400">Invoice {booking.invoice.invoiceNumber}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 pt-3 sm:w-52 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                      <div className="text-right">
                        <div className="text-[18px] font-extrabold tabular-nums text-slate-900">
                          {formatAmount(booking.totalAmount)} <span className="text-[12px] font-semibold text-slate-500">TZS</span>
                        </div>
                        {!expired && timeLeft ? (
                          <div className="text-[12px] font-semibold text-amber-700">Pay within {timeLeft}</div>
                        ) : null}
                      </div>
                      {payHref ? (
                        <Link
                          href={payHref}
                          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
                        >
                          <CreditCard className="h-4 w-4" aria-hidden />
                          Complete payment
                        </Link>
                      ) : (
                        <Link
                          href={reselectHref}
                          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-800 no-underline transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                        >
                          {unavailable ? "Select another room" : "Book again"}
                          <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                      )}
                    </div>
                  </div>
                  <p className="m-0 mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
                    {expired
                      ? "This payment window has closed. Please make a new booking."
                      : unavailable
                        ? booking.draftAvailability?.message || "Payment is disabled because live availability changed after this draft was created."
                        : "Complete payment to confirm this booking and receive your check-in code."}
                  </p>
                </div>
              );
            }

            // ── Paid stay ──
            const active = isActive(booking);
            const inDays = daysUntil(booking.checkIn);
            const staying = active && inDays <= 0;
            const statusLabel = !active ? "Past stay" : staying ? "Staying now" : inDays === 1 ? "Tomorrow" : `In ${inDays} days`;
            return (
              <div
                key={booking.id}
                className="rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-[#02665e]/30 hover:shadow-md sm:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <CalendarTile date={booking.checkIn} muted={!active || undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="m-0 truncate text-[16px] font-bold text-slate-900">{booking.property.title}</h3>
                        <span
                          className={[
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                            !active ? "bg-slate-100 text-slate-600" : staying ? "bg-[#02665e] text-white" : "bg-[#02665e]/10 text-[#02665e]",
                          ].join(" ")}
                        >
                          {active ? <CheckCircle className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
                          {statusLabel}
                        </span>
                      </div>
                      {location ? (
                        <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-slate-500">
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                          <span className="truncate">{location}</span>
                        </div>
                      ) : null}
                      <div className="mt-1.5 text-[13px] text-slate-700">{facts.join(" · ")}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11.5px] text-slate-400">
                        {booking.bookingCode ? <span>Code {booking.bookingCode}</span> : null}
                        {booking.invoice?.receiptNumber ? <span>Receipt {booking.invoice.receiptNumber}</span> : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 pt-3 sm:w-56 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                    <div className="text-right">
                      <div className="text-[18px] font-extrabold tabular-nums text-slate-900">
                        {formatAmount(booking.totalAmount)} <span className="text-[12px] font-semibold text-slate-500">TZS</span>
                      </div>
                      <div className="text-[11.5px] text-slate-500">Paid</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {canRequestCancellation(booking) ? (
                        <Link
                          href={`/account/cancellations?code=${encodeURIComponent(booking.bookingCode!)}`}
                          title="Request cancellation"
                          aria-label="Request cancellation"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-500 no-underline transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <XCircle className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : null}
                      {booking.bookingCode ? (
                        <Link
                          href={`/account/bookings/${encodeURIComponent(booking.bookingReference)}/receipt`}
                          title="Receipt"
                          aria-label="Open receipt"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 no-underline transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : null}
                      <Link
                        href={`/account/bookings/${encodeURIComponent(booking.bookingReference)}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
                      >
                        <Eye className="h-4 w-4" aria-hidden />
                        View details
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
