import { describe, expect, it } from "vitest";
import { electricityNotice, sanitizeElectricityRule, withCleanElectricity } from "./electricityRule.js";

describe("electricity rule for nightly stays", () => {
  it("stores nothing when electricity is included", () => {
    expect(sanitizeElectricityRule({ mode: "INCLUDED" })).toBeNull();
    expect(sanitizeElectricityRule(null)).toBeNull();
    expect(sanitizeElectricityRule({ mode: "FREE_BEER" })).toBeNull();
  });

  it("keeps the guest-pays rule with a sane estimate only", () => {
    expect(sanitizeElectricityRule({ mode: "GUEST_PAYS", perDayTzs: "3000" })).toEqual({ mode: "GUEST_PAYS", perDayTzs: 3000, freeUnitsPerDay: null });
    expect(sanitizeElectricityRule({ mode: "GUEST_PAYS", perDayTzs: -5 })).toEqual({ mode: "GUEST_PAYS", perDayTzs: null, freeUnitsPerDay: null });
    expect(sanitizeElectricityRule({ mode: "GUEST_PAYS", perDayTzs: 9_999_999 })?.perDayTzs).toBeNull();
  });

  it("a limit without its unit count is never shown as more generous than it is", () => {
    expect(sanitizeElectricityRule({ mode: "LIMITED" })).toEqual({ mode: "GUEST_PAYS", perDayTzs: null, freeUnitsPerDay: null });
    expect(sanitizeElectricityRule({ mode: "LIMITED", freeUnitsPerDay: 10 })).toEqual({ mode: "LIMITED", perDayTzs: null, freeUnitsPerDay: 10 });
  });

  it("cleans the house rules it is saved with", () => {
    expect(withCleanElectricity({ other: "Quiet", electricity: { mode: "INCLUDED" } })).toEqual({ other: "Quiet" });
    expect(withCleanElectricity({ electricity: { mode: "GUEST_PAYS", perDayTzs: 3000, extra: "x" } })).toEqual({ electricity: { mode: "GUEST_PAYS", perDayTzs: 3000, freeUnitsPerDay: null } });
  });

  it("writes one plain line for confirmations, from stored services", () => {
    expect(electricityNotice({ houseRules: { electricity: { mode: "GUEST_PAYS", perDayTzs: 3000 } } }))
      .toBe("Electricity is not included: you buy LUKU tokens for your stay (about TSh 3,000 a day).");
    expect(electricityNotice(JSON.stringify({ houseRules: {} }))).toBeNull();
  });
});
