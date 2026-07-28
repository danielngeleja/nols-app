/**
 * NRMS property report export.
 *
 * `buildReportWorkbook` writes a multi-sheet XLSX arranged along USALI lines (the Uniform System
 * of Accounts for the Lodging Industry), with STR-standard performance statistics and embedded
 * charts. This is the format a hotel finance team, an owner's representative or a brand auditor
 * expects to receive.
 *
 * Every sheet is deliberately self-describing: each one repeats the property, period, currency
 * and report reference, so a tab remains interpretable once it has been separated from the
 * workbook or the email that delivered it.
 */

type Money = number;

export type WorkbookProperty = { id: number; title: string };

export type WorkbookCurrencyReport = {
  currency: string;
  summary: {
    roomRevenue: Money; folioExtras: Money; outletPaidRevenue: Money; totalRevenue: Money;
    folioPayments: Money; outletPayments: Money; totalCollected: Money; amountDue: Money;
  };
  collectionTiming: {
    currentStayCollections: Money; currentOutletCollections: Money; currentPeriodCollections: Money;
    priorStayCollections: Money; advanceDeposits: Money; unclassifiedCollections: Money;
    totalCollected: Money; revenueToCollectionDifference: Money; currentPeriodCollectionGap: Money;
  };
  departments: Array<{ department: string; transactions: number; amount: Money }>;
  paymentMethods: Array<{ method: string; transactions: number; amount: Money }>;
};

export type WorkbookData = {
  property: WorkbookProperty;
  range: { from: string; to: string; days: number };
  generatedAt: string;
  control: {
    status: string;
    financialChecks: Array<{ key: string; currency: string; label: string; difference: number; passed: boolean }>;
    warnings: Array<{ key: string; label: string; count: number }>;
    basis: { roomRevenue: string; folioExtras: string; outletRevenue: string; collections: string; channelProduction: string; timeZone: string };
    recordCounts: { reservations: number; stayRevenueReservations: number; folioCharges: number; payments: number; outletOrders: number; auditEvents: number };
  };
  manager: {
    arrivals: number; departures: number; inHouse: number; cancellations: number; noShows: number; openOrders: number;
    rooms: { total: number; active: number; occupiedNow: number; availableNow: number; outOfService: number };
  };
  reservationSources: Array<{
    source: string; currency: string; reservations: number; reservationShare: number; roomNights: number;
    roomRevenue: Money; revenueShare: number; folioCollected: Money; averageReservationValue: Money;
    cancellations: number; noShows: number;
  }>;
  guestBalances: Array<{
    reservationId: number; receiptNumber: string | null; guest: string; phone: string | null; room: string; status: string;
    checkIn: string; checkOut: string; currency: string; roomAmount: Money; folioExtras: Money; outletPaid: Money;
    totalSpend: Money; folioPaid: Money; totalCollected: Money; amountDue: Money; settlementStatus: string;
  }>;
  occupancy: {
    currency: string; rangeDays: number; activeRooms: number; blockedRoomNights: number; roomNightsAvailable: number;
    roomNightsSold: number; occupancyRate: number; roomRevenue: Money; adr: Money; revPar: Money;
    byRoomType: Array<{ roomTypeId: number; roomType: string; units: number; roomNightsAvailable: number; roomNightsSold: number; occupancyRate: number }>;
  };
  payments: { rows: Array<{ occurredAt: string; guest: string; room: string; method: string; reference: string | null; referenceNumber: string | null; currency: string; amount: Money; recordedBy: string; voidedAt: string | null; voidReason: string | null }> };
  outlets: { rows: Array<{ orderNumber: string; outlet: string; outletType: string; guest: string; room: string; status: string; settlementMode: string; settlementMethod: string | null; items: string; itemCount: number; currency: string; total: Money; orderedAt: string; completedAt: string | null; createdBy: string; voidReason: string | null }> };
  audit: { rows: Array<{ occurredAt: string; type: string; guest: string; room: string; reservationId: number; referenceNumber: string | null; actor: string; reason: string | null }> };
  expenses: { rows: Array<{ id: number; category: string; description: string; amount: Money; currency: string; paymentMethod: string | null; incurredAt: string; recordedBy: string; voidedAt: string | null }> };
  profitLoss: Array<{ currency: string; totalRevenue: Money; totalExpenses: Money; netProfit: Money; expensesByCategory: Array<{ category: string; amount: Money }> }>;
  staffPerformance: Array<{ staffId: number; name: string; role: string; currency: string; orders: number; sales: Money; tips: Money }>;
};

export type WorkbookFinance = {
  businessDate: string;
  businessDay: { status: string };
  shifts: Array<{ cashierName: string; currency: string; status: string; openingFloat: Money; expectedCash: Money; declaredCash: Money | null; variance: Money | null; openedAt: string; closedAt: string | null; closeNote: string | null }>;
  ledger: { balanced: boolean; accounts: Array<{ accountCode: string; accountName: string; accountType: string; currency: string; debit: Money; credit: Money; balance: Money }> };
  tax: { total: Money; note: string; rows: Array<{ transactionNumber: string; occurredAt: string; description: string; currency: string; tax: Money }> };
  nbs: { month: string; reportingDays: number; bedsAvailable: number; bedNightsAvailable: number; bedNightsOccupied: number; domesticBedNights: number; internationalBedNights: number; roomNightsOccupied: number; bedOccupancyRate: number; missingNationalityBedNights: number };
};

export type WorkbookIdentity = {
  reportNumber: string;
  generatedAt: string;
  generatedBy: string;
  generatedByRole: string;
  verificationMode: "SEALED" | "REFERENCE";
};

export type WorkbookInput = {
  data: WorkbookData;
  finance: WorkbookFinance;
  currencyReport: WorkbookCurrencyReport;
  identity: WorkbookIdentity;
  label: (value: string) => string;
};

/* ------------------------------------------------------------------ *
 * Standards vocabulary
 * ------------------------------------------------------------------ */

/**
 * USALI groups revenue into operated departments. Anything unrecognised falls into "Other
 * Operated Departments" rather than being dropped, so a workbook always foots to total revenue.
 */
const USALI_DEPARTMENTS: Record<string, string> = {
  ROOM: "Rooms", ROOMS: "Rooms", ROOM_STAY: "Rooms", ROOM_REVENUE: "Rooms", ACCOMMODATION: "Rooms", STAY: "Rooms",
  RESTAURANT: "Food and Beverage", BAR: "Food and Beverage", FOOD: "Food and Beverage", BEVERAGE: "Food and Beverage",
  FNB: "Food and Beverage", FOOD_AND_BEVERAGE: "Food and Beverage", KITCHEN: "Food and Beverage", MINIBAR: "Food and Beverage",
  ROOM_SERVICE: "Food and Beverage", BANQUET: "Food and Beverage",
  LAUNDRY: "Other Operated Departments", SPA: "Other Operated Departments", TRANSPORT: "Other Operated Departments",
  TOUR: "Other Operated Departments", CONFERENCE: "Other Operated Departments", TELEPHONE: "Other Operated Departments",
  PARKING: "Other Operated Departments", EXCURSION: "Other Operated Departments",
};

function usaliDepartment(code: string): string {
  return USALI_DEPARTMENTS[String(code).toUpperCase().replaceAll(" ", "_")] ?? "Other Operated Departments";
}

/* Brand palette. ARGB, because that is what the OOXML style part expects. */
const FONT = "Trebuchet MS";
const TEAL = "FF073C35";        // headings, table header band
const TEAL_MID = "FF0F766E";    // section bands
const TEAL_LIGHT = "FFE8F1EF";  // section band fill
const TEAL_PALE = "FFF4F9F8";   // banded rows
const INK = "FF111816";         // primary values
const INK_SOFT = "FF56625E";    // labels
const RULE = "FFD6DFDC";        // hairlines
const WHITE = "FFFFFFFF";
const POSITIVE = "FF176249";
const NEGATIVE = "FFB42318";
const AMBER = "FF8A4B00";
const TOTALS_BAND = "FF0B1F1C";  // dark footing band under every table

/**
 * Sheet-protection password. This is a tamper-evidence measure, not security: it stops accidental
 * edits and makes a deliberate change a conscious act, but anyone can strip it by unzipping the
 * .xlsx and deleting the sheetProtection element. Treat the sealed PDF as the authoritative copy.
 */
const WORKBOOK_PASSWORD = "NRMS-REPORT";

