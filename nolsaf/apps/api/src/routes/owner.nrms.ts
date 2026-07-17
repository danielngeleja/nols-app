// apps/api/src/routes/owner.nrms.ts
// NRMS service enrollment + workspace mode (doc section 5, 12: owner/service-enrollment).
// Activation is explicit and backend-enforced; cancelling never erases
// room/reservation/guest history (doc 5).
import { Router, type Response } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import {
  NRMS_PLAN_CODE,
  getNrmsEnrollment,
  isNrmsEntitled,
  workspaceMode,
  loadOwnedProperty,
  getActiveNrmsPolicy,
} from "../lib/nrms.js";

export const router = Router();

router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler);

function formatEnrollment(enrollment: Awaited<ReturnType<typeof getNrmsEnrollment>>) {
  if (!enrollment) return null;
  return {
    status: enrollment.status,
    trialStartsAt: enrollment.trialStartsAt,
    trialEndsAt: enrollment.trialEndsAt,
    activatedAt: enrollment.activatedAt,
    suspendedAt: enrollment.suspendedAt,
    cancelledAt: enrollment.cancelledAt,
    plan: {
      code: enrollment.plan.code,
      name: enrollment.plan.name,
      config: enrollment.plan.config ?? null,
    },
  };
}

/**
 * GET /api/owner/nrms
 * Current enrollment, derived workspace mode, and per-property activation.
 */
router.get("/", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const [enrollment, usagePolicy, properties] = await Promise.all([
      getNrmsEnrollment(ownerId),
      getActiveNrmsPolicy(),
      prisma.property.findMany({
        where: { ownerId },
        select: { id: true, title: true, currency: true, nrmsActivatedAt: true, nrmsPaygAccount: true },
        orderBy: { id: "asc" },
      }),
    ]);
    res.json({
      workspaceMode: workspaceMode(enrollment),
      entitled: isNrmsEntitled(enrollment),
      enrollment: formatEnrollment(enrollment),
      usagePolicy: usagePolicy ? { currency: usagePolicy.currency, roomNightPrice: usagePolicy.roomNightPrice, trialDays: usagePolicy.trialDays } : null,
      properties,
    });
  } catch (err) {
    console.error("[owner.nrms] status failed", err);
    res.status(500).json({ error: "Failed to load NRMS status" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/nrms/activate
 * Enroll this owner into the NRMS PAYG plan. Idempotent for TRIAL/ACTIVE.
 * The 45-day trial clock is per property (nrmsActivatedAt); the enrollment
 * trial window here governs account-level access (doc 5, 8.2).
 */
router.post("/activate", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const plan = await prisma.servicePlan.findFirst({ where: { code: NRMS_PLAN_CODE, status: "ACTIVE" } });
    if (!plan) {
      return res.status(503).json({ error: "NRMS enrollment is not open yet", code: "NRMS_PLAN_UNAVAILABLE" });
    }

    const existing = await prisma.ownerServiceEnrollment.findUnique({
      where: { ownerId_planId: { ownerId, planId: plan.id } },
    });

    if (existing) {
      if (existing.status === "TRIAL" || existing.status === "ACTIVE") {
        const enrollment = await getNrmsEnrollment(ownerId);
        return res.json({
          workspaceMode: workspaceMode(enrollment),
          entitled: isNrmsEntitled(enrollment),
          enrollment: formatEnrollment(enrollment),
          alreadyEnrolled: true,
        });
      }
      // PAST_DUE, SUSPENDED and CANCELLED need policy/support resolution, not
      // silent self-reactivation (doc 8.6: suspension and reactivation rules).
      return res.status(409).json({
        error: "This NRMS enrollment needs review before it can be reactivated",
        code: "NRMS_REACTIVATION_REQUIRED",
        enrollmentStatus: existing.status,
      });
    }

    const now = new Date();
    await prisma.ownerServiceEnrollment.create({
      data: {
        ownerId,
        planId: plan.id,
        status: "ACTIVE",
        trialStartsAt: null,
        trialEndsAt: null,
        activatedAt: now,
      },
    });

    const enrollment = await getNrmsEnrollment(ownerId);
    res.status(201).json({
      workspaceMode: workspaceMode(enrollment),
      entitled: isNrmsEntitled(enrollment),
      enrollment: formatEnrollment(enrollment),
      alreadyEnrolled: false,
    });
  } catch (err) {
    console.error("[owner.nrms] activate failed", err);
    res.status(500).json({ error: "Failed to activate NRMS" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/nrms/properties/:propertyId/activate
 * Marks a property as NRMS-operational (starts its 45-day trial clock,
 * doc 8.2: trial runs from operational activation, not registration).
 * Idempotent: re-activating never resets an existing clock.
 */
router.post("/properties/:propertyId/activate", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const enrollment = await getNrmsEnrollment(ownerId);
    if (!isNrmsEntitled(enrollment)) {
      return res.status(403).json({ error: "NRMS is not active on this account", code: "NRMS_NOT_ENROLLED" });
    }
    const propertyId = Number(req.params.propertyId);
    const property = await loadOwnedProperty(res, ownerId, propertyId, {
      id: true,
      title: true,
      nrmsActivatedAt: true,
    });
    if (!property) return;

    if (!property.nrmsActivatedAt) {
      const now = new Date();
      const policy = await getActiveNrmsPolicy(now);
      if (!policy) return res.status(503).json({ error: "NRMS usage policy is unavailable", code: "NRMS_POLICY_UNAVAILABLE" });
      const trialEndsAt = new Date(now.getTime() + policy.trialDays * 24 * 60 * 60 * 1000);
      const updated = await prisma.$transaction(async (tx: any) => {
        const next = await tx.property.update({
          where: { id: propertyId }, data: { nrmsActivatedAt: now },
          select: { id: true, title: true, nrmsActivatedAt: true },
        });
        await tx.ownerPaygAccount.upsert({
          where: { propertyId }, update: {},
          create: { propertyId, ownerId, policyId: policy.id, status: policy.trialDays > 0 ? "TRIAL" : "ACTIVE", trialStartsAt: now, trialEndsAt, unpaidLimit: policy.unpaidLimit },
        });
        return next;
      });
      return res.status(201).json({ property: updated, alreadyActivated: false });
    }
    res.json({ property, alreadyActivated: true });
  } catch (err) {
    console.error("[owner.nrms] property activate failed", err);
    res.status(500).json({ error: "Failed to activate property for NRMS" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/nrms/cancel
 * Cancels the enrollment. Data is retained; only access mode changes (doc 5).
 */
router.post("/cancel", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const enrollment = await getNrmsEnrollment(ownerId);
    if (!enrollment || enrollment.status === "CANCELLED") {
      return res.status(409).json({ error: "No active NRMS enrollment to cancel" });
    }
    await prisma.ownerServiceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    res.json({ workspaceMode: "MARKETPLACE_ONLY", entitled: false, cancelled: true });
  } catch (err) {
    console.error("[owner.nrms] cancel failed", err);
    res.status(500).json({ error: "Failed to cancel NRMS enrollment" });
  }
}) as RequestHandler);

export default router;
