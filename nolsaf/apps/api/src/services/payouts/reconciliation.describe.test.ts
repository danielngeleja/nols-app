import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));
vi.mock("../azampay/disbursement/client.js", () => ({ azamPayTransactionStatus: vi.fn() }));
vi.mock("./ledger.js", () => ({ applyProviderEvent: vi.fn(), recordAmountMismatch: vi.fn() }));

import { describeStatusReply } from "./reconciliation.js";

describe("describeStatusReply", () => {
  const reply = {
    success: true,
    statusCode: 200,
    message: "Transfer to 255747249846 failed: Balance can not be negative",
    pgReferenceId: "PG-77",
    transactionStatus: "FAILED",
    data: {
      status: "failure",
      accountNumber: "255747249846",
      receiverName: "ESTER MASANYIWA SHIMIYU",
      fspReferenceId: "FSP-1",
      amount: "80000",
    },
  };

  it("lists every field so the real result field can be found", () => {
    const { fields } = describeStatusReply(reply);
    expect(fields).toEqual(expect.arrayContaining(["transactionStatus", "data.status", "data.accountNumber", "data.receiverName"]));
  });

  it("logs status-like values and never account, name or reference values", () => {
    const { values } = describeStatusReply(reply);
    expect(values).toMatchObject({ success: true, statusCode: 200, transactionStatus: "FAILED", "data.status": "failure" });
    const logged = JSON.stringify(values);
    expect(logged).not.toContain("255747249846");
    expect(logged).not.toContain("ESTER");
    expect(logged).not.toContain("PG-77");
    expect(logged).not.toContain("FSP-1");
    expect(logged).not.toContain("80000");
    expect(values.message).toBe("Transfer to [digits] failed: Balance can not be negative");
  });

  it("copes with an empty or odd reply", () => {
    expect(describeStatusReply(null)).toEqual({ fields: [], values: {} });
    expect(describeStatusReply([1, 2])).toEqual({ fields: [], values: {} });
  });
});
