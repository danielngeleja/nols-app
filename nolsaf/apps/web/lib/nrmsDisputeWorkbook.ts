/**
 * NRMS dispute evidence workbook.
 *
 * Built in the browser with ExcelJS, in the same house style as the NRMS property report
 * (lib/nrmsReportWorkbook.ts): a Cover with the property as hero and headline cards, then one
 * self-describing schedule per record type with a brand masthead, colour-coded column groups,
 * frozen headers, autofilter and a dark footing band, then a Basis and Coverage sheet. Every
 * sheet is locked read-only because every figure comes from NRMS records, not typing.
 */

export type DisputeReport = {
  documentNumber: string;
  exportId: number;
  generatedAt: string;
  generatedBy: string;
  property: { id: number; title: string; location: string | null };
  from: string;
  to: string;
  periodDays: number;
  reason: string;
  orders: Array<{ orderNumber: string; outlet: string; status: string; itemCount: number; items: string; currency: string; total: number; createdAt: string }>;
  reservations: Array<{ reference: string; source: string; status: string; currency: string; total: number; charges: number; paid: number; checkIn: string | null; checkOut: string | null; createdAt: string }>;
  statements: Array<{ reference: string; status: string; usageEvents: number; currency: string; amount: number; createdAt: string }>;
};

/* Brand palette, ARGB (same values as the property report). */
const FONT = "Trebuchet MS";
const TEAL = "FF073C35";
const TEAL_MID = "FF0F766E";
const TEAL_LIGHT = "FFE8F1EF";
const TEAL_PALE = "FFF4F9F8";
const INK = "FF111816";
const INK_SOFT = "FF56625E";
const RULE = "FFD6DFDC";
const WHITE = "FFFFFFFF";
const POSITIVE = "FF176249";
const NEGATIVE = "FFB42318";
const AMBER = "FF8A4B00";
const TOTALS_BAND = "FF0B1F1C";
const WORKBOOK_PASSWORD = "NRMS-REPORT";

const GROUP_COLOURS = { identity: "FF073C35", revenue: "FF1B7F4B", deduction: "FFB42318", control: "FF1E6084", volume: "FF6756A5", timing: "FF8A4B00" } as const;
const TONE_FILLS = { identity: "FFF4F9F8", revenue: "FFEFF8F2", deduction: "FFFDF2F2", control: "FFF1F6FC", volume: "FFF5F3FB", timing: "FFFDF7EF" } as const;
type ColumnGroup = keyof typeof GROUP_COLOURS;

const CURRENCY_FORMAT = "#,##0.00";
const INTEGER_FORMAT = "#,##0";
const DATETIME_FORMAT = "dd mmm yyyy hh:mm";
const DATE_FORMAT = "dd mmm yyyy";

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sheet = any;

/** Excel serials carry no zone; shift so the displayed wall clock is East Africa Time everywhere. */
function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getTime() + EAT_OFFSET_MS);
}

function eatText(value: string, withTime = false): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).replace("Sept", "Sep");
}

function label(value: string | null | undefined): string {
  const upper = String(value || "").toUpperCase();
  if (upper === "NOLSAF") return "NoLSAF";
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return Number(rows.reduce((n, row) => n + (Number(pick(row)) || 0), 0).toFixed(2));
}

/** Currency with the most money in it: the workbook reports in one currency, like the property report. */
function primaryCurrency(report: DisputeReport): string {
  const totals = new Map<string, number>();
  const add = (cur: string, v: number) => totals.set(cur || "TZS", (totals.get(cur || "TZS") || 0) + Math.abs(v));
  report.orders.forEach((o) => add(o.currency, o.total));
  report.reservations.forEach((r) => add(r.currency, r.total));
  report.statements.forEach((s) => add(s.currency, s.amount));
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "TZS";
}