/** Column groups get a solid band above the header, colour-coded by meaning. */
const GROUP_COLOURS: Record<string, string> = {
  identity: "FF073C35",
  revenue: "FF1B7F4B",
  deduction: "FFB42318",
  control: "FF1E6084",
  volume: "FF6756A5",
  timing: "FF8A4B00",
};

/** Column body tints, matched to the group band above them. */
const TONE_FILLS: Record<string, string> = {
  identity: "FFF4F9F8",
  revenue: "FFEFF8F2",
  deduction: "FFFDF2F2",
  control: "FFF1F6FC",
  volume: "FFF5F3FB",
  timing: "FFFDF7EF",
};

type ColumnGroup = keyof typeof GROUP_COLOURS;

/* ------------------------------------------------------------------ *
 * Charts
 * ------------------------------------------------------------------ */

export type ChartImage = { key: string; title: string; dataUrl: string; width: number; height: number };

/** Paints an opaque background so charts do not render on a transparent canvas inside Excel. */
const whiteBackground = {
  id: "nrmsWhiteBackground",
  beforeDraw(chart: { ctx: CanvasRenderingContext2D; width: number; height: number }) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

const CHART_PALETTE = ["#073c35", "#0f766e", "#0ea5a0", "#38bdf8", "#6366f1", "#a855f7", "#f59e0b", "#ef4444"];

/**
 * Renders the categorical charts the current API can support. There is no per-day series in the
 * reports payload, so these are compositional (mix) charts rather than trends over time.
 */
export async function renderReportCharts(input: WorkbookInput): Promise<ChartImage[]> {
  const { data, currencyReport, label } = input;
  const { default: Chart } = await import("chart.js/auto");

  const draw = async (title: string, config: Record<string, unknown>, width = 900, height = 520): Promise<string> => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Chart canvas is unavailable.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chart = new Chart(context, { ...(config as any), options: { ...((config as any).options ?? {}), responsive: false, animation: false, devicePixelRatio: 2, plugins: { ...(((config as any).options ?? {}).plugins ?? {}), title: { display: true, text: title, font: { size: 16, weight: "bold" }, color: "#111816" } } } });
    const url = chart.toBase64Image("image/png", 1);
    chart.destroy();
    return url;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Chart as any).register(whiteBackground);

  const charts: ChartImage[] = [];
  const currency = currencyReport.currency;

  const revenueSplit = [
    ["Rooms", currencyReport.summary.roomRevenue],
    ["Folio extras", currencyReport.summary.folioExtras],
    ["Paid at outlet", currencyReport.summary.outletPaidRevenue],
  ].filter(([, amount]) => Number(amount) > 0) as Array<[string, number]>;

  if (revenueSplit.length) {
    charts.push({
      key: "revenueMix", title: "Revenue mix", width: 900, height: 520,
      dataUrl: await draw(`Revenue mix by operated department (${currency})`, {
        type: "doughnut",
        data: { labels: revenueSplit.map(([name]) => name), datasets: [{ data: revenueSplit.map(([, amount]) => amount), backgroundColor: CHART_PALETTE, borderColor: "#ffffff", borderWidth: 2 }] },
        options: { plugins: { legend: { position: "right" } } },
      }),
    });
  }

  const departments = currencyReport.departments.filter((row) => row.amount > 0).slice(0, 12);
  if (departments.length) {
    charts.push({
      key: "departments", title: "Revenue by department", width: 900, height: 520,
      dataUrl: await draw(`Revenue by department (${currency})`, {
        type: "bar",
        data: { labels: departments.map((row) => label(row.department)), datasets: [{ label: `Revenue (${currency})`, data: departments.map((row) => row.amount), backgroundColor: "#0f766e" }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      }),
    });
  }

  const channels = data.reservationSources.filter((row) => row.currency === currency && row.roomRevenue > 0).slice(0, 12);
  if (channels.length) {
    charts.push({
      key: "channels", title: "Channel production", width: 900, height: 520,
      dataUrl: await draw(`Room revenue by reservation channel (${currency})`, {
        type: "bar",
        data: { labels: channels.map((row) => label(row.source)), datasets: [{ label: `Room revenue (${currency})`, data: channels.map((row) => row.roomRevenue), backgroundColor: "#073c35" }] },
        options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } },
      }),
    });
  }

  const roomTypes = data.occupancy.byRoomType.slice(0, 14);
  if (roomTypes.length) {
    charts.push({
      key: "occupancy", title: "Occupancy by room type", width: 900, height: 520,
      dataUrl: await draw("Occupancy by room type (%)", {
        type: "bar",
        data: { labels: roomTypes.map((row) => row.roomType), datasets: [{ label: "Occupancy %", data: roomTypes.map((row) => Number(row.occupancyRate.toFixed(1))), backgroundColor: "#0ea5a0" }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
      }),
    });
  }

  const expenseCategories = (data.profitLoss.find((row) => row.currency === currency)?.expensesByCategory ?? []).filter((row) => row.amount > 0).slice(0, 12);
  if (expenseCategories.length) {
    charts.push({
      key: "expenses", title: "Operating expenses by category", width: 900, height: 520,
      dataUrl: await draw(`Operating expenses by category (${currency})`, {
        type: "doughnut",
        data: { labels: expenseCategories.map((row) => label(row.category)), datasets: [{ data: expenseCategories.map((row) => row.amount), backgroundColor: CHART_PALETTE, borderColor: "#ffffff", borderWidth: 2 }] },
        options: { plugins: { legend: { position: "right" } } },
      }),
    });
  }

  const staffRows = data.staffPerformance.filter((row) => row.currency === currency && row.sales > 0).slice(0, 12);
  if (staffRows.length) {
    charts.push({
      key: "staffPerformance", title: "Staff performance", width: 900, height: 520,
      dataUrl: await draw(`Outlet sales by team member (${currency})`, {
        type: "bar",
        data: { labels: staffRows.map((row) => row.name), datasets: [{ label: `Sales (${currency})`, data: staffRows.map((row) => row.sales), backgroundColor: "#0f766e" }] },
        options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } },
      }),
    });
  }

  return charts;
}

/* ------------------------------------------------------------------ *
 * Workbook
 * ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sheet = any;

const CURRENCY_FORMAT = "#,##0.00";
const INTEGER_FORMAT = "#,##0";
const PERCENT_FORMAT = "0.0";
const DATETIME_FORMAT = "yyyy-mm-dd hh:mm";
const DATE_FORMAT = "yyyy-mm-dd";

/**
 * East Africa Time is UTC+3 all year, with no daylight saving in Tanzania, Kenya or Uganda, so a
 * fixed offset is correct rather than an approximation.
 */
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const EAT_LABEL = "EAT";

/**
 * Excel serial dates carry no time zone, and ExcelJS derives the serial from `getTime()`, which is
 * the UTC wall clock. Left alone, a 22:31 EAT timestamp displays as 19:31 in every copy of the
 * workbook. Shifting by the EAT offset makes the value Excel shows read as East Africa Time on any
 * machine, in any locale, which is the wall clock the property actually operated on.
 */
function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getTime() + EAT_OFFSET_MS);
}

/** "YYYY-MM-DD HH:mm" in East Africa Time, for the places that render a timestamp as text. */
function eatStamp(value: string): string {
  const shifted = asDate(value);
  return shifted ? shifted.toISOString().slice(0, 16).replace("T", " ") : value;
}

/**
 * Every sheet opens with the same masthead: a solid brand band carrying the title and subtitle,
 * then a pale provenance strip. Gridlines are switched off so the sheet reads as a document
 * rather than as a spreadsheet grid, which is most of what makes an export look considered.
 */
function sheetHeading(sheet: Sheet, input: WorkbookInput, title: string, subtitle: string, columns: number) {
  const { data, identity, currencyReport } = input;
  const span = Math.max(5, columns);

  sheet.mergeCells(1, 1, 1, span);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: FONT, size: 18, bold: true, color: { argb: WHITE } };
  titleCell.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(2, 1, 2, span);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: FONT, size: 10, color: { argb: "FFBCEBD9" } };
  subtitleCell.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(2).height = 20;

  // Fill the whole band, not just the anchor cell, so the colour runs edge to edge.
  for (let column = 1; column <= span; column += 1) {
    sheet.getCell(1, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    sheet.getCell(2, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  }

  sheet.mergeCells(3, 1, 3, span);
  const provenance = sheet.getCell(3, 1);
  provenance.value = `${data.property.title}   |   ${data.range.from} to ${data.range.to}   |   ${currencyReport.currency} (ISO 4217)   |   Report ${identity.reportNumber}`;
  provenance.font = { name: FONT, size: 9, bold: true, color: { argb: TEAL } };
  provenance.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(3).height = 20;
  for (let column = 1; column <= span; column += 1) {
    sheet.getCell(3, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_LIGHT } };
    sheet.getCell(3, column).border = { bottom: { style: "thin", color: { argb: TEAL_MID } } };
  }

  sheet.getRow(4).height = 9;
  sheet.views = [{ showGridLines: false }];
}

