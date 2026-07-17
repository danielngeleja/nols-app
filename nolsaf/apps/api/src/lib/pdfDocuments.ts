/**
 * pdfDocuments.ts
 * ─────────────────────────────────────────────────────────────
 * Generates branded PDF documents using pdfkit (pure Node.js, no browser needed):
 *   1. generateBookingTicketPdf   — guest booking reservation ticket
 *   2. generatePaymentReceiptPdf  — customer payment receipt (invoice PAID)
 *   3. generateOwnerDisbursementPdf — owner disbursement notice
 */
import PDFDocument from "pdfkit";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";

// ─── Brand constants ──────────────────────────────────────────
const TEAL        = "#02665e";
const DARK        = "#014d47";
const LIGHT_TEAL  = "#e6f2f1";
const TEXT_MAIN   = "#1a2e2c";
const TEXT_MUTED  = "#6b7280";
const BORDER      = "#d1e8e6";
const RED         = "#dc2626";
const AMBER       = "#d97706";
const PAGE_W      = 595.28; // A4 pt width
const MARGIN      = 50;
const COL_W       = PAGE_W - MARGIN * 2;

// Receipt-style palette (mirrors the web "Payout Receipt" template)
const RCPT_BG     = "#f7fbfa";
const RCPT_BORDER = "#edf4f3";
const RCPT_LABEL  = "#8aaca9";
const RCPT_VALUE  = "#1e3a38";
const RCPT_HEAD   = "#0f2e2b";
const RCPT_SUB    = "#5a9990";
const RCPT_OUTER  = "#e2eae9";

// ─── Shared helpers ───────────────────────────────────────────

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
  });
}

function fmtMoney(amount: number | string | null | undefined, currency = "TZS"): string {
  const n = Number(amount ?? 0);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function buildBuffer(fn: (doc: PDFKit.PDFDocument) => void, options?: PDFKit.PDFDocumentOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: "A4", compress: true, ...options });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      fn(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Fixed receipt reference used as both the printed number and Code 128 payload.
 * Example: ND10-K7Q-26071511-00005.
 */
export function buildNrmsDocumentNumber(
  reservationId: number,
  generatedAt: Date | string,
  roomType: string,
  roomNumber: string,
  randomCode: string,
): string {
  const parsedDate = new Date(generatedAt);
  if (!Number.isFinite(parsedDate.getTime())) throw new Error("Invalid NRMS receipt generation date");

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsedDate);
  const part = (type: Intl.DateTimeFormatPartTypes) => dateParts.find((item) => item.type === type)?.value ?? "00";
  const timestamp = `${part("year")}${part("month")}${part("day")}${part("hour")}`;

  const typeCode = roomType.toUpperCase().replace(/[^A-Z0-9]/g, "").charAt(0) || "R";
  const numericRoom = roomNumber.match(/\d+/g)?.at(-1);
  const roomCode = numericRoom
    ? numericRoom.slice(-2).padStart(2, "0")
    : roomNumber.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-2).padStart(2, "0");
  const safeRandomCode = randomCode.toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{3}$/.test(safeRandomCode)) {
    throw new Error("NRMS receipt random code must contain three unambiguous characters");
  }

  const numericId = Math.max(0, Math.trunc(reservationId));
  const billNumber = numericId <= 99_999
    ? String(numericId).padStart(5, "0")
    : numericId.toString(36).toUpperCase().padStart(5, "0").slice(-5);
  return `N${typeCode}${roomCode}-${safeRandomCode}-${timestamp}-${billNumber}`;
}

const NRMS_RANDOM_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateNrmsRandomCode(): string {
  return Array.from({ length: 3 }, () => NRMS_RANDOM_CHARACTERS[randomInt(NRMS_RANDOM_CHARACTERS.length)]).join("");
}

// ISO/IEC 15417 Code 128 symbol patterns. Each digit is the width, in modules,
// of alternating bars and spaces. Index 106 is the stop symbol.
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

function code128BValues(value: string): number[] {
  const normalized = value.toUpperCase();
  if (!/^[\x20-\x7e]+$/.test(normalized)) {
    throw new Error("Code 128 receipt references must contain printable ASCII characters only");
  }

  const startCodeB = 104;
  const data = Array.from(normalized, (char) => char.charCodeAt(0) - 32);
  const checksum = (startCodeB + data.reduce((sum, code, index) => sum + code * (index + 1), 0)) % 103;
  return [startCodeB, ...data, checksum, 106];
}

function drawCode128Barcode(
  doc: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const values = code128BValues(value);
  const quietZoneModules = 10;
  const symbolModules = values.reduce(
    (sum, code) => sum + Array.from(CODE128_PATTERNS[code], Number).reduce((a, b) => a + b, 0),
    0,
  );
  const moduleWidth = width / (symbolModules + quietZoneModules * 2);
  let cursor = x + quietZoneModules * moduleWidth;

  doc.save().fillColor(TEXT_MAIN);
  for (const code of values) {
    const pattern = CODE128_PATTERNS[code];
    for (let index = 0; index < pattern.length; index += 1) {
      const segmentWidth = Number(pattern[index]) * moduleWidth;
      if (index % 2 === 0) doc.rect(cursor, y, segmentWidth, height).fill();
      cursor += segmentWidth;
    }
  }
  doc.restore();
}

type NrmsFonts = { regular: string; bold: string };

