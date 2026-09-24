"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  CalendarX,
  CheckCircle,
  Clock,
  FileText,
  Hash,
  MapPin,
  Moon,
  Banknote,
  Receipt,
  XCircle,
  AlertCircle,
  Phone,
  Mail,
  User,
  Tag,
  ShieldCheck,
  Star,
  Sparkles,
  ScanLine,
} from "lucide-react";
import Link from "next/link";

const api = apiClient;

type BookingDetail = {
  id: number;
  bookingReference: string;
  status: string;
  checkIn: string;
  checkOut: string;
  totalAmount: number;
  currency?: string;
  roomType?: string;
  rooms?: number;
  services?: any;
  notes?: string;
  isValid: boolean;
  isPaid: boolean;
  bookingCode?: string | null;
  codeStatus?: string | null;
  createdAt: string;
  updatedAt: string;
  property: {
    id: number;
    title: string;
    type?: string;
    regionName?: string;
    district?: string;
    city?: string;
    ward?: string | null;
    street?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    owner?: { id: number; name: string; email?: string; phone?: string };
  };
  code?: { code: string; status: string } | null;
  invoices?: Array<{
    invoiceNumber?: string;
    receiptNumber?: string;
    status?: string;
    amount?: number;
  }>;
  user?: { id: number; name: string; email?: string; phone?: string };
};

function getStatusMeta(status: string) {
  const s = status.toLowerCase();
  if (s.includes("confirmed"))
    return {
      label: "Confirmed",
      badge: "bg-emerald-50 text-emerald-700 border border-emerald-200",
      icon: <CheckCircle className="h-3.5 w-3.5" />,
    };
  if (s.includes("checked_in"))
    return {
      label: "Checked In",
      badge: "bg-sky-50 text-sky-700 border border-sky-200",
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
    };
  if (s.includes("checked_out") || s.includes("completed"))
    return {
      label: "Completed",
      badge: "bg-violet-50 text-violet-700 border border-violet-200",
      icon: <Star className="h-3.5 w-3.5" />,
    };
  if (s.includes("cancel"))
    return {
      label: "Cancelled",
      badge: "bg-red-50 text-red-700 border border-red-200",
      icon: <XCircle className="h-3.5 w-3.5" />,
    };
  if (s.includes("pending"))
    return {
      label: "Pending",
      badge: "bg-amber-50 text-amber-700 border border-amber-200",
      icon: <Clock className="h-3.5 w-3.5" />,
    };
  return {
    label: status.replace(/_/g, " "),
    badge: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    icon: <Sparkles className="h-3.5 w-3.5" />,
  };
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function nights(ci: string, co: string) {
  return Math.round(
    (new Date(co).getTime() - new Date(ci).getTime()) / 86400000
  );
}

function canCancel(b: BookingDetail) {
  const s = b.status.toLowerCase();
  if (s.includes("cancel") || s.includes("checked_out")) return false;
  return (new Date(b.checkIn).getTime() - Date.now()) / 3600000 > 24;
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
        {label}
      </p>
      <p className="text-sm font-bold text-slate-800 leading-snug">{value}</p>
    </div>
  );
}

