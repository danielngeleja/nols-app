import { describe, expect, it } from "vitest";
import { normalizePublicChannelValue } from "./trustVerification";

describe("public trust channel normalisation", () => {
  it("matches email addresses without exposing case differences", () => {
    expect(normalizePublicChannelValue("EMAIL", " MAILTO:Support@NoLSAF.com ")).toBe("support@nolsaf.com");
  });

  it("maps Tanzanian local phone notation to the international comparison key", () => {
    expect(normalizePublicChannelValue("PHONE", "0765 012 370")).toBe("255765012370");
    expect(normalizePublicChannelValue("PHONE", "+255 765 012 370")).toBe("255765012370");
  });

  it("normalises websites without doing a fuzzy or partial match", () => {
    expect(normalizePublicChannelValue("WEBSITE", "https://www.NoLSAF.com/contact/?from=sms")).toBe(
      "nolsaf.com/contact",
    );
    expect(normalizePublicChannelValue("WEBSITE", "nolsaf.com")).not.toBe("nolsaf.com.fake.example");
  });

  it("normalises social URLs while preserving the account path", () => {
    expect(normalizePublicChannelValue("SOCIAL", "https://instagram.com/NoLSAF/")).toBe("instagram.com/nolsaf");
  });
});
