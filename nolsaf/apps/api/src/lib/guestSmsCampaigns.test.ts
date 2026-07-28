import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalGuestPhone, currentGuestSmsQuotaYear, matchesGuestSmsAudience } from "./guestSmsCampaigns.js";
import { sendSms } from "./sms.js";

afterEach(() => vi.unstubAllEnvs());

describe("guest SMS campaign safeguards", () => {
  it("uses one canonical phone key across common Tanzanian formats", () => {
    expect(canonicalGuestPhone("0767 671 289")).toBe("+255767671289");
    expect(canonicalGuestPhone("255 767 671 289")).toBe("+255767671289");
    expect(canonicalGuestPhone("+255-767-671-289")).toBe("+255767671289");
  });

  it("rejects missing and unusable phone numbers", () => {
    expect(canonicalGuestPhone(null)).toBeNull();
    expect(canonicalGuestPhone("abc")).toBeNull();
    expect(canonicalGuestPhone("12")).toBeNull();
  });

  it("targets repeat guests only when they have at least two stays", () => {
    const base = { id: 1, fullName: "Guest", phone: "+255700000000", lastStayAt: new Date("2026-01-01") };
    expect(matchesGuestSmsAudience({ ...base, reservationCount: 1 }, "REPEAT_GUESTS")).toBe(false);
    expect(matchesGuestSmsAudience({ ...base, reservationCount: 2 }, "REPEAT_GUESTS")).toBe(true);
  });

  it("uses the Dar es Salaam calendar year for the annual cap", () => {
    expect(currentGuestSmsQuotaYear(new Date("2026-12-31T22:30:00.000Z"))).toBe(2027);
  });

  it("includes only guests inactive for the requested period", () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const base = { id: 1, fullName: "Guest", phone: "+255700000000", reservationCount: 1 };
    expect(matchesGuestSmsAudience({ ...base, lastStayAt: new Date("2026-01-01") }, "INACTIVE_180", now)).toBe(true);
    expect(matchesGuestSmsAudience({ ...base, lastStayAt: new Date("2026-06-01") }, "INACTIVE_90", now)).toBe(false);
  });

  it("does not fall back to another provider for Africa's Talking campaigns", async () => {
    vi.stubEnv("AFRICASTALKING_API_KEY", "");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "configured-but-must-not-be-used");
    const result = await sendSms("+255700000000", "Test", {
      bypassEligibilityCheck: true,
      provider: "africastalking",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("AFRICASTALKING_API_KEY");
  });
});
