/**
 * PDF Generation Service for Booking Codes and Reservation Forms
 * Uses a simple HTML-to-PDF approach (can be enhanced with libraries like puppeteer, pdfkit, etc.)
 */

import { makeQR } from "./qr.js";

interface BookingDetails {
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
    const url = origin ? `${origin.replace(/\/+$/, "")}/public/booking/${encodeURIComponent(details.bookingCode)}` : undefined;

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
  const supportEmail = process.env.SUPPORT_EMAIL || "support@nolsaf.com";
  const supportPhone = process.env.SUPPORT_PHONE || process.env.SUPPORT_TEL || "";
  const supportWebsite = (process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "https://nolsaf.com").replace(/\/+$/, "");
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

  // Authenticity barcode: a deterministic SVG barcode derived from the receipt/booking
  // identifier. Unique per receipt, so it reads as a genuine document mark.
  const barcodeValue = String(
    details.invoice?.receiptNumber || details.bookingCode || details.bookingId || ""
  );
  const barcodeSvg = (() => {
    const W = 150;
    const H = 36;
    let seed = 0;
    for (let i = 0; i < barcodeValue.length; i++) {
      seed = (seed * 31 + barcodeValue.charCodeAt(i)) >>> 0;
    }
    let s = seed || 1;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const rects: string[] = [];
    let x = 1;
    // Continuous bars with small, even gaps — dense like a real barcode (no large blanks).
    while (x < W - 2) {
      const bw = 1 + Math.floor(rnd() * 3); // bar width 1–3px
      const gap = 1 + Math.floor(rnd() * 2); // thin gap 1–2px
      rects.push(`<rect x="${x}" y="0" width="${bw}" height="${H}" fill="#0f172a"/>`);
      x += bw + gap;
    }
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Receipt authenticity barcode" preserveAspectRatio="none">${rects.join("")}</svg>`;
  })();

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

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Booking Receipt ${esc(details.bookingCode)}</title>
  <style>
    @media print {
      @page { size: A5; margin: 0; }
      html, body { width: 148mm; height: 210mm; margin: 0; padding: 0; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { page-break-inside: avoid; break-inside: avoid; }
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      font-family: "Trebuchet MS", Trebuchet, Arial, sans-serif;
      color: #172b2a;
    }
    .sheet {
      width: 148mm;
      min-height: 210mm;
      margin: 0;
      position: relative;
      overflow: hidden;
      background: #fff;
      padding: 9mm 10mm 8mm;
      font-size: 9.5pt;
      line-height: 1.35;
    }
    .sheet::before {
      content: 'NoLSAF  VERIFIED';
      position: absolute;
      top: 98mm;
      left: 17mm;
      font-size: 27pt;
      font-weight: 800;
      letter-spacing: 2px;
      color: rgba(0, 104, 95, 0.035);
      transform: rotate(-31deg);
      pointer-events: none;
      white-space: nowrap;
    }
    .sheet > * { position: relative; z-index: 1; }
    .dot-rule {
      height: 4px;
      background-image: radial-gradient(circle, #08776d 1px, transparent 1.2px);
      background-size: 7px 4px;
      background-repeat: repeat-x;
    }
    .masthead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8mm;
      padding: 5mm 0 4mm;
      border-bottom: 0.35mm solid #b7cfcc;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 3mm;
      min-width: 0;
    }
    .brand img {
      width: 13mm;
      height: 13mm;
      object-fit: contain;
      display: block;
    }
    .brand-name {
      color: #00685f;
      font-size: 16pt;
      font-weight: 800;
      line-height: 1;
    }
    .brand-tagline {
      margin-top: 1.2mm;
      color: #657b78;
      font-size: 7.2pt;
    }
    .verified {
      display: flex;
      align-items: center;
      gap: 2mm;
      color: #00685f;
      font-size: 7.8pt;
      font-weight: 800;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .verified-mark {
      width: 6.5mm;
      height: 6.5mm;
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: #fff;
      background: #00685f;
      font-size: 10pt;
    }
    .hero {
      text-align: center;
      padding: 5mm 0 4mm;
    }
    .eyebrow {
      color: #657b78;
      font-size: 7.3pt;
      font-weight: 800;
      text-transform: uppercase;
    }
    h1 {
      margin: 1.3mm 0 0;
      color: #173c38;
      font-size: 18pt;
      line-height: 1.1;
      font-weight: 800;
    }
    .amount {
      margin-top: 2mm;
      color: #00685f;
      font-size: 22pt;
      font-weight: 800;
      line-height: 1;
    }
    .amount span { font-size: 9pt; font-weight: 800; }
    .status {
      display: inline-block;
      margin-top: 2.2mm;
      padding: 1.1mm 3mm;
      border: 0.3mm solid #8fc0b9;
      color: #00685f;
      background: #f2faf8;
      font-size: 7.5pt;
      font-weight: 800;
      text-transform: uppercase;
    }
    .reference-strip {
      display: grid;
      grid-template-columns: 1fr 38mm;
      align-items: center;
      gap: 5mm;
      padding: 3mm 4mm;
      border-top: 0.35mm solid #b7cfcc;
      border-bottom: 0.35mm solid #b7cfcc;
      background: #f7fbfa;
    }
    .reference-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2mm 5mm;
    }
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
    .barcode { height: 10mm; line-height: 0; }
    .barcode svg { width: 100%; height: 100%; display: block; }
    .content { padding-top: 4mm; }
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
      border-top: 0.3mm solid #b7cfcc;
      border-left: 0.3mm solid #b7cfcc;
      margin-bottom: 4mm;
    }
    .cell {
      min-height: 15mm;
      padding: 2.5mm 3mm;
      border-right: 0.3mm solid #b7cfcc;
      border-bottom: 0.3mm solid #b7cfcc;
    }
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
    .stay-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 29mm;
      border-top: 0.3mm solid #b7cfcc;
      border-left: 0.3mm solid #b7cfcc;
      margin-bottom: 4mm;
    }
    .stay-grid .cell { min-height: 14mm; }
    .services {
      margin-bottom: 4mm;
      padding: 2.5mm 3mm;
      border: 0.3mm solid #b7cfcc;
      color: #334a47;
      font-size: 8pt;
    }
    .certification {
      display: grid;
      grid-template-columns: 1fr 24mm;
      gap: 5mm;
      align-items: center;
      padding: 3.5mm 4mm;
      border: 0.45mm solid #00685f;
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
    .notice {
      margin-top: 3mm;
      color: #526966;
      font-size: 6.9pt;
      line-height: 1.45;
    }
    .footer {
      margin-top: 4mm;
      padding-top: 3mm;
      border-top: 0.35mm solid #b7cfcc;
      display: flex;
      justify-content: space-between;
      gap: 5mm;
      color: #657b78;
      font-size: 6.7pt;
      line-height: 1.45;
    }
    .footer strong { color: #173c38; }
    .footer-right { text-align: right; }
  </style>
</head>
<body>
<div class="sheet">
  <div class="dot-rule"></div>

  <header class="masthead">
    <div class="brand">
      <img src="${esc(logoSrc)}" alt="NoLSAF" />
      <div>
        <div class="brand-name">NoLSAF</div>
        <div class="brand-tagline">Quality Stay for Every Wallet</div>
      </div>
    </div>
    <div class="verified">
      <span class="verified-mark">&#10003;</span>
      Verified booking record
    </div>
  </header>

  <section class="hero">
    <div class="eyebrow">Official reservation document</div>
    <h1>Booking Receipt</h1>
    <div class="amount">${amount} <span>TZS</span></div>
    <div class="status">&#10003;&nbsp; Paid &amp; confirmed</div>
  </section>

  <section class="reference-strip">
    <div class="reference-grid">
      <div>
        <div class="label">Receipt reference</div>
        <div class="reference-value">${esc(receiptReference)}</div>
      </div>
      <div>
        <div class="label">Booking code</div>
        <div class="reference-value">${esc(details.bookingCode)}</div>
      </div>
      <div>
        <div class="label">Invoice reference</div>
        <div class="reference-value">${esc(invoiceReference)}</div>
      </div>
      <div>
        <div class="label">Payment date</div>
        <div class="reference-value">${esc(paidAt || "Payment confirmed")}</div>
      </div>
    </div>
    <div class="barcode">${barcodeSvg}</div>
  </section>

  <main class="content">
    <div class="section-title">Reservation parties</div>
    <section class="info-grid">
      <div class="cell">
        <div class="label">Guest</div>
        <div class="cell-value">${esc(details.guestName)}</div>
        ${details.guestPhone ? `<div class="cell-sub">${esc(details.guestPhone)}</div>` : ""}
        ${details.nationality ? `<div class="cell-sub">${esc(details.nationality)}</div>` : ""}
      </div>
      <div class="cell">
        <div class="label">Property</div>
        <div class="cell-value">${esc(details.property.title)}</div>
        <div class="cell-sub">${esc(details.property.type)}${propertyLocation ? ` / ${esc(propertyLocation)}` : ""}</div>
        ${roomDescription ? `<div class="cell-sub">${esc(roomDescription)}</div>` : ""}
      </div>
    </section>

    <div class="section-title">Stay arrangement</div>
    <section class="stay-grid">
      <div class="cell">
        <div class="label">Check-in</div>
        <div class="cell-value">${esc(checkIn)}</div>
      </div>
      <div class="cell">
        <div class="label">Check-out</div>
        <div class="cell-value">${esc(checkOut)}</div>
      </div>
      <div class="cell">
        <div class="label">Duration</div>
        <div class="cell-value">${nights} night${nights === 1 ? "" : "s"}</div>
      </div>
    </section>

    ${details.services ? `
    <div class="section-title">Included services</div>
    <div class="services">
      ${esc(typeof details.services === "string" ? details.services : JSON.stringify(details.services))}
    </div>
    ` : ""}

    <section class="certification">
      <div>
        <div class="seal-title">Reservation verified by NoLSAF</div>
        <div class="seal-copy">
          This record confirms that payment was received and the reservation was issued through NoLSAF.
          Present booking code <strong>${esc(details.bookingCode)}</strong> at check-in. The QR contains the
          verification details for this booking.
        </div>
      </div>
      <div class="qr">
        ${qrCodeDataUrl
          ? `<img src="${qrCodeDataUrl}" alt="Booking verification QR code" /><div class="qr-label">Verify booking</div>`
          : `<div class="qr-empty">QR unavailable</div>`}
      </div>
    </section>

    <div class="notice">
      <strong>Document note:</strong> This is proof of reservation and payment confirmation for the booking shown above.
      It is not a fiscal tax receipt. For assistance, contact ${esc(supportEmail)}${supportPhone ? ` or ${esc(supportPhone)}` : ""}.
    </div>
  </main>

  <footer class="footer">
    <div>
      <strong>NoLSAF Customer Care</strong><br>
      ${esc(supportEmail)}${supportPhone ? ` &nbsp;|&nbsp; ${esc(supportPhone)}` : ""}<br>
      ${esc(supportWebsite)}
    </div>
    <div class="footer-right">
      Issued electronically by NoLSAF<br>
      Generated ${esc(generatedAt)}
    </div>
  </footer>

  <div class="dot-rule" style="margin-top:4mm;"></div>
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
