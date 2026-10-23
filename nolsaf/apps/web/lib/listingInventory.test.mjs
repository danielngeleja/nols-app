import assert from "node:assert/strict";
import test from "node:test";
import { aggregateBedroomBeds, countPropertyBedrooms, declaredGuestCapacity, firstIncompleteBedroomIndex, hasCompleteBedrooms, sleepingCapacity } from "./listingInventory.ts";

test("one villa is one bookable unit with three bedrooms", () => {
  const bedrooms = [
    { name: "Bedroom 1", beds: { twin: 0, full: 0, queen: 0, king: 1 }, sleeps: 1 },
    { name: "Bedroom 2", beds: { twin: 0, full: 0, queen: 1, king: 0 }, sleeps: 2 },
    { name: "Bedroom 3", beds: { twin: 2, full: 0, queen: 0, king: 0 }, sleeps: 2 },
  ];
  const beds = aggregateBedroomBeds(bedrooms);
  assert.equal(countPropertyBedrooms([{ bookingMode: "ENTIRE_UNIT", roomsCount: 1, bedrooms }]), 3);
  assert.equal(beds.twin + beds.queen + beds.king, 4);
  assert.equal(sleepingCapacity(beds), 6);
  assert.equal(declaredGuestCapacity(bedrooms), 5);
});

test("hotel room inventory still counts each room as a bedroom", () => {
  assert.equal(countPropertyBedrooms([{ bookingMode: "ROOM", roomsCount: 5 }]), 5);
});

test("whole-unit bedrooms need a name, bed, and declared guest capacity", () => {
  const bedrooms = [
    { name: "Bedroom 1", beds: { twin: 0, full: 0, queen: 1, king: 0 }, sleeps: 1 },
    { name: "Bedroom 2", beds: { twin: 0, full: 0, queen: 0, king: 0 }, sleeps: 0 },
  ];
  assert.equal(firstIncompleteBedroomIndex(bedrooms), 1);
  assert.equal(hasCompleteBedrooms(bedrooms), false);
  bedrooms[1].beds.twin = 2;
  assert.equal(hasCompleteBedrooms(bedrooms), false);
  bedrooms[1].sleeps = 1;
  assert.equal(hasCompleteBedrooms(bedrooms), true);
  bedrooms[1].name = "";
  assert.equal(hasCompleteBedrooms(bedrooms), false);
  assert.equal(hasCompleteBedrooms([]), false);
});
