import { describe, expect, it } from "vitest";
import { buildInquiryAcknowledgement } from "./nrmsInquiryAcknowledgement.js";

describe("buildInquiryAcknowledgement", () => {
  it("names the guest, stay and available hotel channels", () => {
    expect(buildInquiryAcknowledgement({
      propertyTitle: "Sheraton Hotel",
      guestName: "Amina Hassan",
      checkIn: "2026-09-12",
      checkOut: "2026-09-14",
      channels: { whatsapp: true, instagram: true, phone: true },
    })).toBe("Hello Amina, we received your request for 12–14 September. Sheraton Hotel reception is checking availability. You can continue on WhatsApp, Instagram or phone.");
  });

  it("falls back to the submitted contact details when no public channel is configured", () => {
    expect(buildInquiryAcknowledgement({ propertyTitle: "Harbour Lodge" }))
      .toBe("Hello, we received your request. Harbour Lodge reception is checking availability. Reception will contact you using the details you provided.");
  });
});
