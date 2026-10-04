// Shared printed-report template, extracted from the NRMS reports page so every
// NoLSAF PDF reads as one document family: the same A4 shell, the same cover
// block, metric tiles, numbered sections, tables and certification page.
//
// The CSS is emitted as a string rather than a stylesheet import because these
// documents are written into a fresh print window, which shares no styles with
// the app.

/** Width of the printable column, in CSS pixels, matching A4 at the page margins below. */
export const PDF_PAGE_WIDTH = 718;

/**
 * The print window's page shell: paper size, margins, and the on-screen
 * preview treatment before the print dialog opens.
 */
export function pdfShellCss(rootId: string): string {
  return `
    @page { size: A4 portrait; margin: 8mm 10mm 10mm 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: #fff; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #${rootId} { width: ${PDF_PAGE_WIDTH}px; margin: 0 auto; background: #fff; }
    #${rootId} .pdf-metric,
    #${rootId} .pdf-panel,
    #${rootId} .pdf-grid-2,
    #${rootId} .pdf-section-title,
    #${rootId} .pdf-certification-head,
    #${rootId} tr { break-inside: avoid; page-break-inside: avoid; }
    #${rootId} thead { display: table-header-group; }
    @media screen {
      body { padding: 18px; background: #eef2f0; }
      #${rootId} { box-shadow: 0 24px 70px rgba(7, 60, 53, .14); }
    }
    @media print {
      body { padding: 0; }
      #${rootId} { width: ${PDF_PAGE_WIDTH}px; margin: 0; box-shadow: none; }
    }
  `;
}

/**
 * The document stylesheet. `root` is the class on the report article, so the
 * same rules can be scoped to `.nrms-pdf`, `.agent-pdf` and so on.
 */