function registerNrmsFonts(doc: PDFKit.PDFDocument): NrmsFonts {
  const regularCandidates = [
    process.env.TREBUCHET_MS_REGULAR_PATH,
    "C:\\Windows\\Fonts\\trebuc.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/trebuc.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/trebuc.ttf",
  ].filter((value): value is string => Boolean(value));
  const boldCandidates = [
    process.env.TREBUCHET_MS_BOLD_PATH,
    "C:\\Windows\\Fonts\\trebucbd.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/trebucbd.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/trebucbd.ttf",
  ].filter((value): value is string => Boolean(value));
  const regularPath = regularCandidates.find(existsSync);
  const boldPath = boldCandidates.find(existsSync);

  if (!regularPath || !boldPath) return { regular: "Helvetica", bold: "Helvetica-Bold" };
  doc.registerFont("NRMS-Trebuchet", regularPath);
  doc.registerFont("NRMS-Trebuchet-Bold", boldPath);
  return { regular: "NRMS-Trebuchet", bold: "NRMS-Trebuchet-Bold" };
}

function drawTealHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  // Teal header band
  doc.rect(0, 0, PAGE_W, 90).fill(TEAL);

  // NoLSAF wordmark
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#ffffff")
    .text("NoLSAF", MARGIN, 22, { lineBreak: false });

  // Document title
  doc.font("Helvetica").fontSize(10).fillColor("rgba(255,255,255,0.75)")
    .text(title.toUpperCase(), MARGIN + 90, 28, { lineBreak: false });

  // Subtitle right-aligned
  doc.font("Helvetica").fontSize(9).fillColor("rgba(255,255,255,0.65)")
    .text(subtitle, MARGIN, 55, { align: "right", width: COL_W });

  doc.moveDown(0);
  doc.y = 110;
}

function drawSectionLabel(doc: PDFKit.PDFDocument, label: string) {
  doc.moveDown(0.4);
  const y = doc.y;
  doc.rect(MARGIN, y, COL_W, 20).fill(LIGHT_TEAL);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK)
    .text(label.toUpperCase(), MARGIN + 8, y + 6);
  doc.y = y + 26;
}

function drawRow(doc: PDFKit.PDFDocument, label: string, value: string, accentValue = false) {
  const y = doc.y;
  // subtle alternating not needed — just draw two columns
  doc.font("Helvetica").fontSize(9).fillColor(TEXT_MUTED)
    .text(label, MARGIN, y, { width: 160, lineBreak: false });
  doc.font(accentValue ? "Helvetica-Bold" : "Helvetica")
    .fillColor(accentValue ? DARK : TEXT_MAIN)
    .text(value, MARGIN + 170, y, { width: COL_W - 170 });
  doc.moveDown(0.15);
}

function drawDivider(doc: PDFKit.PDFDocument) {
  doc.moveDown(0.3);
  doc.strokeColor(BORDER).lineWidth(0.5)
    .moveTo(MARGIN, doc.y).lineTo(MARGIN + COL_W, doc.y).stroke();
  doc.moveDown(0.3);
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const footerY = doc.page.height - 45;
  // The footer sits below the bottom margin; zero it while drawing so pdfkit
  // does not auto-add a blank page for each text line.
  const bottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.strokeColor(BORDER).lineWidth(0.5)
    .moveTo(MARGIN, footerY).lineTo(MARGIN + COL_W, footerY).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(TEXT_MUTED)
    .text(
      `NoLSAF · Dar es Salaam, Tanzania · support@nolsaf.com · nolsaf.com`,
      MARGIN, footerY + 8, { align: "center", width: COL_W }
    )
    .text(
      `This document was generated automatically. For queries contact support@nolsaf.com`,
      MARGIN, footerY + 20, { align: "center", width: COL_W }
    );
  doc.page.margins.bottom = bottomMargin;
}

// ─── Receipt-style helpers (used by the owner Payout Receipt) ─────────────────

type RcptOpts = { accent?: boolean; bold?: boolean };
type RcptRow = [string, string] | [string, string, RcptOpts];

/** A perforated dotted edge, like a real tear-off receipt. */
function drawDottedEdge(doc: PDFKit.PDFDocument, x: number, y: number, w: number, color = TEAL) {
  const step = 9;
  const r = 1.4;
  doc.save().fillColor(color);
  for (let cx = x; cx <= x + w; cx += step) doc.circle(cx, y, r).fill();
  doc.restore();
}

/** One "label … value" line inside a receipt card. */
function drawReceiptDetail(doc: PDFKit.PDFDocument, x: number, y: number, w: number, label: string, value: string, opts: RcptOpts = {}) {
  doc.font("Helvetica").fontSize(7.5).fillColor(RCPT_LABEL)
    .text(label, x, y, { width: w * 0.4, lineBreak: false });
  doc.font(opts.accent || opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8)
    .fillColor(opts.accent ? TEAL : RCPT_VALUE)
    .text(value, x + w * 0.4, y, { width: w * 0.6, align: "right", lineBreak: false });
}

/** A tinted, rounded detail card with a section label and rows. Returns its height. */
function drawReceiptCard(doc: PDFKit.PDFDocument, x: number, y: number, w: number, label: string, rows: RcptRow[]): number {
  const padX = 10, padTop = 9, padBottom = 6, labelH = 13, rowH = 13;
  const h = padTop + labelH + rows.length * rowH + padBottom;
  doc.roundedRect(x, y, w, h, 8).fillAndStroke(RCPT_BG, RCPT_BORDER);
  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(RCPT_LABEL)
    .text(label.toUpperCase(), x + padX, y + padTop, { characterSpacing: 1, lineBreak: false });
  let ry = y + padTop + labelH;
  for (const row of rows) {
    drawReceiptDetail(doc, x + padX, ry, w - padX * 2, row[0], row[1], row[2] ?? {});
    ry += rowH;
  }
  return h;
}

