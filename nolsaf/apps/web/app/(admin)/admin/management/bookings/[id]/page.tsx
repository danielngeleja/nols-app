"use client";
import React, { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BedDouble, Building2, Calendar, Check, ChevronRight, Copy, DollarSign, FileText, Home, Loader2, Mail, Phone, Star, XCircle } from "lucide-react";
import { adminRefOrId, useAdminHref } from "@/lib/adminRecordRefs";
import DocumentViewer from "@/components/admin/DocumentViewer";

const api = apiClient;

type BookingDetail = {
  id: number;
  status: string;
  checkIn: string;
  checkOut: string;
  totalAmount: number;
  guestName?: string | null;
  guestPhone?: string | null;
  nationality?: string | null;
  sex?: string | null;
  ageGroup?: string | null;
  roomCode?: string | null;
  createdAt?: string;
  updatedAt?: string;
  property?: {
    id: number;
    title?: string;
    type?: string | null;
    regionName?: string | null;
    city?: string | null;
    district?: string | null;
    ward?: string | null;
    country?: string | null;
    owner?: {
      id: number;
      name?: string | null;
      email?: string | null;
      phone?: string | null;
    };
  };
  code?: {
    id: number;
    codeVisible?: string | null;
    status?: string;
    generatedAt?: string | null;
    usedAt?: string | null;
    usedByOwner?: boolean | null;
  } | null;
  user?: {
    id: number;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    createdAt?: string | null;
  } | null;
  invoices?: Array<{
    id: number;
    status: string;
    total: number;
    issuedAt: string;
    approvedAt?: string | null;
    paidAt?: string | null;
    invoiceNumber?: string | null;
    receiptNumber?: string | null;
  }>;
};

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

