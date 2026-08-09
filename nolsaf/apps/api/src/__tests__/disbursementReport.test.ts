import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@nolsaf/prisma", async (importOriginal) => {
  const original = await importOriginal<any>();
  return { ...original, prisma: {} };
});

import { buildReportWhere, parseReportDate, reportFileName, toReportCsv, REPORT_CSV_COLUMNS } from "../services/payouts/report";

function row(overrides: Record<string, any> = {}): any {
  return {
    id: 8841,
    externalReferenceId: "NoLSAF-D-2608091420-A1B2C3",
    pgReferenceId: "AZP-99123",
    fspReferenceId: "FSP-771",
    status: "PAID",
    sourceType: "OWNER_INVOICE",
    sourceId: 302,
    amount: new Prisma.Decimal(2400000),
    currency: "TZS",
    bankName: "airtel",
    operator: "Airtel",
    riskLevel: "LOW",
    remarks: null,
    providerMessage: "Success",
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    approvedAt: new Date("2026-08-01T10:00:00.000Z"),
    paidAt: new Date("2026-08-06T16:19:12.000Z"),
    batch: { id: 41, batchReference: "BATCH-2608091420-K7Q2M", status: "COMPLETED" },
    approvedBy: { id: 4, name: "Daniel N.", email: "d@example.com" },
    payoutAccount: {
      id: 9,
      userId: 77,
      type: "MOBILE_MONEY",
      provider: "airtel",
      accountNumber: "255688000001",
      accountName: 'ZANZIBAR "BEACH" LTD',
      isVerified: true,
      lastVerifiedAt: new Date("2026-08-05T07:00:00.000Z"),
      user: { id: 77, name: "Zanzibar Beach Ltd", email: "z@example.com", phone: null },
    },
    ...overrides,
  };
}

describe("disbursement report filters", () => {
  it("maps recipient groups onto the source types the rows actually carry", () => {
    const where: any = buildReportWhere({
      dateField: "paidAt",
      groups: ["OWNERS", "DRIVERS"],
      statuses: ["PAID"],
    });
    expect(where.sourceType).toEqual({ in: ["OWNER_INVOICE", "DRIVER_TRIP"] });
    expect(where.status).toEqual({ in: ["PAID"] });
  });

  it("scopes to one beneficiary through the payout account owner", () => {
    const where: any = buildReportWhere({ dateField: "createdAt", groups: [], statuses: [], recipientUserId: 77 });
    expect(where.payoutAccount).toEqual({ is: { userId: 77 } });
  });

  it("filters bank destinations apart from mobile money", () => {
    const where: any = buildReportWhere({ dateField: "createdAt", groups: [], statuses: [], destinationType: "BANK" });
    expect(where.payoutAccount).toEqual({ is: { type: "BANK" } });
  });

  it("merges beneficiary and destination type into one relation filter", () => {
    // Two separate `payoutAccount` keys would silently drop the first.
    const where: any = buildReportWhere({
      dateField: "createdAt",
      groups: [],
      statuses: [],
      recipientUserId: 77,
      destinationType: "BANK",
    });
    expect(where.payoutAccount).toEqual({ is: { userId: 77, type: "BANK" } });
  });

  it("applies the range to the chosen date field and leaves the others alone", () => {
    const from = new Date("2026-08-01T00:00:00.000Z");
    const where: any = buildReportWhere({ dateField: "paidAt", groups: [], statuses: [], from });
    expect(where.paidAt).toEqual({ gte: from });
    expect(where.createdAt).toBeUndefined();
  });

  it("omits every filter that was not asked for", () => {
    const where: any = buildReportWhere({ dateField: "createdAt", groups: [], statuses: [] });
    expect(Object.keys(where)).toHaveLength(0);
  });
});

describe("report date boundaries", () => {
  const previous = process.env.REPORT_TIMEZONE;
  beforeEach(() => { process.env.REPORT_TIMEZONE = "Africa/Dar_es_Salaam"; });
  afterEach(() => { process.env.REPORT_TIMEZONE = previous; });

  it("starts a day at local midnight, not UTC midnight", () => {
    // Dar es Salaam is UTC+3, so 1 August starts at 21:00 UTC on 31 July.
    expect(parseReportDate("2026-08-01", "start").toISOString()).toBe("2026-07-31T21:00:00.000Z");
  });

  it("ends a day at the last local millisecond", () => {
    expect(parseReportDate("2026-08-31", "end").toISOString()).toBe("2026-08-31T20:59:59.999Z");
  });

  it("keeps a payout made at 01:00 local inside the day the operator sees", () => {
    const paidAt = new Date("2026-08-01T22:00:00.000Z"); // 2 August, 01:00 local
    const start = parseReportDate("2026-08-02", "start");
    const end = parseReportDate("2026-08-02", "end");
    expect(paidAt >= start && paidAt <= end).toBe(true);
  });

  it("passes a full timestamp through untouched", () => {
    expect(parseReportDate("2026-08-01T12:34:56.000Z", "start").toISOString()).toBe("2026-08-01T12:34:56.000Z");
  });
});

