import { describe, expect, it } from "vitest";
import { redactSensitiveUrl } from "./safeAccessLog.js";

describe("redactSensitiveUrl", () => {
  it("redacts NRMS capability path segments", () => {
    expect(redactSensitiveUrl("/api/public/nrms/guest/payment-requests/secret-value?x=1"))
      .toBe("/api/public/nrms/guest/payment-requests/[REDACTED]?x=1");
    expect(redactSensitiveUrl("/api/public/nrms/guest/reviews/review-secret/intent"))
      .toBe("/api/public/nrms/guest/reviews/[REDACTED]/intent");
  });

  it("redacts sensitive query parameters without damaging other parameters", () => {
    expect(redactSensitiveUrl("/api/auth/handoff?token=secret&next=%2Fowner"))
      .toBe("/api/auth/handoff?token=[REDACTED]&next=%2Fowner");
  });
});
