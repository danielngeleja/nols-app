import { describe, expect, it } from "vitest";
import { canActivatePartnership, canBookPartnership, resolvePartnershipConsents } from "./nrmsPartnershipPolicy.js";

const healthy = {
  linkStatus: "ACTIVE",
  initiatedBy: "HOTEL",
  hotelConsentStatus: "ACCEPTED",
  agentConsentStatus: "ACCEPTED",
  agencyStatus: "ACTIVE",
  agencyVerificationStatus: "VERIFIED",
  propertyStatus: "APPROVED",
  propertyNrmsActivated: true,
  paygStatus: "ACTIVE",
};

describe("bilateral partnership policy", () => {
  it("preserves legacy active links when consent columns are not loaded", () => {
    expect(resolvePartnershipConsents({ linkStatus: "ACTIVE" })).toMatchObject({ hotel: "ACCEPTED", agent: "ACCEPTED" });
    expect(canBookPartnership({ ...healthy, hotelConsentStatus: null, agentConsentStatus: null })).toEqual({ ok: true });
  });

  it("requires both parties to consent before activation", () => {
    expect(canActivatePartnership({ ...healthy, linkStatus: "REQUESTED", initiatedBy: "AGENT", hotelConsentStatus: "PENDING" })).toMatchObject({ ok: false, reason: "HOTEL_CONSENT_REQUIRED" });
    expect(canActivatePartnership({ ...healthy, linkStatus: "INVITED", agentConsentStatus: "PENDING" })).toMatchObject({ ok: false, reason: "RELATIONSHIP_NOT_ACTIVE" });
  });

  it("blocks booking when relationship, agency, property, or billing is unsafe", () => {
    expect(canBookPartnership({ ...healthy, linkStatus: "SUSPENDED" })).toMatchObject({ ok: false, reason: "RELATIONSHIP_NOT_ACTIVE" });
    expect(canBookPartnership({ ...healthy, agencyVerificationStatus: "PENDING" })).toMatchObject({ ok: false, reason: "AGENCY_NOT_VERIFIED" });
    expect(canBookPartnership({ ...healthy, propertyNrmsActivated: false })).toMatchObject({ ok: false, reason: "PROPERTY_NRMS_INACTIVE" });
    expect(canBookPartnership({ ...healthy, paygStatus: "FROZEN" })).toMatchObject({ ok: false, reason: "PROPERTY_BILLING_BLOCKED" });
  });

  it("allows a fully consented, verified, operational partnership", () => {
    expect(canActivatePartnership({ ...healthy, linkStatus: "REQUESTED" })).toEqual({ ok: true });
    expect(canBookPartnership(healthy)).toEqual({ ok: true });
  });
});
