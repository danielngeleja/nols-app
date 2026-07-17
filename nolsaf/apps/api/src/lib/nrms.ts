// apps/api/src/lib/nrms.ts
// NRMS (NoLSAF Rooms Management System) entitlement helpers.
// Reference: docs/NOLSAF_ROOMS_MANAGEMENT_SYSTEM.md section 5.
// Workspace mode is derived from the owner's service enrollment, never
// stored separately: ACTIVE or in-window TRIAL => MARKETPLACE_NRMS.
import type { Response, NextFunction, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import type { AuthedRequest } from "../middleware/auth.js";

export const NRMS_PLAN_CODE = "NRMS_PAYG";

export type WorkspaceMode = "MARKETPLACE_ONLY" | "MARKETPLACE_NRMS";

export type NrmsEnrollment = {
  id: number;
  ownerId: number;
  planId: number;
  status: string;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  activatedAt: Date | null;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
  plan: { id: number; code: string; name: string; status: string; config: unknown };
};

export async function getNrmsEnrollment(ownerId: number): Promise<NrmsEnrollment | null> {
  const enrollment = await prisma.ownerServiceEnrollment.findFirst({
    where: { ownerId, plan: { code: NRMS_PLAN_CODE } },
    include: { plan: { select: { id: true, code: true, name: true, status: true, config: true } } },
  });
  return (enrollment as NrmsEnrollment | null) ?? null;
}

/** Enrollment grants product access; property accounts own trial/billing state. */
export function isNrmsEntitled(enrollment: NrmsEnrollment | null): boolean {
  if (!enrollment) return false;
  if (enrollment.plan.status !== "ACTIVE") return false;
  if (enrollment.status === "ACTIVE") return true;
  if (enrollment.status === "TRIAL") return true; // legacy enrollments migrate safely to property-scoped trials
  return false;
}

export async function getActiveNrmsPolicy(now = new Date()) {
  return (prisma as any).nrmsUsageChargePolicy.findFirst({
    where: { status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    orderBy: { effectiveFrom: "desc" },
  });
}

export async function loadOwnedActiveNrmsProperty(res: Response, ownerId: number, propertyId: number) {
  const property = await loadOwnedProperty(res, ownerId, propertyId, { id: true, title: true, nrmsActivatedAt: true });
  if (!property) return null;
  let account = await (prisma as any).ownerPaygAccount.findUnique({ where: { propertyId } });
  if (!property.nrmsActivatedAt || !account) {
    res.status(409).json({ error: "Activate this property for NRMS before using operational tools", code: "NRMS_PROPERTY_NOT_ACTIVE" });
    return null;
  }
  if (account.status === "TRIAL" && new Date() >= account.trialEndsAt) {
    account = await (prisma as any).ownerPaygAccount.update({ where: { id: account.id }, data: { status: "ACTIVE" } });
  }
  return { property, account };
}

export function workspaceMode(enrollment: NrmsEnrollment | null): WorkspaceMode {
  return isNrmsEntitled(enrollment) ? "MARKETPLACE_NRMS" : "MARKETPLACE_ONLY";
}

/**
 * Express middleware guarding NRMS-only APIs (doc 12: entitlement enforced in
 * the API layer, not by hiding frontend links). Must run after requireAuth +
 * requireRole("OWNER"). Attaches the enrollment to req for downstream use.
 */
export const requireNrms: RequestHandler = async (req, res, next) => {
  try {
    const ownerId = (req as AuthedRequest).user?.id;
    if (!ownerId) return res.status(401).json({ error: "Unauthorized" });
    const enrollment = await getNrmsEnrollment(ownerId);
    if (!isNrmsEntitled(enrollment)) {
      return res.status(403).json({
        error: "NRMS is not active on this account",
        code: "NRMS_NOT_ENROLLED",
        workspaceMode: workspaceMode(enrollment),
        enrollmentStatus: enrollment?.status ?? null,
      });
    }
    (req as AuthedRequest & { nrmsEnrollment?: NrmsEnrollment }).nrmsEnrollment = enrollment!;
    next();
  } catch (err) {
    next(err as Error);
  }
};

/** Loads a property and verifies tenancy. Returns null (after responding 404) when not owned. */
export async function loadOwnedProperty(
  res: Response,
  ownerId: number,
  propertyId: number,
  select?: Record<string, boolean>,
) {
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    res.status(400).json({ error: "Invalid property id" });
    return null;
  }
  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId },
    select: select ?? { id: true, title: true, roomsSpec: true, nrmsActivatedAt: true },
  });
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return null;
  }
  return property;
}
