import { describe, expect, it } from "vitest";
import { mayPushNotification } from "./pushPolicy.js";

describe("mobile push preference policy", () => {
  it("keeps marketing off by default and respects an opt-in", () => {
    expect(mayPushNotification({ notificationKind: "promotion_new_offer" }, "system", null)).toBe(false);
    expect(mayPushNotification({ notificationKind: "promotion_new_offer" }, "system", { promotions: true })).toBe(true);
    expect(mayPushNotification(null, "marketing", { promotions: false })).toBe(false);
  });

  it("respects referral choice while preserving booking and security alerts", () => {
    expect(mayPushNotification({ notificationKind: "referral_reward" }, "system", { referrals: false })).toBe(false);
    expect(mayPushNotification({ notificationKind: "booking_confirmed" }, "booking", { bookings: false })).toBe(true);
    expect(mayPushNotification({ notificationKind: "group_stay_offer" }, "booking", { promotions: false })).toBe(true);
    expect(mayPushNotification({ notificationKind: "security_alert" }, "system", { promotions: false })).toBe(true);
  });
});
