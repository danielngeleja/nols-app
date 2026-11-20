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

test("apartments are sold whole or as separate units, never by the room", async () => {
  const { bookingModesForPropertyType } = await import("./propertyBookingMode.ts");
  assert.deepEqual(bookingModesForPropertyType("Apartment"), ["ENTIRE_UNIT", "UNITS"]);
  assert.deepEqual(bookingModesForPropertyType("Condo"), ["ENTIRE_UNIT", "UNITS"]);
  assert.deepEqual(bookingModesForPropertyType("Hotel"), ["ROOM"]);
  assert.deepEqual(bookingModesForPropertyType("Villa"), ["ENTIRE_UNIT", "UNITS", "ROOM"]);
});

test("saved separate units read back as their own mode", async () => {
  const { bookingModeOfEntries, isSeparateUnitEntry } = await import("./propertyBookingMode.ts");
  const unit = { bookingMode: "ENTIRE_UNIT", unitStyle: "UNIT", roomsCount: 3 };
  assert.equal(isSeparateUnitEntry(unit), true);
  assert.equal(isSeparateUnitEntry({ bookingMode: "ENTIRE_UNIT" }), false);
  assert.equal(isSeparateUnitEntry({ bookingMode: "ROOM", unitStyle: "UNIT" }), false);
  assert.equal(bookingModeOfEntries([unit, { ...unit, roomsCount: 1 }]), "UNITS");
  assert.equal(bookingModeOfEntries([{ bookingMode: "ENTIRE_UNIT", roomsCount: 1 }]), "ENTIRE_UNIT");
  assert.equal(bookingModeOfEntries([{ bookingMode: "ROOM" }]), "ROOM");
  assert.equal(bookingModeOfEntries([]), "ROOM");
});
