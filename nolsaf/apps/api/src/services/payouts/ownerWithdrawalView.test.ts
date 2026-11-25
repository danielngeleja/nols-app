import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import { ownerWithdrawalState, toOwnerWithdrawalView } from "./ownerWithdrawalView.js";

const transfer = (status: string, extra: Record<string, unknown> = {}) => ({
  sourceId: 3, status, approvedAt: null, submittedAt: null, paidAt: null, failedAt: null, ...extra,
});

describe("ownerWithdrawalState", () => {
  it.each([
    [null, null, "PREPARING"],
    ["PENDING", null, "PREPARING"],
    ["REVIEW_REQUIRED", null, "CHECKING"],
    ["CANCELLED", null, "RETURNED"],
    ["DONE", "REQUESTED", "CHECKING"],
    ["DONE", "SECURITY_REVIEW", "CHECKING"],
    ["DONE", "APPROVED", "SENDING"],
    ["DONE", "PROCESSING", "SENDING"],
    ["DONE", "PAID", "PAID"],
    // Failed and released: the money is back in Ready.
    ["CANCELLED", "FAILED", "RETURNED"],
    // Failed but kept with finance (refund-debt case): not "returned" yet.
    ["DONE", "FAILED", "CHECKING"],
  ])("handoff %s + transfer %s is %s", (handoff, status, expected) => {
    expect(ownerWithdrawalState(handoff, status ? transfer(status) : null)).toBe(expected);
  });
});

describe("toOwnerWithdrawalView", () => {
  it("shows the first production withdrawal as returned, without internal wording", () => {
    const failedAt = new Date("2026-11-25T20:13:18Z");
    const view = toOwnerWithdrawalView(
      { id: 3, reference: "wd_abc", totalAmount: "80000.00", currency: "TZS", destinationMasked: "vodacom ***846",
        usedAt: new Date("2026-11-25T19:30:00Z"), handoffStatus: "CANCELLED" },
      transfer("FAILED", { approvedAt: new Date("2026-11-25T19:34:00Z"), submittedAt: new Date("2026-11-25T19:39:18Z"), failedAt }),
    );
    expect(view).toMatchObject({ state: "RETURNED", amount: 80000, returnedAt: failedAt, paidAt: null, destination: "vodacom ***846" });
    expect(JSON.stringify(view)).not.toMatch(/Balance|correlation|azampesa/i);
  });
});
