import type { Response } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import type { AuthedRequest } from "../middleware/auth.js";
import { findOpenRestrictionCase, RESTRICTION_SCOPE } from "./restrictionCases.js";
import { getNrmsEnrollment, isNrmsEntitled } from "./nrms.js";

export type NrmsPropertyAccessRole = "OWNER" | "MANAGER" | "FRONT_DESK" | "HOUSEKEEPER" | "RESTAURANT" | "BAR" | "OUTLET_SUPERVISOR";

export type NrmsPropertyAccess = {
  role: NrmsPropertyAccessRole;
  actorId: number;
  ownerId: number;
  property: {
    id: number;
    ownerId: number;
    title: string;
    status: string;
    currency: string | null;
    nrmsActivatedAt: Date | null;
  };
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
    select: { id: true, ownerId: true, title: true, status: true, currency: true, nrmsActivatedAt: true },
  });
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return null;
  }

  let role: NrmsPropertyAccessRole | null = null;
  if (req.user!.role === "OWNER" && property.ownerId === actorId) {
    role = "OWNER";
  } else {
    const membership = await prisma.nrmsStaffMembership.findFirst({
      where: { propertyId, userId: actorId, status: "ACTIVE" },
      select: { role: true },
      orderBy: { id: "asc" },
    });
    role = (membership?.role as NrmsPropertyAccessRole | undefined) ?? null;
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
  return { role, actorId, ownerId: property.ownerId, property };
}
