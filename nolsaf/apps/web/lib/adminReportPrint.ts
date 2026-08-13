import { escapeAttr, escapeHtml } from "@/utils/html";

export type AdminReportPrintOrientation = "portrait" | "landscape";

type ReportHeaderOptions = {
  logoUrl: string;
  eyebrow: string;
  title: string;
  description: string;
  reportId: string;
  reportRef: string;
  barcodeDataUrl?: string | null;
  from: string;
  to: string;
  generatedAt: string;
  preparedBy?: string;
  classification?: string;
};

type ReportFooterOptions = {
  reportRef: string;
  qrDataUrl?: string | null;
  purpose: string;
  signatureLabel?: string;
};

export function adminReportPrintStyles(orientation: AdminReportPrintOrientation) {
  return `
    :root {
      --ink: #17201e;
      --muted: #596662;
      --line: #dce4e1;
      --line-soft: #e9eeec;
      --brand: #073c35;
      --accent: #00785a;
      --soft: #f4f8f6;
      --good: #006b4f;
      --warn: #8a4b00;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      color: var(--ink);
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 9.5px;
      line-height: 1.45;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1, h2, h3, p { margin: 0; }
    .reportPage { width: 100%; padding: 18px; }
    .reportDocument { width: 100%; margin: 0 auto; }
    .reportCover { overflow: hidden; border: 1px solid #d6dfdc; border-radius: 8px; background: #fff; }
    .reportCoverTop { display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 34%); gap: 26px; padding: 18px 21px 16px; background: linear-gradient(180deg, #fff 0%, #fafcfb 100%); }
    .reportBrand { display: flex; min-width: 0; align-items: flex-start; gap: 12px; }
    .reportLogo { width: 42px; height: 42px; flex: none; object-fit: contain; }
    .reportBrandCopy { min-width: 0; }
    .reportEyebrow { color: var(--accent); font-size: 7.5px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; }
    .reportCover h1 { margin-top: 4px; font-size: 22px; line-height: 1.1; letter-spacing: -.45px; }
    .reportDescription { margin-top: 5px; max-width: 540px; color: var(--muted); font-size: 9px; }
    .reportReference { max-width: 310px; margin-top: 11px; padding-top: 8px; border-top: 1px solid #e0e6e4; }
    .reportReferenceHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .reportReferenceLabel { color: #51716a; font-size: 6.7px; font-weight: 900; letter-spacing: .75px; text-transform: uppercase; }
    .reportReferenceCode { color: var(--brand); font-family: Consolas, "Courier New", monospace; font-size: 7.5px; font-weight: 800; letter-spacing: .25px; white-space: nowrap; }
    .reportBarcode { display: block; width: 100%; height: 30px; margin-top: 4px; object-fit: fill; object-position: left center; background: #fff; }
    .reportMeta { min-width: 0; border-left: 1px solid var(--line); padding-left: 17px; }
    .reportMetaRow { display: flex; justify-content: space-between; gap: 14px; padding: 3px 0; }
    .reportMetaRow span { color: var(--muted); font-size: 7px; font-weight: 900; letter-spacing: .65px; text-transform: uppercase; }
    .reportMetaRow strong { color: #111816; font-size: 8px; text-align: right; overflow-wrap: anywhere; }
    .reportScope { display: grid; grid-template-columns: repeat(3, 1fr); background: #f5faf8; }
    .reportScope > div { padding: 10px 16px; border-right: 1px solid #dfeae6; }
    .reportScope > div:last-child { border-right: 0; }
    .reportScope span, .metricLabel { display: block; color: #56625e; font-size: 7px; font-weight: 900; letter-spacing: .65px; text-transform: uppercase; }
    .reportScope strong { display: block; margin-top: 3px; font-size: 9px; }
    .metricGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 12px; }
    .metricCard { min-height: 70px; padding: 11px 12px; border: 1px solid #e2e6e5; border-radius: 6px; background: #fafafa; break-inside: avoid; page-break-inside: avoid; }
    .metricCard strong { display: block; margin-top: 5px; font-size: 15px; line-height: 1.05; letter-spacing: -.25px; }
    .metricCard small { display: block; margin-top: 6px; color: #545d5a; font-size: 7.5px; line-height: 1.35; }
    .metricCardGood { border-color: #bcebd9; background: #ecfbf5; color: var(--good); }
    .metricCardWarn { border-color: #f3dfa5; background: #fffae9; color: var(--warn); }
    .reportSection { margin-top: 16px; page-break-inside: auto; }
    .sectionHead { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 8px; padding-bottom: 7px; border-bottom: 2px solid var(--brand); break-after: avoid; page-break-after: avoid; }
    .sectionNumber { display: grid; width: 22px; height: 22px; flex: none; place-items: center; border-radius: 5px; background: var(--brand); color: #fff; font-size: 8px; font-weight: 900; }
    .sectionHead h2 { font-size: 12px; line-height: 1.2; }
    .sectionHead p { margin-top: 2px; color: #505a57; font-size: 7.8px; }
    .panelGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: start; }
    .panelGridTwo { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .reportPanel { overflow: hidden; border: 1px solid #e2e7e5; border-radius: 6px; background: #fff; break-inside: avoid; page-break-inside: avoid; }
    .panelTitle { padding: 8px 10px; border-bottom: 1px solid var(--line-soft); background: #f5f7f6; font-size: 8px; font-weight: 900; }
    .panelBody { padding: 9px 10px; }
    .chartImage { display: block; width: 100%; height: auto; max-height: 205px; object-fit: contain; background: #fff; }
    .emptyState { padding: 14px; color: #7b8581; text-align: center; }
    .typeLine { display: flex; height: 10px; overflow: hidden; border: 1px solid #e2e7e5; border-radius: 999px; background: #f5f7f6; }
    .typeSeg { display: block; height: 100%; }
    .typeLegend { display: grid; gap: 5px; margin-top: 8px; }
    .typeItem { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; gap: 6px; align-items: center; font-size: 7.6px; }
    .typeItem .dot { width: 7px; height: 7px; border-radius: 2px; }
    .typeItem .name { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .typeItem .pct { color: var(--muted); }
    .typeItem .val { font-weight: 900; text-align: right; white-space: nowrap; }
    .tableWrap { overflow: hidden; border: 1px solid #e2e7e5; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    thead th { padding: 6px 7px; border-bottom: 0; background: #f0f3f2; color: #485652; font-size: 6.8px; font-weight: 900; letter-spacing: .45px; text-align: left; text-transform: uppercase; }
    tbody td { overflow-wrap: anywhere; padding: 6px 7px; border-top: 1px solid #e4e9e7; border-bottom: 0; color: #202624; vertical-align: top; font-size: 7.7px; }
    .details thead th, .details tbody td { padding: 6px 7px; font-size: 7.4px; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .num { font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; }
    .muted { color: var(--muted); }
    .status { display: inline-block; border-radius: 999px; padding: 2px 5px; background: #eaf8f3; color: var(--good); font-size: 6.5px; font-weight: 900; text-transform: uppercase; }
    .reportNote { margin-top: 8px; padding: 9px 11px; border-left: 3px solid #32d29a; background: #f1f8f6; color: #50605c; font-size: 7.7px; break-inside: avoid; page-break-inside: avoid; }
    .reportCertification { margin-top: 18px; padding-top: 12px; border-top: 2px solid var(--brand); break-inside: avoid; page-break-inside: avoid; }
    .certificationGrid { display: grid; grid-template-columns: 112px minmax(0, 1fr) 190px; gap: 14px; align-items: stretch; }
    .verificationCard { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 9px; border: 1px solid var(--line); border-radius: 6px; text-align: center; }
    .verificationCard img { display: block; width: 84px; height: 84px; padding: 3px; border: 1px solid #d7e2de; border-radius: 4px; }
    .verificationCard strong { margin-top: 5px; color: var(--brand); font-size: 6.8px; text-transform: uppercase; }
    .verificationCard code { margin-top: 3px; color: #49605a; font-size: 6px; overflow-wrap: anywhere; }
    .certificationCopy { padding: 11px 12px; border: 1px solid #e4dfc4; border-radius: 6px; background: #fffbed; color: #5f5739; font-size: 7.8px; line-height: 1.55; }
    .certificationCopy strong { display: block; margin-bottom: 4px; color: #574a17; font-size: 8.5px; }
    .signatureCard { display: flex; min-height: 112px; flex-direction: column; padding: 11px 12px; border: 1px solid var(--line); border-radius: 6px; }
    .signatureCard span { color: var(--brand); font-size: 7px; font-weight: 900; letter-spacing: .55px; text-transform: uppercase; }
    .signatureSpace { flex: 1; min-height: 54px; }
    .signatureLine { padding-top: 4px; border-top: 1px solid #8d9693; color: var(--muted); font-size: 7px; text-align: center; }
    .documentFooter { display: flex; justify-content: space-between; gap: 20px; margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--muted); font-size: 6.8px; }
    @media screen {
      body { background: #eef2f0; }
      .reportPage { max-width: ${orientation === "landscape" ? "1123px" : "794px"}; margin: 18px auto; background: #fff; box-shadow: 0 24px 70px rgba(7, 60, 53, .14); }
    }
    @page { size: A4 ${orientation}; margin: 9mm 10mm 11mm; }
    @media print {
      .reportPage { padding: 0; }
      .reportCover, .reportPanel, .tableWrap, .metricCard, .verificationCard, .certificationCopy, .signatureCard { border-radius: 0; }
    }
  `;
}

