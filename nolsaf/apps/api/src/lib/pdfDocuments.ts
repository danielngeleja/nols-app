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

function fmtDateTime(d: Date | string | null | undefined, timeZone = "Africa/Dar_es_Salaam"): string {
  if (!d) return "—";
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
  }).format(new Date(d));

  return `${dateTime} EAT`;
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

/**
 * Document masthead. The wordmark and the document type stack on the left so
 * the type reads as a label rather than as part of the brand name, and the
 * identifier gets its own outlined chip on the right instead of floating as
 * loose grey text.
 */
function drawTealHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  const bandH = 96;
  doc.rect(0, 0, PAGE_W, bandH).fill(TEAL);
  // Accent stripe gives the band an edge instead of ending in flat colour.
  doc.rect(0, bandH, PAGE_W, 3.5).fill("#0b9182");

  doc.font("Helvetica-Bold").fontSize(21).fillColor("#ffffff")
    .text("NoLSAF", MARGIN, 24, { lineBreak: false });

  // Hairline between the wordmark and the document type.
  doc.save().strokeColor("#ffffff").opacity(0.28).lineWidth(0.75)
    .moveTo(MARGIN + 1, 51).lineTo(MARGIN + 74, 51).stroke().restore();

  doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff").opacity(0.82)
    .text(title.toUpperCase(), MARGIN + 1, 59, { characterSpacing: 2.2, lineBreak: false });
  doc.opacity(1);

  // Identifier chip, right aligned.
  const chipText = subtitle.replace(/^[^:]+:\s*/, "");
  const chipLabel = subtitle.includes(":") ? subtitle.split(":")[0]!.trim().toUpperCase() : "";
  const chipW = Math.max(150, doc.font("Helvetica-Bold").fontSize(10).widthOfString(chipText) + 26);
  const chipX = MARGIN + COL_W - chipW;
  doc.save().roundedRect(chipX, 30, chipW, chipLabel ? 40 : 30, 6)
    .fillOpacity(0.14).fill("#ffffff").restore();
  if (chipLabel) {
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#ffffff").opacity(0.75)
      .text(chipLabel, chipX, 37, { width: chipW, align: "center", characterSpacing: 1.4, lineBreak: false });
    doc.opacity(1);
  }
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff")
    .text(chipText, chipX, chipLabel ? 50 : 39, { width: chipW, align: "center", lineBreak: false });

  doc.y = 122;
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

// ─── 1b. Agent Booking Voucher (NRMS Agent B2B) ───────────────────────────────

export interface AgentVoucherData {
  voucherNumber: string;
  agencyName: string;
  agentReference: string;
  guestName?: string | null;
  propertyName: string;
  propertyLocation?: string | null;
  roomType?: string | null;
  ratePlan?: string | null;
  mealPlan?: string | null;
  checkIn: Date | string;
  checkOut: Date | string;
  rooms: number;
  totalAmount: number | string;
  currency?: string;
  bookingMode?: string | null;
  paymentStatus?: string | null;
  confirmedAt?: Date | null;
  /** QR payload rendered top-right. Scanned by the desk at check-in. */
  qrPng?: Buffer | null;
}

