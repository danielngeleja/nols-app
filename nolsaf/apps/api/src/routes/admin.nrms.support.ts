// NRMS Admin Oversight, Phase 6: read-only support snapshot, dispute exports,
// and explicit retention scheduling for permanently closed accounts.
import PDFDocument from "pdfkit";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireFinanceGrant, requireNrmsFinanceApprover } from "../middleware/financeGrant.js";
import { notifyOwner } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import { NRMS_GUEST_RETENTION_DAYS, NRMS_OPERATIONAL_RETENTION_DAYS } from "../workers/nrmsRetention.js";

const router = Router();
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);
const db = prisma as any;
const reason = z.string().trim().min(5).max(300).transform(sanitizeText);

function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  // Spreadsheet formula injection guard: text (never real numbers) starting with = + - @ is prefixed.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function loadProperty(propertyId: number) {
  return db.property.findUnique({ where: { id: propertyId }, select: { id: true, title: true, ownerId: true, nrmsActivatedAt: true } });
}

async function exportData(propertyId: number, from: Date, to: Date) {
  const [orders, reservations, statements] = await Promise.all([
    db.nrmsOutletOrder.findMany({ where: { propertyId, createdAt: { gte: from, lte: to } }, include: { outlet: { select: { name: true } }, items: true }, orderBy: { createdAt: "asc" } }),
    db.reservation.findMany({ where: { propertyId, createdAt: { gte: from, lte: to } }, include: { guestProfile: { select: { id: true } }, payments: true, charges: true }, orderBy: { createdAt: "asc" } }),
    db.nrmsBillingStatement.findMany({ where: { account: { propertyId }, createdAt: { gte: from, lte: to } }, include: { items: { include: { usageEvent: true } }, tokens: { include: { payment: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  return { orders, reservations, statements };
}

// ---- Dispute evidence PDF -------------------------------------------------
// Same visual language as the NRMS master statement (nrmsMasterStatement.ts):
// property header left, document title + number right, teal rule, soft section
// bands, summary cards and ruled ledger tables. All dates are shown in EAT.
const PDF_TEAL = "#047857";
const PDF_DARK = "#111827";
const PDF_MUTED = "#6b7280";
const PDF_BORDER = "#d1d5db";
const PDF_SOFT = "#f0fdf4";
const PDF_A4_WIDTH = 595.28;
const PDF_A4_HEIGHT = 841.89;
const PDF_MARGIN = 46;
const PDF_CONTENT = PDF_A4_WIDTH - PDF_MARGIN * 2;
const PDF_ROW_LIMIT = 300;
const EAT = "Africa/Dar_es_Salaam";

const eatDate = (value: Date | string) => new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: EAT }).replace("Sept", "Sep");
const eatDateTime = (value: Date | string) => new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: EAT }).replace("Sept", "Sep");
const eatShort = (value: Date | string) => new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: EAT }).replace("Sept", "Sep");
const eatKey = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: EAT, year: "numeric", month: "2-digit", day: "2-digit" }).format(value).replace(/-/g, "");
const humanStatus = (value: unknown) => { const t = String(value || "").replace(/_/g, " ").toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Unknown"; };
const humanSource = (value: unknown) => (String(value || "").toUpperCase() === "NOLSAF" ? "NoLSAF" : humanStatus(value));
const tidyName = (value: unknown) => { const t = String(value || "").trim(); return t && t === t.toUpperCase() && /[A-Z]/.test(t) ? t.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()) : t; };
const amountText = (value: unknown) => number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Totals per currency, so a mixed ledger never adds TZS to USD.
function currencyTotal(rows: any[], pick: (row: any) => unknown): string {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.currency || "TZS", (map.get(row.currency || "TZS") || 0) + number(pick(row)));
  if (!map.size) return "TZS 0";
  return [...map.entries()].map(([cur, sum]) => `${cur} ${amountText(sum)}`).join(" + ");
}

type DisputePdfInput = {
  property: { id: number; title: string; street?: string | null; ward?: string | null; city?: string | null; district?: string | null; regionName?: string | null; country?: string | null };
  from: Date;
  to: Date;
  reason: string;
  exportId: number;
  generatedAt: Date;
  data: any;
};

const disputeDocNumber = (exportId: number, generatedAt: Date) => `NDE-${String(exportId).padStart(6, "0")}-${eatKey(generatedAt)}`;
const eatTime = (value: Date | string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: EAT });

