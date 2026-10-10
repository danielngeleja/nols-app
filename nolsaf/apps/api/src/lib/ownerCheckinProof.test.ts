import { describe, expect, it } from "vitest";
import { presentedCheckinCode } from "./ownerCheckinProof.js";

describe("guest-held check-in proof", () => {
  it("rejects a receipt QR containing only a booking ID", () => {
    expect(presentedCheckinCode(JSON.stringify({ bookingId: 42, receipt: "RCPT-42" }), 42)).toBeNull();
  });

  it("accepts an entered code or a code-bearing QR for the same booking", () => {
    expect(presentedCheckinCode(" abcd2345 ", 42)).toBe("ABCD2345");
    expect(presentedCheckinCode(JSON.stringify({ bookingId: 42, checkinCode: "ABCD2345" }), 42)).toBe("ABCD2345");
  });

  it("rejects a QR for another booking", () => {
    expect(presentedCheckinCode(JSON.stringify({ bookingId: 41, code: "ABCD2345" }), 42)).toBeNull();
  });
});
