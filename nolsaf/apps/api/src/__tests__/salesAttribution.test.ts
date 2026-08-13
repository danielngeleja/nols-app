import { describe, expect, it } from "vitest";
import {
  attributionCommissionStart,
  canActivateAttribution,
  canReassignAttribution,
  canRevokeAttribution,
  currentAttributionContract,
  requestedAttributionProducts,
} from "../lib/salesAttribution.js";

const now = new Date("2026-07-26T10:00:00.000Z");

describe("sales attribution lifecycle", () => {
  it("expands a combined proposal into both independently unique products", () => {
    expect(requestedAttributionProducts("NRMS_AND_MARKETPLACE")).toEqual(["NRMS", "MARKETPLACE"]);
    expect(requestedAttributionProducts("NRMS")).toEqual(["NRMS"]);
  });

  it("selects only a contract that can earn at the decision time", () => {
    const current = currentAttributionContract([
      {
        id: 1,
        status: "EXPIRED",
        startsAt: new Date("2025-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: 2,
        status: "ACTIVE",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
      {
        id: 3,
        status: "ACTIVE",
        startsAt: new Date("2027-01-01T00:00:00.000Z"),
        expiresAt: new Date("2028-01-01T00:00:00.000Z"),
      },
    ], now);
    expect(current?.id).toBe(2);
  });

  it("does not activate a pending, active, revoked or disputed row", () => {
    expect(canActivateAttribution("VERIFIED")).toBe(true);
    for (const status of ["PENDING", "ACTIVE", "REVOKED", "DISPUTED"]) {
      expect(canActivateAttribution(status)).toBe(false);
    }
  });

  it("keeps revocation and reassignment transitions explicit", () => {
    expect(canRevokeAttribution("ACTIVE")).toBe(true);
    expect(canRevokeAttribution("REVOKED")).toBe(false);
    expect(canReassignAttribution("ACTIVE")).toBe(true);
    expect(canReassignAttribution("REVOKED")).toBe(true);
    expect(canReassignAttribution("PENDING")).toBe(false);
  });

  it("never starts commission before the governing contract", () => {
    const futureContract = {
      id: 1,
      status: "ACTIVE",
      startsAt: new Date("2026-08-01T00:00:00.000Z"),
      expiresAt: new Date("2027-08-01T00:00:00.000Z"),
    };
    expect(attributionCommissionStart(futureContract, now)).toEqual(futureContract.startsAt);

    const currentContract = {
      ...futureContract,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(attributionCommissionStart(currentContract, now)).toEqual(now);
  });
});