// Currency-split totals as [currency, sum] pairs, for numeric CSV cells.
function currencySums(rows: any[], pick: (row: any) => unknown): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.currency || "TZS", (map.get(row.currency || "TZS") || 0) + number(pick(row)));
  return [...map.entries()].map(([cur, sum]) => [cur, Number(sum.toFixed(2))]);
}

// ---- Dispute evidence CSV -------------------------------------------------
// Mirrors the PDF: report details, summary, then one titled table per record
// type with a total row. Dates are EAT; amounts stay plain numbers so they sum
// in a spreadsheet.
export function buildDisputeEvidenceCsv(input: DisputePdfInput): string {
  const { property, from, to, reason, exportId, generatedAt, data } = input;
  const docNumber = disputeDocNumber(exportId, generatedAt);
  const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
  const place = [property.street, property.ward, property.city, property.district, property.regionName, property.country].filter(Boolean).join(", ");
  const rows: unknown[][] = [];
  const blank = () => rows.push([]);
  const title = (text: string) => rows.push([text.toUpperCase()]);
  const totalRows = (label: string, sums: Array<[string, number]>, width: number, amountIndex: number, extra?: (cur: string) => unknown[]) => {
    for (const [cur, sum] of sums.length ? sums : [["TZS", 0] as [string, number]]) {
      const row: unknown[] = Array(width).fill("");
      row[0] = sums.length > 1 ? `${label} (${cur})` : label;
      row[amountIndex - 1] = cur;
      row[amountIndex] = sum;
      if (extra) extra(cur).forEach((v, i) => { if (v !== undefined) row[amountIndex + 1 + i] = v; });
      rows.push(row);
    }
  };

  // Header + report details
  rows.push(["NRMS DISPUTE EVIDENCE REPORT"]);
  rows.push(["NoLSAF NRMS", "Confidential"]);
  blank();
  title("Report details");
  rows.push(["Document number", docNumber]);
  rows.push(["Property", `${property.title} (#${property.id})`]);
  if (place) rows.push(["Location", place]);
  rows.push(["Reporting period (EAT)", `${eatDate(from)} to ${eatDate(to)}`, `${periodDays} ${periodDays === 1 ? "day" : "days"}`]);
  rows.push(["Generated (EAT)", eatDateTime(generatedAt)]);
  rows.push(["Audit export", `#${exportId}`]);
  rows.push(["Purpose", reason]);
  rows.push(["Data handling", "Guest identifiers are redacted. The property owner has been notified of this export."]);
  blank();

  // Summary
  title("Summary");
  rows.push(["Section", "Records", "Currency", "Total"]);
  const summaryLine = (label: string, count: number, sums: Array<[string, number]>) => {
    if (!sums.length) rows.push([label, count, "TZS", 0]);
    sums.forEach(([cur, sum], i) => rows.push([i === 0 ? label : "", i === 0 ? count : "", cur, sum]));
  };
  summaryLine("Outlet orders", data.orders.length, currencySums(data.orders, (o) => o.total));
  summaryLine("Reservations", data.reservations.length, currencySums(data.reservations, (r) => r.totalAmount));
  summaryLine("Paid on stays", data.reservations.length, currencySums(data.reservations, (r) => r.amountPaid));
  summaryLine("PAYG statements", data.statements.length, currencySums(data.statements, (s) => s.amount));
  blank();

  // Outlet orders
  title(`Outlet orders (${data.orders.length})`);
  const orderHead = ["#", "Date (EAT)", "Time (EAT)", "Order number", "Outlet", "Status", "Items", "Currency", "Amount"];
  rows.push(orderHead);
  data.orders.forEach((o: any, i: number) => rows.push([
    i + 1,
    eatDate(o.createdAt),
    eatTime(o.createdAt),
    o.orderNumber || `#${o.id}`,
    tidyName(o.outlet?.name) || "Outlet",
    humanStatus(o.status),
    (o.items || []).map((item: any) => `${item.quantity} x ${item.nameSnapshot}`).join("; "),
    o.currency,
    number(o.total),
  ]));
  if (!data.orders.length) rows.push(["No outlet orders in this period."]);
  else totalRows("Total", currencySums(data.orders, (o) => o.total), orderHead.length, 8);
  blank();

  // Reservations
  title(`Reservations and folios (${data.reservations.length})`);
  rows.push(["Guest records redacted"]);
  const stayHead = ["Reference", "Created (EAT)", "Check-in", "Check-out", "Source", "Status", "Currency", "Total", "Charges", "Paid", "Balance"];
  rows.push(stayHead);
  data.reservations.forEach((r: any) => {
    // Stay total already includes folio charges, so balance is total minus paid.
    const total = number(r.totalAmount);
    rows.push([
      r.receiptNumber || `RES-${r.id}`,
      eatDate(r.createdAt),
      r.checkIn ? eatDate(r.checkIn) : "",
      r.checkOut ? eatDate(r.checkOut) : "",
      humanSource(r.source),
      humanStatus(r.status),
      r.currency,
      number(r.totalAmount),
      number(r.chargesTotal),
      number(r.amountPaid),
      Number((total - number(r.amountPaid)).toFixed(2)),
    ]);
  });
  if (!data.reservations.length) rows.push(["No reservations in this period."]);
  else totalRows("Total", currencySums(data.reservations, (r) => r.totalAmount), stayHead.length, 7, (cur) => {
    const inCur = data.reservations.filter((r: any) => (r.currency || "TZS") === cur);
    const charges = inCur.reduce((n: number, r: any) => n + number(r.chargesTotal), 0);
    const paid = inCur.reduce((n: number, r: any) => n + number(r.amountPaid), 0);
    const totals = inCur.reduce((n: number, r: any) => n + number(r.totalAmount), 0);
    return [Number(charges.toFixed(2)), Number(paid.toFixed(2)), Number((totals - paid).toFixed(2))];
  });
  blank();

  // PAYG statements
  title(`PAYG statements (${data.statements.length})`);
  const statementHead = ["Statement", "Issued date (EAT)", "Issued time (EAT)", "Status", "Usage events", "Currency", "Amount"];
  rows.push(statementHead);
  data.statements.forEach((s: any) => rows.push([`ST-${String(s.id).padStart(5, "0")}`, eatDate(s.createdAt), eatTime(s.createdAt), humanStatus(s.status), s.items?.length ?? 0, s.currency, number(s.amount)]));
  if (!data.statements.length) rows.push(["No PAYG statements in this period."]);
  else {
    const usage = data.statements.reduce((n: number, s: any) => n + (s.items?.length ?? 0), 0);
    const before = rows.length;
    totalRows("Total", currencySums(data.statements, (s) => s.amount), statementHead.length, 6);
    rows[before][4] = usage;
  }
  blank();

  rows.push(["Record integrity", "Figures are read directly from the NRMS operational ledger at the time of generation. This export was logged in the NoLSAF admin audit trail with the purpose stated above."]);
  rows.push([`NoLSAF NRMS · Confidential dispute evidence · ${docNumber}`]);

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function renderDisputeEvidencePdf(input: DisputePdfInput): Promise<Buffer> {
  const { property, from, to, reason, exportId, generatedAt, data } = input;
  const docNumber = `NDE-${String(exportId).padStart(6, "0")}-${eatKey(generatedAt)}`;
  const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
  const place = [property.street, property.ward, property.city, property.district, property.regionName, property.country].filter(Boolean).join(", ");

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PDF_MARGIN, compress: true, bufferPages: true, info: { Title: `NRMS dispute evidence ${docNumber}`, Author: "NoLSAF NRMS" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      let y = PDF_MARGIN;
      const bottom = PDF_A4_HEIGHT - 70;

      type Col = { label: string; width: number; align?: "left" | "right"; mono?: boolean };
      let activeCols: Col[] | null = null;

      const drawTableHead = (cols: Col[]) => {
        doc.rect(PDF_MARGIN, y, PDF_CONTENT, 18).fill("#f9fafb");
        let x = PDF_MARGIN;
        for (const col of cols) {
          doc.font("Helvetica-Bold").fontSize(6.5).fillColor(PDF_MUTED).text(col.label.toUpperCase(), x + 6, y + 6, { width: col.width - 12, align: col.align || "left", characterSpacing: 0.4, lineBreak: false });
          x += col.width;
        }
        doc.strokeColor(PDF_BORDER).lineWidth(0.5).moveTo(PDF_MARGIN, y + 18).lineTo(PDF_MARGIN + PDF_CONTENT, y + 18).stroke();
        y += 18;
      };

      const newPage = () => {
        doc.addPage({ size: "A4", margin: PDF_MARGIN });
        y = PDF_MARGIN;
        doc.font("Helvetica-Bold").fontSize(8).fillColor(PDF_DARK).text(property.title, PDF_MARGIN, y, { width: PDF_CONTENT / 2, lineBreak: false });
        doc.font("Courier-Bold").fontSize(8).fillColor(PDF_TEAL).text(docNumber, PDF_MARGIN, y, { width: PDF_CONTENT, align: "right", lineBreak: false });
        y += 14;
        doc.strokeColor(PDF_BORDER).lineWidth(0.5).moveTo(PDF_MARGIN, y).lineTo(PDF_MARGIN + PDF_CONTENT, y).stroke();
        y += 12;
        if (activeCols) drawTableHead(activeCols);
      };
      const ensure = (height: number) => { if (y + height > bottom) newPage(); };

      const section = (label: string, right?: string) => {
        activeCols = null;
        ensure(60);
        doc.roundedRect(PDF_MARGIN, y, PDF_CONTENT, 21, 3).fill(PDF_SOFT);
        doc.font("Helvetica-Bold").fontSize(7).fillColor(PDF_TEAL).text(label.toUpperCase(), PDF_MARGIN + 8, y + 7, { characterSpacing: 0.8, lineBreak: false });
        if (right) doc.font("Helvetica").fontSize(7).fillColor(PDF_MUTED).text(right, PDF_MARGIN, y + 7, { width: PDF_CONTENT - 8, align: "right", lineBreak: false });
        y += 28;
      };

      const detail = (label: string, value: string, accent = false) => {
        const h = Math.max(15, doc.font("Helvetica").fontSize(8.5).heightOfString(value, { width: PDF_CONTENT - 150 }) + 5);
        ensure(h);
        doc.font("Helvetica").fontSize(8).fillColor(PDF_MUTED).text(label, PDF_MARGIN, y, { width: 145 });
        doc.font(accent ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(accent ? PDF_TEAL : PDF_DARK).text(value, PDF_MARGIN + 150, y, { width: PDF_CONTENT - 150 });
        y += h;
      };

      const table = (cols: Col[], rows: string[][], opts: { total?: string[]; empty: string; truncatedFrom?: number }) => {
        ensure(18 + 22);
        activeCols = cols;
        drawTableHead(cols);
        if (!rows.length) {
          doc.font("Helvetica").fontSize(8).fillColor(PDF_MUTED).text(opts.empty, PDF_MARGIN + 6, y + 8, { width: PDF_CONTENT - 12 });
          y += 26;
        }
        rows.forEach((cells, index) => {
          // Keep the last row on the same page as its total.
          ensure(index === rows.length - 1 && opts.total ? 20 + 26 : 20);
          if (index % 2 === 1) doc.rect(PDF_MARGIN, y, PDF_CONTENT, 20).fill("#fcfcfd");
          let x = PDF_MARGIN;
          cols.forEach((col, i) => {
            doc.font(col.mono ? "Courier" : "Helvetica").fontSize(col.mono ? 7.5 : 7.8).fillColor(i === cols.length - 1 ? PDF_DARK : "#374151")
              .text(cells[i] ?? "", x + 6, y + 6.5, { width: col.width - 12, align: col.align || "left", ellipsis: true, lineBreak: false });
            x += col.width;
          });
          doc.strokeColor("#eef0f3").lineWidth(0.4).moveTo(PDF_MARGIN, y + 20).lineTo(PDF_MARGIN + PDF_CONTENT, y + 20).stroke();
          y += 20;
        });
        if (opts.total) {
          activeCols = null;
          ensure(24);
          doc.strokeColor(PDF_DARK).lineWidth(0.8).moveTo(PDF_MARGIN, y).lineTo(PDF_MARGIN + PDF_CONTENT, y).stroke();
          let x = PDF_MARGIN;
          cols.forEach((col, i) => {
            doc.font("Helvetica-Bold").fontSize(8).fillColor(PDF_DARK).text(opts.total![i] ?? "", x + 6, y + 7, { width: col.width - 12, align: col.align || "left", ellipsis: true, lineBreak: false });
            x += col.width;
          });
          y += 24;
        }
        if (opts.truncatedFrom && opts.truncatedFrom > rows.length) {
          ensure(16);
          doc.font("Helvetica-Oblique").fontSize(7).fillColor("#b45309").text(`Showing the first ${rows.length} of ${opts.truncatedFrom} records. Use the CSV export for the complete list.`, PDF_MARGIN, y + 2, { width: PDF_CONTENT });
          y += 16;
        }
        activeCols = null;
        y += 10;
      };

      // Header
      doc.font("Helvetica-Bold").fontSize(17).fillColor(PDF_DARK).text(property.title, PDF_MARGIN, y, { width: PDF_CONTENT * 0.52 });
      doc.font("Helvetica").fontSize(8).fillColor(PDF_MUTED).text(place || `Property #${property.id}`, PDF_MARGIN, y + 24, { width: PDF_CONTENT * 0.52 });
      doc.font("Helvetica-Bold").fontSize(16).fillColor(PDF_TEAL).text("DISPUTE EVIDENCE REPORT", PDF_MARGIN, y, { width: PDF_CONTENT, align: "right" });
      doc.font("Courier-Bold").fontSize(8).fillColor(PDF_DARK).text(docNumber, PDF_MARGIN, y + 24, { width: PDF_CONTENT, align: "right" });
      doc.font("Helvetica").fontSize(7).fillColor(PDF_MUTED).text("NoLSAF NRMS · Confidential", PDF_MARGIN, y + 36, { width: PDF_CONTENT, align: "right" });
      y += 60;
      doc.strokeColor(PDF_TEAL).lineWidth(1.4).moveTo(PDF_MARGIN, y).lineTo(PDF_MARGIN + PDF_CONTENT, y).stroke();
      y += 17;

      // Report details
      section("Report details");
      detail("Reporting period", `${eatDate(from)} to ${eatDate(to)} · ${periodDays} ${periodDays === 1 ? "day" : "days"} (EAT, UTC+3)`, true);
      detail("Property", `${property.title} · #${property.id}`);
      detail("Generated", `${eatDateTime(generatedAt)} EAT`);
      detail("Export reference", `${docNumber} · audit export #${exportId}`);
      detail("Purpose", reason);
      detail("Data handling", "Guest identifiers are redacted. The property owner has been notified of this export.");
      y += 6;

      // Summary cards
      section("Summary");
      const orderValue = currencyTotal(data.orders, (o) => o.total);
      const stayValue = currencyTotal(data.reservations, (r) => r.totalAmount);
      const stayPaid = currencyTotal(data.reservations, (r) => r.amountPaid);
      const paygValue = currencyTotal(data.statements, (s) => s.amount);
      const cards = [
        ["Outlet orders", `${data.orders.length}`, orderValue],
        ["Reservations", `${data.reservations.length}`, stayValue],
        ["Paid on stays", "", stayPaid],
        ["PAYG statements", `${data.statements.length}`, paygValue],
      ];
      const gap = 8;
      const cardW = (PDF_CONTENT - gap * 3) / 4;
      ensure(62);
      cards.forEach(([label, count, value], i) => {
        const x = PDF_MARGIN + i * (cardW + gap);
        doc.roundedRect(x, y, cardW, 54, 4).fillAndStroke("#ffffff", PDF_BORDER);
        doc.font("Helvetica-Bold").fontSize(6.5).fillColor(PDF_MUTED).text(label.toUpperCase(), x + 8, y + 9, { width: cardW - 16, lineBreak: false });
        if (count) doc.font("Helvetica-Bold").fontSize(13).fillColor(PDF_DARK).text(count, x + 8, y + 20, { width: cardW - 16, lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(count ? 7.5 : 9).fillColor(count ? PDF_MUTED : PDF_TEAL).text(value, x + 8, count ? y + 38 : y + 27, { width: cardW - 16, ellipsis: true, lineBreak: false });
      });
      y += 68;

      // Orders
      const orderStatusMix = Object.entries(data.orders.reduce((acc: Record<string, number>, o: any) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {}))
        .map(([s, n]) => `${humanStatus(s)} ${n}`).join(" · ");
      section(`Outlet orders (${data.orders.length})`, orderStatusMix || undefined);
      const orderRows = data.orders.slice(0, PDF_ROW_LIMIT);
      table(
        [
          { label: "#", width: 30 },
          { label: "Date (EAT)", width: 78 },
          { label: "Order number", width: 118, mono: true },
          { label: "Outlet", width: 105 },
          { label: "Status", width: 82 },
          { label: "Amount", width: PDF_CONTENT - 413, align: "right" },
        ],
        orderRows.map((o: any, i: number) => [String(i + 1), eatShort(o.createdAt), o.orderNumber || `#${o.id}`, tidyName(o.outlet?.name) || "Outlet", humanStatus(o.status), `${o.currency} ${amountText(o.total)}`]),
        { empty: "No outlet orders in this period.", total: data.orders.length ? ["", "", "", "", "Total", orderValue] : undefined, truncatedFrom: data.orders.length },
      );

      // Reservations
      section(`Reservations and folios (${data.reservations.length})`, data.reservations.length ? "Guest records redacted" : undefined);
      const stayRows = data.reservations.slice(0, PDF_ROW_LIMIT);
      table(
        [
          { label: "Reference", width: 86, mono: true },
          { label: "Stay (EAT)", width: 94 },
          { label: "Source", width: 54 },
          { label: "Status", width: 66 },
          { label: "Total", width: 82, align: "right" },
          { label: "Charges", width: 60, align: "right" },
          { label: "Paid", width: PDF_CONTENT - 442, align: "right" },
        ],
        stayRows.map((r: any) => [
          r.receiptNumber || `RES-${r.id}`,
          r.checkIn && r.checkOut ? `${eatDate(r.checkIn).slice(0, 6)} to ${eatDate(r.checkOut).slice(0, 6)}` : eatDate(r.createdAt),
          humanSource(r.source),
          humanStatus(r.status),
          `${r.currency} ${amountText(r.totalAmount)}`,
          amountText(r.chargesTotal),
          amountText(r.amountPaid),
        ]),
        { empty: "No reservations in this period.", total: data.reservations.length ? ["Total", "", "", "", stayValue, currencyTotal(data.reservations, (r) => r.chargesTotal).replace(/^[A-Z]{3} /, ""), stayPaid.replace(/^[A-Z]{3} /, "")] : undefined, truncatedFrom: data.reservations.length },
      );

      // PAYG statements
      section(`PAYG statements (${data.statements.length})`);
      const statementRows = data.statements.slice(0, PDF_ROW_LIMIT);
      table(
        [
          { label: "Statement", width: 90, mono: true },
          { label: "Issued (EAT)", width: 110 },
          { label: "Status", width: 100 },
          { label: "Usage events", width: 90, align: "right" },
          { label: "Amount", width: PDF_CONTENT - 390, align: "right" },
        ],
        statementRows.map((s: any) => [`ST-${String(s.id).padStart(5, "0")}`, eatDateTime(s.createdAt), humanStatus(s.status), String(s.items?.length ?? 0), `${s.currency} ${amountText(s.amount)}`]),
        { empty: "No PAYG statements in this period.", total: data.statements.length ? ["Total", "", "", String(data.statements.reduce((n: number, s: any) => n + (s.items?.length ?? 0), 0)), paygValue] : undefined, truncatedFrom: data.statements.length },
      );

      // Attestation
      ensure(52);
      doc.roundedRect(PDF_MARGIN, y, PDF_CONTENT, 44, 4).fillAndStroke("#f9fafb", PDF_BORDER);
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(PDF_DARK).text("Record integrity", PDF_MARGIN + 10, y + 9);
      doc.font("Helvetica").fontSize(7.5).fillColor(PDF_MUTED).text(
        "Figures are read directly from the NRMS operational ledger at the time of generation. This export was logged in the NoLSAF admin audit trail with the purpose stated above.",
        PDF_MARGIN + 10, y + 21, { width: PDF_CONTENT - 20 },
      );
      y += 52;

      // Footer on every page
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const footerY = PDF_A4_HEIGHT - 40;
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.strokeColor(PDF_BORDER).lineWidth(0.5).moveTo(PDF_MARGIN, footerY - 6).lineTo(PDF_MARGIN + PDF_CONTENT, footerY - 6).stroke();
        doc.font("Helvetica").fontSize(7).fillColor(PDF_MUTED).text(`NoLSAF NRMS · Confidential dispute evidence · ${docNumber}`, PDF_MARGIN, footerY, { width: PDF_CONTENT * 0.75, lineBreak: false });
        doc.text(`Page ${i - range.start + 1} of ${range.count}`, PDF_MARGIN, footerY, { width: PDF_CONTENT, align: "right", lineBreak: false });
        doc.page.margins.bottom = savedBottom;
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

router.get("/property/:propertyId/snapshot", requireFinanceGrant as RequestHandler, (async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  const property = await db.property.findUnique({ where: { id: propertyId }, include: { owner: { select: { id: true, fullName: true, name: true, email: true, phone: true } }, nrmsPaygAccount: { include: { policy: true } } } });
  if (!property?.nrmsPaygAccount) return res.status(404).json({ error: "NRMS property not found" });
  const [rooms, openReservations, openOrders, openHousekeeping, activeStaff, openShift, lastAudit] = await Promise.all([
    db.roomUnit.groupBy({ by: ["housekeepingStatus"], where: { propertyId, status: "ACTIVE" }, _count: { _all: true } }),
    db.reservation.count({ where: { propertyId, status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] } } }),
    db.nrmsOutletOrder.count({ where: { propertyId, status: { in: ["PLACED", "CONFIRMED", "PREPARING", "SERVING"] } } }),
    db.nrmsHousekeepingTask.count({ where: { propertyId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.nrmsStaffMembership.count({ where: { propertyId, status: "ACTIVE" } }),
    db.nrmsCashierShift.findFirst({ where: { propertyId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true, openedAt: true, userId: true } }),
    db.nrmsNightAuditRun.findFirst({ where: { propertyId }, orderBy: { startedAt: "desc" }, select: { id: true, status: true, reportNumber: true, completedAt: true } }),
  ]);
  res.json({ readOnly: true, property: { id: property.id, title: property.title, owner: { id: property.owner.id, name: property.owner.fullName || property.owner.name || property.owner.email, email: property.owner.email, phone: property.owner.phone } }, account: { status: property.nrmsPaygAccount.status, trialEndsAt: property.nrmsPaygAccount.trialEndsAt, unpaidBalance: number(property.nrmsPaygAccount.unpaidBalance), unpaidLimit: number(property.nrmsPaygAccount.unpaidLimit), policyVersion: property.nrmsPaygAccount.policy.version }, operations: { rooms: rooms.map((row: any) => ({ status: row.housekeepingStatus, count: row._count._all })), openReservations, openOrders, openHousekeeping, activeStaff, openShift, lastAudit } });
}) as RequestHandler);

router.post("/property/:propertyId/dispute-export", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const parsed = z.object({ format: z.enum(["CSV", "PDF", "XLSX"]), from: z.coerce.date(), to: z.coerce.date(), reason }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid export request" });
  if (parsed.data.to < parsed.data.from || parsed.data.to.getTime() - parsed.data.from.getTime() > 366 * 86400000) return res.status(400).json({ error: "Choose a period of up to 366 days" });
  const property = await loadProperty(Number(req.params.propertyId));
  if (!property) return res.status(404).json({ error: "Property not found" });
  const exportRecord = await db.nrmsAdminExport.create({ data: {
    adminId: req.user!.id,
    propertyId: property.id,
    kind: "DISPUTE",
    purpose: parsed.data.reason,
    fromAt: parsed.data.from,
    toAt: parsed.data.to,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    downloadedAt: new Date(),
    ipAddress: req.ip,
    userAgent: req.get("user-agent")?.slice(0, 255),
    sessionRef: String(req.headers.authorization || req.headers.cookie || "").slice(0, 128) || null,
  } });
  const data = await exportData(property.id, parsed.data.from, parsed.data.to);
  await db.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: property.ownerId, action: "NRMS_DISPUTE_EXPORT", details: { exportId: exportRecord.id, propertyId: property.id, format: parsed.data.format, piiRedacted: true, from: parsed.data.from, to: parsed.data.to, counts: { orders: data.orders.length, reservations: data.reservations.length, statements: data.statements.length }, reason: parsed.data.reason, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) } } });
  await notifyOwner(property.ownerId, "nrms_dispute_exported", { propertyTitle: property.title, from: parsed.data.from.toISOString(), to: parsed.data.to.toISOString(), reason: parsed.data.reason });
  const baseName = `nrms-dispute-${property.id}-${parsed.data.from.toISOString().slice(0, 10)}-${parsed.data.to.toISOString().slice(0, 10)}`;
  const location = await db.property.findUnique({ where: { id: property.id }, select: { street: true, ward: true, city: true, district: true, regionName: true, country: true } }).catch(() => null);
  const reportInput: DisputePdfInput = { property: { ...property, ...(location || {}) }, from: parsed.data.from, to: parsed.data.to, reason: parsed.data.reason, exportId: exportRecord.id, generatedAt: new Date(), data };
  if (parsed.data.format === "XLSX") {
    // The workbook is assembled in the browser with the same ExcelJS styling as the NRMS property
    // report (apps/web/lib/nrmsDisputeWorkbook.ts), so the API only returns redacted, pre-shaped rows.
    const admin = await db.user.findUnique({ where: { id: req.user!.id }, select: { fullName: true, name: true, email: true } }).catch(() => null);
    const generatedAt = reportInput.generatedAt;
    return res.json({
      report: {
        documentNumber: disputeDocNumber(exportRecord.id, generatedAt),
        exportId: exportRecord.id,
        generatedAt: generatedAt.toISOString(),
        generatedBy: admin?.fullName || admin?.name || admin?.email || `Admin #${req.user!.id}`,
        property: { id: property.id, title: property.title, location: [location?.street, location?.ward, location?.city, location?.district, location?.regionName, location?.country].filter(Boolean).join(", ") || null },
        from: parsed.data.from.toISOString(),
        to: parsed.data.to.toISOString(),
        periodDays: Math.max(1, Math.round((parsed.data.to.getTime() - parsed.data.from.getTime()) / 86400000)),
        reason: parsed.data.reason,
        orders: data.orders.map((o: any) => ({
          orderNumber: o.orderNumber || `#${o.id}`,
          outlet: tidyName(o.outlet?.name) || "Outlet",
          status: o.status,
          itemCount: (o.items || []).reduce((n: number, item: any) => n + number(item.quantity), 0),
          items: (o.items || []).map((item: any) => `${item.quantity} x ${item.nameSnapshot}`).join("; "),
          currency: o.currency,
          total: number(o.total),
          createdAt: new Date(o.createdAt).toISOString(),
        })),
        reservations: data.reservations.map((r: any) => ({
          reference: r.receiptNumber || `RES-${r.id}`,
          source: r.source,
          status: r.status,
          currency: r.currency,
          total: number(r.totalAmount),
          charges: number(r.chargesTotal),
          paid: number(r.amountPaid),
          checkIn: r.checkIn ? new Date(r.checkIn).toISOString() : null,
          checkOut: r.checkOut ? new Date(r.checkOut).toISOString() : null,
          createdAt: new Date(r.createdAt).toISOString(),
        })),
        statements: data.statements.map((s: any) => ({
          reference: `ST-${String(s.id).padStart(5, "0")}`,
          status: s.status,
          usageEvents: s.items?.length ?? 0,
          currency: s.currency,
          amount: number(s.amount),
          createdAt: new Date(s.createdAt).toISOString(),
        })),
      },
    });
  }
  if (parsed.data.format === "PDF") {
    const pdf = await renderDisputeEvidencePdf(reportInput);
    res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `attachment; filename="${baseName}.pdf"`); return res.end(pdf);
  }
  const csv = buildDisputeEvidenceCsv(reportInput);
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${baseName}.csv"`); res.send(`\uFEFF${csv}`);
}) as RequestHandler);

