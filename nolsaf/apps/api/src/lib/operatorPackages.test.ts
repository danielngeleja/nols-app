import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import { operatorPackageRegister, publicOperatorProfile } from "./operatorPackages.js";

const serengeti = { id: "pkg-1", name: "Serengeti Essential", destination: "Serengeti", pricePerPerson: 4500, currency: "USD" };
const dar = { id: "pkg-2", name: "Dar es Salaam Classic Move", destination: "Dar es Salaam City", pricePerPerson: 4000, currency: "USD" };
const blank = { id: "pkg-3" };

describe("operator package register (what travellers actually see)", () => {
  it("marks approved packages live, edited ones as waiting, and new ones as not approved", () => {
    const register = operatorPackageRegister({
      reviewStatus: "APPROVED",
      approvedAt: "2026-10-01T00:00:00Z",
      packageItems: [serengeti, { ...dar, pricePerPerson: 4200 }, blank],
      approvedSnapshot: { packageItems: [serengeti, dar] },
    });
    expect(register.profileApproved).toBe(true);
    expect(register.packages.map((p) => [p.key, p.state])).toEqual([
      ["pkg-1", "LIVE"],
      ["pkg-2", "LIVE_WITH_CHANGES"],
      ["pkg-3", "NOT_APPROVED"],
    ]);
    // Travellers see the approved price, not the edit.
    expect(register.packages[1].pricePerPerson).toBe(4000);
    expect(register.packages[2].problems).toEqual(["No name", "No price", "No destination"]);
  });

  it("keeps the approved version on sale while submitted changes are under review", () => {
    const register = operatorPackageRegister({
      reviewStatus: "PENDING",
      packageItems: [{ ...serengeti, pricePerPerson: 5000 }, blank],
      approvedSnapshot: { packageItems: [serengeti] },
    });
    expect(register.profileApproved).toBe(true);
    expect(register.underReview).toBe(true);
    expect(register.packages.map((p) => p.state)).toEqual(["LIVE_WITH_CHANGES", "NOT_APPROVED"]);
    expect(register.packages[0].pricePerPerson).toBe(4500);
  });

  it("applies one public rule: approved, or pending with an approved version", () => {
    expect(publicOperatorProfile({ reviewStatus: "APPROVED", approvedSnapshot: { companyName: "A" } })).toEqual({ companyName: "A" });
    expect(publicOperatorProfile({ reviewStatus: "APPROVED", companyName: "Old" })).toMatchObject({ companyName: "Old" });
    expect(publicOperatorProfile({ reviewStatus: "PENDING", approvedSnapshot: { companyName: "A" } })).toEqual({ companyName: "A" });
    expect(publicOperatorProfile({ reviewStatus: "PENDING" })).toBeNull();
    expect(publicOperatorProfile({ reviewStatus: "REJECTED", approvedSnapshot: { companyName: "A" } })).toBeNull();
    expect(publicOperatorProfile(null)).toBeNull();
  });

  it("respects a paused package status and lists removed packages", () => {
    const register = operatorPackageRegister({
      reviewStatus: "APPROVED",
      packageItems: [{ ...serengeti, status: "PAUSED" }],
      approvedSnapshot: { packageItems: [{ ...serengeti, status: "PAUSED" }] },
      removedPackages: [{ item: dar, removedAt: "2026-11-01T00:00:00Z", removedByUserId: 9 }],
    });
    expect(register.packages.map((p) => [p.key, p.state])).toEqual([["pkg-1", "PAUSED"], ["pkg-2", "REMOVED"]]);
    expect(register.packages[1].removedAt).toBe("2026-11-01T00:00:00Z");
  });

  it("sells nothing when the profile was never approved", () => {
    const register = operatorPackageRegister({ reviewStatus: "REJECTED", packageItems: [serengeti] });
    expect(register.packages.map((p) => p.state)).toEqual(["NOT_APPROVED"]);
  });
});