function fillRange(sheet: Sheet, top: number, left: number, bottom: number, right: number, argb: string) {
  for (let row = top; row <= bottom; row += 1) for (let col = left; col <= right; col += 1) sheet.getCell(row, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function boxRange(sheet: Sheet, top: number, left: number, bottom: number, right: number, argb: string) {
  const edge = { style: "thin" as const, color: { argb } };
  for (let row = top; row <= bottom; row += 1) {
    for (let col = left; col <= right; col += 1) {
      const cell = sheet.getCell(row, col);
      cell.border = {
        ...cell.border,
        top: row === top ? edge : cell.border?.top,
        bottom: row === bottom ? edge : cell.border?.bottom,
        left: col === left ? edge : cell.border?.left,
        right: col === right ? edge : cell.border?.right,
      };
    }
  }
}

/** Brand masthead + provenance strip, repeated on every sheet so a tab stands on its own. */
function sheetHeading(sheet: Sheet, report: DisputeReport, currency: string, title: string, subtitle: string, columns: number) {
  const span = Math.max(5, columns);
  sheet.mergeCells(1, 1, 1, span);
  const t = sheet.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 18, bold: true, color: { argb: WHITE } };
  t.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(2, 1, 2, span);
  const s = sheet.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 10, color: { argb: "FFBCEBD9" } };
  s.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(2).height = 20;
  fillRange(sheet, 1, 1, 2, span, TEAL);

  sheet.mergeCells(3, 1, 3, span);
  const p = sheet.getCell(3, 1);
  p.value = `${report.property.title}   |   ${eatText(report.from)} to ${eatText(report.to)}   |   ${currency} (ISO 4217)   |   ${report.documentNumber}   |   Confidential`;
  p.font = { name: FONT, size: 9, bold: true, color: { argb: TEAL } };
  p.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(3).height = 20;
  for (let col = 1; col <= span; col += 1) {
    sheet.getCell(3, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_LIGHT } };
    sheet.getCell(3, col).border = { bottom: { style: "thin", color: { argb: TEAL_MID } } };
  }
  sheet.getRow(4).height = 9;
  sheet.views = [{ showGridLines: false }];
}

type ColumnSpec<Row> = {
  header: string;
  group: ColumnGroup;
  value: (row: Row) => string | number | Date | null;
  format?: string;
  width?: number;
  total?: boolean;
  tone?: (row: Row) => "positive" | "negative" | "amber" | undefined;
};

const CELL_BORDER = {
  top: { style: "hair" as const, color: { argb: RULE } },
  bottom: { style: "hair" as const, color: { argb: RULE } },
  left: { style: "hair" as const, color: { argb: RULE } },
  right: { style: "hair" as const, color: { argb: RULE } },
};

