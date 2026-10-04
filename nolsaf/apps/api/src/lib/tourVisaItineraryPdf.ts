/**
 * Visa-support travel itinerary as an A4 PDF, laid out like the NRMS
 * documents (pdfDocuments.ts): issuer left and teal document title right over a
 * double keyline, tinted info cards, teal-header tables, a verification card
 * with the QR code, and the Code 128 document number in the bottom zone next
 * to the issuing line. Trebuchet MS via registerNrmsFonts.
 */
import PDFDocument from "pdfkit";
import { drawCode128Barcode, registerNrmsFonts, type NrmsFonts } from "./pdfDocuments.js";
import type { VisaItineraryModel } from "./tourVisaItinerary.js";

const TEAL = "#02665e";
const DARK = "#014d47";
const LIGHT_TEAL = "#e6f2f1";
const CARD = "#f7fbfa";
const BORDER = "#d1e8e6";
const TEXT_MAIN = "#1a2e2c";
const TEXT_MUTED = "#6b7280";
const AMBER = "#b45309";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 44;
const W = PAGE_W - M * 2;
const FOOTER_ZONE = 58; // page footer band
const SIGN_ZONE = 64; // issuing line and barcode on the last page

export type VisaItineraryPdfInput = {
  model: VisaItineraryModel;
  verificationUrl: string;
  qrPng: Buffer | null;
};

