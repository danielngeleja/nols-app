import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFS, mergeNotificationPrefs, wantsNotification } from "./notificationPrefs.js";

describe("notification preferences", () => {
  it("keeps marketing off by default and referrals on", () => {
    expect(DEFAULT_NOTIFICATION_PREFS).toEqual({ bookings: true, promotions: false, referrals: true });
    expect(mergeNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("uses saved choices and ignores values that are not on or off", () => {
    expect(mergeNotificationPrefs({ promotions: true, referrals: "no", extra: 1 })).toEqual({ bookings: true, promotions: true, referrals: true });
  });

  it("reads one person's choice, and falls back to the default when it cannot", async () => {
    const db = { user: { findUnique: async () => ({ notificationPrefs: { referrals: false } }) } };
    expect(await wantsNotification(7, "referrals", db)).toBe(false);
    const broken = { user: { findUnique: async () => { throw new Error("down"); } } };
    expect(await wantsNotification(7, "promotions", broken)).toBe(false);
    expect(await wantsNotification(7, "referrals", broken)).toBe(true);
  });
});
