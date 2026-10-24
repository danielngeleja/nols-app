import assert from "node:assert/strict";
import test from "node:test";
import { guestOccupancyPricing } from "./guestOccupancyPricing.js";

test("additional guest fees and capacity follow the selected sellable unit", () => {
  const room = { maxGuestsPerUnit: 3, includedGuests: 1, extraGuestFee: 20000 };
  assert.deepEqual(guestOccupancyPricing(room, 2, 1), { maximumGuests: 3, extraGuests: 1, extraGuestFee: 20000 });
  assert.deepEqual(guestOccupancyPricing(room, 4, 2), { maximumGuests: 6, extraGuests: 2, extraGuestFee: 20000 });
});

test("flat and legacy rates add no extra charge", () => {
  assert.equal(guestOccupancyPricing({ maxGuestsPerUnit: 3, includedGuests: 3, extraGuestFee: 0 }, 2, 1).extraGuests, 0);
  assert.equal(guestOccupancyPricing({}, 2, 1).extraGuests, 0);
});