function addTableSheet<Row>(
  workbook: Sheet,
  report: DisputeReport,
  currency: string,
  options: { name: string; title: string; subtitle: string; rows: Row[]; columns: Array<ColumnSpec<Row>>; emptyNote: string; tab: string },
) {
  const sheet = workbook.addWorksheet(options.name, { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.properties.tabColor = { argb: options.tab };
  sheetHeading(sheet, report, currency, options.title, options.subtitle, options.columns.length);

  // Group band: merged, colour-coded runs above the headers.
  const groupRow = 5;
  const headerRow = 6;
  sheet.getRow(groupRow).height = 22;
  let start = 0;
  while (start < options.columns.length) {
    let end = start;
    while (end + 1 < options.columns.length && options.columns[end + 1]!.group === options.columns[start]!.group) end += 1;
    const group = options.columns[start]!.group;
    if (end > start) sheet.mergeCells(groupRow, start + 1, groupRow, end + 1);
    const cell = sheet.getCell(groupRow, start + 1);
    cell.value = group.toUpperCase();
    cell.font = { name: FONT, bold: true, size: 9, color: { argb: WHITE } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    for (let col = start; col <= end; col += 1) {
      sheet.getCell(groupRow, col + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_COLOURS[group] } };
      sheet.getCell(groupRow, col + 1).border = { right: { style: "thin", color: { argb: WHITE } } };
    }
    start = end + 1;
  }

  // Header band
  const header = sheet.getRow(headerRow);
  header.values = options.columns.map((c) => c.header);
  header.height = 30;
  options.columns.forEach((column, i) => {
    const cell = header.getCell(i + 1);
    cell.font = { name: FONT, bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle", horizontal: column.format ? "right" : "left", wrapText: true, indent: 1 };
    cell.border = { bottom: { style: "medium", color: { argb: TEAL_MID } } };
  });
  sheet.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: options.columns.length } };

  if (!options.rows.length) {
    const note = sheet.getCell(headerRow + 1, 1);
    note.value = options.emptyNote;
    note.font = { name: FONT, italic: true, color: { argb: "FF6F7C78" } };
  }

  options.rows.forEach((row, index) => {
    const target = sheet.getRow(headerRow + 1 + index);
    target.height = 19;
    options.columns.forEach((column, i) => {
      const cell = target.getCell(i + 1);
      const value = column.value(row);
      cell.value = value;
      if (column.format) cell.numFmt = column.format;
      const tone = column.tone?.(row);
      cell.font = { name: FONT, size: 10, bold: Boolean(tone), color: { argb: tone === "positive" ? POSITIVE : tone === "negative" ? NEGATIVE : tone === "amber" ? AMBER : INK } };
      cell.alignment = { vertical: "middle", horizontal: typeof value === "number" || value instanceof Date ? "right" : "left", indent: 1 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILLS[column.group] } };
      cell.border = CELL_BORDER;
    });
  });

  // Dark footing band
  if (options.rows.length && options.columns.some((c) => c.total)) {
    const totalRow = sheet.getRow(headerRow + 1 + options.rows.length);
    totalRow.height = 24;
    options.columns.forEach((column, i) => {
      const cell = totalRow.getCell(i + 1);
      if (i === 0) cell.value = `TOTAL (${options.rows.length} ${options.rows.length === 1 ? "record" : "records"})`;
      else if (column.total) {
        cell.value = sumBy(options.rows, (row) => {
          const v = column.value(row);
          return typeof v === "number" ? v : 0;
        });
        cell.numFmt = column.format ?? CURRENCY_FORMAT;
      }
      cell.font = { name: FONT, bold: true, size: 10, color: { argb: WHITE } };
      cell.alignment = { vertical: "middle", horizontal: column.total ? "right" : "left", indent: 1 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTALS_BAND } };
      cell.border = { top: { style: "medium", color: { argb: TOTALS_BAND } } };
    });
  }

  // Widths from content (Excel cannot auto-fit on write), then explicit overrides.
  sheet.columns.forEach((col: Sheet, i: number) => {
    let widest = 10;
    col.eachCell?.({ includeEmpty: false }, (cell: Sheet, rowNumber: number) => {
      if (rowNumber < headerRow) return;
      const v = cell.value;
      const len = v instanceof Date ? 17 : typeof v === "number" ? String(Math.round(v)).length + 5 : String(v ?? "").length;
      if (len > widest) widest = len;
    });
    col.width = options.columns[i]?.width ?? Math.min(46, Math.max(11, widest + 3));
  });

  return sheet;
}

type KeyValue = { label: string; value: string | number | Date | null; format?: string; total?: boolean; tone?: "positive" | "negative" | "amber" };

