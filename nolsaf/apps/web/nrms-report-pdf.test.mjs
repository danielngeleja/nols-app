import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/(owner)/owner/nrms/reports/page.tsx", import.meta.url), "utf8");

test("NRMS PDF output remains native A4 vector output", () => {
  assert.doesNotMatch(source, /import\(["']html2pdf\.js["']\)/);
  assert.match(source, /@page \{ size: A4 portrait;/);
  assert.match(source, /openAdminReportPrintWindow\(\)/);
  assert.match(source, /printPreparedAdminReportWindow\(printWindow\)/);
  assert.match(source, /printWindow\.document\.title = `NRMS-/);
  assert.match(source, /"High-quality A4 PDF"/);
});

test("NRMS PDF cannot hide or replace the live application body", () => {
  assert.doesNotMatch(source, /document\.body\.classList/);
  assert.doesNotMatch(source, /body\.nrms-printing/);
  assert.doesNotMatch(source, /> \*:not\(#nrms-print-root\)/);
  assert.doesNotMatch(source, /createPortal\([^\n]+document\.body/);
  assert.match(source, /createPortal\(reportNode, pdfPortalTarget\)/);
});

test("NRMS opens its dedicated preview before asynchronous report preparation", () => {
  const generatePdf = source.slice(source.indexOf("const generatePdf"), source.indexOf("return (", source.indexOf("const generatePdf")));
  assert.ok(generatePdf.indexOf("openAdminReportPrintWindow()") < generatePdf.indexOf("await "));
  assert.match(generatePdf, /if \(!printWindow\)/);
});