export async function generateNrmsAgentVoucherPdf(data: AgentVoucherData): Promise<Buffer> {
  const nights = Math.max(1, Math.ceil((new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000));
  const paid = data.paymentStatus === "SETTLED" || data.paymentStatus === "CREDIT";

  // A5 portrait. A voucher is carried, handed over and filed, so it is sized
  // like a ticket rather than a report. Everything that is not needed at the
  // front desk was cut; the full commercial detail lives on the invoice.
  const M = 32;
  const W = 419.53 - M * 2; // A5 width in points
  return buildBuffer((doc) => {
    const fonts = registerNrmsFonts(doc);
    const left = M;
    let y = M;
    const dateOnly = (value: Date | string) => new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

    // ── Masthead, matching the invoice construction at voucher scale ───────
    doc.font(fonts.bold).fontSize(12).fillColor(TEXT_MAIN).text(data.propertyName, left, y, { width: W * 0.5, ellipsis: true });
    if (data.propertyLocation) doc.font(fonts.regular).fontSize(7).fillColor(TEXT_MUTED).text(data.propertyLocation, left, y + 16, { width: W * 0.5, ellipsis: true });
    doc.font(fonts.bold).fontSize(14).fillColor(TEAL).text("BOOKING VOUCHER", left, y, { width: W, align: "right" });
    doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED).text("Issued " + dateOnly(data.confirmedAt || new Date()), left, y + 19, { width: W, align: "right" });
    y += 34;
    doc.strokeColor(TEAL).lineWidth(1.5).moveTo(left, y).lineTo(left + W, y).stroke();
    y += 14;

    // ── Identity: number, status and QR in one band ────────────────────────
    const qrBox = 76;
    const bandH = 92;
    doc.roundedRect(left, y, W, bandH, 6).fillAndStroke("#f7fbfa", BORDER);
    doc.roundedRect(left + 12, y + 12, 44, 15, 7.5).fill(paid ? TEAL : AMBER);
    doc.font(fonts.bold).fontSize(7).fillColor("#ffffff")
      .text(paid ? "PAID" : "DUE", left + 12, y + 16.5, { width: 44, align: "center", lineBreak: false });

    doc.font(fonts.bold).fontSize(6.5).fillColor(TEXT_MUTED)
      .text("VOUCHER NUMBER", left + 12, y + 36, { characterSpacing: 0.7, lineBreak: false });
    doc.font("Courier-Bold").fontSize(15).fillColor(TEAL)
      .text(data.voucherNumber, left + 12, y + 48, { width: W - qrBox - 36, lineBreak: false });
    doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED)
      .text("Present on arrival", left + 12, y + 70, { width: W - qrBox - 36, lineBreak: false });

    if (data.qrPng) {
      try { doc.image(data.qrPng, left + W - qrBox - 10, y + 8, { fit: [qrBox, qrBox], align: "center", valign: "center" }); } catch { /* decorative */ }
    }
    y += bandH + 12;

    // ── The three facts the desk reads first ───────────────────────────────
    const stripH = 40;
    const cellW = W / 3;
    doc.rect(left, y, W, stripH).fill(LIGHT_TEAL);
    ([
      ["CHECK IN", dateOnly(data.checkIn)],
      ["CHECK OUT", dateOnly(data.checkOut)],
      ["STAY", nights + " night" + (nights === 1 ? "" : "s")],
    ] as Array<[string, string]>).forEach(([label, value], index) => {
      const cellX = left + cellW * index;
      if (index > 0) doc.strokeColor("#ffffff").lineWidth(1).moveTo(cellX, y + 7).lineTo(cellX, y + stripH - 7).stroke();
      doc.font(fonts.bold).fontSize(6).fillColor(TEAL).text(label, cellX + 10, y + 9, { width: cellW - 16, characterSpacing: 0.8, lineBreak: false });
      doc.font(fonts.bold).fontSize(8.5).fillColor(TEXT_MAIN).text(value, cellX + 10, y + 21, { width: cellW - 16, ellipsis: true, lineBreak: false });
    });
    y += stripH + 14;

    // ── Only what reception needs, two columns ─────────────────────────────
    const colW = (W - 14) / 2;
    const kv = (label: string, value: string, x: number, rowY: number) => {
      doc.font(fonts.bold).fontSize(6).fillColor(TEXT_MUTED).text(label.toUpperCase(), x, rowY, { width: colW, characterSpacing: 0.6 });
      doc.font(fonts.bold).fontSize(8.5).fillColor(TEXT_MAIN).text(value || "Not stated", x, rowY + 9, { width: colW, ellipsis: true });
    };
    const rightCol = left + colW + 14;
    kv("Agency", data.agencyName, left, y);
    kv("Agent reference", data.agentReference, rightCol, y);
    y += 26;
    kv("Rooms", String(data.rooms) + (data.roomType ? " × " + data.roomType : ""), left, y);
    kv("Board", data.mealPlan ? data.mealPlan.replace(/_/g, " ") : "Room only", rightCol, y);
    y += 26;
    if (data.guestName) { kv("Lead guest", data.guestName, left, y); }
    kv("Total", fmtMoney(data.totalAmount, data.currency), data.guestName ? rightCol : left, y);
    y += 30;

    // ── Desk scan strip ────────────────────────────────────────────────────
    doc.strokeColor(BORDER).lineWidth(0.6).moveTo(left, y).lineTo(left + W, y).stroke();
    y += 12;
    drawCode128Barcode(doc, data.voucherNumber, left + W / 2 - 90, y, 180, 28);
    doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED)
      .text(data.voucherNumber, left, y + 32, { width: W, align: "center", characterSpacing: 1 });
    y += 48;

    // ── Footer, matching the invoice ───────────────────────────────────────
    doc.strokeColor(BORDER).lineWidth(0.6).moveTo(left, y).lineTo(left + W, y).stroke();
    doc.font(fonts.bold).fontSize(6).fillColor(TEXT_MUTED)
      .text(data.propertyName, left, y + 8, { width: W * 0.55, ellipsis: true })
      .text("NoLSAF · support@nolsaf.com", left + W * 0.55, y + 8, { width: W * 0.45, align: "right" });
  }, { size: "A5", margin: M });
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
  /** Shown under the property name, mirroring the Pro Forma masthead. */
  propertyLocation?: string | null;
  checkIn: Date | string;
  checkOut: Date | string;
  total: number | string;
  /** Invoice total and remaining balance, so the receipt reconciles itself. */
  invoiceTotal?: number | string | null;
  balanceAfter?: number | string | null;
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
  const cur = data.currency || "TZS";
  const nights = Math.max(1, Math.ceil(
    (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000
  ));
  const invoiceTotal = data.invoiceTotal == null ? null : Number(data.invoiceTotal);
  const balance = data.balanceAfter == null ? null : Number(data.balanceAfter);

  // Deliberately mirrors generateNrmsProFormaPdf: same Trebuchet fonts, same
  // masthead and teal rule, same card, table and totals treatment. A receipt
  // and the invoice it settles should read as one family of documents.
  return buildBuffer((doc) => {
    const fonts = registerNrmsFonts(doc);
    const left = MARGIN;
    const width = COL_W;
    let y = MARGIN;
    const dateOnly = (value: Date | string | null) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not recorded");
    const keyValue = (label: string, value: string, x: number, rowY: number, rowW: number) => {
      doc.font(fonts.bold).fontSize(6.5).fillColor(TEXT_MUTED).text(label.toUpperCase(), x, rowY, { width: rowW, characterSpacing: 0.7 });
      doc.font(fonts.regular).fontSize(8.5).fillColor(TEXT_MAIN).text(value || "Not provided", x, rowY + 11, { width: rowW, ellipsis: true });
    };

    // ── Masthead ───────────────────────────────────────────────────────────
    doc.font(fonts.bold).fontSize(17).fillColor(TEXT_MAIN).text(data.propertyName, left, y, { width: width * 0.55, ellipsis: true });
    if (data.propertyLocation) doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MUTED).text(data.propertyLocation, left, y + 24, { width: width * 0.55 });
    doc.font(fonts.bold).fontSize(21).fillColor(TEAL).text("PAYMENT RECEIPT", left, y, { width, align: "right" });
    doc.font("Courier-Bold").fontSize(8).fillColor(TEXT_MAIN).text(data.receiptNumber, left, y + 29, { width, align: "right" });
    doc.font(fonts.regular).fontSize(7).fillColor(TEXT_MUTED).text("Paid " + dateOnly(data.paidAt), left, y + 42, { width, align: "right" });
    y += 66;
    doc.strokeColor(TEAL).lineWidth(1.5).moveTo(left, y).lineTo(left + width, y).stroke();
    y += 16;

    // ── Received from / receipt facts ──────────────────────────────────────
    const cardGap = 12;
    const cardW = (width - cardGap) / 2;
    doc.roundedRect(left, y, cardW, 100, 6).fillAndStroke("#f7fbfa", BORDER);
    doc.roundedRect(left + cardW + cardGap, y, cardW, 100, 6).fillAndStroke("#f7fbfa", BORDER);
    doc.font(fonts.bold).fontSize(7).fillColor(TEAL).text("RECEIVED FROM", left + 12, y + 11, { characterSpacing: 1 });
    doc.font(fonts.bold).fontSize(11).fillColor(TEXT_MAIN).text(data.guestName, left + 12, y + 27, { width: cardW - 24, ellipsis: true });
    doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MUTED)
      .text(data.guestEmail || "No email on file", left + 12, y + 47, { width: cardW - 24, ellipsis: true })
      .text("Booking " + (data.bookingCode || "#" + data.bookingId), left + 12, y + 61, { width: cardW - 24, ellipsis: true })
      .text("Against invoice " + (data.invoiceNumber || "not linked"), left + 12, y + 75, { width: cardW - 24, ellipsis: true });
    const rightX = left + cardW + cardGap + 12;
    keyValue("Payment date", dateOnly(data.paidAt), rightX, y + 11, 105);
    keyValue("Method", (data.paymentMethod || "Not stated").replace(/_/g, " "), rightX + 112, y + 11, 105);
    keyValue("Reference", data.paymentRef || "Not provided", rightX, y + 52, 105);
    keyValue("Receipt no.", data.receiptNumber, rightX + 112, y + 52, 105);
    y += 114;

    // ── Stay covered ───────────────────────────────────────────────────────
    doc.font(fonts.bold).fontSize(7).fillColor(TEAL).text("STAY COVERED", left, y, { characterSpacing: 1 });
    doc.font(fonts.bold).fontSize(10).fillColor(TEXT_MAIN).text(data.propertyName, left, y + 14, { width: width * 0.55, ellipsis: true });
    doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MUTED)
      .text(dateOnly(data.checkIn) + " to " + dateOnly(data.checkOut) + " · " + nights + " night" + (nights === 1 ? "" : "s"), left, y + 30, { width: width * 0.55 });
    y += 54;

    // ── Single-line ledger, same table treatment as the invoice ────────────
    const amountW = 130;
    doc.rect(left, y, width, 22).fill(TEAL);
    doc.font(fonts.bold).fontSize(7).fillColor("#ffffff")
      .text("DESCRIPTION", left + 8, y + 7, { width: width - amountW - 16 })
      .text("AMOUNT", left + width - amountW, y + 7, { width: amountW - 8, align: "right" });
    y += 22;
    doc.font(fonts.bold).fontSize(8).fillColor(TEXT_MAIN)
      .text("Payment received against invoice " + (data.invoiceNumber || "(not linked)"), left + 8, y + 6, { width: width - amountW - 16, ellipsis: true });
    doc.font(fonts.regular).fontSize(6.8).fillColor(TEXT_MUTED)
      .text((data.paymentMethod || "Not stated").replace(/_/g, " ") + (data.paymentRef ? " · " + data.paymentRef : ""), left + 8, y + 19, { width: width - amountW - 16, ellipsis: true });
    doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MAIN)
      .text(fmtMoney(data.total, cur), left + width - amountW, y + 7, { width: amountW - 8, align: "right" });
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(left, y + 34).lineTo(left + width, y + 34).stroke();
    y += 48;

    // ── Totals, right aligned like the invoice ─────────────────────────────
    const totalsX = left + width - 230;
    const totalLine = (label: string, value: number, bold = false, color = TEXT_MAIN) => {
      doc.font(bold ? fonts.bold : fonts.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(label, totalsX, y, { width: 120 });
      doc.font(bold ? fonts.bold : fonts.regular).fontSize(9).fillColor(color).text(fmtMoney(value, cur), totalsX + 120, y, { width: 110, align: "right" });
      y += 17;
    };
    if (invoiceTotal != null) totalLine("Invoice total", invoiceTotal);
    totalLine("Amount received", Number(data.total));
    doc.strokeColor(BORDER).lineWidth(0.8).moveTo(totalsX, y).lineTo(left + width, y).stroke();
    y += 8;
    if (balance != null) totalLine("BALANCE REMAINING", balance, true, balance > 0 ? AMBER : TEAL);
    else totalLine("TOTAL PAID", Number(data.total), true, TEAL);
    y += 10;

    // ── Confirmation card carrying the PAID mark and the QR ────────────────
    const settled = balance == null || balance <= 0;
    const cardH = 92;
    doc.roundedRect(left, y, width, cardH, 8).fillAndStroke(LIGHT_TEAL, BORDER);
    doc.font(fonts.bold).fontSize(8).fillColor(TEAL)
      .text(settled ? "PAYMENT RECEIVED IN FULL" : "PART PAYMENT RECEIVED", left + 14, y + 14, { characterSpacing: 0.8 });
    doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MAIN)
      .text(
        settled
          ? "This receipt confirms the property has recorded the payment above against the invoice. No balance remains."
          : "This receipt confirms the amount above. The balance shown remains payable to the property.",
        left + 14, y + 30, { width: width - 130 },
      );
    doc.font(fonts.regular).fontSize(7).fillColor(TEXT_MUTED)
      .text("Keep this document for your records.", left + 14, y + 62, { width: width - 130 });
    if (data.qrPng && data.qrPng.length > 0) {
      try {
        doc.image(data.qrPng, left + width - 88, y + 9, { fit: [76, 76], align: "center", valign: "center" });
        doc.font(fonts.bold).fontSize(5.8).fillColor(TEXT_MUTED).text("RECEIPT CODE", left + width - 93, y + 86, { width: 86, align: "center" });
      } catch { /* QR is decorative */ }
    }
    y += cardH + 16;

    // ── Footer, identical construction to the invoice ──────────────────────
    doc.strokeColor(BORDER).lineWidth(0.6).moveTo(left, y).lineTo(left + width, y).stroke();
    doc.font(fonts.bold).fontSize(6.5).fillColor(TEXT_MUTED)
      .text(data.propertyName, left, y + 10, { width: width * 0.55, ellipsis: true })
      .text(data.receiptNumber, left + width * 0.55, y + 10, { width: width * 0.45, align: "right", ellipsis: true });
  }, { size: "A4", margin: MARGIN });
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
  nolsafReference?: string | null;
  maskedDestination?: string | null;
  paidAt: Date | string | null;
  timeZone?: string;
  disclaimer?: string;
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
        .text(fmtDateTime(data.paidAt, data.timeZone), innerX, y, { width: innerW, align: "center" });
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
      ["Settled", fmtDateTime(data.paidAt, data.timeZone)],
      ...(data.paymentRef ? ([["Provider ref", data.paymentRef]] as RcptRow[]) : []),
      ...(data.nolsafReference ? ([["NoLSAF ref", data.nolsafReference]] as RcptRow[]) : []),
      ...(data.maskedDestination ? ([["Destination", data.maskedDestination]] as RcptRow[]) : []),
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
        data.disclaimer || "This document confirms your payout has been disbursed to your registered payment method. Please retain it for your records.",
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
  transferredToMaster?: number | string;
  /** roomTotal + chargesTotal - amountPaid - transferredToMaster */
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
  const transferredToMaster = Number(data.transferredToMaster || 0);
  const totalSettled = totalCollected + transferredToMaster;
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
  const settled = data.balanceDue <= 0 && totalSettled > 0;
  const clearedByMaster = settled && transferredToMaster > 0;
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
    const totalsRequiredHeight = 155 + (transferredToMaster > 0 ? 14 : 0) + (folioBreakdownHeight ? folioBreakdownHeight + 3 : 0);
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
    if (transferredToMaster > 0) totalsLine("Transferred to master", fmtMoney(transferredToMaster, cur));
    totalsLine("Total settled", fmtMoney(totalSettled, cur), true, TEAL);
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(totalsX, y + 2).lineTo(M + W, y + 2).stroke();
    y += 5;
    const dueBoxH = 22;
    doc.roundedRect(totalsX, y, totalsW, dueBoxH, 3).fill(settled ? "#dcfce7" : "#fef3c7");
    doc.font(fonts.bold).fontSize(9).fillColor(settled ? "#166534" : AMBER);
    if (settled) {
      doc.text(clearedByMaster ? "CLEARED TO MASTER FOLIO" : "PAID IN FULL", totalsX + 8, y + 7, { width: totalsW - 16, align: "center", lineBreak: false });
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

// ─── NRMS breakfast list ──────────────────────────────────────

export interface NrmsProFormaPdfData {
  number: string;
  revision: number;
  issuedAt: Date | string;
  dueAt: Date | string;
  validUntil: Date | string;
  propertyName: string;
  propertyLocation?: string | null;
  propertyTin?: string | null;
  propertyEmail?: string | null;
  propertyPhone?: string | null;
  billToName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  groupName: string;
  groupReference: string;
  checkIn: Date | string;
  checkOut: Date | string;
  currency: string;
  items: Array<{ description: string; detail?: string | null; quantity: number; nights?: number | null; unitRate: number; amount: number }>;
  payments: Array<{ date: Date | string; method: string; reference?: string | null; receiptNumber: string; amount: number }>;
  quotedTotal: number;
  paidAtIssue: number;
  balanceDue: number;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankBranch?: string | null;
  bankSource: string;
  bankCurrency?: string | null;
  bankAddress?: string | null;
  bankSwiftCode?: string | null;
  bankIban?: string | null;
  bankRoutingCode?: string | null;
  bankInstructions?: string | null;
  paymentReference: string;
  notes?: string | null;
  verificationUrl: string;
  qrPng: Buffer;
}

/** A4 direct-to-property agency payment request with a secure verification QR. */
export async function generateNrmsProFormaPdf(data: NrmsProFormaPdfData): Promise<Buffer> {
  const pageHeight = 841.89;
  const cur = data.currency;
  return buildBuffer((doc) => {
    const fonts = registerNrmsFonts(doc);
    const left = MARGIN;
    const width = COL_W;
    let y = MARGIN;
    const dateOnly = (value: Date | string) => new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const addPage = () => {
      doc.addPage({ size: "A4", margin: MARGIN });
      y = MARGIN;
      doc.font(fonts.bold).fontSize(8).fillColor(TEAL).text(`${data.number} · Revision ${data.revision}`, left, y, { width, align: "right" });
      y += 22;
    };
    const ensure = (height: number) => { if (y + height > pageHeight - 72) addPage(); };
    const keyValue = (label: string, value: string, x: number, rowY: number, rowW: number) => {
      doc.font(fonts.bold).fontSize(6.5).fillColor(TEXT_MUTED).text(label.toUpperCase(), x, rowY, { width: rowW, characterSpacing: 0.7 });
      doc.font(fonts.regular).fontSize(8.5).fillColor(TEXT_MAIN).text(value || "—", x, rowY + 11, { width: rowW, ellipsis: true });
    };

    doc.font(fonts.bold).fontSize(17).fillColor(TEXT_MAIN).text(data.propertyName, left, y, { width: width * 0.55, ellipsis: true });
    if (data.propertyLocation) doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MUTED).text(data.propertyLocation, left, y + 24, { width: width * 0.55 });
    doc.font(fonts.bold).fontSize(21).fillColor(TEAL).text("PRO FORMA INVOICE", left, y, { width, align: "right" });
    doc.font("Courier-Bold").fontSize(8).fillColor(TEXT_MAIN).text(data.number, left, y + 29, { width, align: "right" });
    doc.font(fonts.regular).fontSize(7).fillColor(TEXT_MUTED).text(`Revision ${data.revision}`, left, y + 42, { width, align: "right" });
    y += 66;
    doc.strokeColor(TEAL).lineWidth(1.5).moveTo(left, y).lineTo(left + width, y).stroke();
    y += 16;

    const cardGap = 12;
    const cardW = (width - cardGap) / 2;
    doc.roundedRect(left, y, cardW, 100, 6).fillAndStroke("#f7fbfa", BORDER);
    doc.roundedRect(left + cardW + cardGap, y, cardW, 100, 6).fillAndStroke("#f7fbfa", BORDER);
    doc.font(fonts.bold).fontSize(7).fillColor(TEAL).text("BILL TO", left + 12, y + 11, { characterSpacing: 1 });
    doc.font(fonts.bold).fontSize(11).fillColor(TEXT_MAIN).text(data.billToName, left + 12, y + 27, { width: cardW - 24, ellipsis: true });
    doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MUTED)
      .text(data.contactName, left + 12, y + 47, { width: cardW - 24, ellipsis: true })
      .text(data.contactEmail, left + 12, y + 61, { width: cardW - 24, ellipsis: true });
    if (data.contactPhone) doc.text(data.contactPhone, left + 12, y + 75, { width: cardW - 24 });
    const rightX = left + cardW + cardGap + 12;
    keyValue("Issue date", dateOnly(data.issuedAt), rightX, y + 11, 105);
    keyValue("Due date", dateOnly(data.dueAt), rightX + 112, y + 11, 105);
    keyValue("Valid until", dateOnly(data.validUntil), rightX, y + 52, 105);
    keyValue("Group reference", data.groupReference, rightX + 112, y + 52, 105);
    y += 114;

    doc.font(fonts.bold).fontSize(7).fillColor(TEAL).text("GROUP DETAILS", left, y, { characterSpacing: 1 });
    doc.font(fonts.bold).fontSize(10).fillColor(TEXT_MAIN).text(data.groupName, left, y + 14, { width: width * 0.55, ellipsis: true });
    doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MUTED).text(`${dateOnly(data.checkIn)} to ${dateOnly(data.checkOut)}`, left, y + 30, { width: width * 0.55 });
    if (data.propertyTin) doc.text(`TIN: ${data.propertyTin}`, left, y + 44, { width: width * 0.55 });
    const propertyContact = [data.propertyEmail, data.propertyPhone].filter(Boolean).join(" · ");
    if (propertyContact) doc.text(propertyContact, left, y + 58, { width: width * 0.75 });
    y += 78;

    const cols = { description: 250, qty: 48, rate: 90, amount: width - 388 };
    const tableHeader = () => {
      doc.rect(left, y, width, 22).fill(TEAL);
      doc.font(fonts.bold).fontSize(7).fillColor("#ffffff")
        .text("DESCRIPTION", left + 8, y + 7, { width: cols.description - 8 })
        .text("QTY", left + cols.description, y + 7, { width: cols.qty, align: "center" })
        .text("RATE", left + cols.description + cols.qty, y + 7, { width: cols.rate, align: "right" })
        .text("AMOUNT", left + cols.description + cols.qty + cols.rate, y + 7, { width: cols.amount - 8, align: "right" });
      y += 22;
    };
    tableHeader();
    for (const item of data.items) {
      ensure(42);
      const detail = item.detail || (item.nights ? `${item.nights} night${item.nights === 1 ? "" : "s"}` : "");
      const rowH = detail ? 34 : 25;
      doc.font(fonts.bold).fontSize(8).fillColor(TEXT_MAIN).text(item.description, left + 8, y + 6, { width: cols.description - 16, ellipsis: true });
      if (detail) doc.font(fonts.regular).fontSize(6.8).fillColor(TEXT_MUTED).text(detail, left + 8, y + 19, { width: cols.description - 16, ellipsis: true });
      doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MAIN)
        .text(String(item.quantity), left + cols.description, y + 7, { width: cols.qty, align: "center" })
        .text(fmtMoney(item.unitRate, cur), left + cols.description + cols.qty, y + 7, { width: cols.rate, align: "right" })
        .text(fmtMoney(item.amount, cur), left + cols.description + cols.qty + cols.rate, y + 7, { width: cols.amount - 8, align: "right" });
      doc.strokeColor(BORDER).lineWidth(0.5).moveTo(left, y + rowH).lineTo(left + width, y + rowH).stroke();
      y += rowH;
    }

    ensure(112 + data.payments.length * 28);
    y += 13;
    if (data.payments.length) {
      doc.font(fonts.bold).fontSize(7).fillColor(TEAL).text("PAYMENTS ALREADY RECEIVED", left, y, { characterSpacing: 1 });
      y += 16;
      for (const payment of data.payments) {
        doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MAIN)
          .text(dateOnly(payment.date), left, y, { width: 72 })
          .text(payment.method.replace(/_/g, " "), left + 76, y, { width: 80 })
          .text(payment.reference || payment.receiptNumber, left + 160, y, { width: 190, ellipsis: true })
          .text(fmtMoney(payment.amount, cur), left + 355, y, { width: width - 355, align: "right" });
        y += 18;
      }
      y += 6;
    }

    const totalsX = left + width - 230;
    const totalLine = (label: string, value: number, bold = false, color = TEXT_MAIN) => {
      doc.font(bold ? fonts.bold : fonts.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(label, totalsX, y, { width: 120 });
      doc.font(bold ? fonts.bold : fonts.regular).fontSize(9).fillColor(color).text(fmtMoney(value, cur), totalsX + 120, y, { width: 110, align: "right" });
      y += 17;
    };
    totalLine("Pro Forma total", data.quotedTotal);
    totalLine("Payments received", data.paidAtIssue);
    doc.strokeColor(BORDER).lineWidth(0.8).moveTo(totalsX, y).lineTo(left + width, y).stroke();
    y += 8;
    totalLine("AMOUNT REQUESTED", data.balanceDue, true, data.balanceDue > 0 ? AMBER : TEAL);
    y += 12;

    const hasExtendedBankDetails = Boolean(data.bankSwiftCode || data.bankIban || data.bankRoutingCode || data.bankAddress);
    const bankCardH = hasExtendedBankDetails ? 146 : 112;
    ensure(bankCardH + 64);
    doc.roundedRect(left, y, width, bankCardH, 8).fillAndStroke(LIGHT_TEAL, BORDER);
    doc.font(fonts.bold).fontSize(8).fillColor(TEAL).text("PAY DIRECTLY TO THE PROPERTY", left + 14, y + 12, { characterSpacing: 0.8 });
    doc.font(fonts.bold).fontSize(6).fillColor(TEAL)
      .text("BANK TRANSFER DETAILS", left + 285, y + 13, { width: width - 390, align: "right", characterSpacing: 0.45 });
    doc.font(fonts.bold).fontSize(10).fillColor(TEXT_MAIN).text(data.bankName, left + 14, y + 31, { width: 200 });
    doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MAIN)
      .text(`Account name: ${data.bankAccountName}`, left + 14, y + 48, { width: 285 })
      .text(`Account number: ${data.bankAccountNumber}`, left + 14, y + 64, { width: 285 })
      .text(`Payment reference: ${data.paymentReference}`, left + 14, y + 80, { width: 285 });
    if (data.bankCurrency) doc.text(`Account currency: ${data.bankCurrency}`, left + 300, y + 32, { width: 120 });
    if (data.bankBranch) doc.text(`Branch: ${data.bankBranch}`, left + 300, y + 48, { width: 120, ellipsis: true });
    if (data.bankSwiftCode) doc.text(`SWIFT/BIC: ${data.bankSwiftCode}`, left + 300, y + 64, { width: 120, ellipsis: true });
    if (data.bankRoutingCode) doc.text(`Routing code: ${data.bankRoutingCode}`, left + 300, y + 80, { width: 120, ellipsis: true });
    if (data.bankIban) doc.text(`IBAN: ${data.bankIban}`, left + 14, y + 98, { width: 405, ellipsis: true });
    if (data.bankAddress) doc.text(`Bank address: ${data.bankAddress}`, left + 14, y + 114, { width: 405, ellipsis: true });
    doc.image(data.qrPng, left + width - 88, y + 9, { fit: [76, 76], align: "center", valign: "center" });
    doc.font(fonts.bold).fontSize(5.8).fillColor(TEXT_MUTED).text("SCAN TO VIEW", left + width - 93, y + 86, { width: 86, align: "center" });
    y += bankCardH + 14;
    if (data.bankInstructions) {
      doc.font(fonts.bold).fontSize(7).fillColor(TEXT_MUTED).text("TRANSFER INSTRUCTIONS", left, y);
      doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MAIN).text(data.bankInstructions, left, y + 12, { width });
      y += Math.min(42, doc.heightOfString(data.bankInstructions, { width })) + 18;
    }
    if (data.notes) {
      doc.font(fonts.bold).fontSize(7).fillColor(TEXT_MUTED).text("NOTES", left, y);
      doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MAIN).text(data.notes, left, y + 12, { width });
      y += Math.min(50, doc.heightOfString(data.notes, { width })) + 18;
    }
    ensure(32);
    y += 4;
    doc.strokeColor(BORDER).lineWidth(0.6).moveTo(left, y).lineTo(left + width, y).stroke();
    doc.font(fonts.bold).fontSize(6.5).fillColor(TEXT_MUTED)
      .text(data.propertyName, left, y + 10, { width: width * 0.55, ellipsis: true })
      .text(`${data.number} · REV ${data.revision}`, left + width * 0.55, y + 10, { width: width * 0.45, align: "right", ellipsis: true });
  }, { size: "A4", margin: MARGIN });
}

