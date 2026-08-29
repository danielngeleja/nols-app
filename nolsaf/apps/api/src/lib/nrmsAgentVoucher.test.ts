import { describe, expect, it, vi } from "vitest";
import { buildAgentVoucherNumber, loadAgentVoucherContext, verifyAgentVoucherNumber } from "./nrmsAgentVoucher.js";

function dbWithPayment(status: string) {
  return {
    nrmsAgentBookingRequest: { findFirst: vi.fn(async () => ({
      id: 8, propertyId: 2, roomTypeId: null, checkIn: new Date("2026-09-01"), checkOut: new Date("2026-09-02"), roomsRequested: 1, currency: "TZS", quotedTotal: 100,
      link: { bookingMode: "INSTANT", agentAccount: { id: 3, legalName: "Agency", primaryUser: { email: "a@example.com" } } },
      reservation: { receiptNumber: "R-1", confirmedAt: new Date(), totalAmount: 100, allocations: [] },
      masterFolio: { status },
    })) },
    property: { findUnique: vi.fn(async () => ({ title: "Hotel", regionName: "Arusha", district: null })) },
  };
}

describe("loadAgentVoucherContext", () => {
  it("does not expose a voucher before the property records settlement", async () => {
    expect(await loadAgentVoucherContext(dbWithPayment("PENDING") as any, 8)).toBeNull();
  });

  it("creates voucher context only after owner-confirmed settlement", async () => {
    const result = await loadAgentVoucherContext(dbWithPayment("SETTLED") as any, 8);
    expect(result).toMatchObject({ voucherNumber: "R-1", recipientEmail: "a@example.com" });
  });
});

describe("agent voucher numbering", () => {
  it("hides the booking count behind an offset and a check group", () => {
    expect(buildAgentVoucherNumber(1)).toMatch(/^AGV-01001-[0-9A-Z]{4}$/);
  });

  it("is stable for the same request", () => {
    expect(buildAgentVoucherNumber(42)).toBe(buildAgentVoucherNumber(42));
  });

  it("resolves back to the request id", () => {
    expect(verifyAgentVoucherNumber(buildAgentVoucherNumber(42))).toBe(42);
    expect(verifyAgentVoucherNumber(` ${buildAgentVoucherNumber(42).toLowerCase()} `)).toBe(42);
  });

  it("rejects a number walked from a neighbouring voucher", () => {
    const check = buildAgentVoucherNumber(42).split("-")[2];
    expect(verifyAgentVoucherNumber(`AGV-01043-${check}`)).toBeNull();
    expect(verifyAgentVoucherNumber("AGV-01042")).toBeNull();
    expect(verifyAgentVoucherNumber("R-1")).toBeNull();
  });
});
