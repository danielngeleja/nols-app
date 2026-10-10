import { describe, expect, it } from "vitest";
import { birthdayInStay, drinkConflict, drinkLikeOfCategory, EMPTY_KARIBU_PREFERENCES, shapeKaribuPreferences } from "./karibuPreferences.js";

describe("Karibu drink conflicts", () => {
  it("blocks dairy drinks for a lactose-free guest, but not plant-milk ones", () => {
    expect(drinkConflict({ name: "Cappuccino", category: "Tea and coffee" }, ["LACTOSE_FREE"])).toMatch(/milk/);
    expect(drinkConflict({ name: "Oat milk latte", category: "Tea and coffee" }, ["LACTOSE_FREE"])).toBeNull();
    expect(drinkConflict({ name: "Black coffee", category: "Tea and coffee" }, ["LACTOSE_FREE"])).toBeNull();
  });

  it("blocks nut drinks for a nut allergy", () => {
    expect(drinkConflict({ name: "Peanut smoothie", category: "Fresh juices" }, ["NUT_ALLERGY"])).toMatch(/nuts/);
    expect(drinkConflict({ name: "Mango juice", category: "Fresh juices" }, ["NUT_ALLERGY"])).toBeNull();
  });

  it("blocks sweetened soft drinks for no sugar, allowing diet or zero ones", () => {
    expect(drinkConflict({ name: "Coca-Cola", category: "Soft drinks" }, ["NO_SUGAR"])).toMatch(/soft drink/);
    expect(drinkConflict({ name: "Coca-Cola Zero", category: "Soft drinks" }, ["NO_SUGAR"])).toBeNull();
    expect(drinkConflict({ name: "Still water", category: "Water" }, ["NO_SUGAR"])).toBeNull();
  });

  it("never blocks a drink for vegetarians or guests without needs", () => {
    expect(drinkConflict({ name: "Cappuccino", category: "Tea and coffee" }, ["VEGETARIAN"])).toBeNull();
    expect(drinkConflict({ name: "Cappuccino", category: "Tea and coffee" }, [])).toBeNull();
  });

  it("maps menu categories to liked drinks", () => {
    expect(drinkLikeOfCategory("Soft drinks and mixers")).toBe("SOFT_DRINK");
    expect(drinkLikeOfCategory("Fresh juices")).toBe("FRESH_JUICE");
    expect(drinkLikeOfCategory("Beverages")).toBeNull();
  });
});

describe("Karibu birthday in stay", () => {
  const prefs = { ...EMPTY_KARIBU_PREFERENCES, celebrateOptIn: true, birthday: { day: 14, month: 10 } };

  it("finds a birthday inside the stay, in EAT", () => {
    expect(birthdayInStay(prefs, "2026-10-12T11:00:00Z", "2026-10-15T07:00:00Z")).toBe(true);
    expect(birthdayInStay(prefs, "2026-10-15T11:00:00Z", "2026-10-17T07:00:00Z")).toBe(false);
  });

  it("is never true without the guest's opt-in", () => {
    expect(birthdayInStay({ ...prefs, celebrateOptIn: false }, "2026-10-12T11:00:00Z", "2026-10-15T07:00:00Z")).toBe(false);
  });

  it("drops unknown stored values when shaping a row", () => {
    expect(shapeKaribuPreferences({ drinkLikes: ["WATER", "WHISKY"], dietaryTags: "x", celebrateOptIn: 1 })).toEqual(expect.objectContaining({ drinkLikes: ["WATER"], dietaryTags: [], celebrateOptIn: false }));
  });
});

describe("Karibu staff preference note", () => {
  const base = { ...EMPTY_KARIBU_PREFERENCES, drinkLikes: ["FRESH_JUICE" as const], dietaryTags: ["NUT_ALLERGY" as const], dietaryNote: "no ice", celebrateOptIn: true, birthday: { day: 14, month: 10 } };

  it("shares nothing unless the guest switched sharing on", async () => {
    const { staffPreferenceNote } = await import("./karibuPreferences.js");
    expect(staffPreferenceNote({ ...base, shareWithProperty: false })).toBeNull();
  });

  it("gives drinks and dietary needs, never the birthday", async () => {
    const { staffPreferenceNote } = await import("./karibuPreferences.js");
    const note = staffPreferenceNote({ ...base, shareWithProperty: true });
    expect(note).toBe("Likes fresh juice · Nut allergy · no ice");
    expect(note).not.toMatch(/14|birthday/i);
  });

  it("returns notes only for sharing guests, and none when the table is missing", async () => {
    const { staffPreferenceNotesFor } = await import("./karibuPreferences.js");
    const db = { karibuGuestPreference: { findMany: async ({ where }: any) => {
      expect(where).toEqual({ userId: { in: [5, 6] }, shareWithProperty: true });
      return [{ userId: 5, shareWithProperty: true, drinkLikes: ["WATER"], dietaryTags: [] }];
    } } };
    expect([...(await staffPreferenceNotesFor(db, [5, 6, 5])).entries()]).toEqual([[5, "Likes water"]]);
    const missing = { karibuGuestPreference: { findMany: async () => { throw Object.assign(new Error("x"), { code: "P2021" }); } } };
    expect((await staffPreferenceNotesFor(missing, [5])).size).toBe(0);
  });
});
