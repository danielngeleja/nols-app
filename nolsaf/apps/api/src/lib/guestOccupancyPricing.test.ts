import assert from "node:assert/strict";
import { test } from "vitest";
import { guestOccupancyPricing } from "./guestOccupancyPricing.js";

test("owner's included guests and fee apply per sellable unit", () => {
  const rule = { maxGuestsPerUnit: 3, includedGuests: 1, extraGuestFee: 20000 };
  assert.deepEqual(guestOccupancyPricing(rule, 1, 1), { maximumGuests: 3, extraGuests: 0, extraGuestFee: 20000 });
  assert.deepEqual(guestOccupancyPricing(rule, 2, 1), { maximumGuests: 3, extraGuests: 1, extraGuestFee: 20000 });
  assert.deepEqual(guestOccupancyPricing(rule, 4, 2), { maximumGuests: 6, extraGuests: 2, extraGuestFee: 20000 });
});

test("flat and legacy rates add no guest fee", () => {
  assert.equal(guestOccupancyPricing({ maxGuestsPerUnit: 3, includedGuests: 3, extraGuestFee: 0 }, 2, 1).extraGuests, 0);
  assert.equal(guestOccupancyPricing({}, 2, 1).extraGuests, 0);
  assert.equal(guestOccupancyPricing({ includedGuests: 0, extraGuestFee: -10 }, 2, 1).extraGuests, 0);
});
