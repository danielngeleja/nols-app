import assert from "node:assert/strict";
import test from "node:test";

import {
  formatOtpCountdown,
  getOtpRetryAfterSeconds,
  getOtpSendErrorMessage,
} from "./lib/otpRateLimit.ts";

test("OTP retry duration prefers the structured response body", () => {
  assert.equal(getOtpRetryAfterSeconds({ retryAfterMs: 90_001 }, "10"), 91);
  assert.equal(getOtpRetryAfterSeconds({ retryAfterSeconds: 45 }, null), 45);
});

test("OTP retry duration falls back to the Retry-After header", () => {
  assert.equal(getOtpRetryAfterSeconds({}, "120"), 120);
});

test("OTP 429 errors include a readable countdown", () => {
  assert.equal(formatOtpCountdown(899), "14:59");
  assert.equal(
    getOtpSendErrorMessage({ error: "rate_limited" }, 429, 899),
    "Too many OTP requests. Try again in 14:59.",
  );
});

test("non-rate-limit OTP errors preserve the server message", () => {
  assert.equal(getOtpSendErrorMessage({ message: "SMS provider unavailable" }, 503, 0), "SMS provider unavailable");
  assert.equal(getOtpSendErrorMessage({ error: "Invalid phone number" }, 400, 0), "Invalid phone number");
});
