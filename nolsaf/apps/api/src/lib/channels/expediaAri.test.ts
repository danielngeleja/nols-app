import { describe, expect, it } from "vitest";
import { buildExpediaAvailabilityXml, resolveExpediaRateForDate } from "./expediaAri.js";

describe("Expedia Availability and Rates XML", () => {
  it("builds a bounded authenticated update with rates and restrictions", () => {
    const xml = buildExpediaAvailabilityXml({
      credentials: { username: "EQC-user", password: "secret&value" },
      propertyId: "12345",
      updates: [{ roomId: "room-1", rateId: "rate-1", from: "2026-07-22", to: "2026-07-22", roomsToSell: 3, currency: "tzs", price: 125000, policy: { minimumStay: 2, maximumStay: 14, closedOnArrival: true } }],
    });
    expect(xml).toContain('<Authentication username="EQC-user" password="secret&amp;value"/>');
    expect(xml).toContain('<Hotel id="12345"/>');
    expect(xml).toContain('totalInventoryAvailable="3"');
    expect(xml).toContain('<PerDay rate="125000.00"/>');
    expect(xml).toContain('minLOS="2"');
    expect(xml).toContain('closedToArrival="true"');
  });

  it("rejects more than Expedia's 5,000-update limit", () => {
    const update = { roomId: "r", rateId: "p", from: "2026-07-22", to: "2026-07-22", roomsToSell: 1, currency: "USD", price: 10 };
    expect(() => buildExpediaAvailabilityXml({ credentials: { username: "u", password: "p" }, propertyId: "1", updates: Array.from({ length: 5_001 }, () => update) })).toThrow(/5,000/);
  });

  it("derives mapped rate-plan prices from the room base rate", () => {
    expect(resolveExpediaRateForDate(100, { pricingMode: "OFFSET", pricingValue: 25 }, "2026-08-01").price).toBe(125);
    expect(resolveExpediaRateForDate(100, { pricingMode: "MULTIPLIER", pricingValue: 1.2 }, "2026-08-01").price).toBe(120);
    expect(resolveExpediaRateForDate(null, { pricingMode: "FIXED", pricingValue: 80 }, "2026-08-01").price).toBe(80);
  });

  it("applies date-specific prices, restrictions and stop-sell", () => {
    const resolved = resolveExpediaRateForDate(100, {
      pricingMode: "BASE",
      minimumStay: 2,
      dateOverrides: [{ from: "2026-12-20", to: "2026-12-31", price: 175.5, closed: true, minimumStay: 4, closedOnArrival: true }],
    }, "2026-12-24");
    expect(resolved).toEqual({ price: 175.5, closed: true, policy: { minimumStay: 4, maximumStay: null, closedOnArrival: true, closedOnDeparture: null } });
  });

  it("rejects a derived negative price instead of sending invalid ARI", () => {
    expect(resolveExpediaRateForDate(50, { pricingMode: "OFFSET", pricingValue: -75 }, "2026-08-01").price).toBeNull();
  });
});
