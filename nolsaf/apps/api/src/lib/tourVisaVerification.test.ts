import { beforeEach, describe, expect, it } from "vitest";
import { parseTourVisaVerificationToken, tourVisaVerificationToken } from "./tourVisaVerification.js";

describe("tour visa itinerary verification tokens", () => {
  beforeEach(() => {
    process.env.PUBLIC_LINK_TOKEN_SECRET = "v".repeat(48);
  });

  it("round trips a signed booking id", () => {
    const token = tourVisaVerificationToken(42);
    expect(token).toMatch(/^42\.[A-Za-z0-9_-]{24}$/);
    expect(parseTourVisaVerificationToken(token)).toBe(42);
  });

  it("rejects tampered and malformed tokens", () => {
    const token = tourVisaVerificationToken(42);
    expect(parseTourVisaVerificationToken(`43.${token.split(".")[1]}`)).toBeNull();
    expect(parseTourVisaVerificationToken("42.invalid")).toBeNull();
  });
});