// ─── 1. Booking Ticket ────────────────────────────────────────────────────────

export interface BookingTicketData {
  bookingId: number;
  bookingCode: string;
  guestName: string;
  guestPhone?: string | null;
  propertyName: string;
  propertyLocation?: string | null;
  checkIn: Date | string;
  checkOut: Date | string;
  rooms: number;
  totalAmount: number | string;
  currency?: string;
  includeTransport?: boolean;
  transportDate?: Date | string | null;
  transportOrigin?: string | null;
  confirmedAt?: Date | null;
}

export async function generateBookingTicketPdf(data: BookingTicketData): Promise<Buffer> {
  return buildBuffer((doc) => {
    drawTealHeader(doc, "Booking Confirmation", `Issued: ${fmtDate(data.confirmedAt || new Date())}`);

    // Large booking code block
    const codeBoxY = doc.y;
    doc.rect(MARGIN, codeBoxY, COL_W, 56).fill("#f0fdf4");
    doc.rect(MARGIN, codeBoxY, COL_W, 56).strokeColor("#16a34a").lineWidth(1.5).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#166534")
      .text("CHECK-IN CODE", MARGIN, codeBoxY + 8, { align: "center", width: COL_W });
    doc.font("Helvetica-Bold").fontSize(30).fillColor("#14532d")
      .text(data.bookingCode, MARGIN, codeBoxY + 22, { align: "center", width: COL_W, characterSpacing: 6 });
    doc.y = codeBoxY + 68;

    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED)
      .text("Present this code to property staff on arrival", MARGIN, doc.y, { align: "center", width: COL_W });
    doc.moveDown(0.8);

    drawSectionLabel(doc, "Guest Details");
    drawRow(doc, "Guest Name", data.guestName, true);
    if (data.guestPhone) drawRow(doc, "Phone", data.guestPhone);
    drawDivider(doc);

    drawSectionLabel(doc, "Booking Details");
    drawRow(doc, "Booking Reference", `#${data.bookingId}`);
    drawRow(doc, "Property", data.propertyName, true);
    if (data.propertyLocation) drawRow(doc, "Location", data.propertyLocation);
    drawRow(doc, "Check-In", fmtDate(data.checkIn), true);
    drawRow(doc, "Check-Out", fmtDate(data.checkOut), true);
    const nights = Math.max(1, Math.ceil(
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000
    ));
    drawRow(doc, "Duration", `${nights} night${nights !== 1 ? "s" : ""}`);
    drawRow(doc, "Rooms", String(data.rooms));
    drawRow(doc, "Total Amount", fmtMoney(data.totalAmount, data.currency), true);
    drawDivider(doc);

    if (data.includeTransport) {
      drawSectionLabel(doc, "Transport");
      if (data.transportDate) drawRow(doc, "Pickup Date", fmtDate(data.transportDate));
      if (data.transportOrigin) drawRow(doc, "Pickup Address", data.transportOrigin);
      drawDivider(doc);
    }

    // Important notice
    doc.moveDown(0.3);
    doc.rect(MARGIN, doc.y, COL_W, 36).fill("#fff7ed");
    const noticeY = doc.y + 6;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(AMBER)
      .text("IMPORTANT: ", MARGIN + 10, noticeY, { lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor("#92400e")
      .text("Keep this confirmation safe. Present the check-in code to property staff on arrival.", MARGIN + 70, noticeY, { width: COL_W - 80 });
    doc.y += 44;

    drawFooter(doc);
  });
}

// ─── 2. Payment Receipt ───────────────────────────────────────────────────────

export interface PaymentReceiptData {
  receiptNumber: string;
  invoiceNumber: string;
  bookingId: number;
  bookingCode?: string | null;
  guestName: string;
  guestEmail?: string | null;
  propertyName: string;
  checkIn: Date | string;
  checkOut: Date | string;
  total: number | string;
  commissionAmount?: number | string | null;
  taxAmount?: number | string | null;
  netPayable?: number | string | null;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  paidAt: Date | string | null;
  currency?: string;
  /** QR code PNG bytes (from invoice.receiptQrPng) */
  qrPng?: Buffer | null;
}

export async function generatePaymentReceiptPdf(data: PaymentReceiptData): Promise<Buffer> {
  return buildBuffer((doc) => {
    drawTealHeader(doc, "Payment Receipt", `Receipt: ${data.receiptNumber}`);

    // Paid badge
    const badgeY = doc.y;
    doc.rect(MARGIN + COL_W - 80, badgeY - 4, 80, 22).fill("#dcfce7");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#166534")
      .text("PAID ✓", MARGIN + COL_W - 76, badgeY + 2, { width: 72, align: "center" });
    doc.y = badgeY;

    drawSectionLabel(doc, "Receipt Details");
    drawRow(doc, "Receipt Number", data.receiptNumber, true);
    drawRow(doc, "Invoice Number", data.invoiceNumber);
    drawRow(doc, "Date Paid", fmtDate(data.paidAt));
    drawRow(doc, "Payment Method", (data.paymentMethod || "—").replace(/_/g, " "));
    if (data.paymentRef) drawRow(doc, "Transaction Reference", data.paymentRef);
    drawDivider(doc);

    drawSectionLabel(doc, "Customer Details");
    drawRow(doc, "Name", data.guestName, true);
    if (data.guestEmail) drawRow(doc, "Email", data.guestEmail);
    drawDivider(doc);

    drawSectionLabel(doc, "Booking Details");
    drawRow(doc, "Booking Reference", `#${data.bookingId}`);
    if (data.bookingCode) drawRow(doc, "Booking Code", data.bookingCode);
    drawRow(doc, "Property", data.propertyName, true);
    drawRow(doc, "Check-In", fmtDate(data.checkIn));
    drawRow(doc, "Check-Out", fmtDate(data.checkOut));
    const nights = Math.max(1, Math.ceil(
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000
    ));
    drawRow(doc, "Duration", `${nights} night${nights !== 1 ? "s" : ""}`);
    drawDivider(doc);

    // Amount breakdown
    drawSectionLabel(doc, "Payment Summary");
    drawRow(doc, "Booking Amount",   fmtMoney(data.total, data.currency));
    const totalLine = doc.y;
    doc.rect(MARGIN, totalLine, COL_W, 24).fill(LIGHT_TEAL);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK)
      .text("Total Paid", MARGIN + 8, totalLine + 7, { width: 160, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK)
      .text(fmtMoney(data.total, data.currency), MARGIN + 170, totalLine + 7, { width: COL_W - 178 });
    doc.y = totalLine + 32;

    // QR code (right-aligned)
    if (data.qrPng && data.qrPng.length > 0) {
      doc.moveDown(0.4);
      const qrY = doc.y;
      try {
        doc.image(data.qrPng, MARGIN + COL_W - 90, qrY, { width: 80, height: 80 });
        doc.font("Helvetica").fontSize(7.5).fillColor(TEXT_MUTED)
          .text("Scan to verify receipt", MARGIN + COL_W - 90, qrY + 82, { width: 80, align: "center" });
      } catch {
        // QR embed failed — skip silently
      }
      doc.y = qrY + 96;
    }

    drawFooter(doc);
  });
}

// ─── 3. Owner Disbursement Notice ─────────────────────────────────────────────

export interface OwnerDisbursementData {
  ownerName: string;
  ownerEmail?: string | null;
  receiptNumber: string;
  invoiceNumber: string;
  bookingId: number;
  bookingCode?: string | null;
  propertyName: string;
  checkIn: Date | string;
  checkOut: Date | string;
  totalRevenue: number | string;
  commissionPercent?: number | string | null;
  commissionAmount?: number | string | null;
  taxPercent?: number | string | null;
  taxAmount?: number | string | null;
  netPayable: number | string;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  paidAt: Date | string | null;
  currency?: string;
  /** QR code PNG bytes */
  qrPng?: Buffer | null;
}

export async function generateOwnerDisbursementPdf(data: OwnerDisbursementData): Promise<Buffer> {
  return buildBuffer((doc) => {
    const cur = data.currency || "TZS";
    const CARD_W = 440;
    const CARD_X = (PAGE_W - CARD_W) / 2;
    const PAD = 18;
    const innerX = CARD_X + PAD;
    const innerW = CARD_W - PAD * 2;
    const colGap = 12;
    const colW = (innerW - colGap) / 2;

    const cardTop = 48;
    let y = cardTop + 16;

    // Perforated top edge
    drawDottedEdge(doc, CARD_X + 8, cardTop + 9, CARD_W - 16);

    // ── Header: wordmark + verified pill ──
    doc.font("Helvetica-Bold").fontSize(13).fillColor(DARK)
      .text("NoLSAF", innerX, y, { lineBreak: false });
    const badgeW = 62, badgeH = 16, badgeX = innerX + innerW - badgeW, badgeY = y - 3;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 8).fillAndStroke("#edf7f6", "#c0dedd");
    doc.font("Helvetica-Bold").fontSize(7).fillColor(TEAL)
      .text("VERIFIED", badgeX, badgeY + 5, { width: badgeW, align: "center", characterSpacing: 1 });
    y += 26;

    // ── Title ──
    doc.font("Helvetica-Bold").fontSize(7).fillColor(RCPT_LABEL)
      .text("OWNER PAYOUT CONFIRMATION", innerX, y, { width: innerW, align: "center", characterSpacing: 1.5 });
    y += 12;
    doc.font("Helvetica-Bold").fontSize(19).fillColor(RCPT_HEAD)
      .text("Payout Receipt", innerX, y, { width: innerW, align: "center" });
    y += 28;

    // ── Amount ──
    doc.font("Helvetica-Bold").fontSize(7).fillColor(RCPT_LABEL)
      .text("NET AMOUNT DISBURSED", innerX, y, { width: innerW, align: "center", characterSpacing: 1.2 });
    y += 13;
    const amtStr = Number(data.netPayable ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
    doc.font("Helvetica-Bold").fontSize(28).fillColor(TEAL)
      .text(`${cur} ${amtStr}`, innerX, y, { width: innerW, align: "center" });
    y += 34;
    if (data.paidAt) {
      doc.font("Helvetica").fontSize(9).fillColor(RCPT_LABEL)
        .text(fmtDate(data.paidAt), innerX, y, { width: innerW, align: "center" });
      y += 16;
    }

    // ── Reference strip ──
    const stripH = 32;
    doc.roundedRect(innerX, y, innerW, stripH, 6).fillAndStroke(RCPT_BG, RCPT_BORDER);
    doc.font("Helvetica-Bold").fontSize(6).fillColor(RCPT_LABEL)
      .text("RECEIPT NUMBER", innerX + 10, y + 7, { characterSpacing: 1, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(9).fillColor(RCPT_VALUE)
      .text(data.receiptNumber, innerX + 10, y + 17, { width: innerW / 2 - 14, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(6).fillColor(RCPT_LABEL)
      .text("INVOICE", innerX + innerW / 2, y + 7, { width: innerW / 2 - 10, align: "right", characterSpacing: 1, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(9).fillColor(RCPT_VALUE)
      .text(data.invoiceNumber, innerX + innerW / 2, y + 17, { width: innerW / 2 - 10, align: "right", lineBreak: false });
    y += stripH + 12;

    // ── Detail cards row A: Payment | Booking ──
    const nights = Math.max(1, Math.ceil(
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000
    ));
    const paymentRows: RcptRow[] = [
      ["Method", (data.paymentMethod || "—").replace(/_/g, " ")],
      ["Date", fmtDate(data.paidAt)],
      ...(data.paymentRef ? ([["Reference", data.paymentRef]] as RcptRow[]) : []),
    ];
    const bookingRows: RcptRow[] = [
      ["Booking", `#${data.bookingId}`, { accent: true }],
      ...(data.bookingCode ? ([["Code", data.bookingCode]] as RcptRow[]) : []),
      ["Check-in", fmtDate(data.checkIn)],
      ["Check-out", fmtDate(data.checkOut)],
      ["Duration", `${nights} night${nights !== 1 ? "s" : ""}`],
    ];
    const hA = Math.max(
      drawReceiptCard(doc, innerX, y, colW, "Payment", paymentRows),
      drawReceiptCard(doc, innerX + colW + colGap, y, colW, "Booking", bookingRows),
    );
    y += hA + 10;

    // ── Detail cards row B: Property | Owner ──
    const propRows: RcptRow[] = [["Name", data.propertyName, { accent: true }]];
    const ownerRows: RcptRow[] = [
      ["Name", data.ownerName, { accent: true }],
      ...(data.ownerEmail ? ([["Email", data.ownerEmail]] as RcptRow[]) : []),
    ];
    const hB = Math.max(
      drawReceiptCard(doc, innerX, y, colW, "Property", propRows),
      drawReceiptCard(doc, innerX + colW + colGap, y, colW, "Owner", ownerRows),
    );
    y += hB + 10;

    // ── Financial breakdown ──
    const finRows: RcptRow[] = [["Gross Booking Revenue", fmtMoney(data.totalRevenue, cur)]];
    if (data.commissionAmount && Number(data.commissionAmount) > 0) {
      const pct = data.commissionPercent ? ` (${Number(data.commissionPercent).toFixed(1)}%)` : "";
      finRows.push([`Platform Commission${pct}`, `- ${fmtMoney(data.commissionAmount, cur)}`]);
    }
    if (data.taxAmount && Number(data.taxAmount) > 0) {
      const pct = data.taxPercent ? ` (${Number(data.taxPercent).toFixed(1)}%)` : "";
      finRows.push([`Tax${pct}`, `- ${fmtMoney(data.taxAmount, cur)}`]);
    }
    y += drawReceiptCard(doc, innerX, y, innerW, "Financial Breakdown", finRows) + 8;

    // Net highlight
    const netH = 26;
    doc.roundedRect(innerX, y, innerW, netH, 6).fill(LIGHT_TEAL);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK)
      .text("Net Amount Disbursed", innerX + 10, y + 8, { lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(TEAL)
      .text(fmtMoney(data.netPayable, cur), innerX, y + 8, { width: innerW - 10, align: "right", lineBreak: false });
    y += netH + 12;

    // ── Footer seal with QR ──
    const sealH = 70;
    doc.roundedRect(innerX, y, innerW, sealH, 8).fillAndStroke(RCPT_BG, RCPT_BORDER);
    const hasQr = !!(data.qrPng && data.qrPng.length > 0);
    const textW = innerW - (hasQr ? 84 : 24);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK)
      .text("NoLSAF  ·  CERTIFIED RECEIPT", innerX + 12, y + 12, { characterSpacing: 0.5, lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(RCPT_SUB)
      .text(
        "This document confirms your payout has been disbursed to your registered payment method. Please retain it for your records.",
        innerX + 12, y + 26, { width: textW },
      );
    if (hasQr) {
      try {
        doc.image(data.qrPng as Buffer, innerX + innerW - 64, y + 9, { width: 52, height: 52 });
        doc.font("Helvetica").fontSize(6).fillColor(RCPT_LABEL)
          .text("Scan to verify", innerX + innerW - 70, y + 62, { width: 64, align: "center" });
      } catch {
        // skip QR on failure
      }
    }
    y += sealH + 14;

    // Perforated bottom edge + outer card border
    drawDottedEdge(doc, CARD_X + 8, y, CARD_W - 16);
    y += 6;
    doc.roundedRect(CARD_X, cardTop, CARD_W, y - cardTop, 12).lineWidth(1).stroke(RCPT_OUTER);

    drawFooter(doc);
  });
}

// ─── 4. NRMS Guest Invoice ────────────────────────────────────────────────────

export interface NrmsInvoiceData {
  invoiceNumber: string;
  issuedAt: Date | string;
  reservationId: number;
  status: string;
  propertyName: string;
  propertyLocation?: string | null;
  guestName: string;
  guestPhone?: string | null;
  checkIn: Date | string;
  checkOut: Date | string;
  /** Active room allocations, e.g. unit code or room type name */
  rooms: Array<{ label: string }>;
  currency: string;
  /** Reservation.totalAmount (room stay) */
  roomTotal: number | string;
  charges: Array<{ date: Date | string; category: string; description?: string | null; amount: number | string }>;
  payments: Array<{ date: Date | string; method: string; reference?: string | null; amount: number | string }>;
  outletPayments?: Array<{
    date: Date | string;
    orderNumber: string;
    outlet: string;
    method?: string | null;
    items: string;
    amount: number | string;
  }>;
  chargesTotal: number | string;
  amountPaid: number | string;
  /** roomTotal + chargesTotal - amountPaid */
  balanceDue: number;
}

/**
 * A5 guest invoice issued BY the property TO the guest (NoLSAF is only the
 * "generated by" footer line). Classic invoice layout: issuer header, bill-to
 * block, ruled line-item table, right-aligned totals. The document titles
 * itself INVOICE while a balance is due and RECEIPT once fully settled.
 */
export async function generateNrmsInvoicePdf(data: NrmsInvoiceData): Promise<Buffer> {
  const A5_W = 419.53;
  const A5_H = 595.28;
  const M = 34;
  const W = A5_W - M * 2;
  const cur = data.currency;
  const outletPayments = data.outletPayments ?? [];
  const outletPaidTotal = outletPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const folioTotal = Number(data.roomTotal) + Number(data.chargesTotal);
  const totalGuestSpend = folioTotal + outletPaidTotal;
  const totalCollected = Number(data.amountPaid) + outletPaidTotal;
  const folioPaymentTotals = data.payments.reduce<Record<string, number>>((totals, payment) => {
    const method = payment.method || "OTHER";
    totals[method] = (totals[method] ?? 0) + Number(payment.amount || 0);
    return totals;
  }, {});
  const folioPaymentBreakdown = Object.entries(folioPaymentTotals)
    .map(([method, amount]) => {
      const words = method.replace(/_/g, " ").toLowerCase();
      const label = words.charAt(0).toUpperCase() + words.slice(1);
      return `${label} ${fmtMoney(amount, cur)}`;
    })
    .join(" · ");
  const settled = data.balanceDue <= 0 && totalCollected > 0;
  const docTitle = settled ? "RECEIPT" : "INVOICE";
  const CONTENT_LIMIT = A5_H - 96; // keep clear of the signature/footer zone

  const fmtIsoDate = (d: Date | string) => {
    const parsed = new Date(d);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "---- -- --";
  };

  // Line-item table geometry
  const COL_DATE = 62;
  const COL_AMOUNT = 96;
  const COL_DESC = W - COL_DATE - COL_AMOUNT;
  const MIN_ROW_H = 17;
  const MAX_ROW_H = 48;

  return buildBuffer((doc) => {
    const fonts = registerNrmsFonts(doc);
    const drawWatermark = () => {
      doc.save();
      doc.opacity(0.035).fillColor(TEAL).font(fonts.bold).fontSize(48);
      doc.rotate(-32, { origin: [A5_W / 2, A5_H / 2] });
      doc.text("NRMS", 58, A5_H / 2 - 36, { width: A5_W - 116, align: "center", lineBreak: false });
      doc.fontSize(13)
        .text("GUEST RECEIPT", 58, A5_H / 2 + 15, { width: A5_W - 116, align: "center", characterSpacing: 2.2, lineBreak: false });
      doc.restore();
    };

    let y = M;
    drawWatermark();

    const tableHeader = () => {
      doc.rect(M, y, W, 16).fill(TEAL);
      doc.font(fonts.bold).fontSize(6.5).fillColor("#ffffff");
      doc.text("DATE", M + 6, y + 5, { width: COL_DATE - 6, lineBreak: false });
      doc.text("DESCRIPTION", M + COL_DATE + 6, y + 5, { width: COL_DESC - 6, lineBreak: false });
      doc.text("AMOUNT", M + COL_DATE + COL_DESC, y + 5, { width: COL_AMOUNT - 6, align: "right", lineBreak: false });
      y += 16;
    };

    const tableRow = (
      date: string,
      description: string,
      amount: string,
      boldAmount = false,
      detail?: string,
      meta?: string,
    ) => {
      const descriptionWidth = COL_DESC - 10;
      doc.font(fonts.bold).fontSize(8);
      const titleHeight = Math.min(10, doc.heightOfString(description, { width: descriptionWidth }));
      doc.font(fonts.regular).fontSize(7.2);
      const detailHeight = detail ? Math.min(18, doc.heightOfString(detail, { width: descriptionWidth, lineGap: 0.5 })) : 0;
      const metaHeight = meta ? 8 : 0;
      const contentHeight = titleHeight + (detailHeight ? detailHeight + 2 : 0) + (metaHeight ? metaHeight + 2 : 0);
      const rowHeight = Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, Math.ceil(contentHeight) + 8));
      if (y + rowHeight > CONTENT_LIMIT) {
        doc.addPage({ size: "A5", margin: M });
        drawWatermark();
        y = M;
        tableHeader();
      }
      doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MUTED)
        .text(date, M + 6, y + 4, { width: COL_DATE - 6, lineBreak: false });
      let descriptionY = y + 4;
      doc.font(fonts.bold).fontSize(8).fillColor(TEXT_MAIN)
        .text(description, M + COL_DATE + 6, y + 4, {
          width: descriptionWidth,
          height: titleHeight,
          ellipsis: true,
        });
      descriptionY += titleHeight + 2;
      if (detail) {
        doc.font(fonts.regular).fontSize(7.2).fillColor(TEXT_MAIN)
          .text(detail, M + COL_DATE + 6, descriptionY, {
            width: descriptionWidth,
            height: detailHeight,
            lineGap: 0.5,
            ellipsis: true,
          });
        descriptionY += detailHeight + 2;
      }
      if (meta) {
        doc.font(fonts.bold).fontSize(6).fillColor(TEXT_MUTED)
          .text(meta.toUpperCase(), M + COL_DATE + 6, descriptionY, {
            width: descriptionWidth,
            height: metaHeight,
            characterSpacing: 0.25,
            ellipsis: true,
          });
      }
      doc.font(boldAmount ? fonts.bold : fonts.regular).fontSize(8).fillColor(TEXT_MAIN)
        .text(amount, M + COL_DATE + COL_DESC, y + 4, { width: COL_AMOUNT - 6, align: "right", lineBreak: false });
      doc.strokeColor(BORDER).lineWidth(0.5)
        .moveTo(M, y + rowHeight).lineTo(M + W, y + rowHeight).stroke();
      y += rowHeight;
    };

    // ── Issuer header: the property bills the guest ──
    doc.font(fonts.bold).fontSize(13).fillColor(TEXT_MAIN)
      .text(data.propertyName, M, y, { width: W * 0.58, lineBreak: false, ellipsis: true });
    if (data.propertyLocation) {
      doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MUTED)
        .text(data.propertyLocation, M, y + 17, { width: W * 0.58, lineBreak: false, ellipsis: true });
    }
    doc.font(fonts.bold).fontSize(16).fillColor(TEAL)
      .text(docTitle, M, y, { width: W, align: "right" });
    doc.font("Courier-Bold").fontSize(7.2).fillColor(TEXT_MAIN)
      .text(`${docTitle} No: ${data.invoiceNumber}`, M, y + 20, { width: W, align: "right" });
    doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MUTED)
      .text(`Issue date: ${fmtIsoDate(data.issuedAt)}`, M, y + 30, { width: W, align: "right" })
      .text(`Reservation ref: NRMS-${String(data.reservationId).padStart(6, "0")}`, M, y + 40, { width: W, align: "right" });
    if (settled) {
      // PAID badge under the title block
      const badgeW = 54;
      doc.roundedRect(M + W - badgeW, y + 52, badgeW, 15, 3).fill("#dcfce7");
      doc.font(fonts.bold).fontSize(8).fillColor("#166534")
        .text("PAID", M + W - badgeW, y + 56, { width: badgeW, align: "center", lineBreak: false });
    }
    y += 72;

    // Double keyline under the header
    doc.strokeColor(TEAL).lineWidth(1.5).moveTo(M, y).lineTo(M + W, y).stroke();
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(M, y + 3).lineTo(M + W, y + 3).stroke();
    y += 14;

    // ── Bill-to and stay blocks, side by side ──
    const colR = M + W * 0.52;
    const infoCardW = W * 0.48;
    doc.roundedRect(M, y - 6, infoCardW, 58, 5).fillAndStroke("#f7fbfa", BORDER);
    doc.roundedRect(colR, y - 6, M + W - colR, 58, 5).fillAndStroke("#f7fbfa", BORDER);
    doc.font(fonts.bold).fontSize(6.5).fillColor(TEXT_MUTED)
      .text("BILLED TO", M + 8, y, { characterSpacing: 1, lineBreak: false })
      .text("STAY DETAILS", colR + 8, y, { characterSpacing: 1, lineBreak: false });
    doc.font(fonts.bold).fontSize(9).fillColor(TEXT_MAIN)
      .text(data.guestName, M + 8, y + 11, { width: infoCardW - 16, lineBreak: false, ellipsis: true });
    if (data.guestPhone) {
      doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MUTED)
        .text(data.guestPhone, M + 8, y + 24, { lineBreak: false });
    }
    const nights = Math.max(1, Math.ceil(
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000
    ));
    const stayPairs: Array<[string, string]> = [
      ["Check-in", fmtIsoDate(data.checkIn)],
      ["Check-out", fmtIsoDate(data.checkOut)],
      ["Nights", String(nights)],
      ...(data.rooms.length ? ([["Room", data.rooms.map((r) => r.label).join(", ")]] as Array<[string, string]>) : []),
    ];
    let sy = y + 11;
    for (const [label, value] of stayPairs) {
      doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MUTED).text(label, colR + 8, sy, { lineBreak: false });
      doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MAIN)
        .text(value, colR + 54, sy, { width: M + W - colR - 62, lineBreak: false, ellipsis: true });
      sy += 10;
    }
    y = Math.max(y + 38, sy + 4) + 6;

    // ── Line items ──
    tableHeader();
    tableRow(
      fmtIsoDate(data.checkIn),
      "Accommodation",
      fmtMoney(data.roomTotal, cur),
      false,
      `${nights} night${nights !== 1 ? "s" : ""}${data.rooms.length ? ` · ${data.rooms.map((r) => r.label).join(", ")}` : ""}`,
    );
    for (const charge of data.charges) {
      const category = charge.category.replace(/_/g, " ").toLowerCase();
      const label = category.charAt(0).toUpperCase() + category.slice(1);
      tableRow(
        fmtIsoDate(charge.date),
        label,
        fmtMoney(charge.amount, cur),
        false,
        charge.description || undefined,
      );
    }
    for (const payment of outletPayments) {
      const method = payment.method
        ? payment.method.replace(/_/g, " ").toLowerCase()
        : "payment method not recorded";
      tableRow(
        fmtIsoDate(payment.date),
        payment.outlet,
        fmtMoney(payment.amount, cur),
        false,
        payment.items,
        `Paid at outlet · ${method} · ${payment.orderNumber}`,
      );
    }

    // ── Totals, right-aligned ──
    const totalsW = 210;
    const totalsLabelW = 110;
    const totalsValueW = totalsW - totalsLabelW;
    const totalsX = M + W - totalsW;
    const totalsSection = (label: string) => {
      doc.font(fonts.bold).fontSize(6).fillColor(TEAL)
        .text(label.toUpperCase(), totalsX, y + 2, { width: totalsW, characterSpacing: 0.8, lineBreak: false });
      y += 11;
    };
    const totalsLine = (label: string, value: string, bold = false, color = TEXT_MAIN) => {
      doc.font(bold ? fonts.bold : fonts.regular).fontSize(8).fillColor(TEXT_MUTED)
        .text(label, totalsX, y + 4, { width: totalsLabelW, lineBreak: false });
      doc.font(bold ? fonts.bold : fonts.regular).fontSize(8.5).fillColor(color)
        .text(value, totalsX + totalsLabelW, y + 4, { width: totalsValueW, align: "right", lineBreak: false });
      y += 14;
    };
    doc.font(fonts.regular).fontSize(6.5);
    const folioBreakdownHeight = folioPaymentBreakdown
      ? Math.min(16, doc.heightOfString(folioPaymentBreakdown, { width: totalsW, lineGap: 0.5 }))
      : 0;
    const totalsRequiredHeight = 155 + (folioBreakdownHeight ? folioBreakdownHeight + 3 : 0);
    if (y + totalsRequiredHeight > CONTENT_LIMIT) {
      doc.addPage({ size: "A5", margin: M });
      drawWatermark();
      y = M;
    }
    y += 4;
    totalsSection("Guest charges");
    totalsLine("Room and folio charges", fmtMoney(folioTotal, cur));
    totalsLine("Outlet purchases", fmtMoney(outletPaidTotal, cur));
    totalsLine("Total guest spend", fmtMoney(totalGuestSpend, cur), true);
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(totalsX, y + 2).lineTo(M + W, y + 2).stroke();
    y += 6;
    totalsSection("Payments received");
    totalsLine("Folio payments", fmtMoney(data.amountPaid, cur));
    if (folioPaymentBreakdown) {
      doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED);
      doc.text(folioPaymentBreakdown, totalsX, y, { width: totalsW, height: folioBreakdownHeight, lineGap: 0.5, ellipsis: true });
      y += folioBreakdownHeight + 3;
    }
    totalsLine("Outlet payments", fmtMoney(outletPaidTotal, cur));
    totalsLine("Total collected", fmtMoney(totalCollected, cur), true, TEAL);
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(totalsX, y + 2).lineTo(M + W, y + 2).stroke();
    y += 5;
    const dueBoxH = 22;
    doc.roundedRect(totalsX, y, totalsW, dueBoxH, 3).fill(settled ? "#dcfce7" : "#fef3c7");
    doc.font(fonts.bold).fontSize(9).fillColor(settled ? "#166534" : AMBER);
    if (settled) {
      doc.text("PAID IN FULL", totalsX + 8, y + 7, { width: totalsW - 16, align: "center", lineBreak: false });
    } else {
      doc.text("FOLIO BALANCE DUE", totalsX + 8, y + 7, { width: totalsLabelW - 8, lineBreak: false });
      doc.font(fonts.bold).fontSize(9).fillColor(AMBER)
        .text(fmtMoney(data.balanceDue, cur), totalsX + totalsLabelW, y + 7, { width: totalsValueW - 8, align: "right", lineBreak: false });
    }
    y += dueBoxH + 12;

    // ── Signature and footer, pinned to the bottom of the last page ──
    // Zero the bottom margin while drawing so pdfkit does not auto-add a page.
    doc.page.margins.bottom = 0;
    const signY = A5_H - 74;
    doc.strokeColor(TEXT_MUTED).lineWidth(0.5).moveTo(M, signY + 12).lineTo(M + 116, signY + 12).stroke();
    doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED)
      .text("Authorized signature", M, signY + 16, { lineBreak: false });
    const barcodeX = M + 128;
    const barcodeW = W - 128;
    drawCode128Barcode(doc, data.invoiceNumber, barcodeX, signY - 4, barcodeW, 24);
    doc.font("Courier-Bold").fontSize(6).fillColor(TEXT_MAIN)
      .text(data.invoiceNumber, barcodeX, signY + 23, { width: barcodeW, align: "center", characterSpacing: 0.45, lineBreak: false });
    doc.font(fonts.regular).fontSize(5.5).fillColor(TEXT_MUTED)
      .text("CODE 128 | ISO/IEC 15417", barcodeX, signY + 31, { width: barcodeW, align: "center", lineBreak: false });
    const footerY = A5_H - 34;
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(M, footerY - 6).lineTo(M + W, footerY - 6).stroke();
    doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED)
      .text("Powered by NoLSAF | nolsaf.com", M, footerY, { width: W, align: "center" });
    doc.page.margins.bottom = M;
  }, { size: "A5", margin: M });
}
