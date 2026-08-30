import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", async (importOriginal) => {
  const original = await importOriginal<any>();
  return { ...original, prisma: {} };
});

import { evaluateRestrictionRules, resolveRoomTypeIdForCode } from "../lib/nrmsRestrictions";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function rule(overrides: Record<string, any> = {}): any {
  return {
    id: 1,
    name: "Eid closure",
    roomTypeId: null,
    ratePlanId: null,
    channelCode: null,
    daysOfWeek: null,
    startDate: day("2026-08-01"),
    endDate: day("2026-09-01"),
    stopSell: false,
    closedToArrival: false,
    closedToDeparture: false,
    minStay: null,
    maxStay: null,
    minAdvanceDays: null,
    maxAdvanceDays: null,
    ...overrides,
  };
}

const stay = { propertyId: 7, roomTypeId: 3, ratePlanId: 5, checkIn: day("2026-08-10"), checkOut: day("2026-08-12") };

describe("stop sell", () => {
  it("closes a stay whose nights fall inside the window", () => {
    const blocks = evaluateRestrictionRules([rule({ stopSell: true })], stay);
    expect(blocks.map((block) => block.code)).toEqual(["STOP_SELL"]);
  });

  it("closes a stay that only clips the edge of the window", () => {
    // 30 July to 2 August: two of those nights are inside a window opening 1 August.
    const blocks = evaluateRestrictionRules([rule({ stopSell: true })], { ...stay, checkIn: day("2026-07-30"), checkOut: day("2026-08-02") });
    expect(blocks).toHaveLength(1);
  });

  it("leaves a stay that ends the morning the window opens", () => {
    // Checking out on 1 August means the last night is 31 July, outside the rule.
    const blocks = evaluateRestrictionRules([rule({ stopSell: true })], { ...stay, checkIn: day("2026-07-29"), checkOut: day("2026-08-01") });
    expect(blocks).toHaveLength(0);
  });

  it("applies to the whole property when no room type is named", () => {
    const blocks = evaluateRestrictionRules([rule({ stopSell: true, roomTypeId: null })], { ...stay, roomTypeId: 99 });
    expect(blocks).toHaveLength(1);
  });

  it("leaves other room types alone when one is named", () => {
    expect(evaluateRestrictionRules([rule({ stopSell: true, roomTypeId: 3 })], stay)).toHaveLength(1);
    expect(evaluateRestrictionRules([rule({ stopSell: true, roomTypeId: 3 })], { ...stay, roomTypeId: 4 })).toHaveLength(0);
  });

  it("does nothing once the switch is unticked", () => {
    expect(evaluateRestrictionRules([rule({ stopSell: false })], stay)).toHaveLength(0);
  });
});

describe("channel scope", () => {
  it("applies to every channel when the rule names none", () => {
    expect(evaluateRestrictionRules([rule({ stopSell: true })], { ...stay, channelCode: "NOLSAF" })).toHaveLength(1);
    expect(evaluateRestrictionRules([rule({ stopSell: true })], { ...stay, channelCode: "DIRECT" })).toHaveLength(1);
  });

  it("applies only to its own channel when one is named", () => {
    const direct = rule({ stopSell: true, channelCode: "DIRECT" });
    expect(evaluateRestrictionRules([direct], { ...stay, channelCode: "DIRECT" })).toHaveLength(1);
    expect(evaluateRestrictionRules([direct], { ...stay, channelCode: "NOLSAF" })).toHaveLength(0);
  });
});

describe("stay and arrival rules", () => {
  it("refuses a stay under the minimum", () => {
    expect(evaluateRestrictionRules([rule({ minStay: 3 })], stay).map((b) => b.code)).toEqual(["MIN_STAY"]);
  });

  it("allows a stay that meets the minimum", () => {
    expect(evaluateRestrictionRules([rule({ minStay: 2 })], stay)).toHaveLength(0);
  });

  it("refuses an arrival on a closed-to-arrival date", () => {
    const blocks = evaluateRestrictionRules([rule({ closedToArrival: true })], stay);
    expect(blocks.map((b) => b.code)).toContain("CLOSED_TO_ARRIVAL");
  });

  it("ignores a weekday the rule does not cover", () => {
    // 10 and 11 August 2026 are Monday and Tuesday; this rule is Saturday only.
    expect(evaluateRestrictionRules([rule({ stopSell: true, daysOfWeek: [6] })], stay)).toHaveLength(0);
  });

  it("reports stop sell before softer rules so the hardest close is shown first", () => {
    const blocks = evaluateRestrictionRules([rule({ minStay: 5 }), rule({ id: 2, stopSell: true })], stay);
    expect(blocks[0].code).toBe("STOP_SELL");
  });
});

describe("rule scope filtering", () => {
  it("skips a rule bound to a different rate plan", () => {
    expect(evaluateRestrictionRules([rule({ stopSell: true, ratePlanId: 9 })], stay)).toHaveLength(0);
    expect(evaluateRestrictionRules([rule({ stopSell: true, ratePlanId: 5 })], stay)).toHaveLength(1);
  });

  it("returns nothing for a stay with no nights", () => {
    expect(evaluateRestrictionRules([rule({ stopSell: true })], { ...stay, checkOut: stay.checkIn })).toHaveLength(0);
  });
});

describe("resolveRoomTypeIdForCode", () => {
  function fakeDb(types: Array<{ id: number; name: string; sourceSpecKey?: string | null }>): any {
    return {
      roomUnit: { findFirst: async () => null },
      roomType: {
        findFirst: async ({ where }: any) => {
          const wanted = where.OR.map((clause: any) => clause.name ?? clause.sourceSpecKey);
          return types.find((type) => wanted.includes(type.name) || wanted.includes(type.sourceSpecKey)) ?? null;
        },
        findMany: async () => types,
      },
    };
  }

  it("resolves a room type by its own name", async () => {
    const db = fakeDb([{ id: 11, name: "Single", sourceSpecKey: "Single" }]);
    await expect(resolveRoomTypeIdForCode(db, 7, "Single")).resolves.toBe(11);
  });

  it("resolves a roomsSpec variant code back to its room type", async () => {
    // roomsSpec variants are coded "<room type> <beds>", but NRMS imports room
    // types under the bare room type. Without this a room-scoped stop sell
    // would stop closing marketplace dates.
    const db = fakeDb([{ id: 11, name: "Single", sourceSpecKey: "Single" }]);
    await expect(resolveRoomTypeIdForCode(db, 7, "Single 1 Queen")).resolves.toBe(11);
  });

  it("prefers the most specific room type name", async () => {
    const db = fakeDb([
      { id: 11, name: "Deluxe", sourceSpecKey: "Deluxe" },
      { id: 12, name: "Deluxe Suite", sourceSpecKey: "Deluxe Suite" },
    ]);
    await expect(resolveRoomTypeIdForCode(db, 7, "Deluxe Suite 1 King")).resolves.toBe(12);
  });

  it("returns null when nothing matches", async () => {
    const db = fakeDb([{ id: 11, name: "Single", sourceSpecKey: "Single" }]);
    await expect(resolveRoomTypeIdForCode(db, 7, "Cottage 1 King")).resolves.toBeNull();
    await expect(resolveRoomTypeIdForCode(db, 7, "")).resolves.toBeNull();
  });
});