export function buildAdminReportHeader(options: ReportHeaderOptions) {
  const preparedBy = options.preparedBy || "NoLSAF Administration";
  const classification = options.classification || "Management use";
  return `
    <header class="reportCover">
      <div class="reportCoverTop">
        <div class="reportBrand">
          <img class="reportLogo" src="${escapeAttr(options.logoUrl)}" alt="NoLSAF" />
          <div class="reportBrandCopy">
            <p class="reportEyebrow">${escapeHtml(options.eyebrow)}</p>
            <h1>${escapeHtml(options.title)}</h1>
            <p class="reportDescription">${escapeHtml(options.description)}</p>
            <div class="reportReference">
              <div class="reportReferenceHead"><span class="reportReferenceLabel">Report reference</span><span class="reportReferenceCode">${escapeHtml(options.reportRef)}</span></div>
              ${options.barcodeDataUrl ? `<img class="reportBarcode" src="${escapeAttr(options.barcodeDataUrl)}" alt="Report reference barcode" />` : ""}
            </div>
          </div>
        </div>
        <div class="reportMeta">
          <div class="reportMetaRow"><span>Report period</span><strong>${escapeHtml(options.from)} to ${escapeHtml(options.to)}</strong></div>
          <div class="reportMetaRow"><span>Generated</span><strong>${escapeHtml(options.generatedAt)}</strong></div>
          <div class="reportMetaRow"><span>Prepared by</span><strong>${escapeHtml(preparedBy)}</strong></div>
          <div class="reportMetaRow"><span>Report ID</span><strong>${escapeHtml(options.reportId)}</strong></div>
          <div class="reportMetaRow"><span>Classification</span><strong>${escapeHtml(classification)}</strong></div>
        </div>
      </div>
      <div class="reportScope">
        <div><span>Entity</span><strong>NoLS Africa Co Ltd</strong></div>
        <div><span>Coverage</span><strong>All selected NoLSAF records</strong></div>
        <div><span>Control basis</span><strong>Recorded platform transactions and activity</strong></div>
      </div>
    </header>`;
}

