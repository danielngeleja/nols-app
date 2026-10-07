import { describe, expect, it } from "vitest";
import { checkInConfirmationText } from "./checkInConfirmationSms.js";

describe("checkInConfirmationText", () => {
  it("states the property, the time in EAT and the support number", () => {
    const text = checkInConfirmationText({
      propertyTitle: "NoLSAF Hotel",
      usedAt: new Date("2026-10-07T11:00:00Z"),
      supportPhone: "+255736766726",
    });
    expect(text).toBe(
      "NoLSAF: Check-in confirmed at NoLSAF Hotel on 07 Oct, 14:00 EAT. If you have not checked in, call NoLSAF now on +255736766726."
    );
  });

  it("shortens a long property title", () => {
    const text = checkInConfirmationText({
      propertyTitle: "A very long property name that goes on and on past forty characters",
      usedAt: new Date("2026-10-07T11:00:00Z"),
      supportPhone: "+255736766726",
    });
    expect(text).toContain("at A very long property name that goes on.");
  });

  it("never uses an em dash", () => {
    const text = checkInConfirmationText({ propertyTitle: null, usedAt: new Date(), supportPhone: "+255736766726" });
    expect(text).not.toContain("—");
  });
});
