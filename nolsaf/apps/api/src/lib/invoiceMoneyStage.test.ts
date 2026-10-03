import { describe, expect, it } from "vitest";
import { moneyStageOf } from "./invoiceMoneyStage.js";

const booking = (status: string) => ({ status, invoiceNumber: "INV-2026-0001" });
const claim = (status: string) => ({ status, invoiceNumber: "OINV-2026-0001" });
const d = (status: string) => ({ status, paidAt: status === "PAID" ? new Date() : null });

describe("moneyStageOf", () => {
  it("treats PAID on a booking invoice as the guest's payment, not a disbursement", () => {
    expect(moneyStageOf(booking("PAID"), [])).toEqual({ stage: "GUEST_PAID", manual: false });
    expect(moneyStageOf(booking("CUSTOMER_PAID"), []).stage).toBe("GUEST_PAID");
  });

  it("only calls an invoice disbursed when a disbursement settled", () => {
    expect(moneyStageOf(booking("PAID"), [d("PAID")]).stage).toBe("DISBURSED");
    expect(moneyStageOf(booking("APPROVED"), [d("FAILED"), d("PAID")]).stage).toBe("DISBURSED");
  });

  it("reads a settled owner claim without a disbursement as a manual payout", () => {
    expect(moneyStageOf(claim("PAID"), [])).toEqual({ stage: "DISBURSED", manual: true });
  });

  it("splits PROCESSING into guest payment in flight and payout in flight", () => {
    expect(moneyStageOf(booking("PROCESSING"), []).stage).toBe("AWAITING_GUEST");
    expect(moneyStageOf(booking("PROCESSING"), [d("SUBMITTED")]).stage).toBe("DISBURSING");
    expect(moneyStageOf(claim("PROCESSING"), []).stage).toBe("DISBURSING");
  });

  it("surfaces held and failed disbursements", () => {
    expect(moneyStageOf(booking("APPROVED"), [d("SECURITY_REVIEW")]).stage).toBe("ON_HOLD");
    expect(moneyStageOf(booking("APPROVED"), [d("FAILED")]).stage).toBe("FAILED");
  });

  it("maps the claim workflow and the remaining states", () => {
    expect(moneyStageOf(claim("REQUESTED"), []).stage).toBe("IN_REVIEW");
    expect(moneyStageOf(booking("VERIFIED"), []).stage).toBe("IN_REVIEW");
    expect(moneyStageOf(booking("PENDING"), []).stage).toBe("AWAITING_GUEST");
    expect(moneyStageOf(booking("REJECTED"), []).stage).toBe("REJECTED");
    expect(moneyStageOf(claim("DRAFT"), []).stage).toBe("OTHER");
  });
});
