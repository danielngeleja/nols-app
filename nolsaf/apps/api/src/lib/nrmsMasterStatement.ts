import PDFDocument from "pdfkit";
import { sendMail } from "./mailer.js";

const TEAL = "#047857";
const DARK = "#111827";
const MUTED = "#6b7280";
const BORDER = "#d1d5db";
const SOFT = "#f0fdf4";
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 46;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function fmtMoney(value: unknown, currency: string): string {
  return `${currency} ${money(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function fmtDate(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function location(property: any): string {
  return [property.street, property.ward, property.city, property.district, property.regionName, property.country].filter(Boolean).join(", ");
}

function bufferPdf(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, compress: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export function masterStatementMeta(block: any, generatedAt = new Date()) {
  if (!block.masterFolio) throw new Error("NRMS_MASTER_FOLIO_REQUIRED");
  const settled = block.masterFolio.status === "SETTLED";
  const anchor = settled && block.masterFolio.settledAt ? new Date(block.masterFolio.settledAt) : generatedAt;
  const dateKey = anchor.toISOString().slice(0, 10).replace(/-/g, "");
  return {
    settled,
    title: settled ? "FINAL PAYMENT RECEIPT" : "AGENCY ACCOUNT STATEMENT",
    number: `${settled ? "MFR" : "MFS"}-${String(block.masterFolio.id).padStart(6, "0")}-${dateKey}`,
    generatedAt,
  };
}

export async function renderMasterStatementPdf(block: any, generatedAt = new Date()): Promise<{ pdf: Buffer; number: string; title: string }> {
  const folio = block.masterFolio;
  if (!folio) throw new Error("NRMS_MASTER_FOLIO_REQUIRED");
  const meta = masterStatementMeta(block, generatedAt);
  const items = (folio.items ?? []).filter((item: any) => !item.voidedAt);
  const payments = (folio.payments ?? []).filter((payment: any) => !payment.voidedAt);
  const refunds = (folio.refunds ?? []).filter((refund: any) => !refund.voidedAt);
  const billed = money(items.reduce((sum: number, item: any) => sum + money(item.amount), 0));
  const received = money(payments.reduce((sum: number, payment: any) => sum + money(payment.amount), 0));
  const refunded = money(refunds.reduce((sum: number, refund: any) => sum + money(refund.amount), 0));
  const netPaid = money(received - refunded);
  const balance = money(billed - netPaid);
  const currency = folio.currency;
  const property = block.property;
  const owner = block.owner;

  const pdf = await bufferPdf((doc) => {
    let y = MARGIN;
    const ensure = (height: number) => {
      if (y + height <= A4_HEIGHT - 62) return;
      doc.addPage({ size: "A4", margin: MARGIN });
      y = MARGIN;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(TEAL).text(meta.number, MARGIN, y, { width: CONTENT_WIDTH, align: "right" });
      y += 24;
    };
    const row = (label: string, value: string, accent = false) => {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(label, MARGIN, y, { width: 145 });
      doc.font(accent ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(accent ? TEAL : DARK).text(value, MARGIN + 150, y, { width: CONTENT_WIDTH - 150 });
      y += 15;
    };
    const section = (label: string) => {
      ensure(34);
      doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 21, 3).fill(SOFT);
      doc.font("Helvetica-Bold").fontSize(7).fillColor(TEAL).text(label.toUpperCase(), MARGIN + 8, y + 7, { characterSpacing: 0.8 });
      y += 30;
    };
    const ledgerRow = (date: string, description: string, reference: string, amount: number) => {
      ensure(27);
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(date, MARGIN + 6, y + 7, { width: 70 });
      doc.fillColor(DARK).text(description, MARGIN + 80, y + 7, { width: 230, ellipsis: true });
      doc.fillColor(MUTED).text(reference, MARGIN + 314, y + 7, { width: 92, ellipsis: true });
      doc.font("Helvetica-Bold").fillColor(amount < 0 ? "#b91c1c" : DARK).text(fmtMoney(amount, currency), MARGIN + 406, y + 7, { width: CONTENT_WIDTH - 412, align: "right" });
      doc.strokeColor(BORDER).lineWidth(0.4).moveTo(MARGIN, y + 24).lineTo(MARGIN + CONTENT_WIDTH, y + 24).stroke();
      y += 25;
    };

    doc.font("Helvetica-Bold").fontSize(17).fillColor(DARK).text(property.title, MARGIN, y, { width: CONTENT_WIDTH * 0.55 });
    const propertyLocation = location(property);
    if (propertyLocation) doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(propertyLocation, MARGIN, y + 24, { width: CONTENT_WIDTH * 0.55 });
    doc.font("Helvetica-Bold").fontSize(18).fillColor(TEAL).text(meta.title, MARGIN, y, { width: CONTENT_WIDTH, align: "right" });
    doc.font("Courier-Bold").fontSize(8).fillColor(DARK).text(meta.number, MARGIN, y + 29, { width: CONTENT_WIDTH, align: "right" });
    y += 62;
    doc.strokeColor(TEAL).lineWidth(1.4).moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();
    y += 17;

    section("Account details");
    row("Billed to", folio.billToName, true);
    row("Group", `${block.name} · ${block.reference}`);
    row("Stay", `${fmtDate(block.checkIn)} to ${fmtDate(block.checkOut)}`);
    row("Master folio", `${folio.reference} · ${folio.billingMode}`);
    row(meta.settled ? "Settled on" : "Statement generated", fmtDate(meta.settled && folio.settledAt ? folio.settledAt : generatedAt));
    y += 5;

    section("Account summary");
    const summaryY = y;
    const cardGap = 8;
    const cardWidth = (CONTENT_WIDTH - cardGap * 3) / 4;
    const summaries = [["Billed", billed], ["Received", received], ["Refunded", refunded], [balance > 0.005 ? "Balance due" : balance < -0.005 ? "Credit" : "Balance", Math.abs(balance)]] as const;
    summaries.forEach(([label, value], index) => {
      const x = MARGIN + index * (cardWidth + cardGap);
      doc.roundedRect(x, summaryY, cardWidth, 52, 4).fillAndStroke("#ffffff", BORDER);
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(MUTED).text(label.toUpperCase(), x + 8, summaryY + 9, { width: cardWidth - 16 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(label === "Balance due" ? "#b45309" : label === "Credit" ? "#1d4ed8" : DARK).text(fmtMoney(value, currency), x + 8, summaryY + 27, { width: cardWidth - 16, ellipsis: true });
    });
    y += 65;

    section("Charges");
    for (const item of items) ledgerRow(fmtDate(item.createdAt), item.description || (item.kind === "ROOM" ? "Accommodation" : "Extra charge"), item.kind, money(item.amount));
    if (!items.length) ledgerRow("—", "No active charges", "", 0);

    section("Payments and refunds");
    const cashRows = [
      ...payments.map((payment: any) => ({ date: payment.createdAt, description: `${payment.method.replace(/_/g, " ")} payment`, reference: payment.receiptNumber, amount: money(payment.amount) })),
      ...refunds.map((refund: any) => ({ date: refund.createdAt, description: `${refund.method.replace(/_/g, " ")} refund · ${refund.reason}`, reference: refund.refundNumber, amount: -money(refund.amount) })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    for (const movement of cashRows) ledgerRow(fmtDate(movement.date), movement.description, movement.reference, movement.amount);
    if (!cashRows.length) ledgerRow("—", "No payments recorded", "", 0);

    ensure(68);
    y += 10;
    doc.roundedRect(MARGIN + CONTENT_WIDTH - 220, y, 220, 44, 5).fill(meta.settled ? "#dcfce7" : balance < -0.005 ? "#dbeafe" : "#fef3c7");
    doc.font("Helvetica-Bold").fontSize(8).fillColor(meta.settled ? "#166534" : balance < -0.005 ? "#1d4ed8" : "#92400e")
      .text(meta.settled ? "PAID IN FULL" : balance < -0.005 ? "CREDIT TO REFUND" : "BALANCE DUE", MARGIN + CONTENT_WIDTH - 210, y + 9, { width: 200 });
    doc.font("Helvetica-Bold").fontSize(11).text(fmtMoney(Math.abs(balance), currency), MARGIN + CONTENT_WIDTH - 210, y + 23, { width: 200, align: "right" });

    const footerY = A4_HEIGHT - 42;
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(MARGIN, footerY - 5).lineTo(MARGIN + CONTENT_WIDTH, footerY - 5).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(
      [property.title, owner?.email, owner?.phone].filter(Boolean).join(" · "),
      MARGIN,
      footerY + 4,
      { width: CONTENT_WIDTH, align: "center" },
    );
  });
  return { pdf, number: meta.number, title: meta.title };
}

export async function emailMasterStatement(block: any, recipient: string) {
  const rendered = await renderMasterStatementPdf(block);
  const propertyName = block.property.title;
  const html = `<div style="font-family:Arial,sans-serif;color:#1f2937"><p>Dear ${block.masterFolio.contactName || block.masterFolio.billToName},</p><p>Please find attached the ${rendered.title.toLowerCase()} for <strong>${block.name}</strong>.</p><p>Regards,<br><strong>${propertyName}</strong></p></div>`;
  const delivery = await sendMail(recipient, `${rendered.title.replace(/\b\w/g, (value) => value.toUpperCase())} ${rendered.number} from ${propertyName}`, html, [{ filename: `${rendered.number}.pdf`, content: rendered.pdf }], { replyTo: block.owner?.email || undefined, sensitiveContent: true });
  return { ...rendered, delivery };
}
