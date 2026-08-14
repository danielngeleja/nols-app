"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Printer, MapPin, BadgeCheck, Building2, User, CalendarDays, Clock, Loader2 } from "lucide-react";
const api = apiClient;
const RECEIPT_FONT = '"Trebuchet MS", Trebuchet, Arial, sans-serif';

function formatSettlement(value: string, timeZone = "Africa/Dar_es_Salaam"): string {
  const dateTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

  return `${dateTime} EAT`;
}

export default function Receipt() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!idParam) return;
    setError(null);
    setData(null);
    setQrDataUrl(null);
    api
      .get(`/api/owner/revenue/invoices/${idParam}/receipt`)
      .then((r) => setData(r.data))
      .catch((e: any) => setError(String(e?.response?.data?.error || e?.message || "Failed to load receipt")));
  }, [idParam]);

  // Load the exact server-signed QR used by the emailed PDF. The browser never
  // creates or signs receipt claims itself.
  useEffect(() => {
    if (!data?.invoice || !idParam) return;
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/owner/revenue/invoices/${encodeURIComponent(idParam)}/receipt/qr.png`, {
          credentials: "include",
          cache: "force-cache",
        });
        if (!response.ok) return;
        const blob = await response.blob();
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve(String(reader.result || ""));
          reader.readAsDataURL(blob);
        });
        if (alive) setQrDataUrl(url);
      } catch {
        if (alive) setQrDataUrl(null);
      }
    })();
    return () => { alive = false; };
  }, [data, idParam]);

  async function handlePrint() {
    if (!data?.invoice) return;
    const inv = data.invoice;
    const receipt = data.receipt || {};
    const property = inv?.booking?.property;
    const booking = inv?.booking;
    const codeVis = inv?.booking?.code?.codeVisible ?? inv?.booking?.code?.code ?? "-";
    const checkIn = booking?.checkIn ? new Date(booking.checkIn) : null;
    const checkOut = booking?.checkOut ? new Date(booking.checkOut) : null;
    const nights = checkIn && checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000) : null;

    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const esc = (s: any) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

    // Fetch logo as base64
    let logoDataUrl = "";
    try {
      const r = await fetch("/assets/NoLS2025-04.png");
      if (r.ok) {
        const blob = await r.blob();
        logoDataUrl = await new Promise<string>((res) => { const reader = new FileReader(); reader.onload = () => res(reader.result as string); reader.readAsDataURL(blob); });
      }
    } catch { /* skip */ }

    const qr = qrDataUrl || "";

    const propLine = [property?.type, property?.city, property?.district, property?.regionName, property?.country].filter(Boolean).join(" · ");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Receipt ${esc(inv.receiptNumber)}</title>
<style>
  @page { size: 148mm 210mm; margin: 8mm 7mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Trebuchet MS', Trebuchet, Arial, sans-serif; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #1e3a38; }
  .card { width: 134mm; background: #fff; border: 1px solid #e2eae9; border-radius: 14px; overflow: hidden; }

  /* dot rows */
  .dots-top { height: 5px; background-image: radial-gradient(circle, #02665e 1.5px, transparent 1.5px); background-size: 10px 5px; background-repeat: repeat-x; background-position: center; }
  .dots-bot { height: 5px; background-image: radial-gradient(circle, #02665e 1.5px, transparent 1.5px); background-size: 10px 5px; background-repeat: repeat-x; background-position: center; }
  .dots-inner { height: 4px; background-image: radial-gradient(circle, rgba(2,102,94,0.55) 1.5px, transparent 1.5px); background-size: 9px 4px; background-repeat: repeat-x; background-position: center; }

  /* header */
  .header { padding: 12px 16px 12px; border-bottom: 1px solid #edf4f3; }
  .brand-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .brand-left { display: flex; align-items: center; gap: 8px; }
  .brand-logo { width: 28px; height: 28px; border-radius: 8px; object-fit: contain; background: #edf7f6; }
  .brand-name { font-size: 12px; font-weight: 900; color: #024d47; letter-spacing: 0.05em; }
  .verified-badge { display: flex; align-items: center; gap: 4px; background: #edf7f6; border: 1px solid #c0dedd; border-radius: 999px; padding: 3px 8px; }
  .verified-badge span { font-size: 8px; font-weight: 900; color: #02665e; text-transform: uppercase; letter-spacing: 0.12em; }
  .title-block { text-align: center; margin-bottom: 8px; }
  .label-xs { font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.2em; color: #8aaca9; margin-bottom: 2px; }
  .receipt-title { font-size: 18px; font-weight: 900; color: #0f2e2b; letter-spacing: -0.02em; }
  .amount-block { text-align: center; }
  .amount-num { font-size: 30px; font-weight: 900; color: #02665e; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .amount-cur { font-size: 13px; font-weight: 700; color: #5a9990; margin-left: 2px; }
  .paid-date { font-size: 9px; font-weight: 500; color: #8aaca9; margin-top: 2px; }

  /* reference strip */
  .ref-strip { display: grid; grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr); align-items: center; gap: 12px; padding: 6px 16px; background: #f7fbfa; border-bottom: 1px solid #edf4f3; }
  .ref-item { min-width: 0; overflow: hidden; }
  .ref-item.right { text-align: right; }
  .ref-num { font-family: monospace; font-size: 9px; font-weight: 700; color: #1e3a38; letter-spacing: 0.04em; white-space: nowrap; }
  .ref-divider { width: 1px; height: 20px; background: #d0e8e5; flex-shrink: 0; }

  /* body */
  .body { padding: 8px 14px 6px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px; }
  .card-cell { background: #f7fbfa; border: 1px solid #edf4f3; border-radius: 10px; padding: 8px; }
  .sec-label { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
  .sec-label-text { font-size: 7px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.18em; color: #8aaca9; }
  .detail-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; margin-bottom: 4px; }
  .detail-row:last-child { margin-bottom: 0; }
  .dl { font-size: 8.5px; color: #8aaca9; white-space: nowrap; flex-shrink: 0; }
  .dv { font-size: 9px; font-weight: 600; color: #1e3a38; text-align: right; min-width: 0; word-break: break-all; }
  .dv.accent { color: #02665e; font-weight: 700; font-family: monospace; }
  .dv.mono { font-family: monospace; }
  .prop-row { display: flex; align-items: flex-start; gap: 6px; margin-top: 4px; }
  .prop-icon { width: 20px; height: 20px; border-radius: 6px; background: #02665e; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .prop-title { font-size: 9.5px; font-weight: 700; color: #0f2e2b; line-height: 1.3; }
  .prop-sub { font-size: 8px; color: #5a9990; margin-top: 1px; line-height: 1.3; }
  .guest-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
  .guest-avatar { width: 20px; height: 20px; border-radius: 50%; background: #02665e; color: #fff; font-size: 10px; font-weight: 900; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .guest-name { font-size: 9.5px; font-weight: 700; color: #0f2e2b; }
  .guest-phone { font-size: 8px; font-family: monospace; color: #5a9990; margin-top: 1px; }

  /* footer seal */
  .seal-wrap { margin: 4px 10px 10px; border: 1px solid #edf4f3; border-radius: 10px; overflow: hidden; }
  .seal-body { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 10px 12px; background: #f7fbfa; }
  .seal-badge-row { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; }
  .seal-dot { width: 12px; height: 12px; border-radius: 50%; background: #02665e; display: flex; align-items: center; justify-content: center; }
  .seal-title { font-size: 7.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.14em; color: #024d47; }
  .seal-text { font-size: 8px; color: #5a9990; line-height: 1.5; }
  .seal-scan { font-size: 7px; color: #9ab8b6; margin-top: 3px; }
  .qr-wrap { text-align: center; flex-shrink: 0; }
  .qr-label { font-size: 6.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #8aaca9; margin-bottom: 3px; }
  .qr-box { display: inline-block; padding: 5px; background: #fff; border: 1px solid #d0e8e5; border-radius: 8px; }
  .qr-box img { width: 66px; height: 66px; display: block; }
</style>
</head>
<body>
<div class="card">
  <div class="dots-top"></div>

  <div class="header">
    <div class="brand-row">
      <div class="brand-left">
        ${logoDataUrl ? `<img class="brand-logo" src="${esc(logoDataUrl)}" alt="NoLSAF"/>` : ""}
        <span class="brand-name">NoLSAF</span>
      </div>
      <div class="verified-badge"><span>&#10003; Verified</span></div>
    </div>
    <div class="title-block">
      <div class="label-xs">Owner Payout Confirmation</div>
      <div class="receipt-title">Payout Receipt</div>
    </div>
    <div class="amount-block">
      <div class="label-xs">Owner Payout</div>
      <span class="amount-num">${esc(Number((inv.netPayable ?? inv.total) || 0).toLocaleString())}</span><span class="amount-cur">${esc(receipt.currency || "TZS")}</span>
      ${inv.paidAt ? `<div class="paid-date">${esc(formatSettlement(inv.paidAt, receipt.timeZone))}</div>` : ""}
    </div>
  </div>

  <div class="ref-strip">
    <div class="ref-item">
      <div class="label-xs">Receipt Number</div>
      <div class="ref-num">${esc(inv.receiptNumber)}</div>
    </div>
    <div class="ref-divider"></div>
    <div class="ref-item right">
      <div class="label-xs">Invoice</div>
      <div class="ref-num">${esc(inv.invoiceNumber)}</div>
    </div>
  </div>

  <div class="body">
    <div class="grid2">
      <div class="card-cell">
        <div class="sec-label"><span class="sec-label-text">Payment</span></div>
        <div class="detail-row"><span class="dl">Method</span><span class="dv">${esc(inv.paymentMethod || "—")}</span></div>
        ${inv.paidAt ? `<div class="detail-row"><span class="dl">Settled</span><span class="dv">${esc(formatSettlement(inv.paidAt, receipt.timeZone))}</span></div>` : ""}
        <div class="detail-row"><span class="dl">Provider ref</span><span class="dv mono">${esc(receipt.providerReference || inv.paymentRef || "—")}</span></div>
        <div class="detail-row"><span class="dl">NoLSAF ref</span><span class="dv mono">${esc(receipt.nolsafReference || "—")}</span></div>
        <div class="detail-row"><span class="dl">Destination</span><span class="dv mono">${esc(receipt.maskedDestination || "Not recorded")}</span></div>
      </div>
      <div class="card-cell">
        <div class="sec-label"><span class="sec-label-text">Booking</span></div>
        <div class="detail-row"><span class="dl">Code</span><span class="dv accent">${esc(codeVis)}</span></div>
        ${checkIn ? `<div class="detail-row"><span class="dl">Check-in</span><span class="dv">${esc(fmt(checkIn))}</span></div>` : ""}
        ${checkOut ? `<div class="detail-row"><span class="dl">Check-out</span><span class="dv">${esc(fmt(checkOut))}</span></div>` : ""}
        ${nights !== null ? `<div class="detail-row"><span class="dl">Duration</span><span class="dv">${nights} night${nights !== 1 ? "s" : ""}</span></div>` : ""}
        <div class="detail-row"><span class="dl">Booking</span><span class="dv">#${esc(inv.bookingId)}</span></div>
      </div>
    </div>

    <div class="grid2">
      ${property ? `
      <div class="card-cell">
        <div class="sec-label"><span class="sec-label-text">Property</span></div>
        <div class="prop-row">
          <div class="prop-icon"></div>
          <div><div class="prop-title">${esc(property.title)}</div><div class="prop-sub">${esc(propLine)}</div></div>
        </div>
      </div>` : ""}
      ${booking?.guestName ? `
      <div class="card-cell">
        <div class="sec-label"><span class="sec-label-text">Guest</span></div>
        <div class="guest-row">
          <div class="guest-avatar">${esc(booking.guestName.charAt(0).toUpperCase())}</div>
          <div><div class="guest-name">${esc(booking.guestName)}</div>${booking.guestPhone ? `<div class="guest-phone">${esc(booking.guestPhone)}</div>` : ""}</div>
        </div>
      </div>` : ""}
    </div>
  </div>

  <div class="seal-wrap">
    <div class="dots-inner"></div>
    <div class="seal-body">
      <div>
        <div class="seal-badge-row"><div class="seal-dot"></div><span class="seal-title">NoLSAF &middot; Certified Receipt</span></div>
        <div class="seal-text">${esc(receipt.disclaimer || "This is a NoLSAF payout confirmation, not an AzamPay, bank, or mobile-network-issued receipt.")}</div>
        <div class="seal-scan">Scan QR to verify this receipt.</div>
      </div>
      <div class="qr-wrap">
        <div class="qr-label">QR &middot; Verify</div>
        <div class="qr-box">${qr ? `<img src="${esc(qr)}" alt="QR"/>` : `<div style="width:66px;height:66px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9ab8b6;">—</div>`}</div>
      </div>
    </div>
  </div>

  <div class="dots-bot"></div>
</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};}</script>
</body>
</html>`;

    const popup = window.open("", "_blank", "width=620,height=820");
    if (!popup) { window.alert("Please allow popups for this site to print receipts."); return; }
    popup.document.write(html);
    popup.document.close();
  }

  if (!idParam) return <div>Missing receipt id</div>;
  if (error) {
    return (
      <div className="flex items-center justify-center py-20 px-6">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6 text-center">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Error</h2>
          <p className="text-slate-600 mb-6">{error}</p>
          <Link href="/owner/revenue/paid" className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#02665e] text-white no-underline">
            Back to disbursed
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="relative mb-6">
          <span className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" />
          <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
        </div>
        <p className="text-sm font-semibold text-slate-700 tracking-tight">Loading Receipt</p>
        <p className="text-xs text-slate-400 mt-1">Please wait…</p>
      </div>
    );
  }

  const { invoice: inv } = data;
  const receipt = data.receipt || {};
  const settlementLabel = inv?.paidAt ? formatSettlement(inv.paidAt, receipt.timeZone) : null;
  const codeVisible = inv?.booking?.code?.codeVisible ?? inv?.booking?.code?.code ?? "-";
  const property = inv?.booking?.property;
  const booking = inv?.booking;
  const checkIn = booking?.checkIn ? new Date(booking.checkIn) : null;
  const checkOut = booking?.checkOut ? new Date(booking.checkOut) : null;
  const nights = (() => {
    if (!checkIn || !checkOut) return null;
    const n = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000);
    return Number.isFinite(n) && n >= 0 ? n : null;
  })();

  return (
    <div className="bg-white min-h-screen" id="receipt-root" data-receipt-ready="true" style={{ fontFamily: RECEIPT_FONT }}>
      <style jsx global>{`
        @media print {
          @page {
            size: A5 portrait;
            margin: 8mm 7mm;
          }
          html, body {
            width: 148mm;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          #receipt-root {
            background: #fff !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .no-print { display: none !important; }
          #receipt-card {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            page-break-inside: avoid;
            break-inside: avoid;
            overflow: visible !important;
          }
          #receipt-wrap {
            padding: 0 !important;
            max-width: 100% !important;
          }
        }
      `}</style>

      {/* ── Nav bar (screen only) ── */}
      <div className="no-print border-b border-slate-100 bg-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/owner/revenue/paid" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-[#02665e] transition-colors no-underline">
            <ChevronLeft className="w-4 h-4" />
            Disbursed
          </Link>
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white transition-all"
            style={{ background: "linear-gradient(135deg,#024d47,#02665e)" }}
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>
      </div>

      {/* ── Receipt wrapper ── */}
      <div id="receipt-wrap" className="max-w-[460px] mx-auto px-4 py-6 print:px-0 print:py-0">
        <div
          id="receipt-card"
          className="bg-white rounded-2xl overflow-hidden"
          style={{ border: "1px solid #e2eae9", boxShadow: "0 2px 8px rgba(2,102,94,0.06),0 12px 40px rgba(2,102,94,0.08)" }}
        >

          {/* ══ TOP DOT ROW ═════ */}
          <div className="w-full" style={{ height: "5px", backgroundImage: "radial-gradient(circle, #02665e 1.5px, transparent 1.5px)", backgroundSize: "10px 5px", backgroundRepeat: "repeat-x", backgroundPosition: "center" }} />

          {/* ══ HEADER — white background ═════ */}
          <div className="px-5 pt-4 pb-4 border-b" style={{ borderColor: "#edf4f3" }}>
            {/* Brand row */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/assets/NoLS2025-04.png" alt="NoLSAF" className="w-8 h-8 rounded-xl object-contain flex-shrink-0" style={{ background: "#edf7f6" }} />
                <span className="text-[13px] font-black tracking-wide" style={{ color: "#024d47" }}>NoLSAF</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: "#edf7f6", border: "1px solid #c0dedd" }}>
                <BadgeCheck className="w-3 h-3" style={{ color: "#02665e" }} />
                <span className="text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: "#02665e" }}>Verified</span>
              </div>
            </div>

            {/* Title */}
            <div className="text-center mb-3">
              <p className="text-[8px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: "#8aaca9" }}>Owner Payout Confirmation</p>
              <h1 className="text-[19px] font-black tracking-tight" style={{ color: "#0f2e2b" }}>Payout Receipt</h1>
            </div>

            {/* Amount */}
            <div className="text-center">
              <p className="text-[8px] font-bold uppercase tracking-[0.18em] mb-1" style={{ color: "#8aaca9" }}>Owner Payout</p>
              <div className="flex items-baseline justify-center gap-1 leading-none">
                <span className="text-[36px] font-black tabular-nums tracking-tight" style={{ color: "#02665e" }}>
                  {Number((inv?.netPayable ?? inv?.total) || 0).toLocaleString()}
                </span>
                <span className="text-[15px] font-bold" style={{ color: "#5a9990" }}>{receipt.currency || "TZS"}</span>
              </div>
              {inv?.paidAt && (
                <p className="text-[10px] mt-1 font-medium" style={{ color: "#8aaca9" }}>
                  {settlementLabel}
                </p>
              )}
            </div>
          </div>

          {/* ══ REFERENCE STRIP ═════ */}
          <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center gap-3 px-5 py-2 border-b" style={{ background: "#f7fbfa", borderColor: "#edf4f3" }}>
            <div className="min-w-0 overflow-hidden">
              <p className="text-[7.5px] font-bold uppercase tracking-[0.18em] mb-0.5" style={{ color: "#8aaca9" }}>Receipt Number</p>
              <p className="whitespace-nowrap font-mono text-[8px] sm:text-[10px] font-bold tracking-[0.01em] sm:tracking-[0.06em]" style={{ color: "#1e3a38" }}>{inv?.receiptNumber || "—"}</p>
            </div>
            <div className="w-px h-6 self-center" style={{ background: "#d0e8e5" }} />
            <div className="min-w-0 overflow-hidden text-right">
              <p className="text-[7.5px] font-bold uppercase tracking-[0.18em] mb-0.5" style={{ color: "#8aaca9" }}>Invoice</p>
              <p className="whitespace-nowrap font-mono text-[8px] sm:text-[10px] font-bold tracking-[0.01em] sm:tracking-[0.06em]" style={{ color: "#1e3a38" }}>{inv?.invoiceNumber || "—"}</p>
            </div>
          </div>

          {/* ══ BODY ═════ */}
          <div className="px-5 pt-3 pb-2 space-y-2.5">

            {/* Payment + Booking 2-col */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl p-2.5" style={{ background: "#f7fbfa", border: "1px solid #edf4f3" }}>
                <SectionLabel icon={<Clock className="w-2.5 h-2.5" />} label="Payment" />
                <div className="mt-2 space-y-1.5">
                  <DetailRow label="Method" value={inv?.paymentMethod || "—"} />
                  {settlementLabel && <DetailRow label="Settled" value={settlementLabel} wrap />}
                  <DetailRow label="Provider ref" value={receipt.providerReference || inv?.paymentRef || "—"} mono wrap />
                  <DetailRow label="NoLSAF ref" value={receipt.nolsafReference || "—"} mono wrap />
                  <DetailRow label="Destination" value={receipt.maskedDestination || "Not recorded"} mono />
                </div>
              </div>
              <div className="rounded-xl p-2.5" style={{ background: "#f7fbfa", border: "1px solid #edf4f3" }}>
                <SectionLabel icon={<CalendarDays className="w-2.5 h-2.5" />} label="Booking" />
                <div className="mt-2 space-y-1.5">
                  <DetailRow label="Code" value={codeVisible} accent mono />
                  {checkIn && <DetailRow label="Check-in" value={checkIn.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />}
                  {checkOut && <DetailRow label="Check-out" value={checkOut.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />}
                  {typeof nights === "number" && <DetailRow label="Duration" value={`${nights} night${nights !== 1 ? "s" : ""}`} />}
                  <DetailRow label="Booking" value={`#${inv?.bookingId}`} />
                </div>
              </div>
            </div>

            {/* Property + Guest side by side if both exist, else full width */}
            {property && booking?.guestName ? (
              <div className="grid grid-cols-2 gap-2">
                {/* Property */}
                <div className="rounded-xl p-2.5" style={{ background: "#f7fbfa", border: "1px solid #edf4f3" }}>
                  <SectionLabel icon={<MapPin className="w-2.5 h-2.5" />} label="Property" />
                  <div className="mt-2 flex items-start gap-2">
                    <div className="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: "#02665e" }}>
                      <Building2 className="w-3 h-3 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10.5px] font-bold leading-tight" style={{ color: "#0f2e2b" }}>{property?.title || "—"}</p>
                      <p className="text-[9px] mt-0.5 leading-snug" style={{ color: "#5a9990" }}>
                        {[property?.type, property?.city, property?.district, property?.regionName, property?.country].filter(Boolean).join(", ")}
                      </p>
                    </div>
                  </div>
                </div>
                {/* Guest */}
                <div className="rounded-xl p-2.5" style={{ background: "#f7fbfa", border: "1px solid #edf4f3" }}>
                  <SectionLabel icon={<User className="w-2.5 h-2.5" />} label="Guest" />
                  <div className="mt-2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-black text-white" style={{ background: "#02665e" }}>
                      {booking.guestName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10.5px] font-bold" style={{ color: "#0f2e2b" }}>{booking.guestName}</p>
                      {booking?.guestPhone && <p className="text-[9px] font-mono mt-0.5" style={{ color: "#5a9990" }}>{booking.guestPhone}</p>}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {property && (
                  <div className="rounded-xl p-2.5" style={{ background: "#f7fbfa", border: "1px solid #edf4f3" }}>
                    <SectionLabel icon={<MapPin className="w-2.5 h-2.5" />} label="Property" />
                    <div className="mt-2 flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: "#02665e" }}>
                        <Building2 className="w-3 h-3 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold" style={{ color: "#0f2e2b" }}>{property?.title || "—"}</p>
                        <p className="text-[9px] mt-0.5" style={{ color: "#5a9990" }}>
                          {[property?.type, property?.city, property?.district, property?.regionName, property?.country].filter(Boolean).join("  ·  ")}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {booking?.guestName && (
                  <div className="rounded-xl p-2.5" style={{ background: "#f7fbfa", border: "1px solid #edf4f3" }}>
                    <SectionLabel icon={<User className="w-2.5 h-2.5" />} label="Guest" />
                    <div className="mt-2 flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[12px] font-black text-white" style={{ background: "#02665e" }}>
                        {booking.guestName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold" style={{ color: "#0f2e2b" }}>{booking.guestName}</p>
                        {booking?.guestPhone && <p className="text-[9px] font-mono mt-0.5" style={{ color: "#5a9990" }}>{booking.guestPhone}</p>}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ══ FOOTER SEAL ════ */}
          <div className="mx-3 mb-3 mt-1 rounded-xl overflow-hidden" style={{ border: "1px solid #edf4f3" }}>
            <div className="w-full" style={{ height: "4px", backgroundImage: "radial-gradient(circle, rgba(2,102,94,0.55) 1.5px, transparent 1.5px)", backgroundSize: "9px 4px", backgroundRepeat: "repeat-x", backgroundPosition: "center" }} />
            <div className="px-3.5 py-3 grid grid-cols-[1fr,auto] gap-3 items-center" style={{ background: "#f7fbfa" }}>
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: "#02665e" }}>
                    <BadgeCheck className="w-2 h-2 text-white" />
                  </div>
                  <span className="text-[8.5px] font-black uppercase tracking-[0.15em]" style={{ color: "#024d47" }}>NoLSAF · Certified Receipt</span>
                </div>
                <p className="text-[9px] leading-relaxed" style={{ color: "#5a9990" }}>
                  {receipt.disclaimer || "This is a NoLSAF payout confirmation, not an AzamPay, bank, or mobile-network-issued receipt."}
                </p>
                <p className="text-[8px] mt-1" style={{ color: "#9ab8b6" }}>Scan QR to verify this receipt.</p>
              </div>
              <div className="text-center flex-shrink-0">
                <p className="text-[7px] font-bold uppercase tracking-[0.12em] mb-1" style={{ color: "#8aaca9" }}>QR · Verify</p>
                <div className="inline-block p-1.5 bg-white rounded-lg" style={{ border: "1px solid #d0e8e5" }}>
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrDataUrl}
                      alt="Receipt QR"
                      width={66}
                      height={66}
                      className="block"
                    />
                  ) : (
                    <div className="w-[66px] h-[66px] flex items-center justify-center text-[8px]" style={{ color: "#9ab8b6" }}>loading…</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ══ BOTTOM DOT ROW ═══ */}
          <div className="w-full" style={{ height: "5px", backgroundImage: "radial-gradient(circle, #02665e 1.5px, transparent 1.5px)", backgroundSize: "10px 5px", backgroundRepeat: "repeat-x", backgroundPosition: "center" }} />

        </div>

        <p className="no-print text-center text-[10px] mt-3" style={{ color: "#9ab8b6" }}>
          NoLSAF payout confirmation · Signed and independently verifiable
        </p>
      </div>
    </div>
  );
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span style={{ color: "#5a9990" }}>{icon}</span>
      <span className="text-[8px] font-black uppercase tracking-[0.18em]" style={{ color: "#8aaca9" }}>{label}</span>
    </div>
  );
}

function DetailRow({ label, value, mono, accent, wrap }: { label: string; value: string; mono?: boolean; accent?: boolean; wrap?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[9.5px] shrink-0 mt-px" style={{ color: "#8aaca9" }}>{label}</span>
      <span
        className={`text-right text-[10px] min-w-0 ${mono ? (wrap ? "font-mono break-all whitespace-normal" : "font-mono tracking-[0.08em]") : "font-semibold"} ${wrap ? "" : "truncate"}`}
        style={{ color: accent ? "#02665e" : "#1e3a38", fontWeight: accent ? 700 : undefined }}
      >
        {value}
      </span>
    </div>
  );
}



