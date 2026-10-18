import assert from "node:assert/strict";
import test from "node:test";
import { agentNotificationDestination } from "./notificationDestination.ts";

test("a paid booking opens its exact operator booking", () => {
  assert.deepEqual(agentNotificationDestination({ notificationKind: "agent_tour_booking_paid", tourBookingId: 42 }), {
    href: "/account/agent/tour-bookings/42",
    label: "View tour booking",
  });
});

test("balance and payout notices lead to the earnings actions", () => {
  assert.equal(agentNotificationDestination({ notificationKind: "agent_balance_claimable", tourBookingId: 42 })?.href, "/account/agent/revenues");
  assert.equal(agentNotificationDestination({ notificationKind: "agent_payout_rejected", tourBookingId: 42 })?.href, "/account/agent/revenues");
});

test("an admin request for documents opens the documents page", () => {
  assert.deepEqual(agentNotificationDestination({ notificationKind: "account_document_request" }), {
    href: "/account/agent/documents",
    label: "Upload documents",
  });
  assert.equal(agentNotificationDestination({ notificationKind: "admin_message" }), null);
});

test("unverified or unsafe metadata never becomes a shortcut", () => {
  assert.equal(agentNotificationDestination({ notificationKind: "agent_tour_booking_paid" }), null);
  assert.equal(agentNotificationDestination({ notificationKind: "agent_tour_booking_paid", tourBookingId: "../admin" }), null);
  assert.equal(agentNotificationDestination({ link: "https://example.com" }), null);
  assert.equal(agentNotificationDestination({ link: "/account/agent/revenues" }), null);
  assert.equal(agentNotificationDestination({ link: "/account/agent/tour-bookings/42?redirect=evil" }), null);
});