function addKeyValues(sheet: Sheet, startRow: number, title: string, entries: KeyValue[], span = 3): number {
  sheet.getRow(startRow).height = 24;
  sheet.mergeCells(startRow, 1, startRow, span);
  const heading = sheet.getCell(startRow, 1);
  heading.value = title.toUpperCase();
  heading.font = { name: FONT, bold: true, size: 10, color: { argb: WHITE } };
  heading.alignment = { vertical: "middle", indent: 1 };
  fillRange(sheet, startRow, 1, startRow, span, TEAL_MID);

  entries.forEach((entry, index) => {
    const rowNumber = startRow + 1 + index;
    const row = sheet.getRow(rowNumber);
    row.height = String(entry.value ?? "").length > 70 ? 34 : 19;
    const l = row.getCell(1);
    l.value = entry.label;
    l.font = { name: FONT, size: 10, bold: Boolean(entry.total), color: { argb: entry.total ? INK : INK_SOFT } };
    l.alignment = { vertical: "middle", indent: 1 };
    if (span > 2) sheet.mergeCells(rowNumber, 2, rowNumber, span);
    const v = row.getCell(2);
    v.value = entry.value;
    if (entry.format) v.numFmt = entry.format;
    const tone = entry.tone === "positive" ? POSITIVE : entry.tone === "negative" ? NEGATIVE : entry.tone === "amber" ? AMBER : INK;
    v.font = { name: FONT, size: entry.total ? 11 : 10, bold: true, color: { argb: tone } };
    v.alignment = { vertical: "middle", wrapText: true, horizontal: typeof entry.value === "number" ? "right" : "left", indent: 1 };
    const fill = entry.total ? TEAL_LIGHT : index % 2 === 1 ? TEAL_PALE : WHITE;
    for (let col = 1; col <= span; col += 1) {
      const cell = sheet.getCell(rowNumber, col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.border = {
        top: entry.total ? { style: "thin", color: { argb: TEAL_MID } } : undefined,
        bottom: { style: "hair", color: { argb: RULE } },
        left: col === 1 ? { style: "thin", color: { argb: RULE } } : undefined,
        right: col === span ? { style: "thin", color: { argb: RULE } } : undefined,
      };
    }
  });
  const last = startRow + entries.length;
  for (let col = 1; col <= span; col += 1) {
    const cell = sheet.getCell(last, col);
    cell.border = { ...cell.border, bottom: { style: "thin", color: { argb: RULE } } };
  }
  return last + 2;
}

const COVER_FIRST = 2;
const COVER_LAST = 9;

function addCoverSheet(workbook: Sheet, report: DisputeReport, currency: string) {
  const sheet = workbook.addWorksheet("Cover", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0, footer: 0 } } });
  sheet.properties.tabColor = { argb: TEAL };
  sheet.views = [{ showGridLines: false }];
  sheet.getColumn(1).width = 2.5;
  for (let col = COVER_FIRST; col <= COVER_LAST; col += 1) sheet.getColumn(col).width = 13.6;

  sheet.getRow(1).height = 42;
  sheet.mergeCells(1, COVER_FIRST, 1, COVER_LAST);
  const hero = sheet.getCell(1, COVER_FIRST);
  hero.value = report.property.title;
  hero.font = { name: FONT, size: 26, bold: true, color: { argb: INK } };
  hero.alignment = { vertical: "middle" };

  sheet.getRow(2).height = 24;
  sheet.mergeCells(2, COVER_FIRST, 2, COVER_LAST);
  const sub = sheet.getCell(2, COVER_FIRST);
  sub.value = "Dispute evidence report";
  sub.font = { name: FONT, size: 14, bold: true, color: { argb: TEAL_MID } };
  sub.alignment = { vertical: "middle" };

  sheet.getRow(3).height = 20;
  sheet.mergeCells(3, COVER_FIRST, 3, COVER_LAST);
  const meta = sheet.getCell(3, COVER_FIRST);
  meta.value = `${eatText(report.from)} to ${eatText(report.to)}   ·   ${report.periodDays} ${report.periodDays === 1 ? "day" : "days"}   ·   ${currency} (ISO 4217)   ·   All times EAT (UTC+3)`;
  meta.font = { name: FONT, size: 10, color: { argb: INK_SOFT } };
  meta.alignment = { vertical: "middle" };

  sheet.getRow(4).height = 3;
  fillRange(sheet, 4, COVER_FIRST, 4, COVER_LAST, TEAL_MID);
  sheet.getRow(5).height = 16;

  const inCur = <T extends { currency: string }>(rows: T[]) => rows.filter((r) => (r.currency || "TZS") === currency);
  const stays = inCur(report.reservations);
  const outstanding = sumBy(stays, (r) => r.total - r.paid);
  const cards = [
    { label: "Outlet orders", value: sumBy(inCur(report.orders), (o) => o.total), note: `${report.orders.length} ${report.orders.length === 1 ? "order" : "orders"} in the period`, tint: TONE_FILLS.revenue, ink: POSITIVE },
    { label: "Reservations", value: sumBy(stays, (r) => r.total), note: `${report.reservations.length} ${report.reservations.length === 1 ? "stay" : "stays"}, folios included`, tint: TONE_FILLS.identity, ink: TEAL },
    { label: "Outstanding on stays", value: outstanding, note: `Paid ${sumBy(stays, (r) => r.paid).toLocaleString("en-US")}`, tint: outstanding > 0 ? TONE_FILLS.deduction : TONE_FILLS.control, ink: outstanding > 0 ? NEGATIVE : "FF1E6084" },
    { label: "PAYG statements", value: sumBy(inCur(report.statements), (s) => s.amount), note: `${report.statements.length} ${report.statements.length === 1 ? "statement" : "statements"} issued`, tint: TONE_FILLS.volume, ink: "FF55378F" },
  ];

  const cardTop = 6;
  sheet.getRow(cardTop).height = 18;
  sheet.getRow(cardTop + 1).height = 30;
  sheet.getRow(cardTop + 2).height = 18;
  cards.forEach((card, index) => {
    const left = COVER_FIRST + index * 2;
    const right = left + 1;
    fillRange(sheet, cardTop, left, cardTop + 2, right, card.tint);
    boxRange(sheet, cardTop, left, cardTop + 2, right, RULE);
    sheet.mergeCells(cardTop, left, cardTop, right);
    const l = sheet.getCell(cardTop, left);
    l.value = card.label.toUpperCase();
    l.font = { name: FONT, size: 8, bold: true, color: { argb: INK_SOFT } };
    l.alignment = { vertical: "middle", indent: 1 };
    sheet.mergeCells(cardTop + 1, left, cardTop + 1, right);
    const v = sheet.getCell(cardTop + 1, left);
    v.value = card.value;
    v.numFmt = CURRENCY_FORMAT;
    v.font = { name: FONT, size: 16, bold: true, color: { argb: card.ink } };
    v.alignment = { vertical: "middle", indent: 1 };
    sheet.mergeCells(cardTop + 2, left, cardTop + 2, right);
    const n = sheet.getCell(cardTop + 2, left);
    n.value = card.note;
    n.font = { name: FONT, size: 8, color: { argb: INK_SOFT } };
    n.alignment = { vertical: "middle", indent: 1 };
  });

  const stripTop = cardTop + 4;
  sheet.getRow(stripTop).height = 22;
  sheet.mergeCells(stripTop, COVER_FIRST, stripTop, COVER_LAST);
  const band = sheet.getCell(stripTop, COVER_FIRST);
  band.value = "REPORT IDENTITY";
  band.font = { name: FONT, size: 10, bold: true, color: { argb: WHITE } };
  band.alignment = { vertical: "middle", indent: 1 };
  fillRange(sheet, stripTop, COVER_FIRST, stripTop, COVER_LAST, TEAL_MID);

  const pairs: Array<[string, string]> = [
    ["Document number", report.documentNumber],
    ["Property identifier", `NRMS ${report.property.id}`],
    ["Generated at (EAT)", eatText(report.generatedAt, true)],
    ["Generated by", report.generatedBy],
    ["Audit export", `#${report.exportId}`],
    ["Classification", "Confidential dispute evidence"],
    ["Guest identifiers", "Redacted"],
    ["Owner notified", "Yes, automatically"],
  ];
  pairs.forEach(([name, value], index) => {
    const rowNumber = stripTop + 1 + Math.floor(index / 2);
    const half = index % 2;
    const labelCol = COVER_FIRST + half * 4;
    sheet.getRow(rowNumber).height = 20;
    const l = sheet.getCell(rowNumber, labelCol);
    l.value = name;
    l.font = { name: FONT, size: 9, color: { argb: INK_SOFT } };
    l.alignment = { vertical: "middle", indent: 1 };
    sheet.mergeCells(rowNumber, labelCol + 1, rowNumber, labelCol + 3);
    const v = sheet.getCell(rowNumber, labelCol + 1);
    v.value = value;
    v.font = { name: FONT, size: 9, bold: true, color: { argb: INK } };
    v.alignment = { vertical: "middle", indent: 1 };
    if (half === 1) fillRange(sheet, rowNumber, COVER_FIRST, rowNumber, COVER_LAST, Math.floor(index / 2) % 2 === 1 ? TEAL_PALE : WHITE);
  });
  let row = stripTop + Math.ceil(pairs.length / 2) + 1;

  // Purpose gets its own full-width line: it is the reason the file exists.
  sheet.getRow(row).height = 34;
  const pl = sheet.getCell(row, COVER_FIRST);
  pl.value = "Purpose";
  pl.font = { name: FONT, size: 9, color: { argb: INK_SOFT } };
  pl.alignment = { vertical: "middle", indent: 1 };
  sheet.mergeCells(row, COVER_FIRST + 1, row, COVER_LAST);
  const pv = sheet.getCell(row, COVER_FIRST + 1);
  pv.value = report.reason;
  pv.font = { name: FONT, size: 9, bold: true, color: { argb: INK } };
  pv.alignment = { vertical: "middle", wrapText: true, indent: 1 };
  fillRange(sheet, row, COVER_FIRST, row, COVER_LAST, TEAL_PALE);
  boxRange(sheet, stripTop, COVER_FIRST, row, COVER_LAST, RULE);

  row += 2;
  sheet.getRow(row).height = 42;
  sheet.mergeCells(row, COVER_FIRST, row, COVER_LAST);
  const foot = sheet.getCell(row, COVER_FIRST);
  foot.value = "This workbook is evidence prepared for a dispute review. Figures are read directly from the NRMS operational ledger at the time of generation, and the export was logged in the NoLSAF admin audit trail with the purpose stated above. It is not a tax invoice or audited financial statement.";
  foot.font = { name: FONT, size: 8, color: { argb: INK_SOFT } };
  foot.alignment = { vertical: "top", wrapText: true, indent: 1 };
  fillRange(sheet, row, COVER_FIRST, row, COVER_LAST, TEAL_PALE);
  boxRange(sheet, row, COVER_FIRST, row, COVER_LAST, RULE);

  row += 2;
  sheet.getRow(row).height = 32;
  sheet.mergeCells(row, COVER_FIRST, row, COVER_LAST);
  const legend = sheet.getCell(row, COVER_FIRST);
  legend.value = "Every sheet in this workbook is locked (read-only) because every figure comes from NRMS records, not typing. Selecting, copying, sorting and filtering stay available.";
  legend.font = { name: FONT, size: 8, italic: true, color: { argb: INK_SOFT } };
  legend.alignment = { vertical: "top", wrapText: true, indent: 1 };
}

