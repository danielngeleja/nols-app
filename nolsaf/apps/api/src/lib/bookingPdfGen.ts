/**
 * bookingPdfGen.ts
 * ─────────────────────────────────────────────────────────────
 * Generates PDF attachments for booking confirmation emails.
 *   - Booking Reservation Receipt (PDF 1)
 *   - Payment Receipt            (PDF 2)
 *
 * Uses PDFKit (already a project dependency).
 */
import PDFDocument from "pdfkit";
const QRCode = require("qrcode") as { toBuffer(data: string, opts: object): Promise<Buffer> };

// ─── Brand colours (matches owner receipt UI exactly) ──────────────────────
const TEAL        = "#02665e";
const TEAL_DARK   = "#014d47";
const TEAL_LIGHT  = "#edf7f6";   // header/card bg tint
const TEAL_BORDER = "#c0dedd";   // badge border
const BODY_BG     = "#f7fbfa";   // card section bg
const SECTION_BG  = "#f7fbfa";
const BORDER_SOFT = "#edf4f3";
const DIVIDER     = "#d0e8e5";
const TEXT_DARK   = "#1e3a38";   // matches #1e3a38 in UI
const TEXT_MUTED  = "#8aaca9";   // muted labels
const TEXT_SUB    = "#5a9990";   // sub values
const WHITE       = "#ffffff";