export function buildAdminReportFooter(options: ReportFooterOptions) {
  return `
    <section class="reportCertification">
      <div class="sectionHead"><span class="sectionNumber">✓</span><div><h2>Verification and authorization</h2><p>Document authenticity, intended use, and management approval.</p></div></div>
      <div class="certificationGrid">
        ${options.qrDataUrl ? `<div class="verificationCard"><img src="${escapeAttr(options.qrDataUrl)}" alt="Scan to verify this report" /><strong>Scan to verify</strong><code>${escapeHtml(options.reportRef)}</code></div>` : `<div class="verificationCard"><strong>Reference</strong><code>${escapeHtml(options.reportRef)}</code></div>`}
        <div class="certificationCopy"><strong>Authenticity and confidentiality</strong>${escapeHtml(options.purpose)} The verification reference identifies the sealed report figures. This document is confidential and intended only for authorized NoLSAF management, finance, operations, audit, and compliance use.</div>
        <div class="signatureCard"><span>${escapeHtml(options.signatureLabel || "Authorized approval")}</span><div class="signatureSpace"></div><div class="signatureLine">Name, signature, and date</div></div>
      </div>
      <div class="documentFooter"><span>NoLSAF management reporting</span><span>${escapeHtml(options.reportRef)}</span></div>
    </section>`;
}

export function openAdminReportPrintWindow() {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return null;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><title>Preparing NoLSAF report</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#f4f8f6;color:#073c35;font:600 14px Arial,sans-serif}div{padding:18px 22px;border:1px solid #dce4e1;border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(7,60,53,.12)}</style></head><body><div>Preparing the verified report preview…</div></body></html>`);
  printWindow.document.close();
  return printWindow;
}

export async function printPreparedAdminReportWindow(printWindow: Window) {
  const images = Array.from(printWindow.document.images);
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }));
  await new Promise<void>((resolve) => printWindow.requestAnimationFrame(() => printWindow.requestAnimationFrame(() => resolve())));
  printWindow.focus();
  printWindow.print();
}

export async function renderAndPrintAdminReport(printWindow: Window, html: string) {
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  await printPreparedAdminReportWindow(printWindow);
}
