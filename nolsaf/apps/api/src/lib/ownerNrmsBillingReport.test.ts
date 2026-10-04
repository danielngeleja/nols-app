import { describe, expect, it } from "vitest";
import { buildOwnerNrmsBillingRecords } from "./ownerNrmsBillingReport.js";

const closedAt = new Date("2026-09-01T08:00:00.000Z");
const verifiedAt = new Date("2026-09-02T09:30:00.000Z");

function statement(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    status: "PAID",
    amount: 129_000,
    currency: "TZS",
    closedAt,
    paidAt: verifiedAt,
    account: { property: { id: 8, title: "Serengeti Lodge" } },
    tokens: [],
    ...overrides,
  };
}

describe("buildOwnerNrmsBillingRecords", () => {
  it("reports manual reconciliation evidence and never exposes the full token", () => {
    const fullToken = "NRMS-1234567890ABCDEF";
    const [record] = buildOwnerNrmsBillingRecords([
      statement({
        tokens: [{
          id: 77, token: fullToken, status: "PAID", method: "BANK",
          payment: { provider: "ADMIN_MANUAL", providerRef: "BANK-TRACE-44", status: "MANUALLY_VERIFIED", verifiedAt },
        }],
      }),
    ], [{ details: { tokenId: 77, reason: "Bank receipt confirmed" }, admin: { name: "Finance Admin", email: "finance@example.com" } }]);

    expect(record).toMatchObject({
      method: "BANK",
      providerReference: "BANK-TRACE-44",
      reconciliation: "MANUAL",
      reconciledBy: "Finance Admin",
      reconciliationReason: "Bank receipt confirmed",
    });
    expect(record.tokenReference).toBe("#77 · …ABCDEF");
    expect(record.tokenReference).not.toContain(fullToken);
  });

  it("labels a gateway-confirmed payment as provider verified", () => {
    const [record] = buildOwnerNrmsBillingRecords([
      statement({
        tokens: [{
          id: 78, token: "NRMS-PROVIDER123456", status: "PAID", method: "MOBILE_MONEY",
          payment: { provider: "AZAMPAY", providerRef: "AZ-991", status: "VERIFIED", verifiedAt },
        }],
      }),
    ], []);

    expect(record).toMatchObject({ reconciliation: "PROVIDER", provider: "AZAMPAY", paymentStatus: "VERIFIED" });
  });

  it("keeps an unpaid statement traceable without claiming reconciliation", () => {
    const [record] = buildOwnerNrmsBillingRecords([
      statement({
        status: "PAYABLE", paidAt: null,
        tokens: [{ id: 79, token: "NRMS-PENDING654321", status: "PENDING", method: null, payment: null }],
      }),
    ], []);

    expect(record).toMatchObject({ statementStatus: "PAYABLE", method: null, reconciliation: "NONE", verifiedAt: null });
  });
});