/** Softens text stored in capitals (SHERATON HOTEL, DAR-ES-SALAAM) for display. */
function tidy(value?: string | null) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v !== v.toUpperCase() || !/[A-Z]/.test(v)) return v;
  const small = new Set(["es", "of", "and", "la", "na", "wa", "ya"]);
  return v
    .replace(/-/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function initialsOf(name?: string | null, fallback = "?") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

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

export default function ManagementBookingDetail() {
  const recordHref = useAdminHref();
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  // URL segment: the opaque bk_ reference (or a legacy numeric id, swapped for the reference on load).
  const routeRef = String(idParam ?? "").trim();
  const router = useRouter();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      // clipboard blocked; nothing else to do
    }
  }, []);

  // ── Document viewer (receipt and invoice) ────────────────────────────────
  // Both documents come from the shared customer template on the API and are
  // shown exactly as the server renders them, in a sandboxed frame (no scripts),
  // the same way the customer receipt pages do. Running them through the HTML
  // sanitizer stripped the <style> block and the data: images (logo, QR), which
  // is what produced the unstyled multi-page PDFs.
  const [receiptInvoiceId, setReceiptInvoiceId] = useState<number | null>(null);
  const [docKind, setDocKind] = useState<"receipt" | "invoice">("receipt");
  const [receiptHtml, setReceiptHtml] = useState<string>("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptFilename, setReceiptFilename] = useState<string>("");

  const openReceipt = useCallback(async (invoiceId: number, kind: "receipt" | "invoice" = "receipt") => {
    setDocKind(kind);
    setReceiptInvoiceId(invoiceId);
    setReceiptHtml("");
    setReceiptError(null);
    setReceiptLoading(true);
    const fallbackName = kind === "invoice" ? `Invoice-${invoiceId}.pdf` : `Booking-Receipt-${invoiceId}.pdf`;
    setReceiptFilename(fallbackName);
    try {
      const r = await fetch(`/api/admin/revenue/invoices/${invoiceId}/${kind}.html`, {
        credentials: "include",
        cache: "no-store",
      });
      const html = await r.text();
      if (!r.ok) throw new Error(`Could not load the ${kind} (${r.status}).`);
      setReceiptFilename(r.headers.get("x-nolsaf-filename") || fallbackName);
      setReceiptHtml(html);
    } catch (err: any) {
      setReceiptHtml("");
      setReceiptError(err?.message || `Could not load the ${kind}.`);
    } finally {
      setReceiptLoading(false);
    }
  }, []);

  const closeReceipt = useCallback(() => {
    setReceiptInvoiceId(null);
    setReceiptHtml("");
    setReceiptError(null);
  }, []);

  const load = React.useCallback(async () => {
    try {
      // IMPORTANT: Use API-prefixed route.
      // `/admin/bookings/:id` is also a Next.js page route; calling it from the browser can return HTML, not JSON.
      const url = `/api/admin/bookings/${encodeURIComponent(routeRef)}`;
      const r = await api.get<any>(url);

      setBooking(r.data as BookingDetail);
      if (/^\d+$/.test(routeRef) && (r.data as any)?.reference) router.replace(`/admin/management/bookings/${(r.data as any).reference}`);
    } catch (err: any) {
      console.error("Failed to load booking:", err);
    } finally {
      setLoading(false);
    }
  }, [routeRef, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading booking
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-solid border-neutral-300 bg-white px-5 py-6 shadow-sm">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><BedDouble className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold text-neutral-900">Booking not found</p>
          <p className="m-0 mt-0.5 text-xs text-neutral-500">It may have been removed, or the link is wrong.</p>
        </div>
        <Link href="/admin/management/bookings" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50">
          <ArrowLeft className="h-3.5 w-3.5" /> All bookings
        </Link>
      </div>
    );
  }

  const nights = Math.max(0, Math.round((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86_400_000));
  const statusKey = String(booking.status || "").toUpperCase();
  const statusMeta = STATUS_META[statusKey] ?? { label: humanize(booking.status), pill: "bg-white/10 text-white/80", tone: "text-white" };
  const paidInvoice = (booking.invoices ?? []).find((i) => ["PAID", "CUSTOMER_PAID"].includes(String(i.status).toUpperCase()));
  const viewerInvoice = (booking.invoices ?? []).find((i) => i.id === receiptInvoiceId) ?? null;
  const viewerPaid = viewerInvoice ? ["PAID", "CUSTOMER_PAID"].includes(String(viewerInvoice.status).toUpperCase()) : false;
  const viewerNumber = viewerInvoice
    ? (docKind === "receipt" ? viewerInvoice.receiptNumber || viewerInvoice.invoiceNumber : viewerInvoice.invoiceNumber) || receiptFilename.replace(/\.pdf$/i, "")
    : receiptFilename.replace(/\.pdf$/i, "");
  const guestName = booking.guestName || booking.user?.name || "Guest not named";
  const guestPhone = booking.guestPhone || booking.user?.phone || null;
  const owner = booking.property?.owner;
  const place = [tidy(booking.property?.district), tidy(booking.property?.regionName)].filter(Boolean).join(", ");
  const cancelled = statusKey === "CANCELED";

  // Where the booking is in its life, read from status, payment and the check-in code.
  const reached = {
    paid: Boolean(paidInvoice) || ["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN", "CHECKED_OUT"].includes(statusKey),
    code: Boolean(booking.code?.codeVisible),
    in: ["CHECKED_IN", "CHECKED_OUT"].includes(statusKey) || Boolean(booking.code?.usedAt),
    out: statusKey === "CHECKED_OUT",
  };
  const steps = [
    { label: "Booked", detail: booking.createdAt ? eat(booking.createdAt) : "Created", done: true },
    { label: "Paid", detail: paidInvoice?.paidAt ? eat(paidInvoice.paidAt) : reached.paid ? "Payment received" : "Waiting for payment", done: reached.paid },
    { label: "Code issued", detail: booking.code?.generatedAt ? eat(booking.code.generatedAt) : reached.code ? "Issued" : "After payment", done: reached.code },
    { label: "Checked in", detail: booking.code?.usedAt ? eat(booking.code.usedAt) : reached.in ? "In house" : `From ${eatDay(booking.checkIn)}`, done: reached.in },
    { label: "Checked out", detail: reached.out ? "Stay complete" : `By ${eatDay(booking.checkOut)}`, done: reached.out },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  const facts = [
    { label: "Stay", value: `${nights} ${nights === 1 ? "night" : "nights"}`, detail: `${eatDay(booking.checkIn)} to ${eatDay(booking.checkOut)}` },
    { label: "Guest", value: guestName, detail: owner?.name ? `Hosted by ${owner.name}` : booking.user?.email || "No contact on file" },
    { label: "Amount", value: tzs(booking.totalAmount), detail: paidInvoice ? `Paid${paidInvoice.paidAt ? ` ${eatDate(paidInvoice.paidAt)}` : ""}` : "Not paid yet" },
    { label: "Per night", value: nights > 0 ? tzs(Number(booking.totalAmount) / nights) : tzs(booking.totalAmount), detail: booking.roomCode ? `Room ${booking.roomCode}` : tidy(booking.property?.type) || "Room not set", mono: false },
  ];

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
        <div key={label} className="min-w-[180px] flex-1 bg-white px-4 py-3 sm:px-5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{label}</dt>
          <dd className={`m-0 mt-1 break-words text-sm font-semibold ${value ? "text-neutral-900" : "text-neutral-400"}`}>{value || "Not recorded"}</dd>
        </div>
      ))}
    </dl>
  );

  const reference = `NLS-B-${String(booking.id).padStart(6, "0")}`;

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
  const contactRow = (key: string, kind: "mail" | "tel", value: string, href: string) => (
    <div key={key} className="flex min-w-0 items-center gap-2 rounded-lg bg-neutral-50 px-2.5 py-1.5 ring-1 ring-inset ring-neutral-200">
      {kind === "mail" ? <Mail className="h-3.5 w-3.5 shrink-0 text-neutral-400" /> : <Phone className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
      <span className={`min-w-0 flex-1 truncate text-sm text-neutral-800 ${kind === "tel" ? "tabular-nums" : ""}`} title={value}>{value}</span>
      {copyButton(key, value, kind === "mail" ? "email" : "phone")}
      <a href={href} className="inline-flex h-7 shrink-0 items-center rounded-md bg-[#0b2420] px-2 text-[11px] font-semibold text-white no-underline hover:bg-[#12342f] hover:no-underline">
        {kind === "mail" ? "Email" : "Call"}
      </a>
    </div>
  );

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Link href="/admin/management/bookings" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80 no-underline hover:text-emerald-200">
                <ArrowLeft className="h-3.5 w-3.5" /> Bookings
              </Link>
              <h1 className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-bold tracking-tight text-white sm:text-2xl">
                Booking #{booking.id}
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusMeta.pill}`}>{statusMeta.label}</span>
              </h1>
              <p className="m-0 mt-1 max-w-2xl truncate text-sm text-white/60">
                {tidy(booking.property?.title) || "Property removed"}{place ? ` · ${place}` : ""}{booking.roomCode ? ` · Room ${booking.roomCode}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/admin/management/bookings/${(booking as any).reference ?? routeRef}/recommend`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline">
                <Star className="h-3.5 w-3.5" /> Recommend
              </Link>
            </div>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums text-white ${fact.mono ? "font-mono tracking-wider" : ""}`} title={String(fact.value)}>{fact.value}</dd>
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
              #{booking.id} {copyButton("id", String(booking.id), "booking number")}
            </p>
          </div>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Reference</p>
            <p className="m-0 mt-0.5 flex items-center gap-1 font-mono text-sm font-semibold text-neutral-800">
              {reference} {copyButton("ref", reference, "reference")}
            </p>
          </div>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Check-in</p>
            <p className="m-0 mt-0.5 text-sm font-semibold text-neutral-900">{eatDay(booking.checkIn)}, {eatYear(booking.checkIn)}</p>
          </div>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Check-out</p>
            <p className="m-0 mt-0.5 text-sm font-semibold text-neutral-900">{eatDay(booking.checkOut)}, {eatYear(booking.checkOut)}</p>
          </div>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Booked</p>
            <p className="m-0 mt-0.5 text-sm text-neutral-700">{booking.createdAt ? eat(booking.createdAt) : "Not recorded"}</p>
          </div>
        </div>
        {/* Tear line between the record and the code stub */}
        <div className="relative hidden w-0 border-0 border-l-2 border-dashed border-neutral-300 sm:block" aria-hidden>
          <span className="absolute -left-[9px] -top-[9px] h-4 w-4 rounded-full border border-solid border-neutral-300 bg-neutral-100" />
          <span className="absolute -bottom-[9px] -left-[9px] h-4 w-4 rounded-full border border-solid border-neutral-300 bg-neutral-100" />
        </div>
        <div className={`flex shrink-0 items-center gap-3 border-0 border-t-2 border-dashed border-neutral-300 px-5 py-4 sm:border-t-0 ${booking.code?.codeVisible ? "bg-[#0b2420] text-white" : "bg-neutral-50"}`}>
          <div className="min-w-0">
            <p className={`m-0 text-[10px] font-semibold uppercase tracking-[0.16em] ${booking.code?.codeVisible ? "text-emerald-300/80" : "text-neutral-400"}`}>Check-in code</p>
            {booking.code?.codeVisible ? (
              <p className="m-0 mt-0.5 flex items-center gap-1.5 font-mono text-2xl font-bold tracking-[0.18em]">
                {booking.code.codeVisible} {copyButton("code", booking.code.codeVisible, "check-in code", true)}
              </p>
            ) : (
              <p className="m-0 mt-0.5 text-sm font-semibold text-neutral-500">Issued after payment</p>
            )}
            {booking.code?.status && <p className={`m-0 mt-0.5 text-[11px] ${booking.code?.codeVisible ? "text-white/50" : "text-neutral-400"}`}>{humanize(booking.code.status)}{booking.code.usedAt ? ` · used ${eatDate(booking.code.usedAt)}` : ""}</p>}
          </div>
        </div>
      </section>

      {/* Progress */}
      <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-2 shadow-sm">
        {cancelled ? (
          <div className="flex items-center gap-3 rounded-xl bg-rose-50/70 px-4 py-3 ring-1 ring-inset ring-rose-200">
            <XCircle className="h-5 w-5 shrink-0 text-rose-600" />
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-rose-900">This booking was cancelled</p>
              <p className="m-0 mt-0.5 text-xs text-rose-800">{booking.updatedAt ? `Last changed ${eat(booking.updatedAt)}` : "It no longer holds the room."}</p>
            </div>
          </div>
        ) : (
          <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-5">
            {steps.map((step, i) => {
              const current = !step.done && i === doneCount;
              return (
                <li key={step.label} className={`relative min-w-0 rounded-xl p-3 ${step.done ? "bg-emerald-50/70 ring-1 ring-inset ring-emerald-200" : current ? "bg-white ring-1 ring-inset ring-neutral-900" : "bg-neutral-50 ring-1 ring-inset ring-neutral-200"}`}>
                  <span className="flex items-center gap-1.5">
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${step.done ? "bg-emerald-600 text-white" : current ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-500"}`}>
                      {step.done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className={`truncate text-xs font-semibold ${step.done ? "text-emerald-800" : "text-neutral-800"}`}>{step.label}</span>
                  </span>
                  <span className="mt-1.5 block truncate text-[11px] text-neutral-500" title={step.detail}>{step.detail}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Records */}
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
            {sectionHead(<Calendar className="h-4 w-4" />, "Stay")}
            {fieldGrid([
              ["Check-in", `${eatDay(booking.checkIn)}, ${eatYear(booking.checkIn)}`],
              ["Check-out", `${eatDay(booking.checkOut)}, ${eatYear(booking.checkOut)}`],
              ["Length", `${nights} ${nights === 1 ? "night" : "nights"}`],
              ["Room", booking.roomCode],
              ["Booked", booking.createdAt ? eat(booking.createdAt) : null],
              ["Last updated", booking.updatedAt ? eat(booking.updatedAt) : null],
            ])}
          </section>

          {/* People: the traveller and the host, each as a profile card */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm" aria-label="Guest">
              <div className="flex items-center gap-4 border-0 border-b border-solid border-neutral-200 bg-neutral-50 px-5 py-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white text-lg font-bold text-neutral-900 ring-2 ring-emerald-500 ring-offset-2">
                  {initialsOf(guestName, "G")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Guest</p>
                  <p className="m-0 mt-0.5 truncate text-base font-bold text-neutral-900" title={guestName}>{guestName}</p>
                  <p className="m-0 mt-0.5 text-xs text-neutral-500">
                    {booking.user?.createdAt ? `Traveller since ${new Date(booking.user.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })}` : booking.user?.id ? "Registered traveller" : "Booked without an account"}
                  </p>
                </div>
              </div>
              {(booking.nationality || booking.sex || booking.ageGroup) && (
                <div className="flex flex-wrap gap-1.5 px-5 pt-4">
                  {booking.nationality && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">{tidy(booking.nationality)}</span>}
                  {booking.sex && <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200">{tidy(booking.sex)}</span>}
                  {booking.ageGroup && <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200">Age {tidy(booking.ageGroup)}</span>}
                </div>
              )}
              <div className="flex-1 space-y-2 px-5 py-4">
                {booking.user?.email && contactRow("g-mail", "mail", booking.user.email, `mailto:${booking.user.email}?subject=Regarding your booking #${booking.id}`)}
                {guestPhone && contactRow("g-tel", "tel", guestPhone, `tel:${guestPhone}`)}
                {!booking.user?.email && !guestPhone && <p className="m-0 text-sm text-neutral-500">No contact details on file.</p>}
              </div>
              {booking.user?.id && (
                <Link href={`/admin/management/users?userId=${adminRefOrId("user", booking.user.id)}`} className="flex items-center justify-between border-0 border-t border-solid border-neutral-200 px-5 py-3 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50 hover:no-underline">
                  Open account #{booking.user.id} <ChevronRight className="h-4 w-4 text-neutral-400" />
                </Link>
              )}
            </section>

            <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm" aria-label="Property owner">
              {owner ? (
                <>
                  <div className="flex items-center gap-4 bg-[#0b2420] px-5 py-4 text-white">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-white/10 text-lg font-bold text-emerald-200 ring-1 ring-inset ring-white/20">
                      {initialsOf(owner.name, "O")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">Property owner</p>
                      <p className="m-0 mt-0.5 truncate text-base font-bold" title={owner.name || ""}>{owner.name || `Owner #${owner.id}`}</p>
                      <p className="m-0 mt-0.5 text-xs text-white/50">Host of this stay · #{owner.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600"><Building2 className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-semibold text-neutral-900">{tidy(booking.property?.title) || "Property"}</p>
                      <p className="m-0 truncate text-xs text-neutral-500">{[tidy(booking.property?.type), place].filter(Boolean).join(" · ") || "Location not set"}</p>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2 px-5 py-4">
                    {owner.email && contactRow("o-mail", "mail", owner.email, `mailto:${owner.email}?subject=Booking #${booking.id}`)}
                    {owner.phone && contactRow("o-tel", "tel", owner.phone, `tel:${owner.phone}`)}
                    {!owner.email && !owner.phone && <p className="m-0 text-sm text-neutral-500">No contact details on file.</p>}
                  </div>
                  <Link href={recordHref("owner", owner.id)} className="flex items-center justify-between border-0 border-t border-solid border-neutral-200 px-5 py-3 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50 hover:no-underline">
                    Open owner profile <ChevronRight className="h-4 w-4 text-neutral-400" />
                  </Link>
                </>
              ) : (
                <div className="flex flex-1 items-center gap-3 px-5 py-6">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-500"><Building2 className="h-5 w-5" /></span>
                  <p className="m-0 text-sm text-neutral-500">No owner is linked to this property.</p>
                </div>
              )}
            </section>
          </div>

          <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
            {sectionHead(<Home className="h-4 w-4" />, "Property", booking.property?.id ? (
              <Link href={`/admin/properties/previews?previewId=${adminRefOrId("property", booking.property.id)}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50">
                View property <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            ) : undefined)}
            {fieldGrid([
              ["Name", tidy(booking.property?.title)],
              ["Type", tidy(booking.property?.type)],
              ["Region", tidy(booking.property?.regionName)],
              ["District", tidy(booking.property?.district)],
              ["City", tidy(booking.property?.city)],
              ["Ward", tidy(booking.property?.ward)],
              ["Country", tidy(booking.property?.country)],
            ])}
          </section>

          <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
            {sectionHead(<FileText className="h-4 w-4" />, "Check-in code")}
            {booking.code ? (
              <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5">
                <span className="rounded-lg bg-neutral-50 px-4 py-2.5 font-mono text-xl font-bold tracking-[0.2em] text-neutral-900 ring-1 ring-inset ring-neutral-200">{booking.code.codeVisible || "Hidden"}</span>
                <dl className="m-0 grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                  <div><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Status</dt><dd className="m-0 mt-0.5 text-sm font-semibold text-neutral-900">{humanize(booking.code.status || "") || "Unknown"}</dd></div>
                  <div><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Issued</dt><dd className="m-0 mt-0.5 text-sm text-neutral-800">{booking.code.generatedAt ? eat(booking.code.generatedAt) : "Not recorded"}</dd></div>
                  <div><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Used</dt><dd className="m-0 mt-0.5 text-sm text-neutral-800">{booking.code.usedAt ? `${eat(booking.code.usedAt)}${booking.code.usedByOwner ? " by owner" : ""}` : "Not yet"}</dd></div>
                </dl>
              </div>
            ) : (
              <p className="m-0 px-4 py-4 text-sm text-neutral-500 sm:px-5">No code yet. It is issued once the booking is paid.</p>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="min-w-0 space-y-5">
          <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
            {sectionHead(<DollarSign className="h-4 w-4" />, "Payment")}
            <div className="px-4 py-4 sm:px-5">
              <p className="m-0 text-2xl font-bold tabular-nums text-neutral-900">{tzs(booking.totalAmount)}</p>
              <p className={`m-0 mt-1 inline-flex items-center gap-1.5 text-xs font-semibold ${paidInvoice ? "text-emerald-700" : "text-amber-700"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${paidInvoice ? "bg-emerald-500" : "bg-amber-400"}`} />
                {paidInvoice ? `Paid${paidInvoice.paidAt ? ` ${eat(paidInvoice.paidAt)}` : ""}` : "Not paid yet"}
              </p>
              {nights > 0 && <p className="m-0 mt-1 text-xs text-neutral-400">{tzs(Number(booking.totalAmount) / nights)} a night</p>}
            </div>

            <div className="border-0 border-t border-solid border-neutral-200">
              <p className="m-0 px-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400 sm:px-5">Invoices</p>
              {booking.invoices && booking.invoices.length > 0 ? (
                <ul className="m-0 list-none p-0">
                  {booking.invoices.map((invoice, i) => {
                    const paid = ["PAID", "CUSTOMER_PAID"].includes(String(invoice.status).toUpperCase());
                    return (
                      <li key={invoice.id} className={`px-4 py-3 sm:px-5 ${i ? "border-0 border-t border-solid border-neutral-200" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="m-0 truncate font-mono text-[13px] font-semibold text-neutral-900">{invoice.invoiceNumber || `#${invoice.id}`}</p>
                            <p className="m-0 mt-0.5 text-[11px] text-neutral-400">{invoice.issuedAt ? `Issued ${eat(invoice.issuedAt)}` : "Not issued"}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${paid ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>{humanize(invoice.status || "")}</span>
                        </div>
                        <p className="m-0 mt-1.5 text-sm font-semibold tabular-nums text-neutral-900">{tzs(invoice.total)}</p>
                        {invoice.receiptNumber && <p className="m-0 mt-0.5 text-[11px] text-neutral-500">Receipt <span className="font-mono">{invoice.receiptNumber}</span></p>}
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => void openReceipt(invoice.id, "receipt")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-2.5 text-xs font-semibold text-white hover:bg-[#12342f]">
                            <FileText className="h-3.5 w-3.5" /> Receipt
                          </button>
                          <button type="button" onClick={() => void openReceipt(invoice.id, "invoice")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                            <FileText className="h-3.5 w-3.5" /> Invoice
                          </button>
                          {invoice.receiptNumber && (
                            <a href={`/api/admin/invoices/${invoice.id}/receipt.png`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50">
                              QR
                            </a>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="m-0 px-4 pb-4 pt-1 text-sm text-neutral-500 sm:px-5">No invoices yet.</p>
              )}
            </div>
          </section>

        </div>
      </div>

      {/* Document viewer: receipt or invoice, exactly as the customer sees it */}
      <DocumentViewer
        open={receiptInvoiceId !== null}
        title={docKind === "invoice" ? "Invoice" : "Booking receipt"}
        subtitle={viewerNumber || undefined}
        meta={viewerInvoice ? (
          <>
            <span className="text-sm font-bold tabular-nums text-neutral-900">{tzs(viewerInvoice.total)}</span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${viewerPaid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{humanize(viewerInvoice.status)}</span>
            <span className="text-xs text-neutral-500">{viewerInvoice.paidAt ? "Paid" : "Issued"} {eatDate(viewerInvoice.paidAt || viewerInvoice.issuedAt)}</span>
          </>
        ) : null}
        html={receiptHtml}
        loading={receiptLoading}
        error={receiptError}
        filename={receiptFilename}
        tabs={[{ key: "receipt", label: "Receipt" }, { key: "invoice", label: "Invoice" }]}
        activeTab={docKind}
        onTabChange={(key) => { if (receiptInvoiceId !== null) void openReceipt(receiptInvoiceId, key as "receipt" | "invoice"); }}
        onClose={closeReceipt}
      />
    </div>
  );
}
