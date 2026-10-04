import { describe, expect, it } from "vitest";

import {
  canReconcileAutomatically,
  capabilitiesAreValid,
  checkCollectionCapability,
  checkRefundCapability,
  NO_CAPABILITIES,
  parseCapabilities,
  supportsChannel,
  supportsCurrency,
} from "./capabilities.js";

describe("capability parsing fails closed", () => {
  it("grants nothing for null, undefined or a non-object", () => {
    for (const input of [null, undefined, "MNO", 42, []]) {
      expect(parseCapabilities(input)).toEqual(NO_CAPABILITIES);
    }
  });

  it("grants nothing when an unknown key is present", () => {
    // A typo must surface as "no capabilities" during qualification, not
    // silently disable one rail in production.
    const result = parseCapabilities({ channels: ["MNO"], supportsRefunds: true });
    expect(result).toEqual(NO_CAPABILITIES);
    expect(capabilitiesAreValid({ channels: ["MNO"], supportsRefunds: true })).toBe(false);
  });

  it("grants nothing when a channel is not a known channel", () => {
    expect(parseCapabilities({ channels: ["CRYPTO"] })).toEqual(NO_CAPABILITIES);
  });

  it("defaults every boolean capability to false", () => {
    const result = parseCapabilities({ channels: ["MNO"], currencies: ["TZS"] });
    expect(result.supportsRefund).toBe(false);
    expect(result.supportsPartialRefund).toBe(false);
    expect(result.supportsStatusQuery).toBe(false);
    expect(result.supportsSubmerchant).toBe(false);
  });

  it("normalizes currency case so tzs and TZS agree", () => {
    const result = parseCapabilities({ channels: ["MNO"], currencies: ["tzs"] });
    expect(supportsCurrency(result, "TZS")).toBe(true);
    expect(supportsCurrency(result, "tzs")).toBe(true);
  });
});

describe("collection capability gate", () => {
  const capabilities = parseCapabilities({ channels: ["MNO"], currencies: ["TZS"] });

  it("allows a declared channel and currency", () => {
    expect(checkCollectionCapability(capabilities, { channel: "MNO", currency: "TZS" })).toEqual({
      ok: true,
    });
  });

  it("refuses an undeclared channel", () => {
    const result = checkCollectionCapability(capabilities, { channel: "CARD", currency: "TZS" });
    expect(result).toMatchObject({ ok: false, code: "channel_not_supported" });
  });

  it("refuses an undeclared currency", () => {
    const result = checkCollectionCapability(capabilities, { channel: "MNO", currency: "USD" });
    expect(result).toMatchObject({ ok: false, code: "currency_not_supported" });
  });

  it("does not name the provider in the refusal message", () => {
    const result = checkCollectionCapability(capabilities, { channel: "CARD", currency: "TZS" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.toLowerCase()).not.toContain("azampay");
  });

  it("reports channel support directly", () => {
    expect(supportsChannel(capabilities, "MNO")).toBe(true);
    expect(supportsChannel(capabilities, "HOSTED_CHECKOUT")).toBe(false);
  });
});

describe("refund capability gate", () => {
  it("refuses any refund when the provider cannot refund", () => {
    const capabilities = parseCapabilities({ channels: ["MNO"], currencies: ["TZS"] });
    expect(checkRefundCapability(capabilities, { isPartial: false })).toMatchObject({
      ok: false,
      code: "refund_not_supported",
    });
  });

  it("refuses a partial refund on a full-refund-only provider", () => {
    // Silently rounding a partial up to a full refund would return money
    // nobody authorised returning.
    const capabilities = parseCapabilities({
      channels: ["MNO"],
      currencies: ["TZS"],
      supportsRefund: true,
    });
    expect(checkRefundCapability(capabilities, { isPartial: true })).toMatchObject({
      ok: false,
      code: "partial_refund_not_supported",
    });
    expect(checkRefundCapability(capabilities, { isPartial: false })).toEqual({ ok: true });
  });
});

describe("automatic reconciliation", () => {
  it("is impossible without a status query or a settlement report", () => {
    const capabilities = parseCapabilities({ channels: ["MNO"], currencies: ["TZS"] });
    expect(canReconcileAutomatically(capabilities)).toBe(false);
  });

  it("is possible with either one", () => {
    expect(canReconcileAutomatically(parseCapabilities({ supportsStatusQuery: true }))).toBe(true);
    expect(canReconcileAutomatically(parseCapabilities({ supportsSettlementReport: true }))).toBe(
      true
    );
  });
});
