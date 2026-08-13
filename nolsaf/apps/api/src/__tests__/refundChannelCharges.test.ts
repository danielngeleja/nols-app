import { describe, expect, it } from "vitest";
import { calculateRefundChannelCharges, inferRefundChannel } from "../lib/refundChannelCharges";

describe("refund channel inference", () => {
  it("maps CoralCommerce to card", () => {
    expect(inferRefundChannel("CORALCOMMERCE")).toBe("CARD");
  });
  it("maps AzamPay with a payer phone to mobile money and without to bank", () => {
    expect(inferRefundChannel("AZAMPAY", "+255700000001")).toBe("MOBILE_MONEY");
    expect(inferRefundChannel("AZAMPAY", null)).toBe("BANK");
  });
  it("treats unknown or manual providers as cash or manual", () => {
    expect(inferRefundChannel("MANUAL")).toBe("CASH_MANUAL");
    expect(inferRefundChannel(null)).toBe("CASH_MANUAL");
  });
  it("recognises accommodation payment-method names", () => {
    expect(inferRefundChannel("Mpesa")).toBe("MOBILE_MONEY");
    expect(inferRefundChannel("Airtel")).toBe("MOBILE_MONEY");
    expect(inferRefundChannel("Mixx by Yas")).toBe("MOBILE_MONEY");
    expect(inferRefundChannel("CRDB Bank")).toBe("BANK");
    expect(inferRefundChannel("Visa Card")).toBe("CARD");
  });
});

describe("refund channel charges", () => {
  it("deducts the card surcharge plus the admin charge on card refunds", () => {
    const result = calculateRefundChannelCharges({ grossRefundAmount: 1_000_000, channel: "CARD" });
    expect(result.cardSurcharge).toBe(60_000);
    expect(result.adminCharge).toBe(25_000);
    expect(result.bankCharges).toBe(0);
    expect(result.netRefundAmount).toBe(915_000);
  });
  it("deducts actual bank charges plus the admin charge on bank and mobile refunds", () => {
    const result = calculateRefundChannelCharges({ grossRefundAmount: 1_000_000, channel: "BANK", actualBankCharges: 12_500 });
    expect(result.cardSurcharge).toBe(0);
    expect(result.bankCharges).toBe(12_500);
    expect(result.netRefundAmount).toBe(962_500);
  });
  it("exempts full-grace cooling-off refunds from every charge", () => {
    const result = calculateRefundChannelCharges({ grossRefundAmount: 1_000_000, channel: "CARD", eligibilityCode: "FULL_GRACE" });
    expect(result.exempt).toBe(true);
    expect(result.totalCharges).toBe(0);
    expect(result.netRefundAmount).toBe(1_000_000);
  });
  it("exempts the accommodation free-cancellation rule the same as tour full grace", () => {
    const result = calculateRefundChannelCharges({ grossRefundAmount: 400_000, channel: "MOBILE_MONEY", eligibilityCode: "FREE_24H_72H" });
    expect(result.exempt).toBe(true);
    expect(result.exemptReason).toBe("FULL_GRACE");
    expect(result.netRefundAmount).toBe(400_000);
  });
  it("exempts operator-caused refunds from every charge (policy 4A.7)", () => {
    const result = calculateRefundChannelCharges({ grossRefundAmount: 1_000_000, channel: "CARD", operatorCaused: true });
    expect(result.exempt).toBe(true);
    expect(result.exemptReason).toBe("OPERATOR_CAUSED");
    expect(result.netRefundAmount).toBe(1_000_000);
  });
  it("exempts bookings made before the charges policy existed (policy 10.2)", () => {
    const result = calculateRefundChannelCharges({ grossRefundAmount: 1_000_000, channel: "BANK", actualBankCharges: 12_500, chargesAcceptedAtBooking: false });
    expect(result.exempt).toBe(true);
    expect(result.exemptReason).toBe("PRE_POLICY_BOOKING");
    expect(result.netRefundAmount).toBe(1_000_000);
  });
  it("never produces a negative net refund", () => {
    const result = calculateRefundChannelCharges({ grossRefundAmount: 20_000, channel: "BANK", actualBankCharges: 10_000 });
    expect(result.netRefundAmount).toBe(0);
    expect(result.totalCharges).toBe(20_000);
  });
  it("ignores negative bank charge input", () => {
    const result = calculateRefundChannelCharges({ grossRefundAmount: 500_000, channel: "MOBILE_MONEY", actualBankCharges: -50 });
    expect(result.bankCharges).toBe(0);
    expect(result.netRefundAmount).toBe(475_000);
  });
});