// ─── Data shapes ───────────────────────────────────────────────────────────
export interface BookingPdfData {
  guestName:    string;
  propertyName: string;
  bookingId:    number;
  bookingCode?: string;
  checkIn:      Date | string;
  checkOut:     Date | string;
  totalAmount:  number | string;
  roomsQty?:    number;
  currency?:    string;
  paidAt?:      Date | string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function nightCount(ci: Date | string, co: Date | string): number {
  const ms = new Date(co).getTime() - new Date(ci).getTime();
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

function fmtMoney(amount: number | string, currency = "TZS"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

// ─── Shared header/footer helpers ───────────────────────────────────────────
function drawHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  // Green gradient band (simulate with solid)
  doc.rect(0, 0, doc.page.width, 110).fill(TEAL_DARK);

  // Wordmark
  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor(WHITE)
    .text("NoLSAF", 50, 28, { characterSpacing: 3 });

  // Tagline
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("rgba(255,255,255,0.65)")
    .fillOpacity(0.65)
    .text("Africa Travel & Events Platform", 50, 54)
    .fillOpacity(1);

  // Right side badge
  const badgeX = doc.page.width - 200;
  doc.rect(badgeX, 22, 160, 40).fillOpacity(0.18).fill(WHITE).fillOpacity(1);
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(WHITE)
    .text(subtitle.toUpperCase(), badgeX + 10, 29, { width: 140, align: "center", characterSpacing: 0.8 });
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(WHITE)
    .text(title, badgeX + 10, 43, { width: 140, align: "center" });

  // Accent line under header
  doc.rect(0, 110, doc.page.width, 3).fill(TEAL);

  doc.y = 130;
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const footerY = doc.page.height - 52;
  doc.rect(0, footerY - 8, doc.page.width, 60).fill(TEAL_LIGHT);
  doc.rect(0, footerY - 8, doc.page.width, 1).fill(TEAL);

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(TEXT_MUTED)
    .text(
      `NoLSAF  ·  Dar es Salaam, Tanzania  ·  support@nolsaf.com  ·  nolsaf.com`,
      50, footerY + 4,
      { width: doc.page.width - 100, align: "center" }
    );
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(TEXT_MUTED)
    .text(
      `© ${new Date().getFullYear()} NoLSAF. All rights reserved.  |  This is an official document issued by NoLSAF.`,
      50, footerY + 18,
      { width: doc.page.width - 100, align: "center" }
    );
}

function sectionTitle(doc: PDFKit.PDFDocument, text: string) {
  doc
    .moveDown(0.6)
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(TEAL)
    .text(text.toUpperCase(), { characterSpacing: 1.2 })
    .moveDown(0.15);
  // Underline
  doc.rect(50, doc.y, doc.page.width - 100, 0.75).fill(TEAL);
  doc.moveDown(0.5);
}

function tableRow(doc: PDFKit.PDFDocument, label: string, value: string, highlight = false) {
  const y = doc.y;
  if (highlight) {
    doc.rect(50, y - 3, doc.page.width - 100, 18).fillOpacity(0.06).fill(TEAL).fillOpacity(1);
  }
  doc.font("Helvetica").fontSize(9.5).fillColor(TEXT_MUTED).text(label, 60, y, { width: 180 });
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(TEXT_DARK).text(value, 240, y, { width: doc.page.width - 300 });
  doc.y = y + 20;
}

function codeBox(doc: PDFKit.PDFDocument, label: string, code: string) {
  doc.moveDown(0.3);
  const boxY = doc.y;
  const boxH = 62;
  // Dashed border simulation with solid
  doc.rect(50, boxY, doc.page.width - 100, boxH)
    .fillOpacity(0.07).fill(TEAL).fillOpacity(1)
    .rect(50, boxY, doc.page.width - 100, boxH)
    .strokeOpacity(0.5).strokeColor(TEAL).lineWidth(1).stroke().strokeOpacity(1);

  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(TEAL_DARK)
    .text(label.toUpperCase(), 50, boxY + 11, { width: doc.page.width - 100, align: "center", characterSpacing: 1.5 });

  doc
    .font("Helvetica-Bold")
    .fontSize(26)
    .fillColor(TEAL_DARK)
    .text(code, 50, boxY + 25, { width: doc.page.width - 100, align: "center", characterSpacing: 6 });

  doc.y = boxY + boxH + 12;
}

// ─── PDF 1: Booking Reservation Receipt — QR centrepiece ────────────────────
export async function generateBookingReservationPdf(data: BookingPdfData): Promise<Buffer> {
  // A5 portrait, same as payment receipt
  const doc = new PDFDocument({ size: "A5", margins: { top: 0, bottom: 0, left: 0, right: 0 }, autoFirstPage: true });
  const bufferPromise = pdfToBuffer(doc);

  const W        = doc.page.width;
  const H        = doc.page.height;
  const PAD      = 22;
  const currency = data.currency ?? "TZS";
  const refCode  = data.bookingCode ?? `BK-${data.bookingId}`;
  const nights   = nightCount(data.checkIn, data.checkOut);
  const ciStr    = new Date(data.checkIn).toLocaleDateString("en-GB",  { day: "numeric", month: "short", year: "numeric" });
  const coStr    = new Date(data.checkOut).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const genDate  = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Generate QR code buffer (error correction H = 30% recoverable — safe for center overlay)
  const qrPayload = JSON.stringify({ bookingCode: refCode, bookingId: data.bookingId, guest: data.guestName });
  const qrPng = await QRCode.toBuffer(qrPayload, { width: 280, margin: 1, errorCorrectionLevel: "H",
    color: { dark: TEAL_DARK, light: "#ffffff" } });

  // ── Full white background + outer card border ─────────────────────────────
  doc.rect(0, 0, W, H).fill(WHITE);
  doc.roundedRect(8, 8, W - 16, H - 16, 12).lineWidth(0.8).strokeColor(BORDER_SOFT).stroke();

  // ── Dot row helper ────────────────────────────────────────────────────────
  function dotRow(y: number, opacity = 1.0) {
    doc.save().fillOpacity(opacity);
    for (let x = PAD; x < W - PAD; x += 10) doc.circle(x, y, 1.5).fill(TEAL);
    doc.restore();
  }

  // ── TOP DOT ROW ───────────────────────────────────────────────────────────
  dotRow(16);
  let curY = 26;

  // ── Brand row ─────────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(13).fillColor(TEAL_DARK)
     .text("NoLSAF", PAD, curY, { characterSpacing: 1 });

  const badgeW = 62; const badgeH = 16;
  const badgeX = W - PAD - badgeW;
  doc.roundedRect(badgeX, curY - 1, badgeW, badgeH, 8).fill(TEAL_LIGHT);
  doc.roundedRect(badgeX, curY - 1, badgeW, badgeH, 8).lineWidth(0.6).strokeColor(TEAL_BORDER).stroke();
  doc.font("Helvetica-Bold").fontSize(7).fillColor(TEAL)
     .text("✓  VERIFIED", badgeX, curY + 4, { width: badgeW, align: "center", characterSpacing: 0.8 });
  curY += 22;

  // Slogan
  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(TEXT_SUB)
     .text("Quality Stay in Every Wallet", PAD, curY, { characterSpacing: 0.3 });
  curY += 13;

  // ── Title ─────────────────────────────────────────────────────────────────
  doc.font("Helvetica").fontSize(7).fillColor(TEXT_MUTED)
     .text("BOOKING RESERVATION", PAD, curY, { width: W - PAD * 2, align: "center", characterSpacing: 1.8 });
  curY += 12;
  doc.font("Helvetica-Bold").fontSize(17).fillColor(TEXT_DARK)
     .text("Your booking is confirmed", PAD, curY, { width: W - PAD * 2, align: "center" });
  curY += 20;

  // Guest name
  doc.font("Helvetica").fontSize(9).fillColor(TEXT_MUTED)
     .text(`Dear ${data.guestName} — present this at the property on arrival.`, PAD, curY, { width: W - PAD * 2, align: "center" });
  curY += 18;

  // ── QR CODE centrepiece ───────────────────────────────────────────────────
  const QR_SIZE  = 160;
  const qrX      = (W - QR_SIZE) / 2;
  const qrY      = curY;

  // Outer QR container: white rounded box with teal border
  doc.roundedRect(qrX - 8, qrY - 8, QR_SIZE + 16, QR_SIZE + 16, 10)
     .fill(WHITE);
  doc.roundedRect(qrX - 8, qrY - 8, QR_SIZE + 16, QR_SIZE + 16, 10)
     .lineWidth(1).strokeColor(DIVIDER).stroke();

  // QR code image
  doc.image(qrPng, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });

  // Center pill overlay — white background pill with booking code text
  const pillW   = 88;
  const pillH   = 20;
  const pillX   = qrX + (QR_SIZE - pillW) / 2;
  const pillY   = qrY + (QR_SIZE - pillH) / 2;

  doc.roundedRect(pillX - 4, pillY - 3, pillW + 8, pillH + 6, 6)
     .fillOpacity(0.92).fill(WHITE).fillOpacity(1);
  doc.roundedRect(pillX - 4, pillY - 3, pillW + 8, pillH + 6, 6)
     .lineWidth(0.8).strokeColor(TEAL_BORDER).stroke();

  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(TEAL_DARK)
     .text(refCode, pillX - 4, pillY + 3, { width: pillW + 8, align: "center", characterSpacing: 1.2 });

  curY = qrY + QR_SIZE + 18;

  // Caption below QR
  doc.font("Helvetica").fontSize(7.5).fillColor(TEXT_SUB)
     .text("Scan to verify  ·  Show to property staff on arrival", PAD, curY, { width: W - PAD * 2, align: "center" });
  curY += 14;

  // ── Divider ───────────────────────────────────────────────────────────────
  doc.rect(PAD, curY, W - PAD * 2, 0.7).fill(BORDER_SOFT);
  curY += 8;

  // ── Reference strip ───────────────────────────────────────────────────────
  const stripH = 28;
  doc.rect(PAD, curY, W - PAD * 2, stripH).fill(SECTION_BG);

  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(TEXT_MUTED)
     .text("PROPERTY", PAD + 8, curY + 5, { characterSpacing: 0.8 });
  doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_DARK)
     .text(data.propertyName.slice(0, 36), PAD + 8, curY + 14, { width: W / 2 - 16 });

