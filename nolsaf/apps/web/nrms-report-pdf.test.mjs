import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/(owner)/owner/nrms/reports/page.tsx", import.meta.url), "utf8");

test("NRMS PDF output remains native A4 vector output", () => {
  assert.doesNotMatch(source, /import\(["']html2pdf\.js["']\)/);
  assert.match(source, /setPrintMode\(true\)/);
  assert.match(source, /@page \{ size: A4 portrait;/);
  assert.match(source, /window\.print\(\)/);
  assert.match(source, /document\.title = `NRMS-/);
  assert.match(source, /"High-quality A4 PDF"/);
});
