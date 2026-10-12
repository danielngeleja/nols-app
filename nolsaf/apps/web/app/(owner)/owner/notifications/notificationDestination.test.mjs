import assert from "node:assert/strict";
import test from "node:test";
import { notificationDestination } from "./notificationDestination.ts";

test("merchant decision opens its verified property and application", () => {
  assert.deepEqual(notificationDestination({ kind: "merchant_application_return", applicationId: 71, relatedPropertyId: 12, actionUrl: "/owner/nrms/payments" }), {
    href: "/owner/nrms/payments?property=12&application=71#application-status",
    label: "View payment application",
  });
});

test("generic or unverified destinations never become shortcuts", () => {
  assert.equal(notificationDestination({ kind: "merchant_application_return", applicationId: 71, actionUrl: "/owner/nrms/payments" }), null);
  assert.equal(notificationDestination({ kind: "nrms_payment_required" }), null);
  assert.equal(notificationDestination({ kind: "invoice_paid", actionUrl: "/owner/bookings/recent" }), null);
  assert.equal(notificationDestination({ kind: "property_approved", propertyId: "../../admin" }), null);
  assert.equal(notificationDestination({ actionUrl: "https://example.com" }), null);
});

test("known record destinations use their identifiers", () => {
  const reference = "bk_0123456789abcdefghijkl";
  assert.equal(notificationDestination({ kind: "invoice_paid", bookingId: 25, bookingReference: reference })?.href, `/owner/bookings/checked-in/${reference}`);
  assert.equal(notificationDestination({ kind: "invoice_paid", bookingId: 25 }), null);
  assert.equal(notificationDestination({ kind: "invoice_paid", bookingReference: "75" }), null);
  assert.equal(notificationDestination({ notificationKind: "property_rejected", propertyId: 9 })?.href, "/owner/properties/9");
  assert.equal(notificationDestination({ actionUrl: "/owner/revenue/receipts/42" })?.href, "/owner/revenue/receipts/42");
});