export async function buildDisputeWorkbook(report: DisputeReport): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const currency = primaryCurrency(report);
  const created = new Date(report.generatedAt);
  workbook.creator = report.generatedBy;
  workbook.lastModifiedBy = report.generatedBy;
  workbook.created = Number.isNaN(created.getTime()) ? new Date() : created;
  workbook.modified = workbook.created;
  workbook.title = `${report.property.title} dispute evidence report`;
  workbook.subject = `NRMS dispute evidence ${report.documentNumber}`;
  workbook.company = "NoLSAF NRMS";
  workbook.keywords = `NRMS,dispute,${report.documentNumber}`;

  addCoverSheet(workbook, report, currency);

  /* Outlet orders */
  addTableSheet(workbook, report, currency, {
    name: "Outlet Orders",
    tab: "FF0EA5A0",
    title: "Schedule: outlet orders",
    subtitle: "Every bar, restaurant and outlet order created in the reporting period",
    rows: report.orders,
    emptyNote: "No outlet orders were created in this period.",
    columns: [
      { header: "Ordered (EAT)", group: "identity", value: (o) => asDate(o.createdAt), format: DATETIME_FORMAT, width: 20 },
      { header: "Order number", group: "identity", value: (o) => o.orderNumber, width: 22 },
      { header: "Outlet", group: "control", value: (o) => o.outlet, width: 22 },
      { header: "Status", group: "control", value: (o) => label(o.status), width: 18, tone: (o) => (o.status === "CANCELLED" || o.status === "VOIDED" ? "negative" : undefined) },
      { header: "Items", group: "volume", value: (o) => o.itemCount, format: INTEGER_FORMAT, total: true, width: 10 },
      { header: "Item detail", group: "volume", value: (o) => o.items || "Not recorded", width: 44 },
      { header: "Currency", group: "revenue", value: (o) => o.currency, width: 11 },
      { header: "Amount", group: "revenue", value: (o) => o.total, format: CURRENCY_FORMAT, total: true, width: 16 },
    ],
  });

  /* Reservations */
  const nights = (r: DisputeReport["reservations"][number]) =>
    r.checkIn && r.checkOut ? Math.max(0, Math.round((new Date(r.checkOut).getTime() - new Date(r.checkIn).getTime()) / 86400000)) : null;
  addTableSheet(workbook, report, currency, {
    name: "Reservations and Folios",
    tab: "FF38BDF8",
    title: "Schedule: reservations and folios",
    subtitle: "Stays created in the period with folio totals and collections. Guest identity redacted",
    rows: report.reservations,
    emptyNote: "No reservations were created in this period.",
    columns: [
      { header: "Reference", group: "identity", value: (r) => r.reference, width: 18 },
      { header: "Created (EAT)", group: "identity", value: (r) => asDate(r.createdAt), format: DATE_FORMAT, width: 15 },
      { header: "Check-in", group: "timing", value: (r) => asDate(r.checkIn), format: DATE_FORMAT, width: 14 },
      { header: "Check-out", group: "timing", value: (r) => asDate(r.checkOut), format: DATE_FORMAT, width: 14 },
      { header: "Nights", group: "timing", value: (r) => nights(r), format: INTEGER_FORMAT, total: true, width: 9 },
      { header: "Source", group: "control", value: (r) => label(r.source), width: 14 },
      { header: "Status", group: "control", value: (r) => label(r.status), width: 15, tone: (r) => (r.status === "CANCELLED" || r.status === "NO_SHOW" ? "amber" : undefined) },
      { header: "Currency", group: "revenue", value: (r) => r.currency, width: 11 },
      { header: "Stay total", group: "revenue", value: (r) => r.total, format: CURRENCY_FORMAT, total: true, width: 16 },
      { header: "Of which folio charges", group: "revenue", value: (r) => r.charges, format: CURRENCY_FORMAT, total: true, width: 18 },
      { header: "Paid", group: "control", value: (r) => r.paid, format: CURRENCY_FORMAT, total: true, width: 16 },
      { header: "Balance", group: "deduction", value: (r) => Number((r.total - r.paid).toFixed(2)), format: CURRENCY_FORMAT, total: true, width: 16, tone: (r) => (r.total - r.paid > 0.005 ? "negative" : r.total - r.paid < -0.005 ? "positive" : undefined) },
    ],
  });

  /* PAYG statements */
  addTableSheet(workbook, report, currency, {
    name: "PAYG Statements",
    tab: "FF8A4B00",
    title: "Schedule: PAYG statements",
    subtitle: "NRMS usage statements issued to the property in the period",
    rows: report.statements,
    emptyNote: "No PAYG statements were issued in this period.",
    columns: [
      { header: "Statement", group: "identity", value: (s) => s.reference, width: 14 },
      { header: "Issued (EAT)", group: "identity", value: (s) => asDate(s.createdAt), format: DATETIME_FORMAT, width: 20 },
      { header: "Status", group: "control", value: (s) => label(s.status), width: 20, tone: (s) => (s.status === "PAID" ? "positive" : s.status.includes("REQUIRED") || s.status === "OVERDUE" ? "negative" : undefined) },
      { header: "Usage events", group: "volume", value: (s) => s.usageEvents, format: INTEGER_FORMAT, total: true, width: 14 },
      { header: "Currency", group: "revenue", value: (s) => s.currency, width: 11 },
      { header: "Amount", group: "revenue", value: (s) => s.amount, format: CURRENCY_FORMAT, total: true, width: 16 },
    ],
  });

  /* Basis and coverage */
  const info = workbook.addWorksheet("Basis and Coverage", { pageSetup: { paperSize: 9, orientation: "portrait" } });
  info.properties.tabColor = { argb: "FF6F7C78" };
  info.getColumn(1).width = 40;
  info.getColumn(2).width = 52;
  info.getColumn(3).width = 22;
  sheetHeading(info, report, currency, "Basis and coverage", "What this evidence covers and how it was prepared", 3);
  const currencies = [...new Set([...report.orders, ...report.reservations, ...report.statements].map((r) => r.currency || "TZS"))];
  let cursor = addKeyValues(info, 5, "Basis", [
    { label: "Source", value: "NRMS operational ledger, read at the time of generation" },
    { label: "Reporting period", value: `${eatText(report.from)} to ${eatText(report.to)} (${report.periodDays} days)` },
    { label: "Record selection", value: "Records created within the period, East Africa Time (UTC+3)" },
    { label: "Reservation totals", value: "Stay total includes folio charges. Balance is stay total less paid" },
    { label: "Currencies present", value: currencies.join(", ") || currency, tone: currencies.length > 1 ? "amber" : undefined },
    { label: "Cover and totals currency", value: `${currency} (ISO 4217)` },
    { label: "Guest identifiers", value: "Redacted in all sheets" },
  ]);
  cursor = addKeyValues(info, cursor, "Coverage", [
    { label: "Outlet orders", value: report.orders.length, format: INTEGER_FORMAT },
    { label: "Reservations", value: report.reservations.length, format: INTEGER_FORMAT },
    { label: "PAYG statements", value: report.statements.length, format: INTEGER_FORMAT },
    { label: "Total records", value: report.orders.length + report.reservations.length + report.statements.length, format: INTEGER_FORMAT, total: true },
  ]);
  addKeyValues(info, cursor, "Audit", [
    { label: "Document number", value: report.documentNumber },
    { label: "Audit export", value: `#${report.exportId}` },
    { label: "Generated by", value: report.generatedBy },
    { label: "Generated at (EAT)", value: eatText(report.generatedAt, true) },
    { label: "Purpose", value: report.reason },
    { label: "Owner notification", value: "Sent automatically when this export was generated", tone: "positive" },
  ]);

  // Font family pass + read-only protection, as in the property report.
  const sheets: Sheet[] = [];
  workbook.eachSheet((sheet: Sheet) => {
    sheets.push(sheet);
    sheet.eachRow({ includeEmpty: false }, (r: Sheet) => {
      r.eachCell({ includeEmpty: false }, (cell: Sheet) => {
        cell.font = { size: 10, color: { argb: INK }, ...(cell.font ?? {}), name: FONT };
      });
    });
  });
  await Promise.all(sheets.map((sheet) => sheet.protect(WORKBOOK_PASSWORD, {
    selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false, deleteRows: false, deleteColumns: false,
    sort: true, autoFilter: true, pivotTables: false, objects: false, scenarios: false, spinCount: 100000,
  })));

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