router.post("/property/:propertyId/retention", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const parsed = z.object({ closedAt: z.coerce.date(), reason }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  if (parsed.data.closedAt > new Date()) return res.status(400).json({ error: "Closure time cannot be in the future" });
  const property = await loadProperty(Number(req.params.propertyId));
  if (!property) return res.status(404).json({ error: "Property not found" });
  const account = await db.ownerPaygAccount.findUnique({ where: { propertyId: property.id } });
  if (!account || account.status !== "CLOSED") return res.status(409).json({ error: "Retention can only be scheduled for a closed account" });
  await db.ownerPaygAccount.update({ where: { id: account.id }, data: { retentionClosedAt: parsed.data.closedAt, guestDataAnonymizedAt: null, operationalDataMinimizedAt: null } });
  await db.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: property.ownerId, action: "NRMS_RETENTION_SCHEDULE", details: { propertyId: property.id, closedAt: parsed.data.closedAt, guestRetentionDays: NRMS_GUEST_RETENTION_DAYS, operationalRetentionDays: NRMS_OPERATIONAL_RETENTION_DAYS, reason: parsed.data.reason } } });
  await notifyOwner(property.ownerId, "nrms_retention_scheduled", { propertyTitle: property.title, closedAt: parsed.data.closedAt.toISOString(), guestRetentionDays: NRMS_GUEST_RETENTION_DAYS, operationalRetentionDays: NRMS_OPERATIONAL_RETENTION_DAYS, reason: parsed.data.reason });
  res.json({ retention: { closedAt: parsed.data.closedAt, guestRetentionDays: NRMS_GUEST_RETENTION_DAYS, operationalRetentionDays: NRMS_OPERATIONAL_RETENTION_DAYS } });
}) as RequestHandler);

router.get("/retention-policy", ((_req, res) => res.json({ guestDataDays: NRMS_GUEST_RETENTION_DAYS, operationalDataDays: NRMS_OPERATIONAL_RETENTION_DAYS, policy: "Guest identifiers are anonymized after 24 months. Operational notes and free text are minimized after 7 years. Financial totals, ledger entries, audits and immutable PAYG usage remain." })) as RequestHandler);

export default router;
