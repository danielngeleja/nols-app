import { describe, expect, it } from "vitest";
import { redactOwnerCheckinCode } from "./ownerCheckinCodePrivacy.js";

describe("owner check-in code privacy", () => {
  it("removes active and historical credentials from nested booking and receipt data", () => {
    const response = {
      bookingId: 12,
      bookingReference: "BK-12-PUBLIC",
      code: { id: 4, code: "GUESTABC", codeVisible: "GUESTABC", codeHash: "secret-hash", status: "ACTIVE" },
      receiptSnapshot: { bookingCode: "GUESTABC", receiptNumber: "RCPT-12" },
      booking: { codeVisible: "GUESTABC" },
    };
    const safe = redactOwnerCheckinCode(response);
    expect(safe.bookingReference).toBe("BK-12-PUBLIC");
    expect(safe.code).toEqual({ id: 4, code: null, codeVisible: null, codeHash: null, status: "ACTIVE" });
    expect(safe.receiptSnapshot).toEqual({ bookingCode: null, receiptNumber: "RCPT-12" });
    expect(safe.booking.codeVisible).toBeNull();
    expect(response.code.code).toBe("GUESTABC");
  });

  it("keeps noncredential status codes and room codes", () => {
    expect(redactOwnerCheckinCode({ code: "ROOM_ASSIGNMENT_REQUIRED", roomCode: "A101" })).toEqual({
      code: "ROOM_ASSIGNMENT_REQUIRED", roomCode: "A101",
    });
  });

  it("does not echo the code entered for owner preview", () => {
    expect(redactOwnerCheckinCode({ details: { bookingId: 42, code: "ABCD2345", bookingReference: "BK-42" } })).toEqual({
      details: { bookingId: 42, code: null, bookingReference: "BK-42" },
    });
  });
});
