/**
 * PDF Generation Service for Booking Codes and Reservation Forms
 * Uses a simple HTML-to-PDF approach (can be enhanced with libraries like puppeteer, pdfkit, etc.)
 */

import { makeQR } from "./qr.js";

export interface BookingDetails {
  bookingId: number;
  bookingCode: string;
  guestName: string;
  guestPhone?: string;
  nationality?: string;
  property: {
    title: string;
    type: string;
    regionName?: string;
    district?: string;
    city?: string;
    country?: string;
  };
  checkIn: Date | string;
  checkOut: Date | string;
  roomType?: string;
  rooms?: number;
  nights?: number;
  totalAmount: number;
  services?: any;
  invoice?: {
    invoiceNumber?: string;
    receiptNumber?: string;
    paidAt?: Date | string;
  };
  /**
   * Wording for receipts that are not a stay (e.g. a tour package). Every field
   * is optional; when absent the booking receipt renders exactly as before, so
   * all customer receipts share one template.
   */
  document?: {
    title?: string;
    reservationKicker?: string;
    reservationSub?: string;
    periodColumn?: string;
    periodTitle?: string;
    periodSub?: string;
    lineTitle?: string;
    lineSub?: string;
    currency?: string;
    confirmationCopy?: string;
    verifyUrl?: string | null;
  };
}

/**
 * Generate QR code data URL for booking details
 */
