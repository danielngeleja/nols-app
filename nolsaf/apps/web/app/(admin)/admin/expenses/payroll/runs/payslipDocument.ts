import QRCode from "qrcode";
import { escapeAttr, escapeHtml } from "@/utils/html";

/**
 * Payslip documents as self-contained HTML, one A5 `.sheet` per employee, for
 * the shared DocumentViewer (print, save as PDF). The brand reads "NoLSAF";
 * no label containing it is uppercased.
 *
 * Paid payslips carry a faint NoLSAF mark and a QR code that opens the public
 * check at /verify/payslip, which shows NoLSAF's own figures for the slip.
 * Anything not paid yet is stamped DRAFT (or CANCELLED) and has no QR code,
 * so it cannot pass as an issued payslip.
 */

export type PayslipLine = {
  payslipNumber: string;
  employee: { employeeNo: string; fullName: string; jobTitle: string; department: string | null; tin: string | null; nssfNumber: string | null; payTo: string; employmentType: string };
  basicSalary: number;
  allowances: number;
  overtime: number;
  bonus: number;
  gross: number;
  nssfEmployee: number;
  taxable: number;
  paye: number;
  heslb?: number;
  /** Part-month pay; null is the full month. */
  daysPaid?: number | null;
  periodDays?: number | null;
  loanDeduction: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
  nssfEmployer: number;
  wcf: number;
  sdl: number;
  employerCost: number;
  note: string | null;
  /** Signed reference for the QR code; only set once the run is paid. */
  verifyToken?: string | null;
};

export type PayslipRun = { runNumber: string; periodMonth: string; status: string; payDate: string | null; paymentReference: string | null };

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const monthName = (periodMonth: string) => new Date(`${periodMonth}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "To be paid");

const STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e5e7eb; font-family: "Trebuchet MS", Arial, sans-serif; color: #171717; }
  .sheet { position: relative; overflow: hidden; width: 148mm; min-height: 210mm; margin: 0 auto 24px; padding: 11mm 10mm; background: #fff; page-break-after: always; break-after: page; display: flex; flex-direction: column; }
  .sheet > * { position: relative; z-index: 1; }
  .sheet > .wm { position: absolute; z-index: 0; pointer-events: none; }
  .wm-brand { top: 50%; left: 50%; width: 96mm; height: 96mm; transform: translate(-50%, -46%); opacity: 0.075; object-fit: contain; }
  .wm-tile { inset: 0; width: 100%; height: 100%; }
  .wm-seal { top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-28deg); white-space: nowrap; font-size: 30px; font-weight: 800; letter-spacing: 0.18em; color: rgba(2, 102, 94, 0.10); border: 3px solid rgba(2, 102, 94, 0.10); border-radius: 10px; padding: 3px 16px; }
  .wm-edge { left: 0; right: 0; height: 5mm; display: flex; align-items: center; justify-content: center; overflow: hidden; white-space: nowrap; font-size: 6px; font-weight: 700; letter-spacing: 0.22em; color: rgba(2, 102, 94, 0.55); background: rgba(2, 102, 94, 0.06); }
  .wm-edge.top { top: 0; }
  .wm-edge.bottom { bottom: 0; }
  @media print { .wm, .wm * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .wm-stamp { top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-32deg); font-size: 64px; font-weight: 800; letter-spacing: 0.12em; white-space: nowrap; color: rgba(225, 29, 72, 0.13); border: 5px solid rgba(225, 29, 72, 0.13); border-radius: 14px; padding: 4px 22px; }
  .stamp-note { margin-top: 8px; padding: 6px 9px; border-radius: 6px; background: #fff1f2; color: #9f1239; font-size: 8.5px; font-weight: 700; }
  .verify { display: flex; align-items: center; gap: 9px; margin-top: 10px; padding: 7px 9px; border: 1px solid #d7e5e1; border-radius: 8px; background: #fbfdfc; }
  .verify svg { width: 21mm; height: 21mm; flex-shrink: 0; }
  .verify b { display: block; font-size: 9.5px; color: #0b2420; }
  .verify span { display: block; font-size: 8px; color: #6b7280; margin-top: 2px; line-height: 1.4; }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 2px solid #0b2420; }
  .brand { display: flex; align-items: center; gap: 9px; }
  .brand img { width: 34px; height: 34px; object-fit: contain; }
  .brand strong { display: block; font-size: 15px; letter-spacing: -0.01em; }
  .brand span { display: block; font-size: 8.5px; color: #6b7280; }
  .doc { text-align: right; }
  .doc strong { display: block; font-size: 13px; color: #0b2420; }
  .doc span { display: block; font-size: 8.5px; color: #6b7280; margin-top: 2px; }
  .who { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin-top: 11px; padding: 9px 10px; border-radius: 6px; background: #f4f8f6; font-size: 9px; }
  .who div span { color: #6b7280; }
  .who div b { display: block; font-size: 10px; margin-top: 1px; }
  h3 { margin: 13px 0 5px; font-size: 9px; letter-spacing: 0.08em; color: #02665e; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  td { padding: 5px 0; border-bottom: 1px solid #eef0ef; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { border-bottom: 0; border-top: 1.5px solid #171717; font-weight: 700; }
  .net { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding: 11px 12px; border-radius: 8px; background: #0b2420; color: #fff; }
  .net span { font-size: 9px; color: #a7f3d0; }
  .net b { font-size: 18px; font-variant-numeric: tabular-nums; }
  .employer { margin-top: 10px; font-size: 8.5px; color: #4b5563; }
  .employer b { color: #171717; }
  .note { margin-top: 8px; font-size: 8.5px; color: #4b5563; }
  .foot { margin-top: auto; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 7.5px; color: #9ca3af; display: flex; justify-content: space-between; gap: 10px; }
  @page { size: A5 portrait; margin: 0; }
  @media print { html, body { background: #fff; } .sheet { margin: 0; } }
`;

/** A QR code as inline SVG, drawn synchronously so the document stays a plain string. */
function qrSvg(text: string) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = modules.size;
  let path = "";
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules.get(r, c)) path += `M${c + 2} ${r + 2}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 4} ${size + 4}" shape-rendering="crispEdges" aria-label="Verification QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#0b2420"/></svg>`;
}

