import { describe, expect, it } from "vitest";
import { ADMIN_NOTIFICATION_KINDS, adminKindOf, adminNotificationExpired, rowRequiresAction } from "./adminNotificationKinds.js";

const NOW = new Date("2026-11-11T09:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const row = (kind: string, extra: Record<string, unknown> = {}) => ({
  unread: false, readAt: daysAgo(10), resolvedAt: null as Date | null, type: "property", meta: { notificationKind: kind }, requiresAction: false, ...extra,
});

describe("admin notification kinds", () => {
  it("knows every kind and never guesses from the title", () => {
    expect(adminKindOf({ meta: { notificationKind: "payment_unmatched" } })).toMatchObject({ severity: "critical", category: "money", requiresAction: true });
    expect(adminKindOf({ meta: { notificationKind: "property_approved" } })).toMatchObject({ severity: "info", requiresAction: false });
    expect(adminKindOf({ meta: { kind: "invoice_paid_admin" } })).toMatchObject({ key: "invoice_paid_admin", requiresAction: false });
    expect(adminKindOf({ type: "chatbot", meta: null })).toMatchObject({ key: "type:chatbot", category: "support", requiresAction: true });
  });

  it("treats an unknown kind as needing action, so it can never be cleared unseen", () => {
    expect(adminKindOf({ meta: { notificationKind: "something_new" } })).toMatchObject({ requiresAction: true });
    expect(adminKindOf({ type: null, meta: null }).requiresAction).toBe(true);
  });

  it("covers the events that used to be silent", () => {
    for (const kind of ["payout_disbursement_failed", "payout_security_review", "group_stay_request_created", "partner_account_registered", "driver_account_deleted", "sales_partner_owner_disputed", "tour_booking_paid", "group_stay_deposit_paid"]) {
      expect(ADMIN_NOTIFICATION_KINDS[kind]).toBeDefined();
    }
  });
});

describe("what the 7-day clean-up may remove", () => {
  it("never removes an unread alert, however old", () => {
    expect(adminNotificationExpired(row("property_approved", { unread: true, readAt: null }), NOW)).toBe(false);
  });

  it("never removes an alert that asks for action until it is resolved", () => {
    expect(adminNotificationExpired(row("payment_unmatched", { requiresAction: true }), NOW)).toBe(false);
    // A row from before the column (flag false) is still judged by its kind.
    expect(rowRequiresAction(row("payment_unmatched"))).toBe(true);
    expect(adminNotificationExpired(row("payment_unmatched"), NOW)).toBe(false);
  });

  it("removes a resolved alert only 7 days after it was resolved", () => {
    expect(adminNotificationExpired(row("payment_unmatched", { resolvedAt: daysAgo(6) }), NOW)).toBe(false);
    expect(adminNotificationExpired(row("payment_unmatched", { resolvedAt: daysAgo(7) }), NOW)).toBe(true);
  });

  it("removes an information-only alert 7 days after it was read", () => {
    expect(adminNotificationExpired(row("property_approved", { readAt: daysAgo(3) }), NOW)).toBe(false);
    expect(adminNotificationExpired(row("property_approved", { readAt: daysAgo(8) }), NOW)).toBe(true);
  });
});
