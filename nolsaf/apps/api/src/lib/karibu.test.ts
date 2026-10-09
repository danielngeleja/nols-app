import { describe, expect, it, vi } from "vitest";
import { calculateKaribuBudget, DEFAULT_KARIBU_SETTINGS, isKaribuHoldout, isKaribuPilotDrink, karibuMonthStart, menuItemMayContainAlcohol, normalizeKaribuSettings, previewKaribu } from "./karibu.js";

describe("Karibu funding limits", () => {
  it("uses commission less fees and payouts, then caps the gift", () => {
    expect(calculateKaribuBudget({ commission: 18_182, gatewayFee: 5_000, attributedCost: 0, settings: DEFAULT_KARIBU_SETTINGS }))
      .toEqual({ contribution: 13_182, budget: 2_636.4 });
    expect(calculateKaribuBudget({ commission: 100_000, gatewayFee: 3_000, attributedCost: 10_000, settings: DEFAULT_KARIBU_SETTINGS }))
      .toEqual({ contribution: 87_000, budget: 3_000 });
  });

  it("does not authorise a gift below the floor or after costs erase commission", () => {
    expect(calculateKaribuBudget({ commission: 4_545, gatewayFee: 1_250, attributedCost: 0, settings: DEFAULT_KARIBU_SETTINGS }).budget).toBe(0);
    expect(calculateKaribuBudget({ commission: 5_000, gatewayFee: 3_000, attributedCost: 3_000, settings: DEFAULT_KARIBU_SETTINGS }).contribution).toBe(0);
  });

  it("keeps the program off when no settings are stored", () => {
    expect(normalizeKaribuSettings(null)).toEqual(DEFAULT_KARIBU_SETTINGS);
    expect(normalizeKaribuSettings({ enabled: true, budgetPercent: 200 }).budgetPercent).toBe(20);
  });

  it("keeps randomised holdout assignment stable for the same guest and booking", () => {
    expect(isKaribuHoldout(123, 45, 10)).toBe(isKaribuHoldout(123, 45, 10));
    expect(isKaribuHoldout(123, 45, 0)).toBe(false);
    expect(isKaribuHoldout(123, 45, 100)).toBe(true);
  });

  it("rejects obvious alcoholic menu entries while allowing a mocktail", () => {
    expect(menuItemMayContainAlcohol({ name: "House wine", category: "Red wine" })).toBe(true);
    expect(menuItemMayContainAlcohol({ name: "Passion mocktail", category: "Mocktails" })).toBe(false);
    expect(isKaribuPilotDrink({ name: "Passion mocktail", category: "Mocktails" })).toBe(true);
    expect(isKaribuPilotDrink({ name: "House cocktail", category: "Cocktails" })).toBe(false);
    expect(isKaribuPilotDrink({ name: "House wine", category: "Soft drinks" })).toBe(false);
  });

  it("starts the monthly spending window at midnight in Tanzania", () => {
    expect(karibuMonthStart(new Date("2026-09-30T22:00:00Z")).toISOString()).toBe("2026-09-30T21:00:00.000Z");
  });

  it("rejects a second stay before any spend is authorised", async () => {
    const db = {
      booking: {
        findUnique: vi.fn().mockResolvedValue({ id: 20, userId: 8, propertyId: 3, roomsQty: 1, status: "CHECKED_IN",
          property: { status: "APPROVED", nrmsActivatedAt: new Date(), currency: "TZS" },
          nrmsReservation: { id: 7, status: "CHECKED_IN" }, invoices: [{ commissionAmount: 20_000, paymentEvents: [] }] }),
        findFirst: vi.fn().mockResolvedValue({ id: 12 }),
      },
      systemSetting: { findUnique: vi.fn().mockResolvedValue({ karibuSettings: { ...DEFAULT_KARIBU_SETTINGS, enabled: true } }) },
      karibuPropertyConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true, agreedAt: new Date() }) },
      karibuGesture: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn() },
    };
    const result = await previewKaribu(db, 20);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("NOT_FIRST_STAY");
    expect(db.karibuGesture.findUnique).not.toHaveBeenCalled();
  });

  it("shows only available approved drinks and applies reviewed booking costs", async () => {
    const db = {
      booking: {
        findUnique: vi.fn().mockResolvedValue({ id: 42, userId: 7, propertyId: 3, roomsQty: 1, status: "CHECKED_IN", totalAmount: 0,
          property: { id: 3, title: "Test lodge", status: "APPROVED", nrmsActivatedAt: new Date(), currency: "TZS" },
          nrmsReservation: { id: 8, status: "CHECKED_IN" }, invoices: [{ commissionAmount: 100_000, paymentMethod: "MNO", paymentEvents: [] }] }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      systemSetting: { findUnique: vi.fn().mockResolvedValue({ karibuSettings: { ...DEFAULT_KARIBU_SETTINGS, enabled: true, holdoutPercent: 0 } }) },
      karibuPropertyConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true, agreedAt: new Date() }) },
      karibuGesture: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null), aggregate: vi.fn().mockResolvedValue({ _sum: { partnerPrice: 0 } }) },
      referralEarning: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
      salesCommission: { aggregate: vi.fn().mockResolvedValue({ _sum: { commissionAmount: 0 } }) },
      karibuMenuOption: { findMany: vi.fn().mockResolvedValue([
        { id: 1, menuItemId: 10, propertyId: 3, partnerPrice: 2_000, enabled: true },
        { id: 2, menuItemId: 11, propertyId: 3, partnerPrice: 1_000, enabled: true },
      ]) },
      nrmsMenuItem: { findMany: vi.fn().mockResolvedValue([
        { id: 10, name: "Mango juice", category: "Fresh juices", price: 2_500, inStock: true,
          outlet: { id: 5, name: "Restaurant", propertyId: 3, status: "ACTIVE", currency: "TZS" } },
      ]) },
    };
    const preview = await previewKaribu(db, 42, 0);
    expect(preview.eligible).toBe(true);
    expect(preview.options).toEqual([expect.objectContaining({ id: 1, name: "Mango juice", outletName: "Restaurant" })]);
    expect(db.karibuGesture.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ issuedAt: expect.any(Object) }) }));

    const withCosts = await previewKaribu(db, 42, 90_500);
    expect(withCosts.eligible).toBe(false);
    expect(withCosts.reason).toBe("NO_AFFORDABLE_OPTION");
    expect(withCosts.contribution).toBe(9_500);
    expect(withCosts.budget).toBe(1_900);
  });
});

describe("Karibu drink skip reasons", () => {
  it("explains why a menu item is not a Karibu drink", async () => {
    const { karibuDrinkSkipReason, looksLikeDrink } = await import("./karibu.js");
    expect(karibuDrinkSkipReason({ name: "Passion juice", category: "Fresh juices" })).toBeNull();
    expect(karibuDrinkSkipReason({ name: "Passion juice", category: "Beverages" })).toMatch(/Beverages/);
    expect(karibuDrinkSkipReason({ name: "Red wine", category: "Soft drinks" })).toBe("Contains alcohol");
    expect(karibuDrinkSkipReason({ name: "Water", category: null })).toBe("No menu category set");
    expect(looksLikeDrink({ name: "Passion juice", category: "Beverages" })).toBe(true);
    expect(looksLikeDrink({ name: "Chicken curry", category: "Mains" })).toBe(false);
  });
});