  doc.rect(W / 2, curY + 5, 0.8, 18).fill(DIVIDER);

  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(TEXT_MUTED)
     .text("BOOKING NO.", W / 2 + 8, curY + 5, { characterSpacing: 0.8 });
  doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_DARK)
     .text(`#${data.bookingId}`, W / 2 + 8, curY + 14);

  curY += stripH + 1;
  doc.rect(PAD, curY, W - PAD * 2, 0.7).fill(BORDER_SOFT);
  curY += 6;

  // ── Two-col cards: dates + amount ─────────────────────────────────────────
  const colGap = 6;
  const colW   = (W - PAD * 2 - colGap) / 2;
  const row1H  = 62;

  function miniCard(x: number, y: number, w: number, h: number, label: string, rows: [string, string][]) {
    doc.roundedRect(x, y, w, h, 8).fill(SECTION_BG);
    doc.roundedRect(x, y, w, h, 8).lineWidth(0.5).strokeColor(BORDER_SOFT).stroke();
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor(TEXT_MUTED)
       .text(label.toUpperCase(), x + 8, y + 8, { characterSpacing: 1 });
    let ry = y + 21;
    for (const [lbl, val] of rows) {
      doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED).text(lbl, x + 8, ry, { width: w * 0.42 });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(TEXT_DARK).text(val, x + 8 + w * 0.42, ry, { width: w * 0.52, align: "right" });
      ry += 13;
    }
  }

  miniCard(PAD, curY, colW, row1H, "Stay", [
    ["Check-in",  ciStr],
    ["Check-out", coStr],
    ["Duration",  `${nights} night${nights !== 1 ? "s" : ""}`],
  ]);

  const paidAtStr = data.paidAt
    ? new Date(data.paidAt).toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "CONFIRMED";
  miniCard(PAD + colW + colGap, curY, colW, row1H, "Payment", [
    ["Amount",   `${currency} ${Number(data.totalAmount).toLocaleString("en-US")}`],
    ["Rooms",    String(data.roomsQty ?? 1)],
    ["Paid",     paidAtStr],
  ]);
  curY += row1H + 4;

  // ── FOOTER SEAL ───────────────────────────────────────────────────────────
  const sealY = H - 68;
  dotRow(sealY, 0.55);

  doc.rect(PAD, sealY + 6, W - PAD * 2, 50).fill(SECTION_BG);
  doc.circle(PAD + 14, sealY + 21, 6).fill(TEAL);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(TEAL_DARK)
     .text("NoLSAF  ·  Certified Booking Receipt", PAD + 26, sealY + 16, { characterSpacing: 0.5 });
  doc.font("Helvetica").fontSize(7.5).fillColor(TEXT_SUB)
     .text(
       `Issued: ${genDate}  ·  Booking #${data.bookingId}  ·  support@nolsaf.com`,
       PAD + 26, sealY + 29, { width: W - PAD * 2 - 36 }
     );

  dotRow(H - 14);

  doc.end();
  return bufferPromise;
}