export function pdfDocumentCss(root: string): string {
  return `
    ${root} { box-sizing: border-box; width: ${PDF_PAGE_WIDTH}px; background: #fff; color: #171717; font-family: "Trebuchet MS", Arial, sans-serif; font-size: 10.5px; line-height: 1.5; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    ${root} * { box-sizing: border-box; }
    ${root} h1, ${root} h2, ${root} h3, ${root} p { margin: 0; }

    ${root} .pdf-cover { overflow: hidden; border: 1px solid #d6dfdc; border-radius: 7px; background: #fff; }
    ${root} .pdf-cover-top { display: grid; grid-template-columns: minmax(0, 1fr) 252px; align-items: start; gap: 28px; padding: 20px 24px 17px; background: linear-gradient(180deg, #ffffff 0%, #fafcfb 100%); color: #17201e; }
    ${root} .pdf-mark { display: flex; align-items: flex-start; gap: 12px; }
    ${root} .pdf-logo { display: grid; width: 40px; height: 40px; flex: none; place-items: center; border-radius: 6px; background: #073c35; color: #fff; font-size: 16px; font-weight: 900; }
    ${root} .pdf-mark-copy { min-width: 0; flex: 1; }
    ${root} .pdf-kicker { color: #00785a; font-size: 8px; font-weight: 800; letter-spacing: 1.7px; text-transform: uppercase; }
    ${root} .pdf-cover h1 { margin-top: 4px; font-size: 24px; line-height: 1.12; letter-spacing: -.5px; }
    ${root} .pdf-property { margin-top: 5px !important; color: #59635f; font-size: 11px; }
    ${root} .pdf-report-meta { min-width: 0; border-left: 1px solid #dce3e0; padding-left: 18px; }
    ${root} .pdf-report-meta div { display: flex; justify-content: space-between; gap: 14px; padding: 3px 0; }
    ${root} .pdf-report-meta span { color: #596662; font-size: 7.8px; font-weight: 800; letter-spacing: .7px; text-transform: uppercase; }
    ${root} .pdf-report-meta strong { color: #111816; font-size: 8.8px; font-weight: 800; text-align: right; }
    ${root} .pdf-header-barcode { width: 310px; max-width: 100%; margin-top: 13px; padding-top: 9px; border-top: 1px solid #e0e6e4; }
    ${root} .pdf-barcode-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    ${root} .pdf-barcode-label { color: #51716a; font-size: 7px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; }
    ${root} .pdf-barcode { display: block; width: 310px; max-width: 100%; height: 32px; margin-top: 5px; object-fit: fill; object-position: left center; background: #fff; }
    ${root} .pdf-report-number { color: #073c35; font-family: Consolas, "Courier New", monospace; font-size: 8px; font-weight: 800; letter-spacing: .35px; white-space: nowrap; }
    ${root} .pdf-scope { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; background: #f5faf8; }
    ${root} .pdf-scope div { padding: 12px 18px; border-right: 1px solid #dfeae6; }
    ${root} .pdf-scope div:last-child { border-right: 0; }
    ${root} .pdf-scope span, ${root} .pdf-metric p { display: block; color: #56625e; font-size: 8px; font-weight: 800; letter-spacing: .7px; text-transform: uppercase; }
    ${root} .pdf-scope strong { display: block; margin-top: 3px; font-size: 11px; }

    ${root} .pdf-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
    ${root} .pdf-metric { min-height: 82px; padding: 13px 14px; border: 1px solid #e2e6e5; border-radius: 6px; background: #fafafa; page-break-inside: avoid; }
    ${root} .pdf-metric strong { display: block; margin-top: 7px; font-size: 17px; line-height: 1; letter-spacing: -.3px; }
    ${root} .pdf-metric small { display: block; margin-top: 8px; color: #545d5a; font-size: 8.5px; }
    ${root} .pdf-metric-green { border-color: #bcebd9; background: #ecfbf5; color: #006b4f; }
    ${root} .pdf-metric-amber { border-color: #f3dfa5; background: #fffae9; color: #8a4b00; }

    ${root} .pdf-section { margin-top: 18px; page-break-inside: auto; }
    ${root} .pdf-section-title { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 9px; padding-bottom: 8px; border-bottom: 2px solid #073c35; page-break-after: avoid; }
    ${root} .pdf-section-title > span { display: grid; width: 24px; height: 24px; flex: none; place-items: center; border-radius: 5px; background: #073c35; color: #fff; font-size: 9px; font-weight: 800; }
    ${root} .pdf-section-title h2 { font-size: 13px; line-height: 1.2; }
    ${root} .pdf-section-title p { margin-top: 2px; color: #505a57; font-size: 8.7px; }

    ${root} .pdf-grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; align-items: start; break-inside: avoid; page-break-inside: avoid; }
    ${root} .pdf-panel { overflow: hidden; border: 1px solid #e4e7e6; border-radius: 6px; page-break-inside: avoid; }
    ${root} .pdf-panel h3 { margin: 0; padding: 9px 11px; background: #f5f7f6; font-size: 10px; }
    ${root} .pdf-list-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 8px 11px; border-top: 1px solid #edf0ef; }
    ${root} .pdf-list-row:first-of-type { border-top: 0; }
    ${root} .pdf-list-row span { color: #555; }
    ${root} .pdf-list-row strong { text-align: right; }
    ${root} .pdf-list-row small { display: block; color: #68716e; font-size: 7.5px; }

    ${root} .pdf-table-wrap { overflow: hidden; border: 1px solid #e4e7e6; border-radius: 5px; }
    ${root} .pdf-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    ${root} .pdf-table thead { display: table-header-group; }
    ${root} .pdf-table th { padding: 7px 8px; background: #f0f3f2; color: #485652; font-size: 7.4px; font-weight: 800; letter-spacing: .55px; text-align: left; text-transform: uppercase; }
    ${root} .pdf-table td { overflow-wrap: anywhere; padding: 7px 8px; border-top: 1px solid #e4e9e7; color: #202624; vertical-align: top; font-size: 8.5px; }
    ${root} .pdf-table tr { page-break-inside: avoid; }
    ${root} .pdf-table .num { text-align: right; font-weight: 700; }
    ${root} .pdf-table .muted { color: #59635f; }
    ${root} .pdf-empty { padding: 16px !important; color: #888; text-align: center; }

    ${root} .pdf-status { display: inline-block; border-radius: 999px; padding: 2px 6px; background: #eaf8f3; color: #00785a; font-size: 7px; font-weight: 800; text-transform: uppercase; }
    ${root} .pdf-status-warn { background: #fff3cd; color: #8a4b00; }
    ${root} .pdf-status-danger { background: #ffe7e7; color: #ad1f1f; }
    ${root} .pdf-note { margin-top: 14px; padding: 11px 13px; border-left: 3px solid #32d29a; border-radius: 0 4px 4px 0; background: #f1f8f6; color: #50605c; font-size: 8.3px; page-break-inside: avoid; }

    ${root} .pdf-bar-row { padding: 8px 11px; border-top: 1px solid #edf0ef; }
    ${root} .pdf-bar-row:first-of-type { border-top: 0; }
    ${root} .pdf-bar-head { display: flex; align-items: baseline; gap: 8px; }
    ${root} .pdf-bar-head i { display: block; width: 8px; height: 8px; flex: none; border-radius: 2px; }
    ${root} .pdf-bar-head span { flex: 1; min-width: 0; color: #3d4643; font-size: 8.5px; font-weight: 700; }
    ${root} .pdf-bar-head b { color: #56615d; font-size: 8px; font-weight: 800; }
    ${root} .pdf-bar-head strong { font-size: 8.5px; }
    ${root} .pdf-bar-track { height: 5px; margin-top: 5px; border-radius: 999px; background: #eef1f0; }
    ${root} .pdf-bar-track i { display: block; height: 100%; border-radius: 999px; }

    ${root} .pdf-certification { display: flex; flex-direction: column; page-break-before: always; }
    ${root} .pdf-certification-head { padding: 18px 0 12px; border-bottom: 2px solid #073c35; background: #fff; color: #17201e; break-inside: avoid; page-break-inside: avoid; page-break-after: avoid; }
    ${root} .pdf-certification-head p { color: #00785a; font-size: 8px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; }
    ${root} .pdf-certification-head h2 { margin-top: 5px; font-size: 21px; }
    ${root} .pdf-certification-body { padding: 22px 0; }
    ${root} .pdf-disclaimer-row { display: grid; grid-template-columns: minmax(0, 1fr) 148px; gap: 12px; align-items: stretch; }
    ${root} .pdf-disclaimer { padding: 14px 16px; border: 1px solid #e4dfc4; border-radius: 6px; background: #fffbed; color: #5f5739; font-size: 8.8px; line-height: 1.6; }
    ${root} .pdf-disclaimer h3 { margin: 0 0 5px; color: #574a17; font-size: 10px; }
    ${root} .pdf-verification-card { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 11px; border: 1px solid #dce5e2; border-radius: 6px; background: #fff; text-align: center; }
    ${root} .pdf-qr { display: block; width: 84px; height: 84px; padding: 3px; border: 1px solid #d7e2de; border-radius: 4px; background: #fff; }
    ${root} .pdf-verification-card strong { margin-top: 7px; color: #073c35; font-size: 8px; text-transform: uppercase; }
    ${root} .pdf-verification-card p { margin-top: 3px; color: #6f7c78; font-size: 7px; line-height: 1.35; }
    ${root} .pdf-verification-ref { margin-top: 5px !important; overflow-wrap: anywhere; color: #49605a !important; font-family: Consolas, "Courier New", monospace; font-size: 6.5px !important; font-weight: 700; }
    ${root} .pdf-cert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
    ${root} .pdf-cert-card { padding: 13px 14px; border: 1px solid #e1e6e4; border-radius: 6px; background: #fafbfb; }
    ${root} .pdf-cert-card span { display: block; color: #75807d; font-size: 7px; font-weight: 800; letter-spacing: .65px; text-transform: uppercase; }
    ${root} .pdf-cert-card strong { display: block; margin-top: 4px; color: #16211e; font-size: 9.5px; }
    ${root} .pdf-signature-title { margin-top: 24px; font-size: 12px; }
    ${root} .pdf-signature-note { margin-top: 3px !important; color: #777; font-size: 8px; }
    ${root} .pdf-signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 17px; }
    ${root} .pdf-signature { min-height: 150px; padding: 13px; border: 1px solid #dfe4e2; border-radius: 6px; page-break-inside: avoid; }
    ${root} .pdf-signature h3 { margin: 0; color: #073c35; font-size: 10px; }
    ${root} .pdf-signature-line { height: 29px; margin-top: 15px; border-bottom: 1px solid #8d9693; }
    ${root} .pdf-signature-label { margin-top: 3px !important; color: #8b9290; font-size: 7px; }
    ${root} .pdf-footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 18px; padding-top: 10px; border-top: 1px solid #dfe4e2; color: #56615d; font-size: 7.5px; }
  `;
}

/** Full standalone document for a print window. */
export function buildPdfDocument(options: {
  title: string;
  rootId: string;
  rootClass: string;
  bodyHtml: string;
}): string {
  const { title, rootId, rootClass, bodyHtml } = options;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${pdfShellCss(rootId)}${pdfDocumentCss(`.${rootClass}`)}</style>
</head>
<body><div id="${rootId}"><article class="${rootClass}">${bodyHtml}</article></div></body>
</html>`;
}