describe("report CSV", () => {
  const previousZone = process.env.REPORT_TIMEZONE;
  const previousSender = process.env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT;
  beforeEach(() => {
    process.env.REPORT_TIMEZONE = "Africa/Dar_es_Salaam";
    process.env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT = "680801092";
  });
  afterEach(() => {
    process.env.REPORT_TIMEZONE = previousZone;
    process.env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT = previousSender;
  });

  it("writes the header and one line per payout", () => {
    const csv = toReportCsv([row(), row({ id: 8842, externalReferenceId: "NoLSAF-D-2608091420-D4E5F6" })], { unmasked: false });
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(REPORT_CSV_COLUMNS.map((column) => `"${column}"`).join(","));
  });

  it("numbers rows oldest first, so the file reads forward like a statement", () => {
    // loadReportRows returns newest first; the export reverses it.
    const csv = toReportCsv([row({ externalReferenceId: "NEWER" }), row({ externalReferenceId: "OLDER" })], { unmasked: false });
    const lines = csv.split("\r\n");
    expect(lines[1].startsWith('"1","OLDER"')).toBe(true);
    expect(lines[2].startsWith('"2","NEWER"')).toBe(true);
  });

  it("labels a bank destination as such and still prints its account number", () => {
    const bankRow = row({
      bankName: "crdb",
      operator: null,
      payoutAccount: {
        ...row().payoutAccount,
        type: "BANK",
        provider: "crdb",
        accountNumber: "0150312345600",
        accountName: "SERENGETI TRAILS CO",
      },
    });
    const csv = toReportCsv([bankRow], { unmasked: true });
    expect(csv).toContain('"Bank","0150312345600","SERENGETI TRAILS CO"');
    // OPERATOR CODE names the institution for both kinds of destination.
    expect(csv).toContain('"crdb"');
  });

  it("masks the destination by default and prints it in full only when asked", () => {
    expect(toReportCsv([row()], { unmasked: false })).toContain('"••••••••0001"');
    expect(toReportCsv([row()], { unmasked: true })).toContain('"255688000001"');
  });

  it("splits the payment stamp into local date and time", () => {
    const csv = toReportCsv([row()], { unmasked: false });
    // 16:19:12 UTC is 19:19:12 in Dar es Salaam, on 6 August.
    expect(csv).toContain('"6/8/2026","19:19:12"');
  });

  it("escapes quotes rather than breaking the row", () => {
    expect(toReportCsv([row()], { unmasked: false })).toContain('"ZANZIBAR ""BEACH"" LTD"');
  });

  it("falls back to the report label only where a payout carries no remarks of its own", () => {
    const withOwn = toReportCsv([row({ remarks: "Invoice 302 settlement" })], { unmasked: false, label: "Week ended 30th July 2026" });
    expect(withOwn).toContain('"Invoice 302 settlement"');
    expect(withOwn).not.toContain('"Week ended 30th July 2026"');

    const withoutOwn = toReportCsv([row()], { unmasked: false, label: "Week ended 30th July 2026" });
    expect(withoutOwn).toContain('"Week ended 30th July 2026"');
  });

  it("leaves payment date and time empty for a payout that never settled", () => {
    const csv = toReportCsv([row({ status: "FAILED", paidAt: null })], { unmasked: false });
    expect(csv).toContain('"FAILED"');
    expect(csv).toContain('"","","Airtel"');
  });

  it("names the file after the scope and range so it can be filed unrenamed", () => {
    const name = reportFileName({
      dateField: "paidAt",
      groups: ["OWNERS"],
      statuses: [],
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-08-31T00:00:00.000Z"),
    });
    expect(name).toContain("NoLSAF_Disbursement_owners_2026-08-01_2026-08-31");
    expect(name.endsWith(".csv")).toBe(true);
  });
});
