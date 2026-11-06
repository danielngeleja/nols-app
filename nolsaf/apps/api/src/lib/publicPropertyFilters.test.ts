import { describe, expect, it } from "vitest";

import { nightlyPriceOptions, serviceTagSet } from "./publicPropertyDto.js";

describe("serviceTagSet", () => {
  it("reads the current object shape through its tags list", () => {
    const tags = serviceTagSet({ laundry: true, tags: ["Laundry", "Breakfast available", "Payment: M-Pesa"] });
    expect(tags.has("laundry")).toBe(true);
    expect(tags.has("breakfast available")).toBe(true);
    expect(tags.has("payment: m-pesa")).toBe(true);
  });

  it("falls back to yes/no flags when an object was saved without tags", () => {
    const tags = serviceTagSet({ laundry: true, breakfastAvailable: true, parking: "free", acceptGroupBookings: true });
    expect([...tags].sort()).toEqual(["breakfast available", "free parking", "group stay", "laundry"]);
  });

  it("reads legacy arrays and JSON strings", () => {
    expect(serviceTagSet(["Pool", " Bar "]).has("bar")).toBe(true);
    expect(serviceTagSet('{"tags":["Gym"]}').has("gym")).toBe(true);
    expect(serviceTagSet("not json").size).toBe(0);
    expect(serviceTagSet(null).size).toBe(0);
  });
});

describe("nightlyPriceOptions", () => {
  it("includes the base price and every room price", () => {
    expect(nightlyPriceOptions({ basePrice: 50000, roomsSpec: [{ pricePerNight: 15000 }, { price: 30000 }] })).toEqual([50000, 15000, 30000]);
  });

  it("finds room prices when there is no base price", () => {
    expect(nightlyPriceOptions({ basePrice: null, roomsSpec: [{ pricePerNight: 25000 }] })).toEqual([25000]);
  });
});
