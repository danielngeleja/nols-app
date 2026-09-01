import { describe, expect, it } from "vitest";

import {
  capTanzaniaMnoNationalInput,
  inspectTanzaniaMnoInput,
  withTanzaniaMnoCountryCode
} from "./tanzaniaMno";

describe("Tanzania MNO checkout input", () => {
  const tcraJuly2026Allocations = [
    ["072", "Mpesa"],
    ["074", "Mpesa"],
    ["075", "Mpesa"],
    ["076", "Mpesa"],
    ["079", "Mpesa"],
    ["065", "Tigo"],
    ["067", "Tigo"],
    ["070", "Tigo"],
    ["071", "Tigo"],
    ["077", "Tigo"],
    ["066", "Airtel"],
    ["068", "Airtel"],
    ["069", "Airtel"],
    ["078", "Airtel"],
    ["061", "Halopesa"],
    ["062", "Halopesa"],
    ["063", "Halopesa"]
  ] as const;

  it.each([
    ["765012370", "+255765012370"],
    ["0765012370", "+255765012370"],
    ["+255 765 012 370", "+255765012370"]
  ])("normalizes fixed-prefix entry %s to %s", (input, expected) => {
    expect(withTanzaniaMnoCountryCode(input)).toBe(expected);
  });

  it("caps local entry without removing a leading zero while the user types", () => {
    expect(capTanzaniaMnoNationalInput("076501237099")).toBe("0765012370");
  });

  it.each(tcraJuly2026Allocations)(
    "recognizes TCRA allocation %s as %s",
    (prefix, provider) => {
      const result = inspectTanzaniaMnoInput(`+255${prefix.slice(1)}4123456`, provider);

      expect(result.canSubmit).toBe(true);
      expect(result.detectedProvider).toBe(provider);
      expect(result.level).toBe("success");
    }
  );

  it("rejects an explicit Ugandan number before payment", () => {
    const result = inspectTanzaniaMnoInput("+256772123456", "Tigo");

    expect(result.canSubmit).toBe(false);
    expect(result.level).toBe("error");
    expect(result.message).toContain("Tanzanian");
  });

  it("requires an explicit Tanzania country code because local forms are ambiguous", () => {
    const result = inspectTanzaniaMnoInput("0772123456", "Tigo");

    expect(result.canSubmit).toBe(false);
    expect(result.normalizedPhone).toBeNull();
    expect(result.message).toContain("+255");
  });

  it("accepts and normalizes a matching M-Pesa selection", () => {
    const result = inspectTanzaniaMnoInput("+255 754 123 456", "Mpesa");

    expect(result.canSubmit).toBe(true);
    expect(result.normalizedPhone).toBe("+255754123456");
    expect(result.detectedProvider).toBe("Mpesa");
    expect(result.level).toBe("success");
  });

  it("warns on a prefix mismatch but allows authoritative portability lookup", () => {
    const result = inspectTanzaniaMnoInput("+255 714 123 456", "Mpesa");

    expect(result.canSubmit).toBe(true);
    expect(result.detectedProvider).toBe("Tigo");
    expect(result.level).toBe("warning");
    expect(result.message).toContain("ported");
  });

  it("recognizes the newly operational 070 range as Mixx by Yas", () => {
    const result = inspectTanzaniaMnoInput("+255 704 123 456", "Tigo");

    expect(result.canSubmit).toBe(true);
    expect(result.detectedProvider).toBe("Tigo");
    expect(result.level).toBe("success");
  });
});