/** Applies the shared table look: dark header band, frozen panes, autofilter, banded rules. */
function styleTable(sheet: Sheet, headerRowNumber: number, columnCount: number) {
  const header = sheet.getRow(headerRowNumber);
  header.height = 30;
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = header.getCell(column);
    cell.font = { name: FONT, bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
    cell.border = { bottom: { style: "medium", color: { argb: TEAL_MID } } };
  }
  // Freeze below the header and keep gridlines off, set together because `views` is replaced whole.
  sheet.views = [{ state: "frozen", ySplit: headerRowNumber, showGridLines: false }];
  sheet.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: headerRowNumber, column: columnCount } };
}

/** Widths are derived from content because Excel has no true auto-fit on write. */
function fitColumns(sheet: Sheet, headerRowNumber: number) {
  sheet.columns.forEach((column: Sheet) => {
    let widest = 10;
    column.eachCell?.({ includeEmpty: false }, (cell: Sheet, rowNumber: number) => {
      if (rowNumber < headerRowNumber) return;
      const length = String(cell.value ?? "").length;
      if (length > widest) widest = length;
    });
    column.width = Math.min(46, Math.max(10, widest + 2));
  });
}

type ColumnSpec<Row> = {
  header: string;
  /** Columns sharing a group sit under one merged, colour-coded band and share a body tint. */
  group: ColumnGroup;
  value: (row: Row) => string | number | Date | null;
  format?: string;
  width?: number;
  /** Numeric columns marked total are summed into the dark footing band. */
  total?: boolean;
};

const CELL_BORDER = {
  top: { style: "hair" as const, color: { argb: RULE } },
  bottom: { style: "hair" as const, color: { argb: RULE } },
  left: { style: "hair" as const, color: { argb: RULE } },
  right: { style: "hair" as const, color: { argb: RULE } },
};

/**
 * Renders the group band above the column headers, merging each contiguous run of columns that
 * share a group. This is what gives a wide table its readable structure: a manager reads the
 * bands first and the individual columns second.
 */
function addGroupBand<Row>(sheet: Sheet, rowNumber: number, columns: Array<ColumnSpec<Row>>) {
  const row = sheet.getRow(rowNumber);
  row.height = 22;
  let start = 0;
  while (start < columns.length) {
    let end = start;
    while (end + 1 < columns.length && columns[end + 1]!.group === columns[start]!.group) end += 1;
    const group = columns[start]!.group;
    if (end > start) sheet.mergeCells(rowNumber, start + 1, rowNumber, end + 1);
    const cell = sheet.getCell(rowNumber, start + 1);
    cell.value = group.toUpperCase();
    cell.font = { name: FONT, bold: true, size: 9, color: { argb: WHITE } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    for (let column = start; column <= end; column += 1) {
      sheet.getCell(rowNumber, column + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_COLOURS[group] } };
      sheet.getCell(rowNumber, column + 1).border = { right: { style: "thin", color: { argb: WHITE } } };
    }
    start = end + 1;
  }
}

function addTableSheet<Row>(
  workbook: Sheet,
  input: WorkbookInput,
  options: { name: string; title: string; subtitle: string; rows: Row[]; columns: Array<ColumnSpec<Row>>; emptyNote: string },
): Sheet {
  const sheet = workbook.addWorksheet(options.name, { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheetHeading(sheet, input, options.title, options.subtitle, options.columns.length);

  const groupRowNumber = 5;
  const headerRowNumber = 6;
  addGroupBand(sheet, groupRowNumber, options.columns);
  sheet.getRow(headerRowNumber).values = options.columns.map((column) => column.header);
  styleTable(sheet, headerRowNumber, options.columns.length);

  if (!options.rows.length) {
    const note = sheet.getCell(headerRowNumber + 1, 1);
    note.value = options.emptyNote;
    note.font = { name: FONT, italic: true, color: { argb: "FF6F7C78" } };
  }

  options.rows.forEach((row, index) => {
    const target = sheet.getRow(headerRowNumber + 1 + index);
    target.height = 19;
    options.columns.forEach((column, columnIndex) => {
      const cell = target.getCell(columnIndex + 1);
      const value = column.value(row);
      cell.value = value;
      if (column.format) cell.numFmt = column.format;
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.alignment = { vertical: "middle", horizontal: typeof value === "number" ? "right" : "left", indent: 1 };
      // Column tint rather than row banding: the tint ties each cell to the band above it, and
      // full borders carry the row separation that banding would otherwise provide.
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILLS[column.group] } };
      cell.border = CELL_BORDER;
    });
  });

  // Dark footing band, so a wide table always closes on a total the eye can find.
  const totalColumns = options.columns.filter((column) => column.total);
  if (options.rows.length && totalColumns.length) {
    const totalRowNumber = headerRowNumber + 1 + options.rows.length;
    const totalRow = sheet.getRow(totalRowNumber);
    totalRow.height = 24;
    options.columns.forEach((column, columnIndex) => {
      const cell = totalRow.getCell(columnIndex + 1);
      if (columnIndex === 0) {
        cell.value = "TOTAL";
      } else if (column.total) {
        const sum = options.rows.reduce((running, row) => {
          const value = column.value(row);
          return running + (typeof value === "number" && Number.isFinite(value) ? value : 0);
        }, 0);
        cell.value = Number(sum.toFixed(2));
        cell.numFmt = column.format ?? CURRENCY_FORMAT;
      }
      cell.font = { name: FONT, bold: true, size: 10, color: { argb: WHITE } };
      cell.alignment = { vertical: "middle", horizontal: column.total ? "right" : "left", indent: 1 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTALS_BAND } };
      cell.border = { top: { style: "medium", color: { argb: TOTALS_BAND } } };
    });
  }

  fitColumns(sheet, headerRowNumber);
  options.columns.forEach((column, index) => { if (column.width) sheet.getColumn(index + 1).width = column.width; });
  return sheet;
}

type KeyValue = {
  label: string;
  value: string | number | Date | null;
  format?: string;
  /** Renders the row as a footing line: heavier type and a rule above it. */
  total?: boolean;
  tone?: "positive" | "negative" | "amber";
};

/**
 * Two-column label/value block used by the information and summary sheets. Rendered as a titled
 * card: a coloured section band, banded rows, hairline rules and a boxed outline, so the block
 * reads as a defined unit instead of as loose cells on a grid.
 */
function addKeyValues(sheet: Sheet, startRow: number, title: string, entries: KeyValue[], span = 3): number {
  const bandRow = sheet.getRow(startRow);
  bandRow.height = 24;
  sheet.mergeCells(startRow, 1, startRow, span);
  const heading = sheet.getCell(startRow, 1);
  heading.value = title.toUpperCase();
  heading.font = { name: FONT, bold: true, size: 10, color: { argb: WHITE } };
  heading.alignment = { vertical: "middle", indent: 1 };
  for (let column = 1; column <= span; column += 1) {
    sheet.getCell(startRow, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_MID } };
  }

  const lastRow = startRow + entries.length;
  entries.forEach((entry, index) => {
    const rowNumber = startRow + 1 + index;
    const row = sheet.getRow(rowNumber);
    row.height = 19;

    const labelCell = row.getCell(1);
    labelCell.value = entry.label;
    labelCell.font = { name: FONT, size: 10, bold: Boolean(entry.total), color: { argb: entry.total ? INK : INK_SOFT } };
    labelCell.alignment = { vertical: "middle", indent: 1 };

    // Values span the remaining columns so the block has a straight right edge instead of
    // trailing off into unstyled cells.
    if (span > 2) sheet.mergeCells(rowNumber, 2, rowNumber, span);
    const valueCell = row.getCell(2);
    valueCell.value = entry.value;
    if (entry.format) valueCell.numFmt = entry.format;
    const tone = entry.tone === "positive" ? POSITIVE : entry.tone === "negative" ? NEGATIVE : entry.tone === "amber" ? AMBER : INK;
    valueCell.font = { name: FONT, size: entry.total ? 11 : 10, bold: true, color: { argb: tone } };
    valueCell.alignment = { vertical: "middle", horizontal: typeof entry.value === "number" ? "right" : "left", indent: 1 };

    // Banded fill, and a rule above footing rows so totals separate from the lines they sum.
    const fill = entry.total ? TEAL_LIGHT : index % 2 === 1 ? TEAL_PALE : WHITE;
    for (let column = 1; column <= span; column += 1) {
      const cell = sheet.getCell(rowNumber, column);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.border = {
        top: entry.total ? { style: "thin", color: { argb: TEAL_MID } } : undefined,
        bottom: { style: "hair", color: { argb: RULE } },
        left: column === 1 ? { style: "thin", color: { argb: RULE } } : undefined,
        right: column === span ? { style: "thin", color: { argb: RULE } } : undefined,
      };
    }
  });

  // Close the card with a bottom edge.
  for (let column = 1; column <= span; column += 1) {
    const cell = sheet.getCell(lastRow, column);
    cell.border = { ...cell.border, bottom: { style: "thin", color: { argb: RULE } } };
  }

  return lastRow + 2;
}

