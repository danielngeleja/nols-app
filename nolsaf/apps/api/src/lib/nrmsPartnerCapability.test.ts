import { describe, expect, it, vi } from "vitest";
import { bridgeApprovedOperatorToAccommodation, evaluateAccommodationPortalAccess } from "./nrmsPartnerCapability.js";

describe("evaluateAccommodationPortalAccess", () => {
  it("preserves established NRMS agent access without depending on backfill ordering", () => {
    expect(evaluateAccommodationPortalAccess({ role: "NRMS_AGENT", hasAgencyIdentity: true, agencyStatus: "ACTIVE" })).toEqual({ ok: true });
  });

  it("requires an explicit active capability and approved operator profile for AGENT users", () => {
    expect(evaluateAccommodationPortalAccess({ role: "AGENT", hasAgencyIdentity: true, agencyStatus: "ACTIVE", operatorStatus: "ACTIVE", operatorProfileReviewStatus: "APPROVED" })).toMatchObject({ ok: false, reason: "CAPABILITY_REQUIRED" });
    expect(evaluateAccommodationPortalAccess({ role: "AGENT", capabilityStatus: "ACTIVE", hasAgencyIdentity: true, agencyStatus: "ACTIVE", operatorStatus: "ACTIVE", operatorProfileReviewStatus: "PENDING" })).toMatchObject({ ok: false, reason: "OPERATOR_PROFILE_NOT_APPROVED" });
    expect(evaluateAccommodationPortalAccess({ role: "AGENT", capabilityStatus: "ACTIVE", hasAgencyIdentity: true, agencyStatus: "ACTIVE", operatorStatus: "ACTIVE", operatorProfileReviewStatus: "APPROVED" })).toEqual({ ok: true });
  });

  it("rejects expired capability and inactive identities", () => {
    expect(evaluateAccommodationPortalAccess({ role: "AGENT", capabilityStatus: "ACTIVE", capabilityExpiresAt: new Date("2026-01-01"), now: new Date("2026-02-01"), hasAgencyIdentity: true, agencyStatus: "ACTIVE", operatorStatus: "ACTIVE", operatorProfileReviewStatus: "APPROVED" })).toMatchObject({ ok: false, reason: "CAPABILITY_EXPIRED" });
    expect(evaluateAccommodationPortalAccess({ role: "NRMS_AGENT", hasAgencyIdentity: true, agencyStatus: "SUSPENDED" })).toMatchObject({ ok: false, reason: "AGENCY_INACTIVE" });
  });
});

function makeDb(opts: { reviewStatus?: string; operatorStatus?: string; documents?: any[]; identity?: any; capability?: any } = {}) {
  const identity = opts.identity ?? null;
  return {
    agent: { findUnique: vi.fn(async () => ({
      id: 7, userId: 11, status: opts.operatorStatus ?? "ACTIVE",
      operatorProfile: { reviewStatus: opts.reviewStatus ?? "APPROVED", companyName: "Kili Operator", businessRegistrationNumber: "REG-1", tinNumber: "TIN-1", tourismPermitNumber: "LIC-1", countryCode: "TZ" },
      user: { id: 11, name: "Asha", fullName: "Asha M", email: "asha@example.com", phone: "+255700000001", address: "Arusha", tin: null, nationality: "Tanzanian", documents: opts.documents ?? [{ type: "BUSINESS_LICENSE", url: "https://res.cloudinary.com/demo/license.pdf", createdAt: new Date("2026-08-01") }] },
    })) },
    nrmsAgentAccount: {
      findUnique: vi.fn(async () => identity),
      create: vi.fn(async (args: any) => ({ id: 41, status: args.data.status, verificationStatus: args.data.verificationStatus })),
      update: vi.fn(async () => ({ id: identity?.id ?? 41, status: "ACTIVE", verificationStatus: "VERIFIED" })),
    },
    userWorkspaceAccess: {
      findUnique: vi.fn(async () => opts.capability ?? null),
      upsert: vi.fn(async () => ({ id: 9 })),
    },
    auditLog: { create: vi.fn(async () => ({ id: 1 })) },
  };
}

describe("bridgeApprovedOperatorToAccommodation", () => {
  it("reuses the existing operator login and approved evidence without changing its role", async () => {
    const db = makeDb();
    const result = await bridgeApprovedOperatorToAccommodation(db, { agentId: 7, adminId: 2, now: new Date("2026-08-20T12:00:00Z") });
    expect(result).toEqual({ ok: true, accountId: 41, capability: "ACCOMMODATION", createdIdentity: true });
    expect(db.nrmsAgentAccount.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ primaryUserId: 11, legalName: "Kili Operator", verificationStatus: "VERIFIED", verifiedByAdminId: 2 }) }));
    expect(db.userWorkspaceAccess.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: 11, workspace: "ACCOMMODATION", status: "ACTIVE" }) }));
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("requires both profile approval and approved evidence", async () => {
    expect(await bridgeApprovedOperatorToAccommodation(makeDb({ reviewStatus: "PENDING" }), { agentId: 7, adminId: 2 })).toMatchObject({ ok: false, reason: "PROFILE_NOT_APPROVED" });
    expect(await bridgeApprovedOperatorToAccommodation(makeDb({ documents: [] }), { agentId: 7, adminId: 2 })).toMatchObject({ ok: false, reason: "APPROVED_EVIDENCE_REQUIRED" });
  });

  it("does not silently reactivate a suspended capability or rejected identity", async () => {
    expect(await bridgeApprovedOperatorToAccommodation(makeDb({ capability: { status: "SUSPENDED" }, identity: { id: 41, status: "ACTIVE", verificationStatus: "VERIFIED" } }), { agentId: 7, adminId: 2 })).toMatchObject({ ok: false, reason: "CAPABILITY_BLOCKED" });
    expect(await bridgeApprovedOperatorToAccommodation(makeDb({ identity: { id: 41, status: "ACTIVE", verificationStatus: "REJECTED" } }), { agentId: 7, adminId: 2 })).toMatchObject({ ok: false, reason: "IDENTITY_BLOCKED" });
  });
});
