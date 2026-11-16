import { describe, expect, it } from "vitest";
import { loadPropertiesListedAt, marketplaceListingCheck } from "../lib/salesListingHistory.js";
import { conversionEvidenceMissing } from "../lib/salesPartner.js";

const d = (iso: string) => new Date(iso);

describe("marketplaceListingCheck", () => {
  it("refuses a claim on a property that was live before the lead", () => {
    expect(marketplaceListingCheck({ listedAt: d("2026-10-01"), claimedAt: d("2026-11-10") })).toBe("LISTED_BEFORE_CLAIM");
  });
  it("accepts a property that went live after the lead", () => {
    expect(marketplaceListingCheck({ listedAt: d("2026-11-12"), claimedAt: d("2026-11-10") })).toBe("OK");
  });
  it("reports a property that was never live", () => {
    expect(marketplaceListingCheck({ listedAt: null, claimedAt: d("2026-11-10") })).toBe("NOT_LISTED");
  });
});

function fakeDb(input: {
  properties: Array<{ id: number; status: string; createdAt: Date }>;
  verifications?: Array<{ propertyId: number; verifiedAt: Date }>;
  approvals?: Array<{ entityId: number; createdAt: Date }>;
  bookings?: Array<{ propertyId: number; createdAt: Date }>;
}) {
  return {
    property: { findMany: async () => input.properties },
    propertyVerification: { findMany: async () => input.verifications ?? [] },
    auditLog: { groupBy: async () => (input.approvals ?? []).map((row) => ({ entityId: row.entityId, _min: { createdAt: row.createdAt } })) },
    booking: { groupBy: async () => (input.bookings ?? []).map((row) => ({ propertyId: row.propertyId, _min: { createdAt: row.createdAt } })) },
  };
}

describe("loadPropertiesListedAt", () => {
  it("takes the earliest trace, so an unsuspend cannot make an old listing look new", async () => {
    const db = fakeDb({
      properties: [{ id: 1, status: "APPROVED", createdAt: d("2026-01-01") }],
      verifications: [{ propertyId: 1, verifiedAt: d("2026-11-14") }],
      approvals: [{ entityId: 1, createdAt: d("2026-03-05") }],
      bookings: [{ propertyId: 1, createdAt: d("2026-04-01") }],
    });
    expect((await loadPropertiesListedAt(db, [1])).get(1)).toEqual(d("2026-03-05"));
  });
  it("falls back to creation for a live property with no trace", async () => {
    const db = fakeDb({ properties: [{ id: 2, status: "SUSPENDED", createdAt: d("2025-06-01") }] });
    expect((await loadPropertiesListedAt(db, [2])).get(2)).toEqual(d("2025-06-01"));
  });
  it("treats a draft with no trace as never listed", async () => {
    const db = fakeDb({ properties: [{ id: 3, status: "DRAFT", createdAt: d("2025-06-01") }] });
    expect((await loadPropertiesListedAt(db, [3])).get(3)).toBeNull();
  });
});

describe("conversionEvidenceMissing", () => {
  const now = d("2026-11-16T12:00:00Z");
  it("passes a lead with contact, a logged call and a day of age", () => {
    expect(conversionEvidenceMissing({ contactPhone: "0712345678", contactEmail: null, createdAt: d("2026-11-14"), contactActivities: 1 }, now)).toEqual([]);
  });
  it("lists every gap of a lead copied from a listing minutes ago", () => {
    const missing = conversionEvidenceMissing({ contactPhone: " ", contactEmail: null, createdAt: d("2026-11-16T11:50:00Z"), contactActivities: 0 }, now);
    expect(missing).toHaveLength(3);
  });
});