function fillRange(sheet: Sheet, top: number, left: number, bottom: number, right: number, argb: string) {
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      sheet.getCell(row, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    }
  }
}

/** Draws a box around a rectangular range, leaving interior edges clean. */
function boxRange(sheet: Sheet, top: number, left: number, bottom: number, right: number, argb: string) {
  const edge = { style: "thin" as const, color: { argb } };
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.border = {
        ...cell.border,
        top: row === top ? edge : cell.border?.top,
        bottom: row === bottom ? edge : cell.border?.bottom,
        left: column === left ? edge : cell.border?.left,
        right: column === right ? edge : cell.border?.right,
      };
    }
  }
}

const COVER_FIRST = 2;  // column B; column A is a narrow gutter
const COVER_LAST = 9;   // column I, giving eight content columns

/**
 * The cover. A report someone forwards to an owner or a bank is judged on this sheet alone, so it
 * carries brand, the property as the hero, the four numbers the file is opened for, and only then
 * the identity strip. Everything procedural moves to the "Basis and Coverage" tab behind it.
 */
function addCoverSheet(workbook: Sheet, input: WorkbookInput) {
  {
    const { data, currencyReport, identity } = input;
    const occupancy = data.occupancy;
    const sheet = workbook.addWorksheet("Cover", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0, footer: 0 } } });
    sheet.views = [{ showGridLines: false }];
    sheet.getColumn(1).width = 2.5;
    for (let column = COVER_FIRST; column <= COVER_LAST; column += 1) sheet.getColumn(column).width = 13.6;

    /* Hero. The sheet opens on the property name, with no brand band above it. */
    sheet.getRow(1).height = 42;
    sheet.mergeCells(1, COVER_FIRST, 1, COVER_LAST);
    const heroTitle = sheet.getCell(1, COVER_FIRST);
    heroTitle.value = data.property.title;
    heroTitle.font = { name: FONT, size: 26, bold: true, color: { argb: INK } };
    heroTitle.alignment = { vertical: "middle" };

    sheet.getRow(2).height = 24;
    sheet.mergeCells(2, COVER_FIRST, 2, COVER_LAST);
    const heroSub = sheet.getCell(2, COVER_FIRST);
    heroSub.value = "Property performance report";
    heroSub.font = { name: FONT, size: 14, bold: true, color: { argb: TEAL_MID } };
    heroSub.alignment = { vertical: "middle" };

    sheet.getRow(3).height = 20;
    sheet.mergeCells(3, COVER_FIRST, 3, COVER_LAST);
    const heroMeta = sheet.getCell(3, COVER_FIRST);
    heroMeta.value = `${data.range.from} to ${data.range.to}   ·   ${data.range.days} reporting days   ·   ${currencyReport.currency} (ISO 4217)   ·   All times ${EAT_LABEL} (UTC+3)`;
    heroMeta.font = { name: FONT, size: 10, color: { argb: INK_SOFT } };
    heroMeta.alignment = { vertical: "middle" };

    // Rule under the hero, so the title block still closes cleanly without a band above it.
    sheet.getRow(4).height = 3;
    fillRange(sheet, 4, COVER_FIRST, 4, COVER_LAST, TEAL_MID);
    sheet.getRow(5).height = 16;

    /* Headline figures: four cards, two columns each */
    const trevpar = occupancy.roomNightsAvailable > 0 ? currencyReport.summary.totalRevenue / occupancy.roomNightsAvailable : 0;
    const cards: Array<{ label: string; value: number; format: string; note: string; tint: string; ink: string }> = [
      { label: "Total operating revenue", value: currencyReport.summary.totalRevenue, format: CURRENCY_FORMAT, note: `Rooms, folio and outlet, ${currencyReport.currency}`, tint: TONE_FILLS.revenue!, ink: POSITIVE },
      { label: "Total collected", value: currencyReport.summary.totalCollected, format: CURRENCY_FORMAT, note: "Guest folio and outlet collections", tint: TONE_FILLS.control!, ink: "FF1E6084" },
      { label: "Occupancy", value: Number(occupancy.occupancyRate.toFixed(1)), format: '0.0"%"', note: `${occupancy.roomNightsSold} of ${occupancy.roomNightsAvailable} room nights`, tint: TONE_FILLS.identity!, ink: TEAL },
      { label: "RevPAR", value: occupancy.revPar, format: CURRENCY_FORMAT, note: `TRevPAR ${trevpar.toFixed(0)}, ADR ${occupancy.adr.toFixed(0)}`, tint: TONE_FILLS.volume!, ink: "FF55378F" },
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
      const labelCell = sheet.getCell(cardTop, left);
      labelCell.value = card.label.toUpperCase();
      labelCell.font = { name: FONT, size: 8, bold: true, color: { argb: INK_SOFT } };
      labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

      sheet.mergeCells(cardTop + 1, left, cardTop + 1, right);
      const valueCell = sheet.getCell(cardTop + 1, left);
      valueCell.value = card.value;
      valueCell.numFmt = card.format;
      valueCell.font = { name: FONT, size: 16, bold: true, color: { argb: card.ink } };
      valueCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

      sheet.mergeCells(cardTop + 2, left, cardTop + 2, right);
      const noteCell = sheet.getCell(cardTop + 2, left);
      noteCell.value = card.note;
      noteCell.font = { name: FONT, size: 8, color: { argb: INK_SOFT } };
      noteCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    });

    /* Identity strip: two label/value pairs per row */
    const stripTop = cardTop + 4;
    sheet.getRow(stripTop).height = 22;
    sheet.mergeCells(stripTop, COVER_FIRST, stripTop, COVER_LAST);
    const stripBand = sheet.getCell(stripTop, COVER_FIRST);
    stripBand.value = "REPORT IDENTITY";
    stripBand.font = { name: FONT, size: 10, bold: true, color: { argb: WHITE } };
    stripBand.alignment = { vertical: "middle", indent: 1 };
    fillRange(sheet, stripTop, COVER_FIRST, stripTop, COVER_LAST, TEAL_MID);

    const pairs: Array<[string, string]> = [
      ["Report reference", identity.reportNumber],
      ["Property identifier", `NRMS ${data.property.id}`],
      [`Generated at (${EAT_LABEL})`, eatStamp(identity.generatedAt)],
      ["Generated by", identity.generatedBy],
      ["Role", identity.generatedByRole],
      ["Verification", identity.verificationMode === "SEALED" ? "Digitally sealed" : "Reference only"],
      ["Reporting standard", "USALI"],
      ["Statistics basis", "STR definitions"],
      // Carried over from the removed brand band; a management report should still say so on its face.
      ["Classification", "Management use"],
      ["Reporting currency", `${currencyReport.currency} (ISO 4217)`],
    ];

    pairs.forEach(([name, value], index) => {
      const rowNumber = stripTop + 1 + Math.floor(index / 2);
      const half = index % 2;
      const labelColumn = COVER_FIRST + half * 4;
      sheet.getRow(rowNumber).height = 20;

      const labelCell = sheet.getCell(rowNumber, labelColumn);
      labelCell.value = name;
      labelCell.font = { name: FONT, size: 9, color: { argb: INK_SOFT } };
      labelCell.alignment = { vertical: "middle", indent: 1 };

      sheet.mergeCells(rowNumber, labelColumn + 1, rowNumber, labelColumn + 3);
      const valueCell = sheet.getCell(rowNumber, labelColumn + 1);
      valueCell.value = value;
      valueCell.font = { name: FONT, size: 9, bold: true, color: { argb: INK } };
      valueCell.alignment = { vertical: "middle", indent: 1 };

      if (half === 1 || index === pairs.length - 1) {
        const stripe = Math.floor(index / 2) % 2 === 1 ? TEAL_PALE : WHITE;
        fillRange(sheet, rowNumber, COVER_FIRST, rowNumber, COVER_LAST, stripe);
      }
    });

    const stripBottom = stripTop + Math.ceil(pairs.length / 2);
    boxRange(sheet, stripTop, COVER_FIRST, stripBottom, COVER_LAST, RULE);

    /* Footer note */
    const footRow = stripBottom + 2;
    sheet.getRow(footRow).height = 42;
    sheet.mergeCells(footRow, COVER_FIRST, footRow, COVER_LAST);
    const foot = sheet.getCell(footRow, COVER_FIRST);
    foot.value = "This is an operational management report, not a tax invoice, audited financial statement or statutory filing. Its accuracy depends on the transactions recorded in NRMS by authorized users. Corrections must be made in the originating transaction, then the report generated again.";
    foot.font = { name: FONT, size: 8, color: { argb: INK_SOFT } };
    foot.alignment = { vertical: "top", wrapText: true, indent: 1 };
    fillRange(sheet, footRow, COVER_FIRST, footRow, COVER_LAST, TEAL_PALE);
    boxRange(sheet, footRow, COVER_FIRST, footRow, COVER_LAST, RULE);

    /* Legend: every other sheet is protected against edits, and this is the
       one place that says why, so the reason travels with the file rather
       than living in a support article no one opens with it. */
    const legendRow = footRow + 2;
    sheet.getRow(legendRow).height = 32;
    sheet.mergeCells(legendRow, COVER_FIRST, legendRow, COVER_LAST);
    const legend = sheet.getCell(legendRow, COVER_FIRST);
    legend.value = "Every sheet in this workbook is locked (read-only): every figure is generated directly from NRMS transactions, not typed in, so there is nothing here for a reader to fill in. Selecting, copying, sorting and filtering stay available.";
    legend.font = { name: FONT, size: 8, italic: true, color: { argb: INK_SOFT } };
    legend.alignment = { vertical: "top", wrapText: true, indent: 1 };
  }
}