async function generateBookingQRCode(details: BookingDetails): Promise<string> {
  try {
    // Encode key booking details in the QR itself (offline-friendly).
    // Owners can scan and instantly see/import the booking info without relying on a URL.
    const toISODate = (d: Date | string | undefined) => {
      try {
        if (!d) return undefined;
        return new Date(d).toISOString().slice(0, 10);
      } catch {
        return undefined;
      }
    };

    const origin = process.env.WEB_ORIGIN || process.env.APP_ORIGIN;
    const url = details.document && "verifyUrl" in details.document
      ? details.document.verifyUrl || undefined
      : origin ? `${origin.replace(/\/+$/, "")}/public/booking/${encodeURIComponent(details.bookingCode)}` : undefined;

    // Keep payload compact (QR capacity). Use short keys.
    const payloadObj: any = {
      v: 1,
      c: details.bookingCode, // code
      id: details.bookingId, // booking id
      ci: toISODate(details.checkIn), // check-in date
      co: toISODate(details.checkOut), // check-out date
      amt: Number(details.totalAmount || 0), // amount
      rn: details.invoice?.receiptNumber || undefined, // receipt number
      gn: details.guestName || undefined, // guest name
      gp: details.guestPhone || undefined, // guest phone
      nat: details.nationality || undefined, // nationality
      p: details.property?.title || undefined, // property title (optional)
      u: url, // optional web URL for richer view
    };

    const qrPayload = JSON.stringify(payloadObj);
    const { png } = await makeQR(qrPayload);
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (error: any) {
    console.error("Failed to generate QR code:", error);
    // Return a placeholder if QR generation fails
    return "";
  }
}

/**
 * Generate HTML for booking reservation form
 */
export async function generateBookingReservationHTML(details: BookingDetails): Promise<string> {
  // Generate QR code
  const qrCodeDataUrl = await generateBookingQRCode(details);

  // HTML-escape all guest/property-controlled fields. This HTML is served directly
  // (receipt.html) and rendered in an iframe, so unescaped values would be an XSS vector.
  const esc = (value: unknown): string =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const parseValidDate = (value: Date | string | undefined | null): Date | null => {
    try {
      if (value == null) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const formatDate = (value: Date | string | undefined | null): string => {
    const d = parseValidDate(value);
    if (!d) return "—";
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatDateTime = (value: Date | string | undefined | null): string => {
    const d = parseValidDate(value);
    if (!d) return "—";
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Logo: use a configured image URL if provided; otherwise embed a print-safe SVG logo.
  const inlineLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="NoLSAF logo"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#02665e"/><stop offset="1" stop-color="#014d47"/></linearGradient></defs><rect x="6" y="6" width="84" height="84" rx="22" fill="url(#g)"/><path d="M28 63V33h7l19 20V33h7v30h-7L35 43v20h-7z" fill="#fff" opacity="0.98"/></svg>`;
  const inlineLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(inlineLogoSvg, "utf8").toString("base64")}`;
  // Prefer your real logo from apps/web/public/assets when WEB_ORIGIN/APP_ORIGIN is configured.
  const origin = (process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "").replace(/\/+$/, "");
  const defaultLogoUrl = origin ? `${origin}/assets/NoLS2025-04.png` : "";
  const logoSrc = process.env.PDF_LOGO_URL || process.env.BRAND_LOGO_URL || defaultLogoUrl || inlineLogoDataUri;
  const supportEmail = process.env.PAYMENTS_EMAIL || "payments@nolsaf.com";
  const supportPhone = process.env.SUPPORT_PHONE || process.env.SUPPORT_TEL || "";
  const supportWebsite = "nolsaf.com";
  const generatedAt = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const checkIn = formatDate(details.checkIn);
  const checkOut = formatDate(details.checkOut);
  const providedNights = typeof details.nights === "number" && Number.isFinite(details.nights) ? details.nights : null;
  const computedNights = (() => {
    const ci = parseValidDate(details.checkIn);
    const co = parseValidDate(details.checkOut);
    if (!ci || !co) return null;
    const diffDays = Math.ceil((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24));
    return Number.isFinite(diffDays) && diffDays > 0 ? diffDays : null;
  })();
  const nights = Math.max(1, Math.floor(providedNights ?? computedNights ?? 1));
  const amount = Number(details.totalAmount || 0).toLocaleString("en-US");
  const paidAt = details.invoice?.paidAt ? formatDateTime(details.invoice.paidAt) : null;

  const receiptReference = String(
    details.invoice?.receiptNumber || details.bookingCode || details.bookingId || ""
  );
  const invoiceReference = details.invoice?.invoiceNumber
    ? String(details.invoice.invoiceNumber)
    : "Not issued";
  const propertyLocation = [
    details.property.city,
    details.property.district,
    details.property.regionName,
    details.property.country,
  ]
    .filter(Boolean)
    .join(", ");
  const roomDescription = [
    details.roomType,
    details.rooms ? `${details.rooms} room${details.rooms === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  const doc = details.document ?? {};
  const currency = doc.currency || "TZS";
  const documentTitle = doc.title || "BOOKING RECEIPT";
  const reservationKicker = doc.reservationKicker || "Reservation";
  const reservationSub = doc.reservationSub ?? `${details.property.type}${propertyLocation ? ` | ${propertyLocation}` : ""}`;
  const periodColumn = doc.periodColumn || "Stay";
  const periodTitle = doc.periodTitle || `${checkIn} to ${checkOut}`;
  const periodSub = doc.periodSub ?? `${nights} night${nights === 1 ? "" : "s"}`;
  const lineTitle = doc.lineTitle || roomDescription || details.property.type || "Accommodation";
  const confirmationCopy = doc.confirmationCopy
    || "The reservation is confirmed. Present the reservation code above at check-in. This document is not a fiscal tax receipt.";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(doc.title ? doc.title.charAt(0) + doc.title.slice(1).toLowerCase() : "Booking Receipt")} ${esc(details.bookingCode)}</title>
  <style>
    @media print {
      @page { size: A5; margin: 0; }
      html, body {
        width: 148mm !important;
        height: 210mm !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet {
        position: relative !important;
        left: auto !important;
        top: auto !important;
        margin: 0 !important;
        transform: none !important;
        page-break-inside: avoid;
        break-inside: avoid;
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      font-family: "Trebuchet MS", Trebuchet, Arial, sans-serif;
      color: #172b2a;
    }
    .sheet {
      width: 148mm;
      height: 210mm;
      margin: 0;
      overflow: hidden;
      background: #fff;
      padding: 8mm 7mm;
      font-size: 9.5pt;
      line-height: 1.35;
    }
    .receipt-card {
      width: 134mm;
      height: 194mm;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 0;
      border-radius: 0;
      background: #fff;
    }
    .masthead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8mm;
      padding: 3.5mm 4.5mm 3mm;
      border-bottom: 0.3mm solid #edf4f3;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 3mm;
      min-width: 0;
    }
    .brand img {
      width: 8mm;
      height: 8mm;
      border-radius: 0;
      background: transparent;
      object-fit: contain;
      display: block;
    }
    .brand-name {
      color: #00685f;
      font-size: 11pt;
      font-weight: 900;
      line-height: 1;
    }
    .brand-tagline {
      margin-top: 0.5mm;
      color: #657b78;
      font-size: 7.2pt;
    }
    .hero {
      text-align: center;
      padding: 4mm 0 3.5mm;
    }
    h1 {
      margin: 0;
      color: #173c38;
      font-size: 17pt;
      line-height: 1.1;
      font-weight: 800;
    }
    .amount {
      margin-top: 2mm;
      color: #00685f;
      font-size: 28pt;
      font-weight: 800;
      line-height: 1;
    }
    .amount span { font-size: 9pt; font-weight: 800; }
    .status {
      display: inline-block;
      margin-top: 2.2mm;
      padding: 0;
      border: 0;
      color: #00685f;
      background: transparent;
      font-size: 7.5pt;
      font-weight: 800;
      text-transform: uppercase;
    }
    .reference-strip {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 0.3mm minmax(0, 1fr);
      align-items: center;
      gap: 4mm;
      padding: 2.2mm 4.5mm;
      border-top: 0.3mm solid #edf4f3;
      border-bottom: 0.3mm solid #edf4f3;
      background: #f7fbfa;
    }
    .reference-item:last-child { text-align: right; }
    .reference-divider { width: 0.3mm; height: 7mm; background: #d0e8e5; }
    .label {
      color: #657b78;
      font-size: 6.8pt;
      font-weight: 800;
      text-transform: uppercase;
    }
    .reference-value {
      margin-top: 0.5mm;
      color: #173c38;
      font-size: 8.2pt;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .content { padding: 3mm 4mm 2mm; }
    .section-title {
      margin: 0 0 2mm;
      color: #00685f;
      font-size: 7.3pt;
      font-weight: 800;
      text-transform: uppercase;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-top: 0.3mm solid #d0e0de;
      border-bottom: 0.3mm solid #d0e0de;
      margin-bottom: 4mm;
    }
    .cell {
      min-height: 17mm;
      padding: 2.5mm 3mm;
      border: 0;
    }
    .cell + .cell { border-left: 0.3mm solid #d0e0de; }
    .cell-value {
      margin-top: 1mm;
      color: #172b2a;
      font-size: 9pt;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .cell-sub {
      margin-top: 0.8mm;
      color: #657b78;
      font-size: 7.4pt;
    }
    .services {
      margin-bottom: 4mm;
      padding: 2.5mm 3mm;
      border-top: 0.3mm solid #d0e0de;
      border-bottom: 0.3mm solid #d0e0de;
      color: #334a47;
      font-size: 8pt;
    }
    .certification {
      display: grid;
      grid-template-columns: 1fr 24mm;
      gap: 5mm;
      align-items: center;
      padding: 3.5mm 4mm;
      border-top: 0.45mm solid #00685f;
      border-bottom: 0.3mm solid #d0e0de;
      background: #f7fbfa;
    }
    .seal-title {
      color: #00685f;
      font-size: 9pt;
      font-weight: 800;
      text-transform: uppercase;
    }
    .seal-copy {
      margin-top: 1.2mm;
      color: #526966;
      font-size: 7.3pt;
      line-height: 1.45;
    }
    .qr { text-align: center; }
    .qr img, .qr-empty {
      width: 22mm;
      height: 22mm;
      display: block;
      margin: 0 auto;
    }
    .qr-empty {
      display: grid;
      place-items: center;
      border: 0.3mm dashed #8fc0b9;
      color: #657b78;
      font-size: 6.8pt;
    }
    .qr-label {
      margin-top: 1mm;
      color: #657b78;
      font-size: 6.5pt;
      font-weight: 800;
      text-transform: uppercase;
    }
    .footer {
      margin-top: auto;
      padding: 3.5mm 4mm;
      border-top: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 5mm;
      color: #c8ddda;
      font-size: 6.7pt;
      line-height: 1.45;
      background: #123c38;
    }
    .footer-identity {
      display: flex;
      align-items: center;
      gap: 2.5mm;
    }
    .footer-mark {
      width: 1mm;
      height: 10mm;
      background: #54b8ab;
    }
    .footer-title {
      color: #fff;
      font-size: 8pt;
      font-weight: 800;
      text-transform: uppercase;
    }
    .footer strong { color: #fff; }
    .footer-right { text-align: right; }

    /* NRMS document layout */
    .sheet {
      padding: 10mm 9mm 8mm;
      display: flex;
      flex-direction: column;
      color: #1e3a38;
    }
    .document-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10mm;
      align-items: start;
    }
    .document-brand {
      display: flex;
      align-items: center;
      gap: 3mm;
      min-width: 0;
    }
    .document-logo {
      width: 9mm;
      height: 9mm;
      object-fit: contain;
    }
    .document-brand-name {
      color: #0f2e2b;
      font-size: 15pt;
      font-weight: 900;
      line-height: 1;
    }
    .document-brand-sub {
      margin-top: 1mm;
      color: #718b88;
      font-size: 7pt;
    }
    .document-heading { text-align: right; }
    .document-title {
      color: #02665e;
      font-size: 18pt;
      font-weight: 900;
      line-height: 1;
    }
    .document-number {
      margin-top: 2.5mm;
      color: #1e3a38;
      font-family: "Courier New", monospace;
      font-size: 7.5pt;
      font-weight: 700;
    }
    .document-date {
      margin-top: 1mm;
      color: #718b88;
      font-size: 6.8pt;
    }
    .keylines {
      margin-top: 5mm;
      border-top: 0.55mm solid #02665e;
      border-bottom: 0.2mm solid #d6e2e0;
      height: 1.4mm;
    }
    .party-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12mm;
      padding: 5mm 0;
      border-bottom: 0.25mm solid #d6e2e0;
    }
    .kicker {
      color: #02665e;
      font-size: 6.5pt;
      font-weight: 900;
      text-transform: uppercase;
    }
    .primary-value {
      margin-top: 2mm;
      color: #0f2e2b;
      font-size: 10pt;
      font-weight: 800;
    }
    .secondary-value {
      margin-top: 1mm;
      color: #718b88;
      font-size: 7.4pt;
      line-height: 1.45;
    }
    .ledger-section { margin-top: 5mm; }
    .ledger-title {
      margin-bottom: 2.5mm;
      color: #02665e;
      font-size: 6.5pt;
      font-weight: 900;
      text-transform: uppercase;
    }
    .ledger {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .ledger th {
      padding: 2.2mm 2.5mm;
      background: #02665e;
      color: #fff;
      font-size: 6.3pt;
      font-weight: 800;
      text-align: left;
      text-transform: uppercase;
    }
    .ledger th:last-child, .ledger td:last-child { text-align: right; }
    .ledger td {
      padding: 3mm 2.5mm;
      border-bottom: 0.25mm solid #d6e2e0;
      color: #1e3a38;
      font-size: 7.8pt;
      vertical-align: top;
    }
    .line-title { font-weight: 800; }
    .line-sub {
      margin-top: 1mm;
      color: #718b88;
      font-size: 6.8pt;
      line-height: 1.4;
    }
    .totals {
      width: 59mm;
      margin: 4mm 0 5mm auto;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      gap: 6mm;
      padding: 1.5mm 0;
      color: #718b88;
      font-size: 7.5pt;
    }
    .total-row strong { color: #1e3a38; }
    .total-row.final {
      margin-top: 1mm;
      padding-top: 2mm;
      border-top: 0.35mm solid #9fb7b4;
      color: #0f2e2b;
      font-size: 8.5pt;
      font-weight: 900;
    }
    .confirmation-row {
      display: grid;
      grid-template-columns: 1fr 23mm;
      gap: 6mm;
      align-items: center;
      padding: 3.5mm 0;
      border-top: 0.35mm solid #9fb7b4;
      border-bottom: 0.25mm solid #d6e2e0;
    }
    .confirmation-title {
      color: #02665e;
      font-size: 8pt;
      font-weight: 900;
      text-transform: uppercase;
    }
    .confirmation-copy {
      margin-top: 1.5mm;
      color: #526966;
      font-size: 7pt;
      line-height: 1.5;
    }
    .document-qr { text-align: center; }
    .document-qr img, .document-qr .qr-empty {
      width: 20mm;
      height: 20mm;
      display: block;
      margin: 0 auto;
    }
    .document-qr-label {
      margin-top: 1mm;
      color: #718b88;
      font-size: 5.8pt;
      font-weight: 800;
      text-transform: uppercase;
    }
    .document-footer {
      margin-top: auto;
      padding-top: 2.5mm;
      border-top: 0.2mm solid #d6e2e0;
      color: #718b88;
      font-size: 6.2pt;
      text-align: center;
    }
  </style>
</head>
<body>
<div class="sheet">
  <header class="document-header">
    <div class="document-brand">
      <img class="document-logo" src="${esc(logoSrc)}" alt="NoLSAF" />
      <div>
        <div class="document-brand-name">NoLSAF</div>
        <div class="document-brand-sub">Quality Stay for Every Wallet</div>
      </div>
    </div>
    <div class="document-heading">
      <div class="document-title">${esc(documentTitle)}</div>
      <div class="document-number">${esc(receiptReference)}</div>
      <div class="document-date">${esc(paidAt ? `Paid ${paidAt}` : "Payment confirmed")}</div>
    </div>
  </header>

  <div class="keylines"></div>

  <section class="party-grid">
    <div>
      <div class="kicker">Issued to</div>
      <div class="primary-value">${esc(details.guestName)}</div>
      ${details.guestPhone ? `<div class="secondary-value">${esc(details.guestPhone)}</div>` : ""}
      ${details.nationality ? `<div class="secondary-value">${esc(details.nationality)}</div>` : ""}
    </div>
    <div>
      <div class="kicker">${esc(reservationKicker)}</div>
      <div class="primary-value">${esc(details.property.title)}</div>
      ${reservationSub ? `<div class="secondary-value">${esc(reservationSub)}</div>` : ""}
      <div class="secondary-value">Code ${esc(details.bookingCode)}${invoiceReference !== "Not issued" ? ` | Invoice ${esc(invoiceReference)}` : ""}</div>
    </div>
  </section>

  <section class="ledger-section">
    <div class="ledger-title">Transaction</div>
    <table class="ledger">
      <colgroup><col style="width:46%"><col style="width:31%"><col style="width:23%"></colgroup>
      <thead><tr><th>Description</th><th>${esc(periodColumn)}</th><th>Amount</th></tr></thead>
      <tbody><tr>
        <td>
          <div class="line-title">${esc(lineTitle)}</div>
          ${doc.lineSub ? `<div class="line-sub">${esc(doc.lineSub)}</div>` : ""}
          ${details.services ? `<div class="line-sub">Includes ${esc(typeof details.services === "string" ? details.services : JSON.stringify(details.services))}</div>` : ""}
        </td>
        <td>
          <div class="line-title">${esc(periodTitle)}</div>
          ${periodSub ? `<div class="line-sub">${esc(periodSub)}</div>` : ""}
        </td>
        <td><div class="line-title">${amount} ${esc(currency)}</div></td>
      </tr></tbody>
    </table>
  </section>

  <section class="totals">
    <div class="total-row"><span>Amount received</span><strong>${amount} ${esc(currency)}</strong></div>
    <div class="total-row final"><span>Balance</span><span>0 ${esc(currency)}</span></div>
  </section>

  <section class="confirmation-row">
      <div>
        <div class="confirmation-title">Payment received in full</div>
        <div class="confirmation-copy">${esc(confirmationCopy)}</div>
      </div>
      <div class="document-qr">
        ${qrCodeDataUrl
          ? `<img src="${qrCodeDataUrl}" alt="Booking verification QR code" /><div class="document-qr-label">Verify</div>`
          : `<div class="qr-empty">QR unavailable</div>`}
      </div>
  </section>

  <footer class="document-footer">
    ${esc(supportEmail)}${supportPhone ? ` | ${esc(supportPhone)}` : ""} | ${esc(supportWebsite)} | Generated ${esc(generatedAt)}
  </footer>
</div>
</body>
</html>
  `;
}

/**
 * Generate PDF from booking details
 * Note: This returns HTML. For actual PDF generation, you'll need to:
 * 1. Install a PDF library (puppeteer, pdfkit, etc.)
 * 2. Convert HTML to PDF
 * 3. Return the PDF buffer
 * 
 * For now, this returns HTML that can be printed as PDF by the browser
 */
export async function generateBookingPDF(details: BookingDetails): Promise<{
  html: string;
  filename: string;
}> {
  const html = await generateBookingReservationHTML(details);
  const filename = `Booking-${details.bookingCode}-${details.bookingId}.pdf`;
  
  return { html, filename };
}
