import { describe, expect, it } from "vitest";
import {
  attributionCommissionStart,
  canActivateAttribution,
  canReassignAttribution,
  canRevokeAttribution,
  currentAttributionContract,
  NRMS_ADOPTION_DAYS,
  nrmsActivationCheck,
  nrmsLapsesAt,
  requestedAttributionProducts,
} from "../lib/salesAttribution.js";

describe("NRMS adoption", () => {
  const approved = new Date("2026-08-01T09:00:00.000Z");
  const claim = { productType: "NRMS", status: "VERIFIED", attributedAt: new Date("2026-07-20T09:00:00.000Z"), verifiedAt: approved };

  it("gives an unadopted NRMS claim 90 days from approval", () => {
    expect(NRMS_ADOPTION_DAYS).toBe(90);
    expect(nrmsLapsesAt(claim, null)?.toISOString()).toBe("2026-10-30T09:00:00.000Z");
    // Never approved: the clock runs from the claim itself.
    expect(nrmsLapsesAt({ ...claim, verifiedAt: null }, null)?.toISOString()).toBe("2026-10-18T09:00:00.000Z");
  });

  it("never lapses once NRMS is on, for marketplace claims, or for claims already closed", () => {
    expect(nrmsLapsesAt(claim, new Date("2026-09-01T00:00:00.000Z"))).toBeNull();
    expect(nrmsLapsesAt({ ...claim, productType: "MARKETPLACE" }, null)).toBeNull();
    for (const status of ["REVOKED", "LAPSED", "EXPIRED", "REASSIGNED"]) expect(nrmsLapsesAt({ ...claim, status }, null)).toBeNull();
    // A claim that was activated before the rule existed still lapses when NRMS never came.
    expect(nrmsLapsesAt({ ...claim, status: "ACTIVE" }, null)).not.toBeNull();
  });

  it("activates only NRMS the partner brought: switched on, and after the claim", () => {
    const claimedAt = new Date("2026-07-20T09:00:00.000Z");
    expect(nrmsActivationCheck({ nrmsActivatedAt: null, claimedAt })).toBe("NOT_SWITCHED_ON");
    expect(nrmsActivationCheck({ nrmsActivatedAt: new Date("2026-07-19T09:00:00.000Z"), claimedAt })).toBe("ON_BEFORE_CLAIM");
    expect(nrmsActivationCheck({ nrmsActivatedAt: new Date("2026-08-05T09:00:00.000Z"), claimedAt })).toBe("OK");
  });

  it("a lapsed claim cannot be revoked again but can be reassigned", () => {
    expect(canRevokeAttribution("LAPSED")).toBe(false);
    expect(canReassignAttribution("LAPSED")).toBe(true);
    expect(canActivateAttribution("LAPSED")).toBe(false);
  });
});

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
