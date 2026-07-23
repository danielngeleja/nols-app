// apps/api/src/lib/nrms.ts
// NRMS (NoLSAF Rooms Management System) entitlement helpers.
// Reference: docs/NOLSAF_ROOMS_MANAGEMENT_SYSTEM.md section 5.
// Workspace mode is derived from the owner's service enrollment, never
// stored separately: ACTIVE or in-window TRIAL => MARKETPLACE_NRMS.
import type { Response, NextFunction, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import type { AuthedRequest } from "../middleware/auth.js";
import { RESTRICTION_SCOPE, findOpenRestrictionCase } from "./restrictionCases.js";

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
  if (account.status === "FROZEN") {
    const restriction = await findOpenRestrictionCase(RESTRICTION_SCOPE.NRMS_PROPERTY, propertyId);
    res.status(423).json({
      error: "NRMS operations are temporarily frozen by an administrator",
      code: "NRMS_PROPERTY_FROZEN",
      referenceCode: restriction?.referenceCode ?? null,
      reason: restriction?.reason ?? account.frozenReason ?? null,
    });
    return null;
  }
  if (account.status === "TRIAL" && new Date() >= account.trialEndsAt) {
    account = await (prisma as any).ownerPaygAccount.update({ where: { id: account.id }, data: { status: "ACTIVE" } });
  }
  return { property, account };
}

/** Account states that stop new billable activity from being opened. */
export const NRMS_BILLING_BLOCKING_STATUSES = ["PAYMENT_REQUIRED", "PAYMENT_PENDING", "CLOSED"] as const;

/**
 * One message per state, because these three are not the same problem:
 * PAYMENT_REQUIRED owes money, PAYMENT_PENDING has already paid and is waiting
 * on the provider, and CLOSED cannot be fixed by paying at all. Sending the
 * "settle the balance" line to a PAYMENT_PENDING account invites a second payment.
 */
const BILLING_BLOCK_COPY: Record<string, { error: string; title: string; detail: string; action: "PAY" | "STATUS" | "SUPPORT" }> = {
  PAYMENT_REQUIRED: {
    error: "Settle the NRMS balance before opening a new external stay",
    title: "Settle the NRMS balance to open new external stays",
    detail: "Unpaid room-night usage has passed the account limit. Clearing it re-opens external reservations immediately.",
    action: "PAY",
  },
  PAYMENT_PENDING: {
    error: "An NRMS payment for this balance is already in progress",
    title: "A payment is already in progress",
    detail: "A payment for this balance has been started and is waiting for the provider to confirm it. External stays re-open as soon as it clears. If it fails or was never completed, the account returns to payment required and you can pay again from the billing page.",
    action: "STATUS",
  },
  CLOSED: {
    error: "This NRMS account is closed",
    title: "This NRMS account is closed",
    detail: "External reservations cannot be opened on a closed account. Contact NoLSAF support to reopen it.",
    action: "SUPPORT",
  },
};

/**
 * Payload for a 402 on a billing-blocked account. The balance figures come from
 * the already-loaded account row, so the only extra read is the policy currency,
 * and that happens exclusively on the blocked path.
 */
export async function nrmsBillingBlockPayload(account: any) {
  const status = String(account?.status ?? "").toUpperCase();
  const copy = BILLING_BLOCK_COPY[status] ?? BILLING_BLOCK_COPY.PAYMENT_REQUIRED;
  let currency = "TZS";
  try {
    const policy = account?.policyId
      ? await (prisma as any).nrmsUsageChargePolicy.findUnique({ where: { id: account.policyId }, select: { currency: true } })
      : null;
    if (policy?.currency) currency = String(policy.currency);
  } catch {
    // Currency is presentational only. A lookup failure must not swallow the block.
  }
  return {
    error: copy.error,
    code: "NRMS_PAYMENT_REQUIRED",
    billing: {
      status,
      title: copy.title,
      detail: copy.detail,
      action: copy.action,
      outstanding: Number(account?.unpaidBalance ?? 0),
      limit: Number(account?.unpaidLimit ?? 0),
      currency,
    },
  };
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

/**
 * Loads a property and verifies tenancy. Returns null (after responding) when not owned,
 * or when the property is not an admin-approved Marketplace listing. NRMS is part and
 * parcel of the Marketplace, not a standalone product, so every NRMS surface funnels
 * through this one gate.
 */
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
    select: { ...(select ?? { id: true, title: true, roomsSpec: true, nrmsActivatedAt: true }), status: true },
  });
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return null;
  }
  if (property.status !== "APPROVED") {
    res.status(403).json({
      error: "This property must be an approved Marketplace listing before NRMS can be used",
      code: "NRMS_PROPERTY_NOT_APPROVED",
      propertyStatus: property.status,
    });
    return null;
  }
  return property;
}