export type BreakfastListPdfRow = {
  sn: number;
  fullName: string;
  roomType: string;
  roomNo: string;
  adults: number;
  children: number;
  mealPlanLabel: string;
  entitled: boolean;
  remark: string;
};

export type BreakfastListPdfData = {
  propertyName: string;
  propertyLocation?: string | null;
  serviceDate: Date | string;
  nightOf: Date | string;
  documentNumber: string;
  generatedAt: Date;
  preparedBy?: string | null;
  rows: BreakfastListPdfRow[];
  totals: { rooms: number; parties: number; adults: number; children: number; covers: number; entitledRooms: number; entitledCovers: number; unverified: number };
};

/**
 * The sheet that goes to the restaurant before service. A4 portrait, one line
 * per occupied room, ruled REMARK column left empty for the floor to write in.
 *
 * The header repeats property, service date and the night it covers on every
 * page, because this page gets separated from its stack the moment service
 * starts. The totals block is what the kitchen preps against, so it is printed
 * once at the end where it cannot be mistaken for a page subtotal.
 */
export async function generateNrmsBreakfastListPdf(data: BreakfastListPdfData): Promise<Buffer> {
  const M = 36;
  const W = PAGE_W - M * 2;
  const PAGE_H = 841.89; // A4 pt height
  const FOOTER_ZONE = 104;

  // SN | FULL NAME | ROOM TYPE | ROOM NO | PAX | MEAL PLAN | REMARK
  const COL_SN = 26;
  const COL_NAME = 150;
  const COL_TYPE = 96;
  const COL_ROOM = 52;
  const COL_PAX = 38;
  const COL_PLAN = 78;
  const COL_REMARK = W - COL_SN - COL_NAME - COL_TYPE - COL_ROOM - COL_PAX - COL_PLAN;
  const ROW_H = 24;

  const dayLabel = (value: Date | string) =>
    new Date(value).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  return buildBuffer((doc) => {
    const fonts = registerNrmsFonts(doc);
    let y = M;

    const header = (includeSummary: boolean) => {
      const headerH = 62;
      doc.roundedRect(M, y, W, headerH, 9).fillAndStroke("#ffffff", BORDER);
      doc.roundedRect(M, y, 6, headerH, 3).fill(TEAL);
      doc.font(fonts.bold).fontSize(6.5).fillColor(TEAL)
        .text("FRONT OFFICE  >  RESTAURANT", M + 18, y + 11, { characterSpacing: 1.1, lineBreak: false });
      doc.font(fonts.bold).fontSize(17).fillColor(DARK)
        .text("Breakfast service list", M + 18, y + 23, { width: W - 245, lineBreak: false, ellipsis: true });
      doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MUTED)
        .text(`${data.propertyName}${data.propertyLocation ? `  ·  ${data.propertyLocation}` : ""}  ·  ${data.documentNumber}`, M + 18, y + 47, { width: W - 245, lineBreak: false, ellipsis: true });

      doc.font(fonts.regular).fontSize(6).fillColor(TEXT_MUTED)
        .text("SERVICE MORNING", M + W - 210, y + 11, { width: 194, align: "right", characterSpacing: 0.8, lineBreak: false });
      doc.font(fonts.bold).fontSize(10).fillColor(RCPT_HEAD)
        .text(dayLabel(data.serviceDate), M + W - 230, y + 23, { width: 214, align: "right", lineBreak: false });
      doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED)
        .text(`Night covered: ${dayLabel(data.nightOf)}`, M + W - 230, y + 42, { width: 214, align: "right", lineBreak: false });
      y += headerH + 10;

      if (includeSummary) {
        const summaryH = 50;
        const stats: Array<[string, string]> = [
          ["Rooms", String(data.totals.rooms)],
          ["Parties", String(data.totals.parties)],
          ["Adults", String(data.totals.adults)],
          ["Children", String(data.totals.children)],
          ["Total covers", String(data.totals.covers)],
          ["Entitled", String(data.totals.entitledCovers)],
        ];
        doc.roundedRect(M, y, W, summaryH, 8).fillAndStroke(LIGHT_TEAL, RCPT_BORDER);
        const statW = W / stats.length;
        stats.forEach(([label, value], index) => {
          const sx = M + statW * index;
          if (index > 0) {
            doc.strokeColor(RCPT_BORDER).lineWidth(0.5).moveTo(sx, y + 10).lineTo(sx, y + summaryH - 10).stroke();
          }
          doc.font(fonts.regular).fontSize(6).fillColor(TEXT_MUTED)
            .text(label.toUpperCase(), sx + 7, y + 9, { width: statW - 14, align: "center", characterSpacing: 0.5, lineBreak: false });
          doc.font(fonts.bold).fontSize(15).fillColor(index >= 4 ? TEAL : RCPT_HEAD)
            .text(value, sx + 7, y + 23, { width: statW - 14, align: "center", lineBreak: false });
        });
        y += summaryH + 10;
      }

      doc.rect(M, y, W, 20).fill("#edf7f6");
      doc.strokeColor(RCPT_BORDER).lineWidth(0.6).moveTo(M, y + 20).lineTo(M + W, y + 20).stroke();
      doc.font(fonts.bold).fontSize(6.3).fillColor(RCPT_HEAD);
      let x = M;
      const head = (label: string, width: number, align: "left" | "center" = "left") => {
        doc.text(label, x + 5, y + 7, { width: width - 8, align, characterSpacing: 0.35, lineBreak: false });
        x += width;
      };
      head("NO.", COL_SN);
      head("GUEST", COL_NAME);
      head("ROOM TYPE", COL_TYPE);
      head("ROOM", COL_ROOM, "center");
      head("PAX", COL_PAX, "center");
      head("MEAL PLAN", COL_PLAN);
      head("SERVICE NOTES", COL_REMARK);
      y += 20;
    };

    header(true);

    for (const row of data.rows) {
      if (y + ROW_H > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = M;
        header(false);
      }

      if (row.sn % 2 === 0) doc.rect(M, y, W, ROW_H).fill("#fafcfb");
      doc.strokeColor(BORDER).lineWidth(0.4).moveTo(M, y + ROW_H).lineTo(M + W, y + ROW_H).stroke();

      let x = M;
      const cell = (text: string, width: number, options: { align?: "left" | "center"; bold?: boolean; muted?: boolean } = {}) => {
        doc.font(options.bold ? fonts.bold : fonts.regular).fontSize(7.5)
          .fillColor(options.muted ? TEXT_MUTED : TEXT_MAIN)
          .text(text, x + 5, y + 8, { width: width - 8, align: options.align ?? "left", lineBreak: false, ellipsis: true });
        x += width;
      };

      cell(String(row.sn).padStart(2, "0"), COL_SN, { muted: true });
      cell(row.fullName, COL_NAME, { bold: true });
      cell(row.roomType, COL_TYPE);
      cell(row.roomNo || "not set", COL_ROOM, { align: "center", bold: true, muted: !row.roomNo });
      cell(`${row.adults}+${row.children}`, COL_PAX, { align: "center" });
      // Meal-plan state is treated as a compact badge so it scans quickly at
      // the restaurant pass without adding colour noise to every other cell.
      const planColor = row.entitled ? TEAL : row.mealPlanLabel === "Verify" ? AMBER : TEXT_MUTED;
      const planBg = row.entitled ? "#eaf8f3" : row.mealPlanLabel === "Verify" ? "#fff7e8" : "#f1f3f3";
      doc.font(fonts.bold).fontSize(6.7);
      const planW = Math.min(COL_PLAN - 10, Math.max(36, doc.widthOfString(row.mealPlanLabel) + 13));
      doc.roundedRect(x + 5, y + 5, planW, 14, 6).fill(planBg);
      doc.fillColor(planColor)
        .text(row.mealPlanLabel, x + 11, y + 9, { width: planW - 12, lineBreak: false, ellipsis: true });
      x += COL_PLAN;
      doc.font(fonts.regular).fontSize(7).fillColor(TEXT_MUTED)
        .text(row.remark || "—", x + 6, y + 8, { width: COL_REMARK - 10, lineBreak: false, ellipsis: true });

      // Keep the notes area visibly separate and writable without turning the
      // whole register into a heavy spreadsheet grid.
      const notesRule = M + COL_SN + COL_NAME + COL_TYPE + COL_ROOM + COL_PAX + COL_PLAN;
      doc.strokeColor(BORDER).lineWidth(0.45).moveTo(notesRule, y).lineTo(notesRule, y + ROW_H).stroke();
      y += ROW_H;
    }

    if (data.rows.length === 0) {
      doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MUTED)
        .text("No occupied rooms for this service date.", M, y + 18, { width: W, align: "center" });
      y += 44;
    }

    if (data.totals.unverified > 0) {
      y += 10;
      doc.font(fonts.bold).fontSize(7).fillColor(AMBER)
        .text(`${data.totals.unverified} room(s) have no meal plan on file and print as Verify. Confirm at reception before serving.`, M, y + 7, { width: W, lineBreak: false });
      y += 18;
    }

    // Signature pair: what makes this a controlled handover, not a printout.
    doc.page.margins.bottom = 0;
    const signY = PAGE_H - 74;
    doc.strokeColor(TEXT_MUTED).lineWidth(0.5).moveTo(M, signY + 12).lineTo(M + 170, signY + 12).stroke();
    doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED)
      .text("Prepared by (front office)", M, signY + 16, { lineBreak: false });
    doc.strokeColor(TEXT_MUTED).lineWidth(0.5).moveTo(M + W - 170, signY + 12).lineTo(M + W, signY + 12).stroke();
    doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED)
      .text("Received by (restaurant)", M + W - 170, signY + 16, { lineBreak: false });
    if (data.preparedBy) {
      doc.font(fonts.regular).fontSize(7).fillColor(TEXT_MAIN)
        .text(data.preparedBy, M, signY, { width: 170, lineBreak: false });
    }

    const footerY = PAGE_H - 34;
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(M, footerY - 6).lineTo(M + W, footerY - 6).stroke();
    doc.font(fonts.regular).fontSize(6.5).fillColor(TEXT_MUTED)
      .text(`${data.documentNumber} | generated ${fmtDateTime(data.generatedAt)} | Powered by NoLSAF`, M, footerY, { width: W, align: "center" });
    doc.page.margins.bottom = M;
  }, { size: "A4", margin: M });
}
