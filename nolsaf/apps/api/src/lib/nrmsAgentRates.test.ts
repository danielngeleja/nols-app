import { describe, expect, it, vi } from "vitest";
import { getAgentRateAccess, getPropertyAgentCurrencies, quoteAgentRates, quoteAgentRoom } from "./nrmsAgentRates.js";

/** Build a Db double from fixed rows. */
function makeDb(opts: {
  access?: Array<{ ratePlanId: number; roomTypeId: number | null }>;
  roomTypes?: any[];
  plans?: any[];
}) {
  return {
    nrmsAgentRateAccess: { findMany: vi.fn(async () => opts.access ?? []) },
    roomType: { findMany: vi.fn(async () => opts.roomTypes ?? []) },
    nrmsRatePlan: { findMany: vi.fn(async () => opts.plans ?? []) },
  };
}

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const roomStandard = { id: 10, name: "Standard", capacityAdults: 2, capacityChildren: 1, baseRate: 100000, currency: "TZS", sortOrder: 0 };
const planCorporate = { id: 5, name: "Corporate", roomTypeId: null, refundable: true, mealPlan: "ROOM_ONLY", adjustmentType: "PERCENT", adjustment: -10, defaultMinStay: 1, defaultMaxStay: null, taxPolicy: null, feePolicy: null, seasons: [] };

describe("getAgentRateAccess", () => {
  it("normalizes missing roomTypeId to null", async () => {
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: undefined as any }] });
    expect(await getAgentRateAccess(db, 1)).toEqual([{ ratePlanId: 5, roomTypeId: null }]);
  });
});

describe("getPropertyAgentCurrencies", () => {
  it("returns only currencies with a compatible active room and rate plan", async () => {
    const db = makeDb({
      roomTypes: [
        { id: 10, currency: "TZS" },
        { id: 11, currency: "USD" },
        { id: 12, currency: "EUR" },
      ],
      plans: [
        { roomTypeId: null, currency: "TZS" },
        { roomTypeId: 10, currency: "USD" }, // USD plan is scoped to a TZS room: invalid pairing
      ],
    });
    expect(await getPropertyAgentCurrencies(db, 2)).toEqual(["TZS"]);
  });

  it("accepts a room-scoped plan only for its matching room", async () => {
    const db = makeDb({
      roomTypes: [{ id: 11, currency: "USD" }],
      plans: [{ roomTypeId: 11, currency: "USD" }],
    });
    expect(await getPropertyAgentCurrencies(db, 2)).toEqual(["USD"]);
  });
});

describe("quoteAgentRates", () => {
  it("returns no quotes when the agent has no rate access", async () => {
    const db = makeDb({ access: [], roomTypes: [roomStandard], plans: [planCorporate] });
    expect(await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: d("2026-09-01"), checkOut: d("2026-09-03"), adults: 2, children: 0 })).toEqual([]);
    // must short-circuit before touching room types
    expect(db.roomType.findMany).not.toHaveBeenCalled();
  });

  it("prices a two-night stay with the negotiated plan (10% off base)", async () => {
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: null }], roomTypes: [roomStandard], plans: [planCorporate] });
    const quotes = await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: d("2026-09-01"), checkOut: d("2026-09-03"), adults: 2, children: 0 });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.nightly).toEqual([
      { date: "2026-09-01", rate: 90000 },
      { date: "2026-09-02", rate: 90000 },
    ]);
    expect(quotes[0]!.subtotal).toBe(180000);
    expect(quotes[0]!.total).toBe(180000);
    expect(quotes[0]!.ratePlan.id).toBe(5);
  });

  it("applies tax and fixed fees from the plan policy", async () => {
    const taxed = { ...planCorporate, adjustmentType: "BASE", adjustment: 0, taxPolicy: { percent: 18 }, feePolicy: { fixed: 5000 } };
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: null }], roomTypes: [roomStandard], plans: [taxed] });
    const quotes = await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: d("2026-09-01"), checkOut: d("2026-09-02"), adults: 1, children: 0 });
    expect(quotes[0]!.subtotal).toBe(100000);
    expect(quotes[0]!.tax).toBe(18000);
    expect(quotes[0]!.fees).toBe(5000);
    expect(quotes[0]!.total).toBe(123000);
  });

  it("excludes a room type the agent's grant does not cover", async () => {
    // grant is scoped to roomTypeId 99, but the only room is 10 -> not sellable
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: 99 }], roomTypes: [roomStandard], plans: [planCorporate] });
    expect(await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: d("2026-09-01"), checkOut: d("2026-09-02"), adults: 1, children: 0 })).toEqual([]);
  });

  it("skips rooms that exceed occupancy capacity", async () => {
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: null }], roomTypes: [roomStandard], plans: [planCorporate] });
    expect(await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: d("2026-09-01"), checkOut: d("2026-09-02"), adults: 5, children: 0 })).toEqual([]);
  });

  it("enforces the plan's minimum stay", async () => {
    const minStay = { ...planCorporate, defaultMinStay: 3 };
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: null }], roomTypes: [roomStandard], plans: [minStay] });
    expect(await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: d("2026-09-01"), checkOut: d("2026-09-02"), adults: 1, children: 0 })).toEqual([]);
  });

  it("rejects stays longer than the global 365-night safety bound", async () => {
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: null }], roomTypes: [roomStandard], plans: [planCorporate] });
    expect(await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: d("2026-09-01"), checkOut: d("2027-09-02"), adults: 1, children: 0 })).toEqual([]);
  });

  it("enforces minimum and maximum advance windows", async () => {
    const today = new Date();
    const at = (days: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
    const plan = { ...planCorporate, minAdvanceDays: 3, maxAdvanceDays: 30 };
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: null }], roomTypes: [roomStandard], plans: [plan] });
    expect(await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: at(2), checkOut: at(3), adults: 1, children: 0 })).toEqual([]);
    expect(await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: at(31), checkOut: at(32), adults: 1, children: 0 })).toEqual([]);
    expect(await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: at(5), checkOut: at(6), adults: 1, children: 0 })).toHaveLength(1);
  });

  it("scopes both rooms and plans to the link currency", async () => {
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: null }], roomTypes: [roomStandard], plans: [planCorporate] });
    const quotes = await quoteAgentRates(db, { linkId: 1, propertyId: 2, checkIn: d("2026-09-01"), checkOut: d("2026-09-02"), adults: 1, children: 0, currency: "USD" });
    expect((db.roomType.findMany as any).mock.calls[0][0].where.currency).toBe("USD");
    expect((db.nrmsRatePlan.findMany as any).mock.calls[0][0].where.currency).toBe("USD");
    expect(quotes[0]!.currency).toBe("USD");
  });
});

describe("quoteAgentRoom", () => {
  it("returns null when the requested room is not sellable", async () => {
    const db = makeDb({ access: [{ ratePlanId: 5, roomTypeId: 99 }], roomTypes: [roomStandard], plans: [planCorporate] });
    expect(await quoteAgentRoom(db, { linkId: 1, propertyId: 2, checkIn: d("2026-09-01"), checkOut: d("2026-09-02"), adults: 1, children: 0, roomTypeId: 10 })).toBeNull();
  });
});
