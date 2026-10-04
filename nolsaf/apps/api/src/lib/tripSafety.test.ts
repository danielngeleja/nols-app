import { describe, expect, it } from "vitest";
import { isShareableTrip, tripShareExpiry, type SafeTripSnapshot } from "./tripSafety";

const NOW = new Date("2026-10-04T09:00:00.000Z");

function trip(overrides: Partial<SafeTripSnapshot> = {}): SafeTripSnapshot {
  return {
    serviceKind: "STAY",
    serviceId: 42,
    title: "Example stay",
    destination: "Arusha",
    startAt: new Date("2026-10-05T09:00:00.000Z"),
    endAt: new Date("2026-10-07T09:00:00.000Z"),
    status: "CONFIRMED",
    provider: { name: "Example", phone: null, email: null },
    ...overrides,
  };
}

describe("trip safety sharing", () => {
  it("allows active upcoming trips and blocks terminal services", () => {
    expect(isShareableTrip(trip(), NOW)).toBe(true);
    expect(isShareableTrip(trip({ status: "COMPLETED" }), NOW)).toBe(false);
    expect(isShareableTrip(trip({ status: "EXPIRED" }), NOW)).toBe(false);
  });

  it("expires at the earlier of seven days or one day after the trip", () => {
    expect(tripShareExpiry(trip(), NOW).toISOString()).toBe("2026-10-08T09:00:00.000Z");
    expect(tripShareExpiry(trip({ endAt: new Date("2026-11-01T09:00:00.000Z") }), NOW).toISOString()).toBe("2026-10-11T09:00:00.000Z");
  });
});