/** Sheets are colour-grouped in the tab bar: identity, summary, USALI schedules, detail, control. */
const TAB_COLOURS: Record<string, string> = {
  Cover: TEAL,
  "Basis and Coverage": TEAL,
  "Executive Summary": TEAL_MID,
  "Profit and Loss": TEAL_MID,
  "Revenue by Department": "FF0EA5A0",
  "Rooms Schedule": "FF0EA5A0",
  "Outlet Sales": "FF0EA5A0",
  "Staff Performance": "FF38BDF8",
  "Operating Expenses": "FF38BDF8",
  "Channel Production": "FF38BDF8",
  "Guest Ledger": "FF38BDF8",
  "Payment Register": "FF38BDF8",
  "Cashier Shifts": "FF8A4B00",
  "Trial Balance": "FF8A4B00",
  "Tax Register": "FF8A4B00",
  "Audit Trail": "FF8A4B00",
  Definitions: "FF6F7C78",
};

/**
 * ExcelJS has no document-level default font, so the family is stamped onto every written cell in
 * one pass at the end. Existing weight, size and colour are preserved; only the family is forced.
 */
async function finaliseWorkbook(workbook: Sheet) {
  const sheets: Sheet[] = [];
  workbook.eachSheet((sheet: Sheet) => {
    sheets.push(sheet);
    const tabColour = TAB_COLOURS[sheet.name];
    if (tabColour) sheet.properties.tabColor = { argb: tabColour };
    sheet.eachRow({ includeEmpty: false }, (row: Sheet) => {
      row.eachCell({ includeEmpty: false }, (cell: Sheet) => {
        cell.font = { size: 10, color: { argb: INK }, ...(cell.font ?? {}), name: FONT };
      });
    });
  });

  // Cells are locked by default in Excel, so protecting the sheet makes the whole tab read-only.
  // Selecting, copying, sorting and filtering stay available, because a reviewer still needs to
  // read and extract figures; only editing, formatting and structural changes are refused.
  await Promise.all(sheets.map((sheet) => sheet.protect(WORKBOOK_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertRows: false,
    insertColumns: false,
    insertHyperlinks: false,
    deleteRows: false,
    deleteColumns: false,
    sort: true,
    autoFilter: true,
    pivotTables: false,
    objects: false,
    scenarios: false,
    spinCount: 100000,
  })));
}