export function generateTourVisaItineraryPdf(input: VisaItineraryPdfInput): Promise<Buffer> {
  const { model } = input;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: M, compress: true, bufferPages: true, info: { Title: `${model.documentTitle} ${model.bookingCode}`, Author: "NoLSAF" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc, registerNrmsFonts(doc), input);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function draw(doc: PDFKit.PDFDocument, fonts: NrmsFonts, input: VisaItineraryPdfInput) {
  const { model } = input;
  let y = M;
  const limit = () => PAGE_H - FOOTER_ZONE;

  const newPage = () => {
    doc.addPage({ size: "A4", margin: M });
    y = M;
    // Running header so a loose page still says what it belongs to.
    doc.font(fonts.bold).fontSize(8).fillColor(TEAL)
      .text(model.documentTitle.toUpperCase(), M, y, { width: W / 2, characterSpacing: 0.8, lineBreak: false });
    doc.font("Courier-Bold").fontSize(8).fillColor(TEXT_MAIN)
      .text(model.documentNumber, M + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
    y += 14;
    doc.strokeColor(BORDER).lineWidth(0.6).moveTo(M, y).lineTo(M + W, y).stroke();
    y += 12;
  };
  const ensure = (height: number) => {
    if (y + height > limit()) newPage();
  };
  const sectionLabel = (label: string) => {
    ensure(40);
    doc.font(fonts.bold).fontSize(8).fillColor(TEAL).text(label.toUpperCase(), M, y, { characterSpacing: 1.1, lineBreak: false });
    y += 15;
  };

  // ── Masthead: issuer left, document title right ─────────────
  doc.font(fonts.bold).fontSize(22).fillColor(TEXT_MAIN).text("NoLSAF", M, y, { lineBreak: false });
  doc.font(fonts.regular).fontSize(8.5).fillColor(TEXT_MUTED)
    .text("Travel booking platform", M, y + 27, { lineBreak: false })
    .text("nolsaf.com · support@nolsaf.com", M, y + 39, { lineBreak: false });

  doc.font(fonts.bold).fontSize(17).fillColor(TEAL)
    .text(model.documentTitle.toUpperCase(), M + W * 0.35, y, { width: W * 0.65, align: "right", lineBreak: false });
  doc.font("Courier-Bold").fontSize(9).fillColor(TEXT_MAIN)
    .text(model.documentNumber, M, y + 24, { width: W, align: "right", lineBreak: false });
  doc.font(fonts.regular).fontSize(8.5).fillColor(TEXT_MUTED)
    .text(`Issued ${model.issuedLabel}`, M, y + 37, { width: W, align: "right", lineBreak: false });

  const tone = model.status.tone === "confirmed"
    ? { bg: "#dcfce7", fg: "#166534" }
    : model.status.tone === "review" ? { bg: "#fef3c7", fg: AMBER } : { bg: "#f1f5f9", fg: TEXT_MUTED };
  doc.font(fonts.bold).fontSize(8);
  const badgeW = doc.widthOfString(model.status.label.toUpperCase(), { characterSpacing: 0.6 }) + 20;
  doc.roundedRect(M + W - badgeW, y + 51, badgeW, 17, 4).fill(tone.bg);
  doc.fillColor(tone.fg).text(model.status.label.toUpperCase(), M + W - badgeW, y + 56, { width: badgeW, align: "center", characterSpacing: 0.6, lineBreak: false });
  y += 78;

  doc.strokeColor(TEAL).lineWidth(1.6).moveTo(M, y).lineTo(M + W, y).stroke();
  doc.strokeColor(BORDER).lineWidth(0.5).moveTo(M, y + 3.5).lineTo(M + W, y + 3.5).stroke();
  y += 16;

  // ── Lead traveller and trip dates cards ─────────────────────
  const gap = 12;
  const cardW = (W - gap) / 2;
  const cardH = 104;
  doc.roundedRect(M, y, cardW, cardH, 6).fillAndStroke(CARD, BORDER);
  doc.roundedRect(M + cardW + gap, y, cardW, cardH, 6).fillAndStroke(CARD, BORDER);

  doc.font(fonts.bold).fontSize(7.5).fillColor(TEAL).text("LEAD TRAVELLER", M + 14, y + 12, { characterSpacing: 1, lineBreak: false });
  doc.font(fonts.bold).fontSize(13).fillColor(TEXT_MAIN).text(model.leadTraveller, M + 14, y + 27, { width: cardW - 28, lineBreak: false, ellipsis: true });
  doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MUTED);
  if (model.leadNationality) doc.text(`Nationality: ${model.leadNationality}`, M + 14, y + 47, { width: cardW - 28, lineBreak: false, ellipsis: true });
  doc.text(`Travelling party: ${model.travellerCount} ${model.travellerCount === 1 ? "person" : "people"}`, M + 14, y + 61, { width: cardW - 28, lineBreak: false });
  doc.text(`Booking reference: ${model.bookingCode}`, M + 14, y + 75, { width: cardW - 28, lineBreak: false, ellipsis: true });

  const rx = M + cardW + gap + 14;
  const colW = (cardW - 28) / 2;
  const keyValue = (label: string, value: string, x: number, ky: number) => {
    doc.font(fonts.bold).fontSize(7).fillColor(TEXT_MUTED).text(label.toUpperCase(), x, ky, { width: colW - 6, characterSpacing: 0.7, lineBreak: false });
    doc.font(fonts.bold).fontSize(10).fillColor(TEXT_MAIN).text(value, x, ky + 11, { width: colW - 6, lineBreak: false, ellipsis: true });
  };
  doc.font(fonts.bold).fontSize(7.5).fillColor(TEAL).text("TRIP DATES", rx, y + 12, { characterSpacing: 1, lineBreak: false });
  keyValue("Arrival", model.arrival, rx, y + 30);
  keyValue(model.departureDerived ? "Departure (planned)" : "Departure", model.departure, rx + colW, y + 30);
  keyValue("Duration", model.duration, rx, y + 64);
  keyValue("Destination", model.destination, rx + colW, y + 64);
  y += cardH + 18;

  // ── Tour line ───────────────────────────────────────────────
  sectionLabel("Tour");
  doc.font(fonts.bold).fontSize(13).fillColor(TEXT_MAIN).text(model.title, M, y, { width: W });
  y = doc.y + 3;
  doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MUTED)
    .text(`Operated by ${model.operatorName} · Payment: ${model.payment}`, M, y, { width: W });
  y = doc.y + 16;

  // ── Travelling party ────────────────────────────────────────
  const party = { num: 26, name: W * 0.4, nat: W * 0.24 };
  const partyDoc = W - party.num - party.name - party.nat;
  const partyHeader = () => {
    doc.rect(M, y, W, 22).fill(TEAL);
    doc.font(fonts.bold).fontSize(7.5).fillColor("#ffffff")
      .text("#", M + 8, y + 7.5, { width: party.num - 8, lineBreak: false })
      .text("FULL NAME", M + party.num, y + 7.5, { width: party.name, lineBreak: false })
      .text("NATIONALITY", M + party.num + party.name, y + 7.5, { width: party.nat, lineBreak: false })
      .text("TRAVEL DOCUMENT", M + party.num + party.name + party.nat, y + 7.5, { width: partyDoc - 8, lineBreak: false });
    y += 22;
  };
  sectionLabel("Travelling party");
  partyHeader();
  model.travellers.forEach((t, index) => {
    if (y + 24 > limit()) {
      newPage();
      partyHeader();
    }
    const rowH = 24;
    doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MUTED).text(String(index + 1), M + 8, y + 7.5, { width: party.num - 8, lineBreak: false });
    doc.font(fonts.bold).fontSize(9.5).fillColor(TEXT_MAIN);
    const nameText = t.name;
    doc.text(nameText, M + party.num, y + 7, { width: party.name - 44, lineBreak: false, ellipsis: true });
    if (t.lead) {
      const nameW = Math.min(party.name - 44, doc.widthOfString(nameText));
      doc.roundedRect(M + party.num + nameW + 6, y + 6.5, 30, 11, 3).fill(LIGHT_TEAL);
      doc.font(fonts.bold).fontSize(6).fillColor(TEAL).text("LEAD", M + party.num + nameW + 6, y + 9.2, { width: 30, align: "center", lineBreak: false });
    }
    doc.font(fonts.regular).fontSize(9.5).fillColor(TEXT_MAIN)
      .text(t.nationality || "Not recorded", M + party.num + party.name, y + 7, { width: party.nat - 6, lineBreak: false, ellipsis: true });
    if (t.document) {
      doc.font("Courier-Bold").fontSize(9).fillColor(TEXT_MAIN)
        .text(t.document, M + party.num + party.name + party.nat, y + 7.5, { width: partyDoc - 8, lineBreak: false });
    } else {
      doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MUTED)
        .text("Not recorded", M + party.num + party.name + party.nat, y + 7.5, { width: partyDoc - 8, lineBreak: false });
    }
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(M, y + rowH).lineTo(M + W, y + rowH).stroke();
    y += rowH;
  });
  y += 18;

  // ── Day-by-day itinerary ────────────────────────────────────
  const dayCol = 78;
  const nightCol = 118;
  const progCol = W - dayCol - nightCol;
  const timeCol = 70;
  const itineraryHeader = () => {
    doc.rect(M, y, W, 22).fill(TEAL);
    doc.font(fonts.bold).fontSize(7.5).fillColor("#ffffff")
      .text("DAY", M + 8, y + 7.5, { width: dayCol - 8, lineBreak: false })
      .text("PROGRAMME", M + dayCol, y + 7.5, { width: progCol - 8, lineBreak: false })
      .text("OVERNIGHT", M + dayCol + progCol, y + 7.5, { width: nightCol - 8, lineBreak: false });
    y += 22;
  };
  const measureDay = (day: VisaItineraryModel["days"][number]) => {
    let h = 9;
    doc.font(fonts.bold).fontSize(10);
    h += doc.heightOfString(day.title, { width: progCol - 12 }) + 3;
    if (day.description) {
      doc.font(fonts.regular).fontSize(9);
      h += doc.heightOfString(day.description, { width: progCol - 12, lineGap: 1 }) + 5;
    }
    doc.font(fonts.regular).fontSize(9);
    for (const event of day.timeline) {
      h += Math.max(13, doc.heightOfString(event.text, { width: progCol - 12 - timeCol })) + 3;
    }
    doc.font(fonts.regular).fontSize(9);
    const nightH = day.overnight ? doc.heightOfString(day.overnight, { width: nightCol - 12 }) + 18 : 0;
    return Math.max(h + 8, nightH, 44);
  };
  sectionLabel("Day-by-day itinerary");
  itineraryHeader();
  model.days.forEach((day, index) => {
    const rowH = measureDay(day);
    if (y + rowH > limit()) {
      newPage();
      itineraryHeader();
    }
    if (index % 2 === 1) doc.rect(M, y, W, rowH).fill(CARD);
    // Day cell
    doc.font(fonts.bold).fontSize(11).fillColor(TEAL).text(`Day ${day.day}`, M + 8, y + 9, { width: dayCol - 12, lineBreak: false });
    if (day.date) {
      doc.font(fonts.regular).fontSize(8).fillColor(TEXT_MUTED).text(day.date, M + 8, y + 24, { width: dayCol - 12 });
    }
    // Programme cell
    const px = M + dayCol;
    let py = y + 9;
    doc.font(fonts.bold).fontSize(10).fillColor(TEXT_MAIN).text(day.title, px, py, { width: progCol - 12 });
    py = doc.y + 3;
    if (day.description) {
      doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MUTED).text(day.description, px, py, { width: progCol - 12, lineGap: 1 });
      py = doc.y + 5;
    }
    for (const event of day.timeline) {
      doc.font(fonts.bold).fontSize(9).fillColor(TEAL).text(event.time || "", px, py, { width: timeCol - 6, lineBreak: false });
      doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MAIN).text(event.text, px + timeCol, py, { width: progCol - 12 - timeCol });
      py = Math.max(doc.y, py + 13) + 3;
    }
    // Overnight cell
    const nx = M + dayCol + progCol;
    if (day.overnight) {
      doc.font(fonts.bold).fontSize(6.5).fillColor(TEXT_MUTED).text("STAY", nx, y + 9, { characterSpacing: 0.8, lineBreak: false });
      doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MAIN).text(day.overnight, nx, y + 20, { width: nightCol - 12 });
    } else {
      doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MUTED).text(index === model.days.length - 1 ? "End of tour" : "See programme", nx, y + 9, { width: nightCol - 12, lineBreak: false });
    }
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(M, y + rowH).lineTo(M + W, y + rowH).stroke();
    y += rowH;
  });
  if (!model.days.length) {
    doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MUTED).text("A detailed daily schedule has not been added to this booking.", M + 8, y + 8, { width: W - 16 });
    y = doc.y + 8;
  }
  y += 18;

  // ── Arrangements and operator, side by side ─────────────────
  const halfW = (W - gap) / 2;
  const listHeight = (items: string[]) => {
    doc.font(fonts.regular).fontSize(9);
    return items.reduce((h, item) => h + doc.heightOfString(item, { width: halfW - 36 }) + 5, 0);
  };
  const opRows = model.operatorFacts;
  const arrangements = model.arrangements.length ? model.arrangements : ["No additional arrangements recorded."];
  const boxH = Math.max(34 + listHeight(arrangements), 34 + opRows.length * 16) + 8;
  ensure(boxH + 8);
  doc.roundedRect(M, y, halfW, boxH, 6).fillAndStroke(CARD, BORDER);
  doc.roundedRect(M + halfW + gap, y, halfW, boxH, 6).fillAndStroke(CARD, BORDER);
  doc.font(fonts.bold).fontSize(7.5).fillColor(TEAL)
    .text("ARRANGEMENTS", M + 14, y + 12, { characterSpacing: 1, lineBreak: false })
    .text("TOUR OPERATOR", M + halfW + gap + 14, y + 12, { characterSpacing: 1, lineBreak: false });
  let ay = y + 30;
  for (const item of arrangements) {
    doc.circle(M + 17, ay + 5, 1.8).fill(TEAL);
    doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MAIN).text(item, M + 25, ay, { width: halfW - 36 });
    ay = doc.y + 5;
  }
  let oy = y + 30;
  const ox = M + halfW + gap + 14;
  const ow = halfW - 28;
  for (const [label, value] of opRows) {
    doc.font(fonts.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(label, ox, oy, { width: ow * 0.42, lineBreak: false });
    doc.font(fonts.bold).fontSize(9).fillColor(TEXT_MAIN).text(value, ox + ow * 0.42, oy, { width: ow * 0.58, align: "right", lineBreak: false, ellipsis: true });
    oy += 16;
  }
  y += boxH + 16;

  // ── Verification card with QR ───────────────────────────────
  const verifyH = 96;
  ensure(verifyH + 60 + SIGN_ZONE);
  doc.roundedRect(M, y, W, verifyH, 8).fillAndStroke(LIGHT_TEAL, BORDER);
  doc.font(fonts.bold).fontSize(8).fillColor(TEAL).text("VERIFY THIS DOCUMENT", M + 16, y + 14, { characterSpacing: 1, lineBreak: false });
  doc.font(fonts.regular).fontSize(9).fillColor(TEXT_MAIN)
    .text("Scan the QR code, or open the link below, to confirm this booking, its dates and its travellers directly with NoLSAF. The document number appears in the barcode below.", M + 16, y + 30, { width: W - 130, lineGap: 1 });
  doc.font("Courier").fontSize(7.5).fillColor(DARK).text(input.verificationUrl, M + 16, y + 70, { width: W - 130, lineBreak: false, ellipsis: true });
  if (input.qrPng) {
    doc.image(input.qrPng, M + W - 94, y + 9, { fit: [78, 78] });
  }
  y += verifyH + 12;

  doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MUTED)
    .text("This document confirms the itinerary recorded for the NoLSAF booking above. It is not a visa, immigration decision, airline ticket or guarantee of entry. Travel document numbers are partly hidden for privacy. The traveller remains responsible for meeting the requirements of the relevant embassy, consulate, airline and border authority.", M, y, { width: W, lineGap: 1 });
  y = doc.y + 10;

  // ── Issuing line and barcode, pinned above the footer ───────
  const signY = PAGE_H - FOOTER_ZONE - SIGN_ZONE + 10;
  if (y > signY - 6) newPage();
  const lastBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.strokeColor(TEXT_MUTED).lineWidth(0.5).moveTo(M, signY + 22).lineTo(M + 190, signY + 22).stroke();
  doc.font(fonts.bold).fontSize(8.5).fillColor(TEXT_MAIN).text("Issued electronically by NoLSAF", M, signY + 27, { lineBreak: false });
  doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MUTED).text("Valid without signature · verify with the QR code above", M, signY + 39, { lineBreak: false });
  const bcW = 210;
  const bcX = M + W - bcW;
  drawCode128Barcode(doc, model.documentNumber, bcX, signY, bcW, 30);
  doc.font("Courier-Bold").fontSize(8).fillColor(TEXT_MAIN).text(model.documentNumber, bcX, signY + 33, { width: bcW, align: "center", characterSpacing: 0.6, lineBreak: false });
  doc.font(fonts.regular).fontSize(6).fillColor(TEXT_MUTED).text("CODE 128 | ISO/IEC 15417", bcX, signY + 43, { width: bcW, align: "center", lineBreak: false });
  doc.page.margins.bottom = lastBottom;

  // ── Footer with page numbers on every page ──────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = PAGE_H - 36;
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(M, fy - 8).lineTo(M + W, fy - 8).stroke();
    doc.font(fonts.regular).fontSize(7.5).fillColor(TEXT_MUTED)
      .text(`NoLSAF · ${model.documentTitle} · ${model.documentNumber}`, M, fy, { width: W * 0.7, lineBreak: false })
      .text(`Page ${i - range.start + 1} of ${range.count}`, M + W * 0.7, fy, { width: W * 0.3, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}
