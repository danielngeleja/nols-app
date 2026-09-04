import { describe, expect, it } from "vitest";

import {
  allowsNewAttempt,
  canOriginatePayment,
  canTransitionIntent,
  isSettledIntentStatus,
  isTerminalAttemptStatus,
  MERCHANT_ACCOUNT_STATUSES,
  type AttemptStatus,
} from "./types.js";

describe("attempt status", () => {
  it("does not treat STATUS_UNKNOWN as terminal", () => {
    // Terminal would mean "stop asking", and the whole point of this state is
    // that nobody yet knows whether money moved.
    expect(isTerminalAttemptStatus("STATUS_UNKNOWN")).toBe(false);
  });

  it("blocks a new attempt for every status where money may already have moved", () => {
    const blocked: AttemptStatus[] = [
      "REQUIRES_CUSTOMER_ACTION",
      "PROCESSING",
      "SUCCEEDED",
      "STATUS_UNKNOWN",
    ];
    for (const status of blocked) {
      expect(allowsNewAttempt(status), `${status} must block a retry`).toBe(false);
    }
  });

  it("allows a new attempt only after a resolved non-collecting outcome", () => {
    for (const status of ["CREATED", "FAILED", "EXPIRED", "CANCELLED"] as AttemptStatus[]) {
      expect(allowsNewAttempt(status), `${status} should allow a retry`).toBe(true);
    }
  });
});

describe("intent transitions", () => {
  it("refuses to let a late failure overwrite a settled payment", () => {
    expect(canTransitionIntent("SUCCEEDED", "FAILED")).toBe(false);
    expect(canTransitionIntent("SUCCEEDED", "EXPIRED")).toBe(false);
    expect(canTransitionIntent("SUCCEEDED", "CANCELLED")).toBe(false);
  });

  it("unwinds a settled payment only through an explicit post-payment event", () => {
    expect(canTransitionIntent("SUCCEEDED", "REFUNDED")).toBe(true);
    expect(canTransitionIntent("SUCCEEDED", "PARTIALLY_REFUNDED")).toBe(true);
    expect(canTransitionIntent("SUCCEEDED", "REVERSED")).toBe(true);
    expect(canTransitionIntent("SUCCEEDED", "DISPUTED")).toBe(true);
  });

  it("lets reconciliation resolve STATUS_UNKNOWN in either direction", () => {
    expect(canTransitionIntent("STATUS_UNKNOWN", "SUCCEEDED")).toBe(true);
    expect(canTransitionIntent("STATUS_UNKNOWN", "FAILED")).toBe(true);
  });

  it("treats a duplicate event as a no-op rather than an illegal transition", () => {
    // Providers repeat events as a matter of course; that must be harmless.
    expect(canTransitionIntent("SUCCEEDED", "SUCCEEDED")).toBe(true);
    expect(canTransitionIntent("FAILED", "FAILED")).toBe(true);
  });

  it("never leaves a dead-end failure state", () => {
    expect(canTransitionIntent("FAILED", "SUCCEEDED")).toBe(false);
    expect(canTransitionIntent("CANCELLED", "PROCESSING")).toBe(false);
    expect(canTransitionIntent("EXPIRED", "SUCCEEDED")).toBe(false);
  });

  it("counts every post-settlement state as settled", () => {
    expect(isSettledIntentStatus("SUCCEEDED")).toBe(true);
    expect(isSettledIntentStatus("REFUNDED")).toBe(true);
    expect(isSettledIntentStatus("DISPUTED")).toBe(true);
    expect(isSettledIntentStatus("FAILED")).toBe(false);
    expect(isSettledIntentStatus("PROCESSING")).toBe(false);
  });
});

describe("merchant account status", () => {
  it("permits payment origination from ACTIVE alone", () => {
    const originating = MERCHANT_ACCOUNT_STATUSES.filter(canOriginatePayment);
    expect(originating).toEqual(["ACTIVE"]);
  });

  it("does not treat local admin approval as provider activation", () => {
    expect(canOriginatePayment("SUBMISSION_QUEUED")).toBe(false);
    expect(canOriginatePayment("PROVIDER_ACCOUNT_CREATED")).toBe(false);
  });
});