export async function buildReportWorkbook(input: WorkbookInput, charts: ChartImage[]): Promise<Blob> {
  const { data, finance, currencyReport, identity, label } = input;
  const currency = currencyReport.currency;
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  workbook.creator = identity.generatedBy;
  workbook.lastModifiedBy = identity.generatedBy;
  // Document metadata stays in UTC: OOXML defines dcterms:created as UTC, and Excel renders it in
  // the reader's own zone. Only the cell values are shifted to EAT.
  const generatedUtc = new Date(identity.generatedAt);
  const createdUtc = Number.isNaN(generatedUtc.getTime()) ? new Date() : generatedUtc;
  workbook.created = createdUtc;
  workbook.modified = createdUtc;
  workbook.title = `${data.property.title} property performance report`;
  workbook.subject = `NRMS property report ${data.range.from} to ${data.range.to} (${currency})`;
  workbook.company = "NRMS Property Reporting Centre";
  workbook.keywords = `NRMS,hotel,USALI,STR,${identity.reportNumber},${currency}`;

  /* ---- 1. Cover ------------------------------------------------------ */
  addCoverSheet(workbook, input);

  /* ---- 2. Basis and coverage ---------------------------------------- */
  // Identity now lives on the cover, so this sheet carries only the procedural detail an auditor
  // needs and a casual reader does not.
  const info = workbook.addWorksheet("Basis and Coverage", { pageSetup: { paperSize: 9, orientation: "portrait" } });
  info.getColumn(1).width = 46;
  info.getColumn(2).width = 48;
  info.getColumn(3).width = 26;
  sheetHeading(info, input, "Basis and coverage", "Accounting basis, recognition rules and data coverage", 3);

  let cursor = 5;
  cursor = addKeyValues(info, cursor, "Accounting basis", [
    { label: "Reporting standard", value: "USALI (Uniform System of Accounts for the Lodging Industry)" },
    { label: "Performance statistics", value: "STR standard definitions for Occupancy, ADR and RevPAR" },
    { label: "Room revenue recognition", value: label(data.control.basis.roomRevenue) },
    { label: "Folio extras recognition", value: label(data.control.basis.folioExtras) },
    { label: "Outlet revenue recognition", value: label(data.control.basis.outletRevenue) },
    { label: "Collections recognition", value: label(data.control.basis.collections) },
    { label: "Channel production basis", value: label(data.control.basis.channelProduction) },
    { label: "Time zone", value: data.control.basis.timeZone },
    { label: "Business date", value: finance.businessDate },
    { label: "Business day status", value: label(finance.businessDay.status) },
    { label: "General ledger balanced", value: finance.ledger.balanced ? "Yes" : "No", tone: finance.ledger.balanced ? "positive" : "negative" },
    { label: "Automated control status", value: label(data.control.status), tone: data.control.status === "BALANCED" ? "positive" : "amber" },
  ]);

  cursor = addKeyValues(info, cursor, "Data coverage", [
    { label: "Reservations", value: data.control.recordCounts.reservations, format: INTEGER_FORMAT },
    { label: "Reservations contributing stay revenue", value: data.control.recordCounts.stayRevenueReservations, format: INTEGER_FORMAT },
    { label: "Folio charges", value: data.control.recordCounts.folioCharges, format: INTEGER_FORMAT },
    { label: "Payments", value: data.control.recordCounts.payments, format: INTEGER_FORMAT },
    { label: "Outlet orders", value: data.control.recordCounts.outletOrders, format: INTEGER_FORMAT },
    { label: "Audit events", value: data.control.recordCounts.auditEvents, format: INTEGER_FORMAT },
    { label: "Data quality warnings", value: data.control.warnings.length, format: INTEGER_FORMAT, tone: data.control.warnings.length > 0 ? "amber" : "positive" },
  ]);

  const disclaimer = info.getCell(cursor, 1);
  info.mergeCells(cursor, 1, cursor, 3);
  disclaimer.value = "This is an operational management report, not a tax invoice, audited financial statement or statutory filing. Its accuracy depends on the transactions recorded in NRMS by authorized users. Corrections must be made in the originating transaction, then the report generated again.";
  disclaimer.alignment = { wrapText: true, vertical: "top" };
  disclaimer.font = { size: 9, color: { argb: "FF6F7C78" } };
  info.getRow(cursor).height = 46;

  /* ---- 2. Executive summary with charts ----------------------------- */
  const summary = workbook.addWorksheet("Executive Summary", { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  summary.getColumn(1).width = 46;
  summary.getColumn(2).width = 26;
  summary.getColumn(3).width = 20;
  sheetHeading(summary, input, "Executive summary", "USALI revenue summary and STR performance statistics", 3);

  const occupancy = data.occupancy;
  const trevpar = occupancy.roomNightsAvailable > 0 ? currencyReport.summary.totalRevenue / occupancy.roomNightsAvailable : 0;

  let summaryCursor = 5;
  summaryCursor = addKeyValues(summary, summaryCursor, `Revenue summary (${currency})`, [
    { label: "Rooms revenue", value: currencyReport.summary.roomRevenue, format: CURRENCY_FORMAT },
    { label: "Folio extras", value: currencyReport.summary.folioExtras, format: CURRENCY_FORMAT },
    { label: "Paid at outlet", value: currencyReport.summary.outletPaidRevenue, format: CURRENCY_FORMAT },
    { label: "Total operating revenue", value: currencyReport.summary.totalRevenue, format: CURRENCY_FORMAT, total: true },
    { label: "Total collected", value: currencyReport.summary.totalCollected, format: CURRENCY_FORMAT, tone: "positive" },
    { label: "Amount due", value: currencyReport.summary.amountDue, format: CURRENCY_FORMAT, tone: currencyReport.summary.amountDue > 0 ? "negative" : "positive" },
  ]);

  summaryCursor = addKeyValues(summary, summaryCursor, "Performance statistics (STR definitions)", [
    { label: "Rooms available (room nights)", value: occupancy.roomNightsAvailable, format: INTEGER_FORMAT },
    { label: "Rooms sold (room nights)", value: occupancy.roomNightsSold, format: INTEGER_FORMAT },
    { label: "Rooms out of service (room nights)", value: occupancy.blockedRoomNights, format: INTEGER_FORMAT, tone: occupancy.blockedRoomNights > 0 ? "amber" : undefined },
    { label: "Occupancy %", value: Number(occupancy.occupancyRate.toFixed(1)), format: PERCENT_FORMAT, total: true },
    { label: "ADR (average daily rate)", value: occupancy.adr, format: CURRENCY_FORMAT, total: true },
    { label: "RevPAR (revenue per available room)", value: occupancy.revPar, format: CURRENCY_FORMAT, total: true },
    { label: "TRevPAR (total revenue per available room)", value: Number(trevpar.toFixed(2)), format: CURRENCY_FORMAT, total: true },
  ]);

  summaryCursor = addKeyValues(summary, summaryCursor, "Collection timing", [
    { label: "Current-period collections", value: currencyReport.collectionTiming.currentPeriodCollections, format: CURRENCY_FORMAT },
    { label: "Prior-stay collections", value: currencyReport.collectionTiming.priorStayCollections, format: CURRENCY_FORMAT },
    { label: "Advance deposits", value: currencyReport.collectionTiming.advanceDeposits, format: CURRENCY_FORMAT },
    { label: "Unclassified collections", value: currencyReport.collectionTiming.unclassifiedCollections, format: CURRENCY_FORMAT, tone: currencyReport.collectionTiming.unclassifiedCollections > 0 ? "amber" : undefined },
    { label: "Collections versus revenue difference", value: currencyReport.collectionTiming.revenueToCollectionDifference, format: CURRENCY_FORMAT, total: true },
  ]);

  addKeyValues(summary, summaryCursor, "Operations", [
    { label: "Arrivals", value: data.manager.arrivals, format: INTEGER_FORMAT },
    { label: "Departures", value: data.manager.departures, format: INTEGER_FORMAT },
    { label: "In house", value: data.manager.inHouse, format: INTEGER_FORMAT },
    { label: "Cancellations", value: data.manager.cancellations, format: INTEGER_FORMAT, tone: data.manager.cancellations > 0 ? "amber" : undefined },
    { label: "No shows", value: data.manager.noShows, format: INTEGER_FORMAT, tone: data.manager.noShows > 0 ? "amber" : undefined },
    { label: "Open outlet orders", value: data.manager.openOrders, format: INTEGER_FORMAT },
    { label: "Rooms in inventory", value: data.manager.rooms.total, format: INTEGER_FORMAT },
    { label: "Rooms out of service", value: data.manager.rooms.outOfService, format: INTEGER_FORMAT, tone: data.manager.rooms.outOfService > 0 ? "amber" : undefined },
  ]);

  // Charts sit to the right of the statistics so both are visible without scrolling.
  let chartRow = 5;
  for (const chart of charts) {
    const imageId = workbook.addImage({ base64: chart.dataUrl, extension: "png" });
    summary.addImage(imageId, { tl: { col: 4, row: chartRow - 1 }, ext: { width: chart.width / 2, height: chart.height / 2 } });
    chartRow += 15;
  }

  /* ---- 3. Profit and loss -------------------------------------------- */
  const pl = workbook.addWorksheet("Profit and Loss", { pageSetup: { paperSize: 9, orientation: "portrait" } });
  pl.getColumn(1).width = 40;
  pl.getColumn(2).width = 24;
  pl.getColumn(3).width = 24;
  sheetHeading(pl, input, "Profit and loss", "Operating revenue less recorded expenses, by currency", 3);

  let plCursor = 5;
  if (!data.profitLoss.length) {
    const note = pl.getCell(plCursor, 1);
    note.value = "No revenue or expenses were recorded in this period.";
    note.font = { name: FONT, italic: true, color: { argb: "FF6F7C78" } };
    plCursor += 2;
  }
  for (const row of data.profitLoss) {
    plCursor = addKeyValues(pl, plCursor, `Profit and loss (${row.currency})`, [
      { label: "Total operating revenue", value: row.totalRevenue, format: CURRENCY_FORMAT, tone: "positive" },
      { label: "Total operating expenses", value: row.totalExpenses, format: CURRENCY_FORMAT, tone: row.totalExpenses > 0 ? "negative" : undefined },
      ...row.expensesByCategory.map((category) => ({ label: `  ${label(category.category)}`, value: category.amount, format: CURRENCY_FORMAT } as KeyValue)),
      { label: "Net profit", value: row.netProfit, format: CURRENCY_FORMAT, total: true, tone: row.netProfit >= 0 ? "positive" : "negative" },
    ]);
  }
  const plDisclaimer = pl.getCell(plCursor, 1);
  pl.mergeCells(plCursor, 1, plCursor, 3);
  plDisclaimer.value = "Revenue is recognized on the same basis as the Executive Summary. Expenses are those recorded on the Operating Expenses schedule for this period. Stock cost and depreciation are not tracked yet, so this is a partial profit and loss, not a complete statement.";
  plDisclaimer.alignment = { wrapText: true, vertical: "top" };
  plDisclaimer.font = { size: 9, color: { argb: "FF6F7C78" } };
  pl.getRow(plCursor).height = 46;

  /* ---- 4. USALI operated departments -------------------------------- */
  addTableSheet(workbook, input, {
    name: "Revenue by Department",
    title: "Schedule: operated department revenue",
    subtitle: "Departmental revenue classified against USALI operated departments",
    rows: currencyReport.departments,
    emptyNote: "No departmental revenue was recognized in this period.",
    columns: [
      { header: "USALI operated department", group: "identity", value: (row) => usaliDepartment(row.department), width: 30 },
      { header: "NRMS department", group: "identity", value: (row) => label(row.department), width: 28 },
      { header: "Transactions", group: "volume", value: (row) => row.transactions, format: INTEGER_FORMAT, total: true },
      { header: `Revenue (${currency})`, group: "revenue", value: (row) => row.amount, format: CURRENCY_FORMAT, total: true },
      { header: "Share of total revenue %", group: "revenue", value: (row) => currencyReport.summary.totalRevenue > 0 ? Number((row.amount / currencyReport.summary.totalRevenue * 100).toFixed(2)) : 0, format: PERCENT_FORMAT },
      { header: "Currency (ISO 4217)", group: "identity", value: () => currency },
    ],
  });

  /* ---- 4. Rooms schedule -------------------------------------------- */
  addTableSheet(workbook, input, {
    name: "Rooms Schedule",
    title: "Schedule 1: rooms",
    subtitle: "Room-night utilisation by room type, on STR definitions",
    rows: occupancy.byRoomType,
    emptyNote: "Configure room types and room units to calculate occupancy.",
    columns: [
      { header: "Room type", group: "identity", value: (row) => row.roomType, width: 28 },
      { header: "Rooms in inventory", group: "identity", value: (row) => row.units, format: INTEGER_FORMAT, total: true },
      { header: "Rooms available (room nights)", group: "volume", value: (row) => row.roomNightsAvailable, format: INTEGER_FORMAT, total: true },
      { header: "Rooms sold (room nights)", group: "volume", value: (row) => row.roomNightsSold, format: INTEGER_FORMAT, total: true },
      { header: "Occupancy %", group: "revenue", value: (row) => Number(row.occupancyRate.toFixed(1)), format: PERCENT_FORMAT },
    ],
  });

  /* ---- 5. Channel production ---------------------------------------- */
  addTableSheet(workbook, input, {
    name: "Channel Production",
    title: "Reservation channel production",
    subtitle: "Production by source of business, on arrival date",
    rows: data.reservationSources.filter((row) => row.currency === currency),
    emptyNote: "No channel production was recorded in this period.",
    columns: [
      { header: "Source of business", group: "identity", value: (row) => label(row.source), width: 26 },
      { header: "Reservations", group: "volume", value: (row) => row.reservations, format: INTEGER_FORMAT, total: true },
      { header: "Reservation share %", group: "volume", value: (row) => Number(row.reservationShare.toFixed(2)), format: PERCENT_FORMAT },
      { header: "Room nights", group: "volume", value: (row) => row.roomNights, format: INTEGER_FORMAT, total: true },
      { header: `Room revenue (${currency})`, group: "revenue", value: (row) => row.roomRevenue, format: CURRENCY_FORMAT, total: true },
      { header: "Revenue share %", group: "revenue", value: (row) => Number(row.revenueShare.toFixed(2)), format: PERCENT_FORMAT },
      { header: `Average reservation value (${currency})`, group: "revenue", value: (row) => row.averageReservationValue, format: CURRENCY_FORMAT },
      { header: `Folio collected (${currency})`, group: "revenue", value: (row) => row.folioCollected, format: CURRENCY_FORMAT, total: true },
      { header: "Cancellations", group: "deduction", value: (row) => row.cancellations, format: INTEGER_FORMAT, total: true },
      { header: "No shows", group: "deduction", value: (row) => row.noShows, format: INTEGER_FORMAT, total: true },
    ],
  });

  /* ---- 6. Guest ledger ---------------------------------------------- */
  addTableSheet(workbook, input, {
    name: "Guest Ledger",
    title: "Guest ledger and folio settlement",
    subtitle: "Charges, collections and outstanding balances by reservation",
    rows: data.guestBalances.filter((row) => row.currency === currency),
    emptyNote: "No guest folios in this period.",
    columns: [
      { header: "Reservation reference", group: "identity", value: (row) => row.receiptNumber || String(row.reservationId), width: 22 },
      { header: "Guest", group: "identity", value: (row) => row.guest, width: 26 },
      { header: "Room", group: "identity", value: (row) => row.room },
      { header: "Reservation status", group: "identity", value: (row) => label(row.status) },
      { header: "Check in", group: "timing", value: (row) => asDate(row.checkIn), format: DATE_FORMAT },
      { header: "Check out", group: "timing", value: (row) => asDate(row.checkOut), format: DATE_FORMAT },
      { header: `Room charges (${currency})`, group: "revenue", value: (row) => row.roomAmount, format: CURRENCY_FORMAT, total: true },
      { header: `Folio extras (${currency})`, group: "revenue", value: (row) => row.folioExtras, format: CURRENCY_FORMAT, total: true },
      { header: `Paid at outlet (${currency})`, group: "revenue", value: (row) => row.outletPaid, format: CURRENCY_FORMAT, total: true },
      { header: `Total spend (${currency})`, group: "revenue", value: (row) => row.totalSpend, format: CURRENCY_FORMAT, total: true },
      { header: `Collected (${currency})`, group: "control", value: (row) => row.totalCollected, format: CURRENCY_FORMAT, total: true },
      { header: `Amount due (${currency})`, group: "deduction", value: (row) => row.amountDue, format: CURRENCY_FORMAT, total: true },
      { header: "Settlement status", group: "deduction", value: (row) => label(row.settlementStatus) },
    ],
  });

  /* ---- 7. Payment register ------------------------------------------ */
  addTableSheet(workbook, input, {
    name: "Payment Register",
    title: "Payment register",
    subtitle: "Collections by method, operator and reference",
    rows: data.payments.rows.filter((row) => row.currency === currency),
    emptyNote: "No payments recorded in this period.",
    columns: [
      { header: `Recorded at (${EAT_LABEL})`, group: "timing", value: (row) => asDate(row.occurredAt), format: DATETIME_FORMAT, width: 18 },
      { header: "Guest", group: "identity", value: (row) => row.guest, width: 26 },
      { header: "Room", group: "identity", value: (row) => row.room },
      { header: "Payment method", group: "identity", value: (row) => label(row.method) },
      { header: "Reference", group: "identity", value: (row) => row.reference || row.referenceNumber || "" },
      { header: `Amount (${currency})`, group: "revenue", value: (row) => row.amount, format: CURRENCY_FORMAT, total: true },
      { header: "Recorded by", group: "control", value: (row) => row.recordedBy, width: 22 },
      { header: "Status", group: "control", value: (row) => row.voidedAt ? "Voided" : "Active" },
      { header: "Void reason", group: "control", value: (row) => row.voidReason || "", width: 30 },
    ],
  });

  /* ---- 8. Outlet sales ---------------------------------------------- */
  addTableSheet(workbook, input, {
    name: "Outlet Sales",
    title: "Schedule 2: food and beverage",
    subtitle: "Outlet orders, settlement mode and payment method",
    rows: data.outlets.rows.filter((row) => row.currency === currency),
    emptyNote: "No outlet orders in this period.",
    columns: [
      { header: "Order number", group: "identity", value: (row) => row.orderNumber, width: 18 },
      { header: "Outlet", group: "identity", value: (row) => row.outlet, width: 22 },
      { header: "Outlet type", group: "identity", value: (row) => label(row.outletType) },
      { header: "Guest", group: "identity", value: (row) => row.guest, width: 24 },
      { header: "Room", group: "identity", value: (row) => row.room },
      { header: "Items", group: "volume", value: (row) => row.items, width: 34 },
      { header: "Item count", group: "volume", value: (row) => row.itemCount, format: INTEGER_FORMAT, total: true },
      { header: "Settlement mode", group: "control", value: (row) => label(row.settlementMode) },
      { header: "Payment method", group: "control", value: (row) => row.settlementMode === "OUTLET_PAYMENT" ? label(row.settlementMethod || "UNCLASSIFIED") : "Not applicable" },
      { header: `Ordered at (${EAT_LABEL})`, group: "timing", value: (row) => asDate(row.orderedAt), format: DATETIME_FORMAT, width: 18 },
      { header: `Completed at (${EAT_LABEL})`, group: "timing", value: (row) => asDate(row.completedAt), format: DATETIME_FORMAT, width: 18 },
      { header: `Amount (${currency})`, group: "revenue", value: (row) => row.total, format: CURRENCY_FORMAT, total: true },
      { header: "Status", group: "control", value: (row) => label(row.status) },
      { header: "Created by", group: "control", value: (row) => row.createdBy, width: 22 },
    ],
  });

  /* ---- 8a. Staff performance ------------------------------------------ */
  addTableSheet(workbook, input, {
    name: "Staff Performance",
    title: "Individual staff performance",
    subtitle: "Outlet sales and tips by team member who settled the order, bar / restaurant / outlet-supervisor roles",
    rows: data.staffPerformance.filter((row) => row.currency === currency),
    emptyNote: "No outlet orders were settled by a named team member in this period.",
    columns: [
      { header: "Team member", group: "identity", value: (row) => row.name, width: 26 },
      { header: "Role", group: "identity", value: (row) => label(row.role) },
      { header: "Orders settled", group: "volume", value: (row) => row.orders, format: INTEGER_FORMAT, total: true },
      { header: `Sales (${currency})`, group: "revenue", value: (row) => row.sales, format: CURRENCY_FORMAT, total: true },
      { header: `Tips collected (${currency})`, group: "revenue", value: (row) => row.tips, format: CURRENCY_FORMAT, total: true },
      { header: `Average sale (${currency})`, group: "revenue", value: (row) => row.orders > 0 ? Number((row.sales / row.orders).toFixed(2)) : 0, format: CURRENCY_FORMAT },
    ],
  });

  /* ---- 8b. Operating expenses ------------------------------------------ */
  addTableSheet(workbook, input, {
    name: "Operating Expenses",
    title: "Operating expenses",
    subtitle: "Rent, utilities, supplies, wages and other costs recorded for this period",
    rows: data.expenses.rows.filter((row) => row.currency === currency),
    emptyNote: "No operating expenses were recorded in this period.",
    columns: [
      { header: `Incurred at (${EAT_LABEL})`, group: "timing", value: (row) => asDate(row.incurredAt), format: DATE_FORMAT, width: 16 },
      { header: "Category", group: "identity", value: (row) => label(row.category), width: 22 },
      { header: "Description", group: "identity", value: (row) => row.description, width: 36 },
      { header: `Amount (${currency})`, group: "deduction", value: (row) => row.amount, format: CURRENCY_FORMAT, total: true },
      { header: "Payment method", group: "control", value: (row) => row.paymentMethod ? label(row.paymentMethod) : "Accrued, unpaid" },
      { header: "Recorded by", group: "control", value: (row) => row.recordedBy, width: 22 },
      { header: "Status", group: "control", value: (row) => row.voidedAt ? "Voided" : "Active" },
    ],
  });

  /* ---- 9. Cashier shifts -------------------------------------------- */
  addTableSheet(workbook, input, {
    name: "Cashier Shifts",
    title: "Cashier accountability",
    subtitle: "Float, expected cash, declared cash and variance by shift",
    rows: finance.shifts.filter((row) => row.currency === currency),
    emptyNote: "No cashier shifts in this period.",
    columns: [
      { header: "Cashier", group: "identity", value: (row) => row.cashierName, width: 26 },
      { header: "Status", group: "identity", value: (row) => label(row.status) },
      { header: `Opened at (${EAT_LABEL})`, group: "timing", value: (row) => asDate(row.openedAt), format: DATETIME_FORMAT, width: 18 },
      { header: `Closed at (${EAT_LABEL})`, group: "timing", value: (row) => asDate(row.closedAt), format: DATETIME_FORMAT, width: 18 },
      { header: `Opening float (${currency})`, group: "revenue", value: (row) => row.openingFloat, format: CURRENCY_FORMAT, total: true },
      { header: `Expected cash (${currency})`, group: "revenue", value: (row) => row.expectedCash, format: CURRENCY_FORMAT, total: true },
      { header: `Declared cash (${currency})`, group: "control", value: (row) => row.declaredCash, format: CURRENCY_FORMAT, total: true },
      { header: `Variance (${currency})`, group: "deduction", value: (row) => row.variance, format: CURRENCY_FORMAT, total: true },
      { header: "Close note", group: "control", value: (row) => row.closeNote || "", width: 30 },
    ],
  });

  /* ---- 10. Trial balance -------------------------------------------- */
  addTableSheet(workbook, input, {
    name: "Trial Balance",
    title: "General ledger trial balance",
    subtitle: `Ledger ${finance.ledger.balanced ? "is balanced" : "does NOT balance"} for this period`,
    rows: finance.ledger.accounts.filter((row) => row.currency === currency),
    emptyNote: "No ledger accounts posted in this period.",
    columns: [
      { header: "Account code", group: "identity", value: (row) => row.accountCode, width: 16 },
      { header: "Account name", group: "identity", value: (row) => row.accountName, width: 32 },
      { header: "Account type", group: "identity", value: (row) => label(row.accountType) },
      { header: `Debit (${currency})`, group: "revenue", value: (row) => row.debit, format: CURRENCY_FORMAT, total: true },
      { header: `Credit (${currency})`, group: "deduction", value: (row) => row.credit, format: CURRENCY_FORMAT, total: true },
      { header: `Balance (${currency})`, group: "control", value: (row) => row.balance, format: CURRENCY_FORMAT, total: true },
    ],
  });

  /* ---- 11. Tax register --------------------------------------------- */
  addTableSheet(workbook, input, {
    name: "Tax Register",
    title: "Tax register",
    subtitle: finance.tax.note || "Tax recorded against posted transactions",
    rows: finance.tax.rows.filter((row) => row.currency === currency),
    emptyNote: "No tax entries in this period.",
    columns: [
      { header: "Transaction number", group: "identity", value: (row) => row.transactionNumber, width: 22 },
      { header: `Occurred at (${EAT_LABEL})`, group: "timing", value: (row) => asDate(row.occurredAt), format: DATETIME_FORMAT, width: 18 },
      { header: "Description", group: "identity", value: (row) => row.description, width: 40 },
      { header: `Tax (${currency})`, group: "deduction", value: (row) => row.tax, format: CURRENCY_FORMAT, total: true },
    ],
  });

  /* ---- 12. Audit trail ---------------------------------------------- */
  addTableSheet(workbook, input, {
    name: "Audit Trail",
    title: "Audit trail and exceptions",
    subtitle: "Voids, corrections and the responsible user",
    rows: data.audit.rows,
    emptyNote: "No audit events in this period.",
    columns: [
      { header: `Occurred at (${EAT_LABEL})`, group: "timing", value: (row) => asDate(row.occurredAt), format: DATETIME_FORMAT, width: 18 },
      { header: "Action", group: "identity", value: (row) => label(row.type), width: 24 },
      { header: "Guest", group: "identity", value: (row) => row.guest, width: 24 },
      { header: "Room", group: "identity", value: (row) => row.room },
      { header: "Reference", group: "identity", value: (row) => row.referenceNumber || String(row.reservationId), width: 20 },
      { header: "Performed by", group: "control", value: (row) => row.actor, width: 24 },
      { header: "Reason", group: "control", value: (row) => row.reason || "", width: 36 },
    ],
  });

  /* ---- 13. Definitions ---------------------------------------------- */
  addTableSheet(workbook, input, {
    name: "Definitions",
    title: "Definitions and calculation basis",
    subtitle: "How each statistic in this workbook is calculated",
    emptyNote: "",
    rows: [
      ["Occupancy %", "Rooms sold / Rooms available x 100", "STR", "Rooms out of service are excluded from rooms available."],
      ["ADR", "Rooms revenue / Rooms sold", "STR", "Average daily rate, also reported as ARR."],
      ["RevPAR", "Rooms revenue / Rooms available", "STR", "Equals Occupancy x ADR."],
      ["TRevPAR", "Total operating revenue / Rooms available", "STR", "Includes food, beverage and other operated departments."],
      ["Total operating revenue", "Rooms + folio extras + paid at outlet", "USALI", "Operated department revenue before undistributed expenses."],
      ["Rooms revenue", "Stay value allocated to occupied nights", "USALI Schedule 1", "Allocated per night, not recognised at check-out."],
      ["Food and beverage revenue", "Outlet orders settled directly", "USALI Schedule 2", "Charges routed to a guest folio appear under folio extras."],
      ["Amount due", "Total spend less total collected", "NRMS", "Outstanding guest ledger balance at period end."],
      ["Advance deposits", "Collections received before the stay period", "USALI", "A liability until the stay is consumed."],
      ["Bed occupancy %", "Bed nights occupied / Bed nights available x 100", "NBS Tanzania", "Statutory tourism statistic, distinct from room occupancy."],
      ["Net profit", "Total operating revenue - total operating expenses", "NRMS", "Partial P&amp;L: stock cost and depreciation are not tracked yet."],
      ["Operating expenses", "Sum of active (non-voided) expenses recorded for the period", "NRMS", "Recorded on the Expenses tab of Financial Control; posts to the ledger at Night Audit close."],
      ["Staff sales", "Sum of order totals settled by that team member", "NRMS", "Bar, restaurant and outlet-supervisor roles only; front desk and housekeeping have no comparable sales figure."],
      ["Timestamps", "Stored in UTC, presented as UTC+3", "East Africa Time", "EAT observes no daylight saving, so the offset is constant all year."],
    ] as Array<[string, string, string, string]>,
    columns: [
      { header: "Measure", group: "identity", value: (row) => row[0], width: 30 },
      { header: "Calculation", group: "revenue", value: (row) => row[1], width: 46 },
      { header: "Standard", group: "control", value: (row) => row[2], width: 18 },
      { header: "Note", group: "control", value: (row) => row[3], width: 56 },
    ],
  });

  await finaliseWorkbook(workbook);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
