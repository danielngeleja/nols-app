import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTrackableTrip } from "./activeTrip.ts";

const now = Date.parse("2026-11-03T12:00:00.000Z");
const trip = (id, status, scheduledDate) => ({ id, status, scheduledDate });

test("an in-progress trip takes priority over future assignments", () => {
  assert.equal(selectTrackableTrip([
    trip(1, "CONFIRMED", "2026-11-03T12:10:00.000Z"),
    trip(2, "IN_PROGRESS", "2026-11-03T11:00:00.000Z"),
  ], now)?.id, 2);
});

test("future confirmed trips do not start location sharing early", () => {
  assert.equal(selectTrackableTrip([trip(1, "CONFIRMED", "2026-11-03T14:00:00.000Z")], now), null);
  assert.equal(selectTrackableTrip([trip(2, "CONFIRMED", "2026-11-03T12:15:00.000Z")], now)?.id, 2);
});

test("completed and cancelled trips do not keep location sharing active", () => {
  assert.equal(selectTrackableTrip([
    trip(1, "COMPLETED", "2026-11-03T11:00:00.000Z"),
    trip(2, "CANCELED", "2026-11-03T11:00:00.000Z"),
  ], now), null);
});