// ─── PDF 2: Payment Receipt (matches owner receipt UI exactly) ──────────────
export async function generatePaymentReceiptPdf(data: BookingPdfData): Promise<Buffer> {
  // A5 portrait — same proportions as the receipt card in the UI
  const doc = new PDFDocument({ size: "A5", margins: { top: 0, bottom: 0, left: 0, right: 0 }, autoFirstPage: true });
  const bufferPromise = pdfToBuffer(doc);

  const W        = doc.page.width;   // ~419 pts
  const H        = doc.page.height;  // ~595 pts
  const PAD      = 22;               // outer horizontal padding
  const currency = data.currency ?? "TZS";
  const refCode  = data.bookingCode ?? `BK-${data.bookingId}`;
  const nights   = nightCount(data.checkIn, data.checkOut);
  const now      = new Date();
  const paidDate = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const paidFull = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // ── Full white page background ────────────────────────────────────────────
  doc.rect(0, 0, W, H).fill(WHITE);

  // ── Outer card border ─────────────────────────────────────────────────────
  doc.roundedRect(8, 8, W - 16, H - 16, 12)
     .lineWidth(0.8).strokeColor(BORDER_SOFT).stroke();

  // helper: draw dot row
  function dotRow(y: number, opacity = 1) {
    const r = 1.5;
    const step = 10;
    doc.save().fillOpacity(opacity);
    for (let x = PAD; x < W - PAD; x += step) {
      doc.circle(x, y, r).fill(TEAL);
    }
    doc.restore();
  }

  // ── TOP DOT ROW ───────────────────────────────────────────────────────────
  dotRow(16);

  let curY = 26;

  // ── HEADER — brand row ────────────────────────────────────────────────────
  // "NoLSAF" wordmark
  doc.font("Helvetica-Bold").fontSize(13).fillColor(TEAL_DARK)
     .text("NoLSAF", PAD, curY, { characterSpacing: 1 });

  // Verified badge (right-aligned)
  const badgeW = 62; const badgeH = 16;
  const badgeX = W - PAD - badgeW;
  doc.roundedRect(badgeX, curY - 1, badgeW, badgeH, 8)
     .fill(TEAL_LIGHT);
  doc.roundedRect(badgeX, curY - 1, badgeW, badgeH, 8)
     .lineWidth(0.6).strokeColor(TEAL_BORDER).stroke();
  doc.font("Helvetica-Bold").fontSize(7).fillColor(TEAL)
     .text("✓  VERIFIED", badgeX, curY + 4, { width: badgeW, align: "center", characterSpacing: 0.8 });

  curY += 22;

  // Slogan
  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(TEXT_SUB)
     .text("Quality Stay in Every Wallet", PAD, curY, { characterSpacing: 0.3 });
  curY += 13;

  // ── Title ─────────────────────────────────────────────────────────────────
  doc.font("Helvetica").fontSize(7).fillColor(TEXT_MUTED)
     .text("GUEST PAYMENT CONFIRMATION", PAD, curY, { width: W - PAD * 2, align: "center", characterSpacing: 1.8 });
  curY += 12;
  doc.font("Helvetica-Bold").fontSize(17).fillColor(TEXT_DARK)
     .text("Payment Receipt", PAD, curY, { width: W - PAD * 2, align: "center" });
  curY += 24;

  // ── Amount block ──────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(7).fillColor(TEXT_MUTED)
     .text("AMOUNT PAID", PAD, curY, { width: W - PAD * 2, align: "center", characterSpacing: 1.6 });
  curY += 11;
  const amtStr    = Number(data.totalAmount).toLocaleString("en-US");
  const amtFull   = `${amtStr}`;
  const amtCoords = { x: PAD, y: curY, w: W - PAD * 2 - 40 };
  doc.font("Helvetica-Bold").fontSize(28).fillColor(TEAL)
     .text(amtFull, PAD, curY, { width: W - PAD * 2, align: "center" });
  // TZS suffix inline — rendered small to the right
  doc.font("Helvetica-Bold").fontSize(11).fillColor(TEXT_SUB)
     .text(currency, W - PAD - 30, curY + 8);
  curY += 36;

  // Paid date
  doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED)
     .text(paidFull, PAD, curY, { width: W - PAD * 2, align: "center" });
  curY += 16;

  // ── Divider ───────────────────────────────────────────────────────────────
  doc.rect(PAD, curY, W - PAD * 2, 0.7).fill(BORDER_SOFT);
  curY += 1;

  // ── Reference strip ───────────────────────────────────────────────────────
  const stripH = 30;
  doc.rect(PAD, curY, W - PAD * 2, stripH).fill(SECTION_BG);

  // left: Booking Reference
  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(TEXT_MUTED)
     .text("BOOKING REFERENCE", PAD + 8, curY + 5, { characterSpacing: 0.8 });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(TEXT_DARK)
     .text(refCode, PAD + 8, curY + 15);

  // divider line
  doc.rect(W / 2, curY + 5, 0.8, 18).fill(DIVIDER);

  // right: Booking Number
  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(TEXT_MUTED)
     .text("BOOKING NO.", W / 2 + 8, curY + 5, { characterSpacing: 0.8 });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(TEXT_DARK)
     .text(`#${data.bookingId}`, W / 2 + 8, curY + 15);

  curY += stripH + 1;
  doc.rect(PAD, curY, W - PAD * 2, 0.7).fill(BORDER_SOFT);
  curY += 8;

  // ── Info cards layout ─────────────────────────────────────────────────────
  function infoCard(x: number, y: number, w: number, h: number, label: string, rows: [string, string][]) {
    doc.roundedRect(x, y, w, h, 8).fill(SECTION_BG);
    doc.roundedRect(x, y, w, h, 8).lineWidth(0.5).strokeColor(BORDER_SOFT).stroke();
    // Section label
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor(TEXT_MUTED)
       .text(label.toUpperCase(), x + 8, y + 8, { characterSpacing: 1 });
    // Rows
    let ry = y + 21;
    for (const [lbl, val] of rows) {
      doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED)
         .text(lbl, x + 8, ry, { width: w * 0.4 });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(TEXT_DARK)
         .text(val, x + 8 + w * 0.4, ry, { width: w * 0.55, align: "right" });
      ry += 13;
    }
  }

  const colGap   = 6;
  const colW     = (W - PAD * 2 - colGap) / 2;
  const ciStr    = new Date(data.checkIn).toLocaleDateString("en-GB",  { day: "numeric", month: "short", year: "numeric" });
  const coStr    = new Date(data.checkOut).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  // Row 1: Payment card + Booking card
  const row1H = 78;
  infoCard(PAD, curY, colW, row1H, "Payment", [
    ["Date",      paidDate],
    ["Status",    "PAID"],
    ["Reference", refCode],
  ]);
  infoCard(PAD + colW + colGap, curY, colW, row1H, "Booking", [
    ["Check-in",  ciStr],
    ["Check-out", coStr],
    ["Duration",  `${nights} night${nights !== 1 ? "s" : ""}`],
    ["Rooms",     String(data.roomsQty ?? 1)],
  ]);
  curY += row1H + 6;

  // Row 2: Property card (full width)
  const row2H = 42;
  doc.roundedRect(PAD, curY, W - PAD * 2, row2H, 8).fill(SECTION_BG);
  doc.roundedRect(PAD, curY, W - PAD * 2, row2H, 8).lineWidth(0.5).strokeColor(BORDER_SOFT).stroke();
  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(TEXT_MUTED)
     .text("PROPERTY", PAD + 8, curY + 8, { characterSpacing: 1 });

  // small teal square icon
  doc.roundedRect(PAD + 8, curY + 20, 14, 14, 3).fill(TEAL);

  doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_DARK)
     .text(data.propertyName, PAD + 28, curY + 21, { width: W - PAD * 2 - 36 });
  curY += row2H + 6;

  // ── FOOTER SEAL ───────────────────────────────────────────────────────────
  const sealY = H - 70;

  // Inner dot row (slightly transparent)
  dotRow(sealY, 0.55);

  // Seal background
  doc.rect(PAD, sealY + 5, W - PAD * 2, 56).fill(SECTION_BG);

  // Teal dot + title
  doc.circle(PAD + 14, sealY + 19, 6).fill(TEAL);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(TEAL_DARK)
     .text("NoLSAF  ·  Certified Receipt", PAD + 26, sealY + 15, { characterSpacing: 0.5 });
  doc.font("Helvetica").fontSize(7.5).fillColor(TEXT_SUB)
     .text(
       "This is an official payment document issued by NoLSAF.\nFor assistance contact support@nolsaf.com",
       PAD + 26, sealY + 28, { width: W - PAD * 2 - 36, lineGap: 1 }
     );

  // ── BOTTOM DOT ROW ────────────────────────────────────────────────────────
  dotRow(H - 14);

  doc.end();
  return bufferPromise;
}