/** A diagonal, repeating text watermark covering the whole sheet. Drawn as inline SVG so it prints even without background graphics. */
function tiledWatermark(text: string, color: string) {
  const safe = escapeHtml(text);
  return `<svg class="wm wm-tile" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><pattern id="wm-${Math.abs(hash(text))}" width="300" height="110" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><text x="0" y="40" font-family="Trebuchet MS, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="2" fill="${color}">${safe}</text><text x="-150" y="95" font-family="Trebuchet MS, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="2" fill="${color}">${safe}</text></pattern></defs><rect width="100%" height="100%" fill="url(#wm-${Math.abs(hash(text))})"/></svg>`;
}
function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

function sheet(run: PayslipRun, line: PayslipLine, logoUrl: string, origin: string) {
  const e = line.employee;
  const issued = run.status === "PAID";
  const stamp = issued ? null : run.status === "CANCELLED" ? "CANCELLED" : "DRAFT";
  const verifyUrl = issued && line.verifyToken ? `${origin}/verify/payslip?t=${encodeURIComponent(line.verifyToken)}` : null;
  const verifyHost = origin.replace(/^https?:\/\//, "");
  const earnings = [
    ["Basic salary", line.basicSalary],
    ["Allowances", line.allowances],
    ["Overtime", line.overtime],
    ["Bonus", line.bonus],
  ].filter(([, v], i) => i === 0 || Number(v) > 0) as Array<[string, number]>;
  const deductions = [
    ["NSSF (employee share)", line.nssfEmployee],
    ["PAYE", line.paye],
    ["HESLB loan repayment", line.heslb ?? 0],
    ["Loan or advance", line.loanDeduction],
    ["Other deductions", line.otherDeductions],
  ].filter(([, v], i) => i < 2 || Number(v) > 0) as Array<[string, number]>;

  return `
  <section class="sheet">
    ${issued
      ? `${tiledWatermark(`NoLSAF  ·  PAID  ·  ${line.payslipNumber}  ·  ${e.employeeNo}`, "rgba(2,102,94,0.075)")}<img class="wm wm-brand" src="${escapeAttr(logoUrl)}" alt="" aria-hidden="true" /><div class="wm wm-seal" aria-hidden="true">ISSUED · ${escapeHtml(monthName(run.periodMonth).toUpperCase())}</div>`
      : `${tiledWatermark(`${stamp}  ·  NOT ISSUED  ·  NOT PROOF OF INCOME`, "rgba(225,29,72,0.07)")}<div class="wm wm-stamp" aria-hidden="true">${stamp}</div>`}
    <div class="wm wm-edge top" aria-hidden="true">${escapeHtml(`NoLSAF PAYROLL  ·  ${line.payslipNumber}  ·  ${e.employeeNo}  ·  ${issued ? "VERIFY BY QR CODE" : "DRAFT, NOT ISSUED"}`)}</div>
    <div class="wm wm-edge bottom" aria-hidden="true">${escapeHtml(`${line.payslipNumber}  ·  NoLSAF  ·  ${e.employeeNo}  ·  ${line.payslipNumber}  ·  NoLSAF  ·  ${e.employeeNo}`)}</div>
    <div class="head">
      <div class="brand"><img src="${escapeAttr(logoUrl)}" alt="NoLSAF" /><div><strong>NoLSAF</strong><span>NoLS Africa Co Ltd · Dar es Salaam</span></div></div>
      <div class="doc"><strong>Payslip</strong><span>${escapeHtml(monthName(run.periodMonth))}</span><span>${escapeHtml(line.payslipNumber)}</span></div>
    </div>
    <div class="who">
      <div><span>Employee</span><b>${escapeHtml(e.fullName)}</b></div>
      <div><span>Employee no.</span><b>${escapeHtml(e.employeeNo)}</b></div>
      <div><span>Position</span><b>${escapeHtml(e.jobTitle)}${e.department ? `, ${escapeHtml(e.department)}` : ""}</b></div>
      <div><span>Pay date</span><b>${escapeHtml(day(run.payDate))}</b></div>
      <div><span>TIN</span><b>${escapeHtml(e.tin || "Not recorded")}</b></div>
      <div><span>NSSF no.</span><b>${escapeHtml(e.nssfNumber || "Not recorded")}</b></div>
    </div>
    <h3>Earnings</h3>
    ${line.daysPaid != null && line.periodDays ? `<p class="note" style="margin:0 0 4px">Paid for ${line.daysPaid} of ${line.periodDays} days in ${escapeHtml(monthName(run.periodMonth))}.</p>` : ""}
    <table>
      ${earnings.map(([label, v]) => `<tr><td>${escapeHtml(label)}</td><td class="n">${money(v)}</td></tr>`).join("")}
      <tr class="total"><td>Gross pay</td><td class="n">${money(line.gross)}</td></tr>
    </table>
    <h3>Deductions</h3>
    <table>
      ${deductions.map(([label, v]) => `<tr><td>${escapeHtml(label)}</td><td class="n">${money(v)}</td></tr>`).join("")}
      <tr class="total"><td>Total deductions</td><td class="n">${money(line.totalDeductions)}</td></tr>
    </table>
    <div class="net"><div><span>Net pay, TZS</span><div style="font-size:8.5px;color:#d1fae5;margin-top:2px">Paid to ${escapeHtml(e.payTo)}</div></div><b>${money(line.net)}</b></div>
    <p class="employer">Taxable pay <b>${money(line.taxable)}</b>. Also paid by NoLSAF on your behalf: employer NSSF <b>${money(line.nssfEmployer)}</b>, WCF <b>${money(line.wcf)}</b>${line.sdl ? `, SDL <b>${money(line.sdl)}</b>` : ""}.</p>
    ${line.note ? `<p class="note">${escapeHtml(line.note)}</p>` : ""}
    ${verifyUrl ? `<div class="verify">${qrSvg(verifyUrl)}<div><b>Scan to verify this payslip</b><span>Opens NoLSAF's own record of this payslip at ${escapeHtml(verifyHost)}/verify/payslip. If the figures there differ from this page, the page was changed.</span></div></div>` : ""}
    ${stamp ? `<p class="stamp-note">${stamp === "CANCELLED" ? "This pay run was cancelled. This is not a payslip." : "Draft. Not issued until the pay run is marked as paid, so it cannot be used as proof of income."}</p>` : ""}
    <div class="foot"><span>${escapeHtml(run.runNumber)}${run.paymentReference ? ` · Payment ref ${escapeHtml(run.paymentReference)}` : ""}</span><span>Confidential. Generated by NoLSAF payroll.</span></div>
  </section>`;
}

export function payslipsHtml(run: PayslipRun, lines: PayslipLine[]) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://nolsaf.com";
  const logoUrl = new URL("/assets/NoLS2025-04.png", origin).toString();
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(`Payslips ${run.runNumber}`)}</title><style>${STYLES}</style></head><body>${lines.map((l) => sheet(run, l, logoUrl, origin)).join("")}</body></html>`;
}