export default function BookingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [qrUrl, setQrUrl] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    api
      .get(`/api/customer/bookings/${encodeURIComponent(id)}`)
      .then((r) => {
        const next = r.data as BookingDetail;
        setBooking(next);
        if (/^\d+$/.test(id) && next.bookingReference) {
          router.replace(`/account/bookings/${encodeURIComponent(next.bookingReference)}`);
        }
      })
      .catch((e) =>
        setError(e.response?.data?.error || "Failed to load booking.")
      )
      .finally(() => setLoading(false));
  }, [id, router]);

  // Generate QR once booking loads
  useEffect(() => {
    if (!booking) return;
    const qrContent =
      booking.code?.code ||
      booking.bookingCode ||
      booking.bookingReference;
    (async () => {
      try {
        const QR = (await import("qrcode")) as any;
        const url = await QR.default.toDataURL(qrContent, {
          width: 220,
          margin: 2,
          color: { dark: "#0f172a", light: "#f0fdf4" },
        });
        setQrUrl(url);
      } catch {}
    })();
  }, [booking]);

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  }

  /* ── Loading skeleton ── */
  if (loading)
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4" aria-busy="true">
        <span role="status" className="sr-only">Loading booking</span>
        <div className="rounded-2xl bg-[#0a1110] px-5 py-5 sm:px-6">
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="mt-4 h-7 w-64 rounded-lg bg-white/15" />
          <div className="mt-3 h-3 w-72 rounded bg-white/10" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <div className="h-56 rounded-2xl border border-solid border-slate-200 bg-white" />
            <div className="h-40 rounded-2xl border border-solid border-slate-200 bg-white" />
          </div>
          <div className="space-y-4">
            <div className="h-72 rounded-2xl bg-[#0a1110]/90" />
            <div className="h-40 rounded-2xl border border-solid border-slate-200 bg-white" />
          </div>
        </div>
      </div>
    );

  /* ── Error ── */
  if (error || !booking)
    return (
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col items-center rounded-2xl border border-solid border-rose-200 bg-white px-6 py-12 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">
            <AlertCircle className="h-6 w-6" aria-hidden />
          </span>
          <h2 className="m-0 mt-3 text-[17px] font-bold text-slate-900">Booking not found</h2>
          <p className="m-0 mt-1 text-sm text-slate-500">{error || "We could not load this booking."}</p>
          <Link
            href="/account/bookings"
            className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014e47]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to my bookings
          </Link>
        </div>
      </div>
    );

  const meta = getStatusMeta(booking.status);
  const n = nights(booking.checkIn, booking.checkOut);
  const invoice = booking.invoices?.[0];
  const code = booking.code?.code || booking.bookingCode;
  const codeStatus = booking.code?.status || booking.codeStatus;
  const location = [booking.property.city, booking.property.district, booking.property.regionName]
    .filter(Boolean)
    .filter((p, i, all) => all.findIndex((q) => String(q).toLowerCase() === String(p).toLowerCase()) === i)
    .join(", ");
  // An invoice marked paid counts as paid, even when the booking flag lags behind
  const paid = Boolean(booking.isPaid) || /paid/i.test(String(invoice?.status || ""));
  const amount = Number(booking.totalAmount) || 0;
  const human = (v?: string | null) => String(v || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const shortDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const DateTile = ({ label, date }: { label: string; date: string }) => {
    const d = new Date(date);
    return (
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-16 w-14 flex-shrink-0 flex-col overflow-hidden rounded-xl border border-solid border-[#02665e]/25 bg-white text-center">
          <span className="bg-[#02665e] py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
            {d.toLocaleDateString("en-US", { month: "short" })}
          </span>
          <span className="flex flex-1 items-center justify-center text-[22px] font-extrabold leading-none tabular-nums text-slate-900">{d.getDate()}</span>
        </div>
        <div className="min-w-0 leading-tight">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</div>
          <div className="mt-0.5 text-[14px] font-bold text-slate-900">{d.toLocaleDateString("en-US", { weekday: "long" })}</div>
          <div className="text-[12.5px] text-slate-500">{d.getFullYear()}</div>
        </div>
      </div>
    );
  };

  const specs = [
    { label: "Room type", value: booking.roomType },
    { label: "Rooms", value: booking.rooms != null ? `${booking.rooms} ${booking.rooms === 1 ? "room" : "rooms"}` : null },
    { label: "Booked on", value: fmt(booking.createdAt) },
    { label: "Status", value: human(booking.status) },
  ].filter((x) => x.value);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      {/* ── Header band ── */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0a1110] text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.8)]" style={{ isolation: "isolate" }}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.6), rgba(2,102,94,0))" }} />
        <div className="px-5 pb-5 pt-4 sm:px-6">
          <button
            type="button"
            onClick={() => router.push("/account/bookings")}
            style={{ fontFamily: "inherit" }}
            className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[12.5px] font-semibold text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> My bookings
          </button>

          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="m-0 min-w-0 break-words text-[24px] font-bold leading-tight text-white sm:text-[28px]">{booking.property.title}</h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-bold text-white ring-1 ring-inset ring-white/15">
                  {meta.icon} {meta.label}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-white/60">
                {location ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-[#5ec8bb]" aria-hidden />
                    {location}
                  </span>
                ) : null}
                {booking.property.type ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-[#5ec8bb]" aria-hidden />
                    {human(booking.property.type)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex-shrink-0 rounded-xl border border-solid border-white/10 bg-white/[0.05] px-4 py-2.5 text-right">
              <div className="text-[20px] font-extrabold leading-none tabular-nums text-white">
                {n} <span className="text-[13px] font-semibold text-white/60">{n === 1 ? "night" : "nights"}</span>
              </div>
              <div className="mt-1 text-[12px] text-white/60">
                {shortDate(booking.checkIn)} to {shortDate(booking.checkOut)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left */}
        <div className="min-w-0 space-y-4">
          {/* Your stay */}
          <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
            <header className="flex items-center gap-2.5 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
                <Moon className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="m-0 text-[15px] font-bold text-slate-900">Your stay</h2>
            </header>
            <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
              <DateTile label="Check-in" date={booking.checkIn} />
              <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500 sm:flex-col sm:gap-1">
                <span className="hidden h-px w-16 bg-slate-200 sm:block" aria-hidden />
                <span className="rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[#02665e]">
                  {n} {n === 1 ? "night" : "nights"}
                </span>
                <span className="hidden h-px w-16 bg-slate-200 sm:block" aria-hidden />
              </div>
              <DateTile label="Check-out" date={booking.checkOut} />
            </div>
            {specs.length ? (
              <div className="grid grid-cols-2 border-0 border-t border-solid border-slate-100 sm:grid-cols-4">
                {specs.map((sp, i) => (
                  <div
                    key={sp.label}
                    className={[
                      "min-w-0 px-5 py-3",
                      i % 2 === 1 ? "border-0 border-l border-solid border-slate-100" : "",
                      i >= 2 ? "border-0 border-t border-solid border-slate-100 sm:border-t-0" : "",
                      i === 2 ? "sm:border-l" : "",
                    ].join(" ")}
                  >
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">{sp.label}</div>
                    <div className="mt-0.5 truncate text-[13.5px] font-semibold text-slate-900" title={String(sp.value)}>{sp.value}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* Booking code */}
          {code ? (
            <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
              <header className="flex items-center gap-2.5 border-0 border-b border-dashed border-slate-200 px-5 py-3.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
                  <Hash className="h-4 w-4" aria-hidden />
                </span>
                <h2 className="m-0 text-[15px] font-bold text-slate-900">Booking code</h2>
                {codeStatus ? (
                  <span
                    className={[
                      "ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em]",
                      codeStatus === "ACTIVE" ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-500",
                    ].join(" ")}
                  >
                    {human(codeStatus)}
                  </span>
                ) : null}
              </header>
              <div className="flex flex-col items-center gap-3 px-5 py-5 sm:flex-row sm:justify-between">
                <div className="min-w-0 text-center sm:text-left">
                  <div className="break-all font-mono text-[26px] font-black tracking-[0.18em] text-[#02665e] sm:text-[30px]">{code}</div>
                  <div className="mt-1 text-[12.5px] text-slate-500">Show this code at reception when you arrive.</div>
                </div>
                <button
                  type="button"
                  onClick={() => copyCode(code)}
                  style={{ fontFamily: "inherit" }}
                  className={[
                    "inline-flex h-10 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-solid px-4 text-[13px] font-semibold transition-colors",
                    codeCopied ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-800 hover:border-[#02665e]/40 hover:text-[#02665e]",
                  ].join(" ")}
                >
                  {codeCopied ? <CheckCircle className="h-4 w-4" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
                  {codeCopied ? "Copied" : "Copy code"}
                </button>
              </div>
            </section>
          ) : null}

          {/* Getting there: the exact spot, which the public page withholds for
              private homes until the stay is booked and paid. */}
          {(() => {
            const lat = Number(booking.property.latitude);
            const lng = Number(booking.property.longitude);
            const hasPoint = booking.property.latitude != null && booking.property.longitude != null && Number.isFinite(lat) && Number.isFinite(lng);
            const address = [booking.property.street, booking.property.ward, booking.property.district, booking.property.regionName]
              .map((p) => String(p || "").trim())
              .filter(Boolean)
              .filter((p, i, all) => all.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
              .join(", ");
            if (!hasPoint && !address) return null;
            return (
              <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
                <header className="flex items-center gap-2.5 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
                    <MapPin className="h-4 w-4" aria-hidden />
                  </span>
                  <h2 className="m-0 text-[15px] font-bold text-slate-900">Getting there</h2>
                </header>
                <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    {address ? <p className="m-0 text-[14px] font-semibold text-slate-900">{address}</p> : null}
                    <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">Exact location of your stay.</p>
                  </div>
                  {hasPoint ? (
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
                      >
                        <MapPin className="h-4 w-4" aria-hidden />
                        Directions
                      </a>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 items-center rounded-lg border border-solid border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 no-underline transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                      >
                        Open in Maps
                      </a>
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })()}

          {/* Notes */}
          {booking.notes ? (
            <section className="rounded-2xl border border-solid border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#02665e]">
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Notes
              </div>
              <p className="m-0 whitespace-pre-line text-sm leading-relaxed text-slate-700">{booking.notes}</p>
            </section>
          ) : null}
        </div>

        {/* Right */}
        <div className="min-w-0 space-y-4">
          {/* Check-in pass */}
          <section className="relative overflow-hidden rounded-2xl bg-[#0a1110] p-5 text-white" style={{ isolation: "isolate" }}>
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 -z-10 h-48 w-48 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.55), rgba(2,102,94,0))" }} />
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[#5ec8bb]">
              <ScanLine className="h-4 w-4" aria-hidden />
              Check-in pass
            </div>
            <div className="mt-4 flex justify-center">
              {qrUrl ? (
                <div className="w-full max-w-[210px] rounded-2xl bg-white p-3 shadow-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrUrl} alt="Booking QR code" className="block h-auto w-full" style={{ imageRendering: "pixelated" }} />
                </div>
              ) : (
                <div className="flex aspect-square w-full max-w-[210px] items-center justify-center rounded-2xl bg-white/[0.06]">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-solid border-white/20 border-t-[#5ec8bb]" />
                </div>
              )}
            </div>
            {code ? <div className="mt-3 text-center font-mono text-[15px] font-bold tracking-[0.2em] text-white">{code}</div> : null}
            <p className="m-0 mt-1 text-center text-[12px] text-white/55">Show this at reception on arrival</p>
          </section>

          {/* Payment */}
          <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  <Banknote className="h-4 w-4 text-[#02665e]" aria-hidden />
                  Payment
                </div>
                <span
                  className={[
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold",
                    paid ? "bg-[#02665e]/10 text-[#02665e]" : "bg-amber-50 text-amber-700",
                  ].join(" ")}
                >
                  {paid ? <CheckCircle className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
                  {paid ? "Paid" : "Pending"}
                </span>
              </div>
              <div className="mt-2 text-[26px] font-extrabold leading-tight tabular-nums text-slate-900">
                <span className="mr-1 text-[14px] font-semibold text-slate-500">{booking.currency || "TZS"}</span>
                {amount.toLocaleString("en-US")}
              </div>
              <div className="text-[12px] text-slate-500">
                for {n} {n === 1 ? "night" : "nights"}
                {n > 0 ? ` · about ${Math.round(amount / n).toLocaleString("en-US")} a night` : ""}
              </div>
            </div>
            {invoice?.invoiceNumber || invoice?.receiptNumber ? (
              <dl className="m-0 border-0 border-t border-solid border-slate-100 px-5 py-3 text-[12.5px]">
                {invoice?.invoiceNumber ? (
                  <div className="flex items-center justify-between gap-3 py-1">
                    <dt className="inline-flex items-center gap-1.5 text-slate-500"><FileText className="h-3.5 w-3.5" aria-hidden /> Invoice</dt>
                    <dd className="m-0 font-mono text-slate-800">{invoice.invoiceNumber}</dd>
                  </div>
                ) : null}
                {invoice?.receiptNumber ? (
                  <div className="flex items-center justify-between gap-3 py-1">
                    <dt className="inline-flex items-center gap-1.5 text-slate-500"><Receipt className="h-3.5 w-3.5" aria-hidden /> Receipt</dt>
                    <dd className="m-0 font-mono font-semibold text-[#02665e]">{invoice.receiptNumber}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </section>

          {/* Host contact */}
          {booking.property.owner ? (
            <section className="rounded-2xl border border-solid border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Your host</div>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-[15px] font-bold text-white">
                  {booking.property.owner.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold text-slate-900">{booking.property.owner.name}</div>
                  <div className="truncate text-[12px] text-slate-500">{booking.property.owner.phone || booking.property.owner.email || "Property manager"}</div>
                </div>
                <div className="flex flex-shrink-0 gap-1.5">
                  {booking.property.owner.phone ? (
                    <a
                      href={`tel:${booking.property.owner.phone}`}
                      title="Call"
                      aria-label="Call the host"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#02665e] text-white transition-colors hover:bg-[#014e47]"
                    >
                      <Phone className="h-4 w-4" aria-hidden />
                    </a>
                  ) : null}
                  {booking.property.owner.email ? (
                    <a
                      href={`mailto:${booking.property.owner.email}`}
                      title="Email"
                      aria-label="Email the host"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-700 transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                    >
                      <Mail className="h-4 w-4" aria-hidden />
                    </a>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {/* Actions */}
          <div className="space-y-2">
            {canCancel(booking) ? (
              <Link
                href={`/account/cancellations?code=${encodeURIComponent(code || booking.bookingReference)}`}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-solid border-rose-200 bg-white text-sm font-semibold text-rose-600 no-underline transition-colors hover:bg-rose-50"
              >
                <XCircle className="h-4 w-4" aria-hidden />
                Request cancellation
              </Link>
            ) : null}
            <Link
              href="/account/bookings"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-solid border-slate-200 bg-white text-sm font-semibold text-slate-600 no-underline transition-colors hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> All my bookings
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
