import assert from "node:assert/strict";
import test from "node:test";
import { straightLineKm } from "./nearbyPlaceDistance.ts";

test("straight-line distance is zero at the same pin and symmetric", () => {
  const property = { lat: -6.8, lng: 39.2 };
  const airport = { lat: -6.878111, lng: 39.202625 };
  assert.equal(straightLineKm(property, property), 0);
  assert.equal(straightLineKm(property, airport), straightLineKm(airport, property));
  assert.ok(straightLineKm(property, airport) > 0);
});
