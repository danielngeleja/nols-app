/**
 * Owner payout record: a confidential, traceable print of one owner's payout
 * behaviour (admin owner page, Payouts, Export PDF).
 *
 * It carries LESS than the screen on purpose: the wallet shows its provider
 * and last four digits only (never the holder's name or full number), and
 * there are no IP addresses, devices, phone numbers or emails. Every page is
 * watermarked and footed with who exported it, when (EAT) and the export
 * reference, so a leaked copy can be traced to the export in the audit log.
 */
import PDFDocument from "pdfkit";
import { randomBytes } from "node:crypto";
import { registerNrmsFonts } from "./pdfDocuments.js";

export const OWNER_PAYOUT_RECORD_PURPOSES = {
  DISPUTE: "A dispute with the owner",
  LEGAL: "A police or legal request",
  AUDIT: "An auditor's request",
  OWNER_REQUEST: "The owner asked for their own record",
} as const;
export type OwnerPayoutRecordPurpose = keyof typeof OWNER_PAYOUT_RECORD_PURPOSES;

/** "EXP-7K2Q9M4D": short, unguessable, printed on every page. */
export function ownerPayoutRecordReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  return `EXP-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

export interface OwnerPayoutRecordData {
  reference: string;
  purpose: OwnerPayoutRecordPurpose;
  note: string;
  exportedBy: string;
  exportedAt: Date;
  ownerName: string;
  money: {
    readyToWithdraw: number; paidLast30Days: number; paidCount: number; recoveryDue: number;
    waitingApproval: { count: number; total: number; oldestAt: Date | string | null };
    unlockingCount: number; onHoldCount: number;
  };
  nextRoute: { lane: "AUTO" | "MANUAL"; reason: string | null; amount: number } | null;
  wallet: { provider: string; ending: string | null; nameMatchesOwner: boolean } | null;
  walletWaitUntil: Date | string | null;
  contactWaitUntil: Date | string | null;
  codeLocked: boolean;
  wrongCodes: number;
  failedLast14Days: number;
  behaviour: { score: number | null; band: string; days: number; signals: Array<{ label: string; value: string; severity: string }> };
  controls: { hold: { at: Date | string; reason: string | null } | null; alwaysReview: { reason: string | null } | null };
  withdrawals: Array<{ reference: string; amount: number; status: string; route: "AUTO" | "MANUAL"; createdAt: Date | string; paidAt: Date | string | null }>;
  events: Array<{ createdAt: string; label: string; actor: string; detail: string | null }>;
}

const TEAL = "#02665e";
const INK = "#1a2e2c";
const MUTED = "#6b7280";
const LINE = "#d1e8e6";
const SOFT = "#f7fbfa";
const RED = "#b42318";
const AMBER = "#b45309";
const GREEN = "#166534";

const PROVIDERS: Record<string, string> = {
  vodacom: "Vodacom M-Pesa", mpesa: "Vodacom M-Pesa", airtel: "Airtel Money", tigo: "Tigo Pesa",
  azampesa: "AzamPesa", halopesa: "HaloPesa", crdb: "CRDB Bank", nmb: "NMB Bank", nbc: "NBC Bank",
};
const provider = (v: string) => PROVIDERS[v.toLowerCase()] ?? v.replace(/\b\w/g, (c) => c.toUpperCase());
const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
const eat = (d: Date | string | null | undefined) => d
  ? `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date(d))} EAT`
  : "Not recorded";
const STATUS: Record<string, string> = {
  REQUESTED: "Waiting for approval", APPROVED: "Approved", BATCHED: "Queued", AUTHORIZED: "Queued",
  SUBMITTED: "Sending", PROCESSING: "Sending", PAID: "Paid", FAILED: "Failed", SECURITY_REVIEW: "Security review",
};
const BAND: Record<string, string> = { CLEAN: "No flagged signals", WATCH: "Watch", ACTION: "Review needed", NO_DATA: "No recent records" };

export function generateOwnerPayoutRecordPdf(data: OwnerPayoutRecordData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, compress: true, info: {
      Title: `Owner payout record ${data.reference}`, Author: "NoLSAF", Subject: "Confidential",
    } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc, data);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function draw(doc: PDFKit.PDFDocument, data: OwnerPayoutRecordData) {
  const fonts = registerNrmsFonts(doc);
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;
  const CW = W - M * 2;
  const BOTTOM = H - 54; // the footer rule sits at H - 46
  let y = M;

  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = M;
    }
  };
  const section = (title: string) => {
    ensure(40);
    y += 6;
    doc.font(fonts.bold).fontSize(8).fillColor(TEAL).text(title.toUpperCase(), M, y, { characterSpacing: 0.9, lineBreak: false });
    y += 14;
  };
  /** Label on the left, value on the right, one ruled row. */
  const row = (label: string, value: string, color = INK) => {
    doc.font(fonts.bold).fontSize(9.5);
    const h = Math.max(18, doc.heightOfString(value, { width: CW * 0.58 }) + 8);
    ensure(h);
    doc.font(fonts.regular).fontSize(9).fillColor(MUTED).text(label, M, y + 4, { width: CW * 0.4 });
    doc.font(fonts.bold).fontSize(9.5).fillColor(color).text(value, M + CW * 0.42, y + 4, { width: CW * 0.58, align: "right" });
    y += h;
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(M, y).lineTo(M + CW, y).stroke();
  };
  const table = (headers: string[], widths: number[], rows: string[][], empty: string) => {
    const head = () => {
      ensure(22);
      doc.roundedRect(M, y, CW, 18, 3).fill("#e6f2f1");
      let x = M + 6;
      headers.forEach((h, i) => {
        doc.font(fonts.bold).fontSize(7).fillColor("#014d47").text(h.toUpperCase(), x, y + 6, { width: widths[i] - 8, characterSpacing: 0.6, lineBreak: false });
        x += widths[i];
      });
      y += 22;
    };
    head();
    if (!rows.length) {
      doc.font(fonts.regular).fontSize(9).fillColor(MUTED).text(empty, M + 6, y);
      y += 18;
      return;
    }
    for (const cells of rows) {
      doc.font(fonts.regular).fontSize(8.5);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i] - 8 }))) + 8;
      if (y + h > BOTTOM) {
        doc.addPage();
        y = M;
        head();
      }
      let x = M + 6;
      cells.forEach((c, i) => {
        doc.font(i === 0 ? "Courier" : fonts.regular).fontSize(i === 0 ? 7.5 : 8.5).fillColor(INK).text(c, x, y + 4, { width: widths[i] - 8 });
        x += widths[i];
      });
      y += h;
      doc.strokeColor(LINE).lineWidth(0.4).moveTo(M, y).lineTo(M + CW, y).stroke();
    }
  };

  // Masthead.
  doc.font(fonts.bold).fontSize(15).fillColor(TEAL).text("NoLSAF", M, y, { lineBreak: false });
  doc.font(fonts.bold).fontSize(17).fillColor(INK).text("Owner payout record", M, y + 22, { lineBreak: false });
  doc.font(fonts.bold).fontSize(8);
  const chip = "CONFIDENTIAL";
  const chipW = doc.widthOfString(chip, { characterSpacing: 0.9 }) + 18;
  doc.roundedRect(M + CW - chipW, y, chipW, 18, 3).fill("#fdf3f2");
  doc.fillColor(RED).text(chip, M + CW - chipW, y + 5.5, { width: chipW, align: "center", characterSpacing: 0.9, lineBreak: false });
  doc.font("Courier-Bold").fontSize(9).fillColor(INK).text(data.reference, M, y + 28, { width: CW, align: "right", lineBreak: false });
  y += 50;
  doc.strokeColor(TEAL).lineWidth(1.5).moveTo(M, y).lineTo(M + CW, y).stroke();
  y += 12;

  // Why this exists: the export record, first.
  const purpose = OWNER_PAYOUT_RECORD_PURPOSES[data.purpose];
  doc.font(fonts.regular).fontSize(9);
  const noteH = doc.heightOfString(data.note, { width: CW - 24 });
  const boxH = 74 + noteH;
  doc.roundedRect(M, y, CW, boxH, 5).fillAndStroke(SOFT, LINE);
  doc.font(fonts.bold).fontSize(7).fillColor(MUTED).text("OWNER", M + 12, y + 10, { characterSpacing: 0.7, lineBreak: false });
  doc.font(fonts.bold).fontSize(11).fillColor(INK).text(data.ownerName, M + 12, y + 20, { width: CW / 2 - 20, height: 14, ellipsis: true });
  doc.font(fonts.bold).fontSize(7).fillColor(MUTED).text("PURPOSE OF THIS EXPORT", M + CW / 2, y + 10, { characterSpacing: 0.7, lineBreak: false });
  doc.font(fonts.bold).fontSize(10).fillColor(INK).text(purpose, M + CW / 2, y + 20, { width: CW / 2 - 12 });
  doc.font(fonts.regular).fontSize(8.5).fillColor(MUTED)
    .text(`Exported by ${data.exportedBy} on ${eat(data.exportedAt)}`, M + 12, y + 40, { width: CW - 24, lineBreak: false });
  doc.font(fonts.regular).fontSize(9).fillColor(INK).text(data.note, M + 12, y + 58, { width: CW - 24 });
  y += boxH + 10;

  section("Money");
  const m = data.money;
  row("Ready to withdraw", `${tzs(m.readyToWithdraw)}${m.unlockingCount || m.onHoldCount ? `  (${[m.unlockingCount ? `${m.unlockingCount} unlocking` : "", m.onHoldCount ? `${m.onHoldCount} on hold` : ""].filter(Boolean).join(", ")})` : ""}`);
  row("Waiting for approval", m.waitingApproval.count
    ? `${tzs(m.waitingApproval.total)} (${m.waitingApproval.count} withdrawal${m.waitingApproval.count === 1 ? "" : "s"}), since ${eat(m.waitingApproval.oldestAt)}`
    : "None");
  row("Paid in the last 30 days", tzs(m.paidLast30Days));
  row("Payouts paid in total", m.paidCount ? String(m.paidCount) : "None yet");
  row("Owed back from refunds", m.recoveryDue > 0 ? tzs(m.recoveryDue) : "Nothing", m.recoveryDue > 0 ? RED : INK);
  row("Next payout", data.nextRoute
    ? `${data.nextRoute.lane === "AUTO" ? "Sent automatically" : "Checked by a person"} for ${tzs(data.nextRoute.amount)}${data.nextRoute.reason ? `: ${data.nextRoute.reason}` : ""}`
    : "Nothing ready to withdraw");

  section("Safety signals");
  row("Wallet", data.wallet ? `${provider(data.wallet.provider)}${data.wallet.ending ? `, ending in ${data.wallet.ending}` : ""}` : "No verified wallet");
  if (data.wallet) row("Holder name matches owner", data.wallet.nameMatchesOwner ? "Yes" : "No", data.wallet.nameMatchesOwner ? GREEN : AMBER);
  row("Security wait", [data.walletWaitUntil ? `Wallet change, until ${eat(data.walletWaitUntil)}` : "", data.contactWaitUntil ? `Contact change, until ${eat(data.contactWaitUntil)}` : ""].filter(Boolean).join(". ") || "None");
  row("Withdrawal code", data.codeLocked ? "Locked after 3 wrong codes" : data.wrongCodes ? `${data.wrongCodes} of 3 wrong codes` : "OK", data.codeLocked ? RED : data.wrongCodes ? AMBER : GREEN);
  row("Failed payouts, last 14 days", String(data.failedLast14Days), data.failedLast14Days ? RED : INK);

  section(`Behaviour score, last ${data.behaviour.days} days`);
  row("Score", data.behaviour.score == null ? "No recent records" : `${data.behaviour.score} / 100, ${BAND[data.behaviour.band] ?? data.behaviour.band}`,
    data.behaviour.band === "ACTION" ? RED : data.behaviour.band === "WATCH" ? AMBER : INK);
  for (const s of data.behaviour.signals) {
    row(s.label, `${s.value}${s.severity === "CLEAN" ? "" : `, ${BAND[s.severity] ?? s.severity}`}`, s.severity === "ACTION" ? RED : s.severity === "WATCH" ? AMBER : INK);
  }

  section("Admin controls");
  row("Payouts paused", data.controls.hold ? `Yes, since ${eat(data.controls.hold.at)}${data.controls.hold.reason ? `. Reason: ${data.controls.hold.reason}` : ""}` : "No", data.controls.hold ? RED : INK);
  row("Always checked by a person", data.controls.alwaysReview ? `Yes${data.controls.alwaysReview.reason ? `. Reason: ${data.controls.alwaysReview.reason}` : ""}` : "No", data.controls.alwaysReview ? AMBER : INK);

  section("Recent withdrawals");
  table(["Reference", "Amount", "Route", "Status", "Requested"], [104, 80, 66, 140, CW - 390],
    data.withdrawals.map((w) => [
      w.reference, tzs(w.amount), w.route === "AUTO" ? "Automatic" : "By a person",
      w.status === "PAID" && w.paidAt ? `Paid ${eat(w.paidAt)}` : STATUS[w.status] ?? w.status.toLowerCase().replace(/_/g, " "), eat(w.createdAt),
    ]), "No withdrawals yet.");

  section("Withdrawal and control events");
  table(["When", "Event", "By", "Detail"], [120, 150, 60, CW - 330],
    data.events.map((e) => [eat(e.createdAt), e.label, e.actor, e.detail ?? ""]), "No withdrawal or control events recorded.");

  // Every page: diagonal watermark and a traceable footer.
  const range = doc.bufferedPageRange();
  const stamp = `CONFIDENTIAL  ·  ${data.exportedBy}  ·  ${eat(data.exportedAt)}`;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.save();
    // Wider than the page and one line: rotated, it crosses the page corner to corner.
    doc.opacity(0.06).fillColor(TEAL).font(fonts.bold).fontSize(18);
    doc.rotate(-32, { origin: [W / 2, H / 2] });
    doc.text(stamp, -150, H / 2 - 9, { width: W + 300, align: "center", lineBreak: false });
    doc.restore();
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(M, H - 46).lineTo(M + CW, H - 46).stroke();
    doc.font(fonts.regular).fontSize(7).fillColor(MUTED)
      .text(`Exported by ${data.exportedBy}  ·  ${eat(data.exportedAt)}  ·  ${data.reference}  ·  Page ${i - range.start + 1} of ${range.count}`, M, H - 38, { width: CW, align: "left", lineBreak: false })
      .text("Confidential. Do not forward or copy without NoLSAF approval.", M, H - 38, { width: CW, align: "right", lineBreak: false });
  }
}
