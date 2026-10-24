import { describe, expect, it } from "vitest";
import { parsePropertyServices } from "./propertyServices";

describe("public property services", () => {
  it("reads saved object tags and avoids repeating a named nearby place", () => {
    const parsed = parsePropertyServices({
      tags: ["Payment: Mobile money", "Free cancellation", "Near Central Railway Station"],
      breakfastIncluded: true,
      security24: true,
      nearbyFacilities: [{ name: "Central Railway Station", type: "train station", distanceKm: 1 }]
    });
    expect(parsed.paymentModes).toContain("Mobile money");
    expect(parsed.freeCancellation).toBe(true);
    expect(parsed.included).toContain("Breakfast included");
    expect(parsed.amenities).toContain("24h security");
    expect(parsed.nearbyFacilities).toHaveLength(1);
    expect(parsed.nearby).toEqual([]);
  });
});
