import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  allocateReceiptNumber,
  allocateSequenceValue,
  formatReceiptNumber,
  receiptPeriodFor,
} from "./documentSequence.js";

/** Stand-in transaction client. Records the SQL it was handed. */
const tx = { $executeRaw: mocks.executeRaw, $queryRaw: mocks.queryRaw };

/** Join a tagged-template SQL fragment back into inspectable text. */
const sqlText = (strings: TemplateStringsArray) => strings.join("?");

describe("allocateSequenceValue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx));
    mocks.executeRaw.mockResolvedValue(1);
    mocks.queryRaw.mockResolvedValue([{ lastValue: 7 }]);
  });

  it("returns the value the locked row now holds", async () => {
    await expect(allocateSequenceValue("RCPT", "2026")).resolves.toBe(7);
  });

  it("runs both statements inside one interactive transaction", async () => {
    // Prisma pools connections. An INSERT and a bare SELECT on different
    // connections would read another caller's value, so this must be one
    // transaction, not two loose statements.
    await allocateSequenceValue("RCPT", "2026");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("increments with a plain lastValue + 1, never LAST_INSERT_ID", async () => {
    // LAST_INSERT_ID(lastValue + 1) only works on the ON DUPLICATE KEY branch.
    // On a genuine INSERT, the first receipt of a new year, it returns the new
    // row's AUTO_INCREMENT id instead and hands out a wrong number.
    await allocateSequenceValue("RCPT", "2026");
    const sql = sqlText(mocks.executeRaw.mock.calls[0][0]);
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(sql).toContain("lastValue = lastValue + 1");
    expect(sql).not.toContain("LAST_INSERT_ID");
  });

  it("throws rather than returning a bogus number when the row is missing", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(allocateSequenceValue("RCPT", "2026")).rejects.toThrow(/no value/i);
  });

  it("throws on a non-positive value instead of issuing RCPT/2026/00000", async () => {
    mocks.queryRaw.mockResolvedValue([{ lastValue: 0 }]);
    await expect(allocateSequenceValue("RCPT", "2026")).rejects.toThrow(/no value/i);
  });
});

describe("receipt number formatting", () => {
  it("matches the format already printed on issued receipts", () => {
    expect(formatReceiptNumber("2026", 42)).toBe("RCPT/2026/00042");
  });

  it("keeps five-digit padding so numbers within a year sort as strings", () => {
    const ordered = [1, 2, 10, 99, 100, 99999].map((n) => formatReceiptNumber("2026", n));
    expect([...ordered].sort()).toEqual(ordered);
  });

  it("does not truncate once the sequence outgrows the padding", () => {
    expect(formatReceiptNumber("2026", 100000)).toBe("RCPT/2026/100000");
  });

  it("uses the calendar year as the reset boundary", () => {
    expect(receiptPeriodFor(new Date("2026-08-11T21:00:00Z"))).toBe("2026");
  });
});

describe("allocateReceiptNumber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx));
    mocks.executeRaw.mockResolvedValue(1);
    mocks.queryRaw.mockResolvedValue([{ lastValue: 43 }]);
  });

  it("allocates against the RCPT scope for the given year", async () => {
    await expect(allocateReceiptNumber(new Date("2026-08-11T21:00:00Z"))).resolves.toBe("RCPT/2026/00043");
  });
});
