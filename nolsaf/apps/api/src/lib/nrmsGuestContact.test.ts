import { describe, expect, it } from "vitest";
import { nrmsGuestContactSchema, publicNrmsGuestContact } from "./nrmsGuestContact.js";

describe("NRMS guest contact settings", () => {
  it("normalizes Instagram handles and public phone numbers", () => {
    const result = nrmsGuestContactSchema.parse({
      enabled: true,
      instagramUsername: "@sheraton.hotel",
      whatsappPhone: "+255 712 345 678",
      preferredLanguage: "EN_SW",
    });
    expect(result.instagramUsername).toBe("sheraton.hotel");
    expect(result.whatsappPhone).toBe("+255712345678");
  });

  it("does not publish disabled settings", () => {
    expect(publicNrmsGuestContact({ enabled: false, instagramUsername: "hotel" })).toBeNull();
  });

  it("requires a real channel when public contact is enabled", () => {
    expect(nrmsGuestContactSchema.safeParse({ enabled: true }).success).toBe(false);
  });
});
