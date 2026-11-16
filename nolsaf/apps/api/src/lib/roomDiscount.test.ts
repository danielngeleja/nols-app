import { describe, expect, it } from "vitest";
import { discountedNightlyNet, roomDiscountPercent } from "./roomDiscount.js";
import { nightlyPriceOptions } from "./publicPropertyDto.js";

describe("room discount", () => {
  it("takes the discount off the owner's nightly net", () => {
    expect(discountedNightlyNet(76_000, 4)).toBe(72_960);
    expect(discountedNightlyNet(76_000, null)).toBe(76_000);
  });

  it("ignores discounts outside 0 to 90%", () => {
    expect(roomDiscountPercent({ discountPercent: 0 })).toBeNull();
    expect(roomDiscountPercent({ discountPercent: 95 })).toBeNull();
    expect(roomDiscountPercent({ discountPercent: "10" })).toBe(10);
    expect(roomDiscountPercent({})).toBeNull();
  });

  it("filters and shows 'from' prices at what guests actually pay", () => {
    const options = nightlyPriceOptions({ roomsSpec: [{ pricePerNight: 76_000, discountPercent: 4 }, { pricePerNight: 50_000 }] });
    expect(options).toEqual([72_960, 50_000]);
  });
});
