import assert from "node:assert/strict";
import test from "node:test";
import { defaultBookingModeForPropertyType, isRoomOnlyPropertyType } from "./propertyBookingMode.ts";

test("room-centric properties never default to whole-place inventory", () => {
  for (const type of ["Hotel", "Lodge", "Guest House"]) {
    assert.equal(defaultBookingModeForPropertyType(type), "ROOM");
    assert.equal(isRoomOnlyPropertyType(type), true);
  }
});

test("a property-type change can replace a whole-place default with hotel rooms", () => {
  assert.equal(defaultBookingModeForPropertyType("Apartment"), "ENTIRE_UNIT");
  assert.equal(defaultBookingModeForPropertyType("Hotel"), "ROOM");
  assert.equal(isRoomOnlyPropertyType("Apartment"), false);
});
