import type { Response } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import type { AuthedRequest } from "../middleware/auth.js";
import { findOpenRestrictionCase, RESTRICTION_SCOPE } from "./restrictionCases.js";
import { getNrmsEnrollment, isNrmsEntitled } from "./nrms.js";
import { NRMS_STAFF_ROLES, type NrmsStaffRole } from "./nrmsStaffRoles.js";
import {
  authorizeNrmsAccess,
  buildNrmsEffectiveAccessManifest,
  isNrmsRole,
  type NrmsAuthorizationInput,
  type NrmsCapability,
  type NrmsEffectiveAccessManifest,
} from "./nrmsAuthorization.js";

/** The owner plus every staff role. Derived so a new sub-role is granted
 *  access-type coverage automatically instead of being silently excluded. */
export type NrmsPropertyAccessRole = "OWNER" | NrmsStaffRole;

export type NrmsPropertyAccess = {
  role: NrmsPropertyAccessRole;
  actorId: number;
  ownerId: number;
  outletId: number | null;
  membershipId: number | null;
  /** Null for an owner, who holds no membership row. */
  membershipStatus: string | null;
  membershipConfirmed: boolean;
  effectiveAccess: NrmsEffectiveAccessManifest;
  property: {
    id: number;
    ownerId: number;
    title: string;
    status: string;
    currency: string | null;
    nrmsActivatedAt: Date | null;
    nrmsMenuPublic: boolean;
    housekeepingDailyServiceEnabled: boolean;
    housekeepingDailyServiceTime: string;
  };
  /**
   * The property's PAYG account, already loaded here to run the frozen and
   * entitlement checks. Returned so a caller needing a quota such as
   * `maxAgents` does not have to fetch the same row again, which is what the
   * owner-only helper it replaces already gave them.
   */
  account: { id: number; status: string; maxAgents: number; maxStaff: number; maxOutlets: number; maxRooms: number };
};

/**
 * Property-scoped NRMS access for operational APIs. Staff memberships borrow
 * the property's owner's enrollment; they never become global OWNER users.
 */
export async function loadNrmsPropertyAccess(
  req: AuthedRequest,
  res: Response,
  propertyId: number,
  allowedRoles: readonly NrmsPropertyAccessRole[] = ["OWNER", "MANAGER", "FRONT_DESK"],
): Promise<NrmsPropertyAccess | null> {
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    res.status(400).json({ error: "Invalid property id" });
    return null;
  }
  const actorId = req.user!.id;
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      ownerId: true,
      title: true,
      status: true,
      currency: true,
      nrmsActivatedAt: true,
      nrmsMenuPublic: true,
      housekeepingDailyServiceEnabled: true,
      housekeepingDailyServiceTime: true,
    },
  });
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return null;
  }

  let role: NrmsPropertyAccessRole | null = null;
  let outletId: number | null = null;
  let membershipId: number | null = null;
  let membershipVersion = 0;
  let membershipStatus: string | null = null;
  let membershipConfirmed = false;
  if (req.user!.role === "OWNER" && property.ownerId === actorId) {
    role = "OWNER";
  } else {
    const membership = await prisma.nrmsStaffMembership.findFirst({
      where: { propertyId, userId: actorId, status: "ACTIVE", confirmedAt: { not: null } },
      select: { id: true, role: true, outletId: true, inviteVersion: true, status: true, confirmedAt: true },
      orderBy: { id: "asc" },
    });
    if (membership && isNrmsRole(membership.role) && membership.role !== "OWNER") {
      role = membership.role;
      outletId = membership.outletId;
      membershipId = membership.id;
      membershipVersion = membership.inviteVersion;
      membershipStatus = membership.status;
      membershipConfirmed = membership.confirmedAt != null;
    }
  }
  if (!role || !allowedRoles.includes(role)) {
    res.status(403).json({ error: "You do not have access to this NRMS property", code: "NRMS_PROPERTY_FORBIDDEN" });
    return null;
  }
  if (property.status !== "APPROVED") {
    res.status(403).json({ error: "This property must be approved before NRMS can be used", code: "NRMS_PROPERTY_NOT_APPROVED", propertyStatus: property.status });
    return null;
  }

  const [enrollment, account] = await Promise.all([
    getNrmsEnrollment(property.ownerId),
    prisma.ownerPaygAccount.findUnique({ where: { propertyId } }),
  ]);
  if (!property.nrmsActivatedAt || !account || !isNrmsEntitled(enrollment)) {
    res.status(403).json({ error: "NRMS operations are not active for this property", code: "NRMS_NOT_ACTIVE" });
    return null;
  }
  if (["FROZEN", "CLOSED"].includes(account.status)) {
    const restriction = await findOpenRestrictionCase(RESTRICTION_SCOPE.NRMS_PROPERTY, propertyId);
    res.status(423).json({
      error: account.status === "CLOSED" ? "NRMS operations are closed for this property" : "NRMS operations are temporarily frozen for this property",
      code: account.status === "CLOSED" ? "NRMS_PROPERTY_CLOSED" : "NRMS_PROPERTY_FROZEN",
      referenceCode: restriction?.referenceCode ?? null,
      reason: restriction?.reason ?? account.frozenReason ?? null,
    });
    return null;
  }
  if (account.status === "TRIAL" && new Date() >= account.trialEndsAt) {
    await prisma.ownerPaygAccount.update({ where: { id: account.id }, data: { status: "ACTIVE" } });
  }
  return {
    role,
    actorId,
    ownerId: property.ownerId,
    outletId,
    membershipId,
    membershipStatus,
    membershipConfirmed,
    effectiveAccess: buildNrmsEffectiveAccessManifest({ propertyId, role, outletId, membershipVersion }),
    property,
    account,
  };
}

/**
 * Capability-first entry point for protected property routes. New and migrated
 * handlers should use this instead of declaring route-local role allowlists.
 */
export async function requireNrmsPropertyCapability(
  req: AuthedRequest,
  res: Response,
  propertyId: number,
  capability: NrmsCapability,
  context: Partial<Pick<NrmsAuthorizationInput, "targetPropertyId" | "targetOutletId" | "amount" | "approvalLimit" | "requesterId">> = {},
): Promise<NrmsPropertyAccess | null> {
  const access = await loadNrmsPropertyAccess(req, res, propertyId, ["OWNER", ...NRMS_STAFF_ROLES]);
  if (!access) return null;
  const decision = authorizeNrmsAccess({
    actorId: access.actorId,
    role: access.role,
    capability,
    propertyId,
    // Carry the row's real state rather than asserting it: the loader filters on
    // ACTIVE/confirmed today, and hardcoding that here would rubber-stamp the
    // membership checks if that filter ever loosens.
    membershipStatus: access.membershipStatus ?? undefined,
    membershipConfirmed: access.membershipConfirmed,
    assignedOutletId: access.outletId,
    ...context,
  });
  if (!decision.allowed) {
    res.status(403).json({
      error: "You do not have permission to perform this NRMS operation",
      code: decision.reasonCode,
    });
    return null;
  }
  return access;
}
