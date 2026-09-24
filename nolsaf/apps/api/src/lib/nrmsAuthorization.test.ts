import { describe, expect, it } from "vitest";
import {
  NRMS_CAPABILITIES,
  NRMS_ROLE_CAPABILITIES,
  authorizeNrmsAccess,
  buildNrmsEffectiveAccessManifest,
  hasNrmsCapability,
} from "./nrmsAuthorization.js";

describe("NRMS capability policy", () => {
  it("keeps every role template inside the canonical capability catalogue", () => {
    const catalogue = new Set<string>(NRMS_CAPABILITIES);
    for (const capabilities of Object.values(NRMS_ROLE_CAPABILITIES)) {
      expect(capabilities.every((capability) => catalogue.has(capability))).toBe(true);
      expect(new Set(capabilities).size).toBe(capabilities.length);
    }
  });

  it("keeps Owner governance away from Manager and operational roles", () => {
    const governance = [
      "nrms.subscription.manage",
      "merchant.kyc.submit",
      "merchant.provider.activate",
      "merchant.wallet.change",
      "merchant.settlement_destination.change",
      "merchant.policy.accept",
      "staff.manager.assign",
      "staff.manager.revoke",
    ] as const;

    for (const capability of governance) {
      expect(hasNrmsCapability("OWNER", capability)).toBe(true);
      expect(hasNrmsCapability("MANAGER", capability)).toBe(false);
      expect(hasNrmsCapability("FRONT_DESK", capability)).toBe(false);
    }
  });

  it("allows Managers to delegate lower roles without allowing Manager delegation", () => {
    expect(hasNrmsCapability("MANAGER", "staff.lower_role.assign")).toBe(true);
    expect(hasNrmsCapability("MANAGER", "staff.lower_role.revoke")).toBe(true);
    expect(hasNrmsCapability("MANAGER", "staff.manager.assign")).toBe(false);
    expect(hasNrmsCapability("MANAGER", "staff.manager.revoke")).toBe(false);
  });

  it("allows Managers to maintain property guest-contact settings only through property scope", () => {
    expect(hasNrmsCapability("MANAGER", "property.settings.read")).toBe(true);
    expect(hasNrmsCapability("MANAGER", "property.settings.manage")).toBe(true);
    expect(hasNrmsCapability("SALES_EXECUTIVE", "property.settings.manage")).toBe(false);
    expect(hasNrmsCapability("FRONT_DESK", "property.settings.manage")).toBe(false);
  });

  it("gives Sales Executive a sales workspace without front-desk or settlement authority", () => {
    expect(hasNrmsCapability("SALES_EXECUTIVE", "sales.inquiry.manage")).toBe(true);
    expect(hasNrmsCapability("SALES_EXECUTIVE", "sales.inquiry.convert")).toBe(true);
    expect(hasNrmsCapability("SALES_EXECUTIVE", "sales.group.manage")).toBe(true);
    expect(hasNrmsCapability("SALES_EXECUTIVE", "sales.agent.manage")).toBe(true);
    expect(hasNrmsCapability("SALES_EXECUTIVE", "reservation.check_in")).toBe(false);
    expect(hasNrmsCapability("SALES_EXECUTIVE", "reservation.check_out")).toBe(false);
    expect(hasNrmsCapability("SALES_EXECUTIVE", "finance.settlement.read")).toBe(false);
    expect(hasNrmsCapability("SALES_EXECUTIVE", "payment.refund_approve")).toBe(false);
  });

  it("fails closed for retired Housekeeper memberships", () => {
    expect(authorizeNrmsAccess({
      actorId: 23,
      role: "HOUSEKEEPER",
      capability: "room_status.read",
      propertyId: 91,
      membershipStatus: "ACTIVE",
      membershipConfirmed: true,
    })).toEqual({ allowed: false, reasonCode: "NRMS_ROLE_RETIRED" });
  });

  it("requires active confirmed membership and the matching property", () => {
    const base = {
      actorId: 23,
      role: "FRONT_DESK",
      capability: "reservation.read" as const,
      propertyId: 91,
      membershipStatus: "ACTIVE",
      membershipConfirmed: true,
    };
    expect(authorizeNrmsAccess(base)).toEqual({ allowed: true });
    expect(authorizeNrmsAccess({ ...base, membershipConfirmed: false })).toEqual({ allowed: false, reasonCode: "NRMS_MEMBERSHIP_UNCONFIRMED" });
    expect(authorizeNrmsAccess({ ...base, targetPropertyId: 92 })).toEqual({ allowed: false, reasonCode: "NRMS_PROPERTY_SCOPE_MISMATCH" });
  });

  it("enforces outlet assignment for outlet staff", () => {
    const base = {
      actorId: 23,
      role: "BAR",
      capability: "outlet.order.manage" as const,
      propertyId: 91,
      membershipStatus: "ACTIVE",
      membershipConfirmed: true,
      assignedOutletId: 7,
    };
    expect(authorizeNrmsAccess({ ...base, targetOutletId: 7 })).toEqual({ allowed: true });
    expect(authorizeNrmsAccess({ ...base, targetOutletId: 8 })).toEqual({ allowed: false, reasonCode: "NRMS_OUTLET_SCOPE_MISMATCH" });
    expect(authorizeNrmsAccess({ ...base, assignedOutletId: null })).toEqual({ allowed: false, reasonCode: "NRMS_OUTLET_SCOPE_REQUIRED" });
  });

  it("applies approval limits and separation of duties", () => {
    const base = {
      actorId: 12,
      role: "OWNER",
      capability: "payment.refund_approve" as const,
      propertyId: 91,
    };
    expect(authorizeNrmsAccess({ ...base, amount: 100, approvalLimit: null })).toEqual({ allowed: false, reasonCode: "NRMS_APPROVAL_LIMIT_REQUIRED" });
    expect(authorizeNrmsAccess({ ...base, amount: 101, approvalLimit: 100 })).toEqual({ allowed: false, reasonCode: "NRMS_APPROVAL_LIMIT_EXCEEDED" });
    expect(authorizeNrmsAccess({ ...base, amount: 100, approvalLimit: 100, requesterId: 12 })).toEqual({ allowed: false, reasonCode: "NRMS_SEPARATION_OF_DUTIES" });
    expect(authorizeNrmsAccess({ ...base, amount: 100, approvalLimit: 100, requesterId: 44 })).toEqual({ allowed: true });
  });

  it("treats both approval spellings as approvals", () => {
    // outlet.exception.approve names the action as its own segment; matching
    // only the payment.void_approve form exempted that spelling from limits
    // and from separation of duties.
    for (const capability of ["outlet.exception.approve"] as const) {
      const base = { actorId: 12, role: "OWNER", capability, propertyId: 91 };
      expect(authorizeNrmsAccess({ ...base, amount: 100, approvalLimit: null })).toEqual({ allowed: false, reasonCode: "NRMS_APPROVAL_LIMIT_REQUIRED" });
      expect(authorizeNrmsAccess({ ...base, amount: 101, approvalLimit: 100 })).toEqual({ allowed: false, reasonCode: "NRMS_APPROVAL_LIMIT_EXCEEDED" });
      expect(authorizeNrmsAccess({ ...base, requesterId: 12 })).toEqual({ allowed: false, reasonCode: "NRMS_SEPARATION_OF_DUTIES" });
      expect(authorizeNrmsAccess({ ...base, amount: 100, approvalLimit: 100, requesterId: 44 })).toEqual({ allowed: true });
    }
  });

  it("leaves non-approval capabilities free of approval controls", () => {
    const base = { actorId: 12, role: "OWNER", capability: "sales.group.manage" as const, propertyId: 91 };
    expect(authorizeNrmsAccess({ ...base, amount: 5_000_000, approvalLimit: null })).toEqual({ allowed: true });
    expect(authorizeNrmsAccess({ ...base, requesterId: 12 })).toEqual({ allowed: true });
  });

  it("builds a server-owned effective access manifest", () => {
    const manifest = buildNrmsEffectiveAccessManifest({ propertyId: 91, role: "BAR", outletId: 7, membershipVersion: 4 });
    expect(manifest).toMatchObject({
      propertyId: 91,
      primaryRole: "BAR",
      workspace: "BAR",
      scopes: { outletIds: [7], shift: "OWN", finance: "LIMITED" },
      membershipVersion: 4,
    });
    expect(manifest.capabilities).toContain("outlet.order.manage");
    expect(manifest.capabilities).not.toContain("staff.lower_role.assign");
  });
});
