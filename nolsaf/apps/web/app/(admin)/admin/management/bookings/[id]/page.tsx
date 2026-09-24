"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, Mail, Phone, Calendar, Printer, User, Home, DollarSign, FileText, Star, X } from "lucide-react";
import { sanitizeTrustedHtml } from "@/utils/html";

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

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="font-semibold text-sm text-gray-900">{value || "—"}</div>
    </div>
  );
}

export default function ManagementBookingDetail() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const id = Number(idParam);
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Receipt modal ─────────────────────────────────────────────────────────
  const [receiptInvoiceId, setReceiptInvoiceId] = useState<number | null>(null);
  const [receiptHtml, setReceiptHtml] = useState<string>("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptFilename, setReceiptFilename] = useState<string>("");
  const [receiptPdfUrl, setReceiptPdfUrl] = useState<string | null>(null);
  const [receiptPdfBusy, setReceiptPdfBusy] = useState(false);
  const [receiptIframeH, setReceiptIframeH] = useState<number>(600);
  const receiptContainerRef = useRef<HTMLDivElement | null>(null);

  const sanitizedReceiptHtml = useMemo(
    () => (receiptHtml ? sanitizeTrustedHtml(receiptHtml) : ""),
    [receiptHtml]
  );

  const openReceipt = useCallback(async (invoiceId: number) => {
    setReceiptInvoiceId(invoiceId);
    setReceiptHtml("");
    setReceiptPdfUrl(null);
    setReceiptIframeH(600);
    setReceiptLoading(true);
    setReceiptFilename(`Booking-Receipt-invoice-${invoiceId}.pdf`);
    try {
      const r = await fetch(`/api/admin/revenue/invoices/${invoiceId}/receipt.html`, {
        credentials: "include",
        cache: "no-store",
      });
      const html = await r.text();
      if (!r.ok) throw new Error(`Failed to load receipt (${r.status})`);
      const fn = r.headers.get("x-nolsaf-filename") || `Booking-Receipt-invoice-${invoiceId}.pdf`;
      setReceiptFilename(fn);
      setReceiptHtml(html);
    } catch {
      setReceiptHtml("");
    } finally {
      setReceiptLoading(false);
    }
  }, []);

  const closeReceipt = useCallback(() => {
    setReceiptInvoiceId(null);
    setReceiptHtml("");
    setReceiptPdfUrl(null);
  }, []);

  const printReceipt = useCallback(() => {
    const root = receiptContainerRef.current;
    if (!root) return;
    const el = (root.querySelector(".sheet") as HTMLElement | null) || root;
    const w = window.open("", "", "width=760,height=980");
    if (!w) return;
    w.document.write(
      `<!DOCTYPE html><html><head><title>Booking Receipt</title><style>*{box-sizing:border-box}body{margin:0;padding:0;background:#fff}</style></head><body>${el.outerHTML}</body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  }, []);

  useEffect(() => {
    let revoked: string | null = null;
    async function gen() {
      if (!sanitizedReceiptHtml || receiptInvoiceId === null) return;
      const root = receiptContainerRef.current;
      if (!root) return;
      const el = (root.querySelector(".sheet") as HTMLElement | null) || root;
      setReceiptPdfBusy(true);
      try {
        const mod: any = await import("html2pdf.js");
        const h2p = mod.default || mod;
        if (!h2p) throw new Error("html2pdf failed");
        const pdf = await h2p().from(el).set({
          filename: receiptFilename,
          margin: 0,
          jsPDF: { unit: "mm", format: "a5", orientation: "portrait" },
          html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 558 },
          pagebreak: { mode: [] },
        }).toPdf().get("pdf");
        const url = pdf.output("bloburl");
        revoked = url;
        setReceiptPdfUrl(url);
      } catch {
        setReceiptPdfUrl(null);
      } finally {
        setReceiptPdfBusy(false);
      }
    }
    gen();
    return () => { if (revoked) { try { URL.revokeObjectURL(revoked); } catch {} } };
  }, [sanitizedReceiptHtml, receiptInvoiceId, receiptFilename]);

  const load = React.useCallback(async () => {
    try {
      // IMPORTANT: Use API-prefixed route.
      // `/admin/bookings/:id` is also a Next.js page route; calling it from the browser can return HTML, not JSON.
      const url = `/api/admin/bookings/${id}`;
      const r = await api.get<any>(url);

      setBooking(r.data as BookingDetail);
    } catch (err: any) {
      console.error("Failed to load booking:", err);
      if (err?.response?.status === 404) {
        alert("Booking not found");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-emerald-600"></div>
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">Booking not found</p>
          <Link
            href="/admin/management/bookings"
            className="text-emerald-600 hover:text-emerald-700 underline"
          >
            ← Back to bookings list
          </Link>
        </div>
      </div>
    );
  }

  function getStatusBadgeClass(status: string) {
    const statusLower = String(status || "").toLowerCase();
    if (statusLower.includes('confirmed') || statusLower.includes('active')) {
      return "inline-flex items-center px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium";
    }
    if (statusLower.includes('pending') || statusLower.includes('new')) {
      return "inline-flex items-center px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-sm font-medium";
    }
    if (statusLower.includes('cancel')) {
      return "inline-flex items-center px-3 py-1 rounded-full bg-red-100 text-red-800 text-sm font-medium";
    }
    if (statusLower.includes('check')) {
      return "inline-flex items-center px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm font-medium";
    }
    return "inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm font-medium";
  }

  const checkInDate = new Date(booking.checkIn);
  const checkOutDate = new Date(booking.checkOut);
  const nights = Math.max(0, Math.round((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/management/bookings"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to bookings list"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Booking #{booking.id}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <span className={getStatusBadgeClass(booking.status)}>
                  {booking.status}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Property Details */}
          <div className="bg-gradient-to-br from-white to-emerald-50 rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                <Home className="h-5 w-5 text-[#02665e]" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Property Details</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoRow label="Property Name" value={booking.property?.title} />
                  <InfoRow label="Property Type" value={booking.property?.type} />
                  <InfoRow label="Country" value={booking.property?.country} />
                  <InfoRow label="Region" value={booking.property?.regionName} />
                  <InfoRow label="City" value={booking.property?.city} />
                  <InfoRow label="District" value={booking.property?.district} />
                  <InfoRow label="Ward" value={booking.property?.ward} />
                </div>
              </div>
            </div>
          </div>

          {/* Guest Information */}
          <div className="bg-gradient-to-br from-white to-blue-50 rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <User className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Guest Information</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoRow label="Full Name" value={booking.guestName || booking.user?.name} />
                  <InfoRow label="Phone" value={booking.guestPhone || booking.user?.phone} />
                  <InfoRow label="Email" value={booking.user?.email} />
                  <InfoRow label="Nationality" value={booking.nationality} />
                  <InfoRow label="Sex" value={booking.sex} />
                  <InfoRow label="Age Group" value={booking.ageGroup} />
                  {booking.user?.createdAt && (
                    <div className="sm:col-span-2">
                      <InfoRow 
                        label="Account Created" 
                        value={new Date(booking.user.createdAt).toLocaleString()} 
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Booking Dates and Details */}
          <div className="bg-gradient-to-br from-white to-purple-50 rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                <Calendar className="h-5 w-5 text-purple-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Booking Dates & Details</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Check-in</div>
                    <div className="font-semibold text-sm text-gray-900">
                      {checkInDate.toLocaleDateString()}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {checkInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Check-out</div>
                    <div className="font-semibold text-sm text-gray-900">
                      {checkOutDate.toLocaleDateString()}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {checkOutDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                  <InfoRow label="Duration" value={`${nights} ${nights === 1 ? 'night' : 'nights'}`} />
                  <InfoRow label="Room Code" value={booking.roomCode} />
                  {booking.createdAt && (
                    <div className="sm:col-span-2">
                      <InfoRow 
                        label="Booking Created" 
                        value={new Date(booking.createdAt).toLocaleString()} 
                      />
                    </div>
                  )}
                  {booking.updatedAt && (
                    <div className="sm:col-span-2">
                      <InfoRow 
                        label="Last Updated" 
                        value={new Date(booking.updatedAt).toLocaleString()} 
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Check-in Code */}
          <div className="bg-gradient-to-br from-white to-emerald-50 rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Check-in Code</h2>
                {booking.code ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InfoRow label="Code" value={booking.code.codeVisible} />
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Status</div>
                      <span className={getStatusBadgeClass(booking.code.status || "")}>
                        {booking.code.status || "—"}
                      </span>
                    </div>
                    {booking.code.generatedAt && (
                      <InfoRow 
                        label="Generated At" 
                        value={new Date(booking.code.generatedAt).toLocaleString()} 
                      />
                    )}
                    {booking.code.usedAt && (
                      <InfoRow 
                        label="Used At" 
                        value={new Date(booking.code.usedAt).toLocaleString()} 
                      />
                    )}
                    {booking.code.usedByOwner !== null && booking.code.usedByOwner !== undefined && (
                      <InfoRow 
                        label="Used By Owner" 
                        value={booking.code.usedByOwner ? "Yes" : "No"} 
                      />
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">No check-in code generated yet</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Amount */}
          <div className="bg-gradient-to-br from-white to-amber-50 rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <DollarSign className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Amount</h2>
                <div className="text-2xl font-bold text-gray-900">
                  {new Intl.NumberFormat('en-US').format(Number(booking.totalAmount))} TZS
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-gradient-to-br from-white to-gray-50 rounded-lg border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Actions</h2>
            <div className="space-y-3">
              {(booking.user?.email || booking.guestPhone || booking.user?.phone) && (
                <>
                  {booking.user?.email && (
                    <a
                      href={`mailto:${booking.user.email}?subject=Regarding Your Booking #${booking.id}`}
                      className="no-underline flex items-center gap-3 w-full px-4 py-3 bg-blue-600 text-white rounded-xl shadow-sm hover:shadow-md hover:bg-blue-700 active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    >
                      <Mail className="h-5 w-5" />
                      <span className="font-medium">Email Guest</span>
                    </a>
                  )}
                  {(booking.guestPhone || booking.user?.phone) && (
                    <a
                      href={`tel:${booking.guestPhone || booking.user?.phone}`}
                      className="no-underline flex items-center gap-3 w-full px-4 py-3 bg-green-600 text-white rounded-xl shadow-sm hover:shadow-md hover:bg-green-700 active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
                    >
                      <Phone className="h-5 w-5" />
                      <span className="font-medium">Call Guest</span>
                    </a>
                  )}
                </>
              )}
              <Link
                href={`/admin/management/bookings/${booking.id}/recommend`}
                className="no-underline flex items-center gap-3 w-full px-4 py-3 bg-purple-600 text-white rounded-xl shadow-sm hover:shadow-md hover:bg-purple-700 active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"
              >
                <Star className="h-5 w-5" />
                <span className="font-medium">Recommend Properties/Services</span>
              </Link>
            </div>
          </div>

          {/* Property Owner */}
          {booking.property?.owner && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Property Owner</h2>
              <div className="space-y-2">
                <InfoRow label="Name" value={booking.property.owner.name} />
                {booking.property.owner.email && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Email</div>
                    <a
                      href={`mailto:${booking.property.owner.email}`}
                      className="font-semibold text-sm text-blue-600 hover:text-blue-700"
                    >
                      {booking.property.owner.email}
                    </a>
                  </div>
                )}
                {booking.property.owner.phone && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Phone</div>
                    <a
                      href={`tel:${booking.property.owner.phone}`}
                      className="font-semibold text-sm text-blue-600 hover:text-blue-700"
                    >
                      {booking.property.owner.phone}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Invoices */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Invoices</h2>
            {booking.invoices && booking.invoices.length > 0 ? (
              <div className="space-y-2">
                {booking.invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="p-4 bg-gradient-to-b from-slate-50 to-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Invoice</div>
                          <div className="text-sm font-semibold text-gray-900 truncate">
                            {invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : `#${invoice.id}`}
                          </div>
                        </div>
                        <span className={getStatusBadgeClass(invoice.status || "")}>
                          {(invoice.status || "—").toUpperCase()}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs text-gray-700">
                        <div className="rounded-xl bg-white/70 border border-gray-200 p-3">
                          <div className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">Amount</div>
                          <div className="mt-0.5 text-sm font-bold text-gray-900">
                            {new Intl.NumberFormat("en-US").format(Number(invoice.total))}{" "}
                            <span className="text-xs font-semibold text-gray-600">TZS</span>
                          </div>
                        </div>
                        <div className="rounded-xl bg-white/70 border border-gray-200 p-3">
                          <div className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">Issued</div>
                          <div className="mt-0.5 text-sm font-semibold text-gray-900">
                            {invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString() : "—"}
                          </div>
                          {invoice.issuedAt && (
                            <div className="text-[11px] text-gray-500 mt-0.5">
                              {new Date(invoice.issuedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          )}
                        </div>
                        {invoice.receiptNumber ? (
                          <div className="col-span-2 rounded-xl bg-white/70 border border-gray-200 p-3">
                            <div className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">Receipt</div>
                            <div className="mt-0.5 font-mono text-sm font-semibold text-gray-900 truncate">
                              {invoice.receiptNumber}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Link
                          href={`/admin/revenue/${invoice.id}`}
                          className="no-underline inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 text-gray-800 shadow-sm hover:shadow-md hover:bg-gray-50 active:scale-[0.99] transition-all"
                          title="View invoice in admin"
                        >
                          <FileText className="h-4 w-4" />
                          Invoice
                        </Link>
                        <button
                          type="button"
                          onClick={() => openReceipt(invoice.id)}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#02665e] text-white shadow-sm hover:shadow-md hover:bg-[#014e47] active:scale-[0.99] transition-all"
                          title="View receipt"
                        >
                          <FileText className="h-4 w-4" />
                          Receipt
                        </button>
                        {invoice.receiptNumber && (
                          <Link
                            href={`/api/admin/invoices/${invoice.id}/receipt.png`}
                            target="_blank"
                            rel="noreferrer"
                            className="no-underline inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 text-gray-800 shadow-sm hover:shadow-md hover:bg-gray-50 active:scale-[0.99] transition-all"
                            title="Open receipt QR (PNG)"
                          >
                            <span className="text-xs font-semibold">QR</span>
                          </Link>
                        )}
                      </div>

                      {invoice.receiptNumber && (
                        <div className="pt-2">
                          <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                            Receipt QR
                          </div>
                          <div className="inline-flex rounded-2xl bg-white border border-gray-200 p-3 shadow-sm">
                            <Image
                              src={`/api/admin/invoices/${invoice.id}/receipt.png`}
                              alt="Receipt QR"
                              width={160}
                              height={160}
                              unoptimized
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-500">No invoices available</div>
            )}          </div>
        </div>
      </div>

      {/* ── Receipt modal ── */}
      {receiptInvoiceId !== null && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={closeReceipt}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-gray-200 shrink-0"
              style={{ borderTop: "3px solid #02665e" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
                  style={{ background: "rgba(2,102,94,0.08)" }}
                >
                  <FileText className="h-4 w-4" style={{ color: "#02665e" }} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 leading-tight">Booking Receipt</p>
                  <p className="text-xs text-gray-400 leading-tight">NoLSAF</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={printReceipt}
                  disabled={receiptLoading || !receiptHtml}
                  title="Print receipt"
                  className="h-9 w-9 flex items-center justify-center rounded-lg text-white shadow-sm transition hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "#02665e" }}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <a
                  href={receiptPdfUrl || "#"}
                  download={receiptFilename}
                  onClick={(e) => { if (!receiptPdfUrl) e.preventDefault(); }}
                  title={receiptPdfBusy ? "Generating PDF…" : "Download PDF"}
                  className={`no-underline h-9 w-9 flex items-center justify-center rounded-lg border transition ${
                    receiptPdfUrl
                      ? "border-gray-300 text-gray-600 hover:bg-gray-50"
                      : "border-gray-200 text-gray-300 cursor-not-allowed"
                  }`}
                >
                  {receiptPdfBusy
                    ? <span className="h-4 w-4 border-2 border-gray-300 rounded-full animate-spin" style={{ borderTopColor: "#02665e" }} />
                    : <Download className="h-4 w-4" />}
                </a>
                <div className="w-px h-5 bg-gray-200 mx-0.5" />
                <button
                  type="button"
                  onClick={closeReceipt}
                  title="Close"
                  className="h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition shrink-0"
                  aria-label="Close receipt"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 p-4 sm:p-6">
              {receiptLoading ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <div className="w-8 h-8 border-2 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: "#02665e" }} />
                  <p className="text-sm text-gray-500">Loading receipt…</p>
                </div>
              ) : receiptHtml ? (
                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                  {receiptPdfUrl ? (
                    <iframe title="Receipt PDF" src={receiptPdfUrl} className="w-full" style={{ height: "75vh" }} />
                  ) : (
                    <iframe
                      title="Receipt"
                      srcDoc={sanitizedReceiptHtml}
                      className="w-full block border-0"
                      style={{ height: receiptIframeH }}
                      onLoad={(e) => {
                        const doc = e.currentTarget.contentDocument;
                        const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || 600;
                        setReceiptIframeH(h);
                      }}
                    />
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 gap-2">
                  <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                    <X className="h-5 w-5 text-red-400" />
                  </div>
                  <p className="text-sm font-medium text-red-500">Receipt unavailable</p>
                  <p className="text-xs text-gray-400">Please try again or contact support</p>
                </div>
              )}
            </div>
          </div>
          <div className="fixed left-[-10000px] top-0 pointer-events-none">
            <div ref={receiptContainerRef} dangerouslySetInnerHTML={{ __html: sanitizedReceiptHtml }} />
          </div>
        </div>
      )}
    </div>
  );
}
