// apps/api/src/routes/admin.nrms.enforce.ts
//
// NRMS Admin Oversight, Phase 2: enforcement (docs/NRMS_ADMIN_OVERSIGHT.md).
// Every action here: typed reason, AdminAudit row, owner notification.
// Every state-changing action requires an NRMS finance approver and the admin
// finance OTP grant (requireFinanceGrant), the codebase's standing 2FA
// re-auth gate. Admin oversees, never operates: nothing in this file creates
// or edits menus, orders, reservations or money records.

import { Router } from "express";
import type { RequestHandler, Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireFinanceGrant, requireNrmsFinanceApprover } from "../middleware/financeGrant.js";
import { notifyOwner } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import { NRMS_PLAN_CODE } from "../lib/nrms.js";
import { generateOrderPointToken } from "../lib/nrmsOrderPoints.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler);
router.use(requireRole("ADMIN") as unknown as RequestHandler);
router.use(blockImpersonated as unknown as RequestHandler);

const db = prisma as any;

const reasonSchema = z.object({ reason: z.string().trim().min(5).max(300) });

function parseReason(req: AuthedRequest, res: Response): string | null {
  const parsed = reasonSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "A reason of at least 5 characters is required" });
    return null;
  }
  return sanitizeText(parsed.data.reason);
}

async function audit(adminId: number, action: string, targetUserId: number | null, details: Record<string, unknown>) {
  await db.adminAudit.create({ data: { adminId, targetUserId, action, details } });
}

async function loadNrmsProperty(res: Response, propertyId: number) {
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    res.status(400).json({ error: "Invalid property id" });
    return null;
  }
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { id: true, title: true, ownerId: true, nrmsActivatedAt: true, nrmsQrOrderingFrozenAt: true },
  });
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return null;
  }
  return property;
}

// ── Owner-level: enrollment suspend / restore (2FA) ─────────────────────────

router.post("/enrollment/:ownerId/suspend", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const ownerId = Number(req.params.ownerId);
  if (!Number.isInteger(ownerId) || ownerId <= 0) return res.status(400).json({ error: "Invalid owner id" });
  const reason = parseReason(req, res);
  if (!reason) return;
  const enrollment = await db.ownerServiceEnrollment.findFirst({ where: { ownerId, plan: { code: NRMS_PLAN_CODE } } });
  if (!enrollment) return res.status(404).json({ error: "This owner has no NRMS enrollment" });
  if (enrollment.status === "SUSPENDED") return res.status(409).json({ error: "The enrollment is already suspended" });
  const updated = await db.ownerServiceEnrollment.update({
    where: { id: enrollment.id },
    data: { status: "SUSPENDED", suspendedAt: new Date(), notes: reason },
  });
  await audit(req.user!.id, "NRMS_ENROLLMENT_SUSPEND", ownerId, { enrollmentId: enrollment.id, previousStatus: enrollment.status, reason });
  await notifyOwner(ownerId, "nrms_enrollment_suspended", { reason });
  res.json({ enrollment: { id: updated.id, status: updated.status, suspendedAt: updated.suspendedAt } });
}) as RequestHandler);

router.post("/enrollment/:ownerId/restore", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const ownerId = Number(req.params.ownerId);
  if (!Number.isInteger(ownerId) || ownerId <= 0) return res.status(400).json({ error: "Invalid owner id" });
  const reason = parseReason(req, res);
  if (!reason) return;
  const enrollment = await db.ownerServiceEnrollment.findFirst({ where: { ownerId, plan: { code: NRMS_PLAN_CODE } } });
  if (!enrollment) return res.status(404).json({ error: "This owner has no NRMS enrollment" });
  if (enrollment.status !== "SUSPENDED") return res.status(409).json({ error: "Only a suspended enrollment can be restored" });
  const nextStatus = enrollment.activatedAt ? "ACTIVE" : "TRIAL";
  const updated = await db.ownerServiceEnrollment.update({
    where: { id: enrollment.id },
    data: { status: nextStatus, suspendedAt: null },
  });
  await audit(req.user!.id, "NRMS_ENROLLMENT_RESTORE", ownerId, { enrollmentId: enrollment.id, restoredTo: nextStatus, reason });
  await notifyOwner(ownerId, "nrms_enrollment_restored", { reason });
  res.json({ enrollment: { id: updated.id, status: updated.status } });
}) as RequestHandler);

// ── Property-level: freeze / unfreeze the PAYG account (2FA) ────────────────

router.post("/property/:propertyId/freeze", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const property = await loadNrmsProperty(res, Number(req.params.propertyId));
  if (!property) return;
  const reason = parseReason(req, res);
  if (!reason) return;
  const account = await db.ownerPaygAccount.findUnique({ where: { propertyId: property.id } });
  if (!account) return res.status(404).json({ error: "This property has no NRMS account" });
  if (["FROZEN", "CLOSED"].includes(account.status)) return res.status(409).json({ error: "The property is already frozen or permanently closed" });
  await db.ownerPaygAccount.update({
    where: { id: account.id },
    data: {
      status: "FROZEN",
      freezePreviousStatus: account.status,
      frozenAt: new Date(),
      frozenByAdminId: req.user!.id,
      frozenReason: reason,
    },
  });
  await audit(req.user!.id, "NRMS_PROPERTY_FREEZE", property.ownerId, { propertyId: property.id, accountId: account.id, previousStatus: account.status, reason });
  await notifyOwner(property.ownerId, "nrms_property_frozen", { propertyTitle: property.title, reason });
  res.json({ account: { id: account.id, status: "FROZEN", previousStatus: account.status } });
}) as RequestHandler);

router.post("/property/:propertyId/unfreeze", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const property = await loadNrmsProperty(res, Number(req.params.propertyId));
  if (!property) return;
  const reason = parseReason(req, res);
  if (!reason) return;
  const account = await db.ownerPaygAccount.findUnique({ where: { propertyId: property.id } });
  if (!account) return res.status(404).json({ error: "This property has no NRMS account" });
  if (account.status !== "FROZEN") return res.status(409).json({ error: "The property is not temporarily frozen" });
  const allowedBillingStates = ["TRIAL", "ACTIVE", "WARNING", "PAYMENT_REQUIRED", "PAYMENT_PENDING"];
  const nextStatus = allowedBillingStates.includes(account.freezePreviousStatus) ? account.freezePreviousStatus : null;
  if (!nextStatus) return res.status(409).json({ error: "The previous billing state is unavailable; review the account before unfreezing" });
  await db.ownerPaygAccount.update({
    where: { id: account.id },
    data: { status: nextStatus, freezePreviousStatus: null, frozenAt: null, frozenByAdminId: null, frozenReason: null },
  });
  await audit(req.user!.id, "NRMS_PROPERTY_UNFREEZE", property.ownerId, { propertyId: property.id, accountId: account.id, restoredTo: nextStatus, reason });
  await notifyOwner(property.ownerId, "nrms_property_unfrozen", { propertyTitle: property.title, reason });
  res.json({ account: { id: account.id, status: nextStatus } });
}) as RequestHandler);

// Permanent closure is deliberately separate from a temporary freeze. Only a
// finance approver with a fresh OTP grant can move an account into CLOSED;
// retention scheduling is allowed only after this explicit decision.
router.post("/property/:propertyId/close", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const property = await loadNrmsProperty(res, Number(req.params.propertyId));
  if (!property) return;
  const reason = parseReason(req, res);
  if (!reason) return;
  const account = await db.ownerPaygAccount.findUnique({ where: { propertyId: property.id } });
  if (!account) return res.status(404).json({ error: "This property has no NRMS account" });
  if (account.status === "CLOSED") return res.status(409).json({ error: "The property is already permanently closed" });
  await db.ownerPaygAccount.update({ where: { id: account.id }, data: { status: "CLOSED", freezePreviousStatus: null, frozenAt: null, frozenByAdminId: null, frozenReason: null } });
  await audit(req.user!.id, "NRMS_PROPERTY_CLOSE", property.ownerId, { propertyId: property.id, accountId: account.id, previousStatus: account.status, reason });
  await notifyOwner(property.ownerId, "nrms_property_closed", { propertyTitle: property.title, reason });
  res.json({ account: { id: account.id, status: "CLOSED" } });
}) as RequestHandler);

// ── Staff: global disable + session kill; per-property invite invalidation ──

router.post("/staff/:userId/disable", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "Invalid user id" });
  const reason = parseReason(req, res);
  if (!reason) return;
  const memberships = await db.nrmsStaffMembership.findMany({
    where: { userId, status: { in: ["ACTIVE", "PENDING"] } },
    include: { property: { select: { id: true, title: true, ownerId: true } }, user: { select: { fullName: true, name: true, email: true } } },
  });
  if (memberships.length === 0) return res.status(404).json({ error: "This user has no active or pending NRMS memberships" });
  await db.$transaction([
    db.nrmsStaffMembership.updateMany({ where: { userId, status: { in: ["ACTIVE", "PENDING"] } }, data: { status: "DISABLED" } }),
    // Kill every live session for the disabled staff account.
    db.user.update({ where: { id: userId }, data: { tokensValidAfter: new Date() } }),
  ]);
  const staffName = memberships[0].user?.fullName || memberships[0].user?.name || memberships[0].user?.email || `User #${userId}`;
  await audit(req.user!.id, "NRMS_STAFF_DISABLE_GLOBAL", userId, {
    memberships: memberships.map((m: any) => ({ id: m.id, propertyId: m.propertyId, role: m.role, previousStatus: m.status })),
    reason,
  });
  // Tell every affected owner once.
  const ownerIds = [...new Set(memberships.map((m: any) => m.property.ownerId))] as number[];
  for (const ownerId of ownerIds) {
    await notifyOwner(ownerId, "nrms_staff_disabled", { staffName, reason });
  }
  res.json({ disabled: memberships.length, sessionsRevoked: true });
}) as RequestHandler);

router.post("/property/:propertyId/invites/invalidate", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const property = await loadNrmsProperty(res, Number(req.params.propertyId));
  if (!property) return;
  const reason = parseReason(req, res);
  if (!reason) return;
  const changed = await db.nrmsStaffMembership.updateMany({
    where: { propertyId: property.id, status: "PENDING" },
    data: { status: "DISABLED" },
  });
  if (changed.count === 0) return res.status(409).json({ error: "There are no pending invites for this property" });
  await audit(req.user!.id, "NRMS_INVITES_INVALIDATE", property.ownerId, { propertyId: property.id, invalidated: changed.count, reason });
  await notifyOwner(property.ownerId, "nrms_invites_invalidated", { propertyTitle: property.title, reason });
  res.json({ invalidated: changed.count });
}) as RequestHandler);

// ── QR surface: deactivate all points, rotate all, freeze/unfreeze ordering ─

router.post("/property/:propertyId/order-points/deactivate-all", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const property = await loadNrmsProperty(res, Number(req.params.propertyId));
  if (!property) return;
  const reason = parseReason(req, res);
  if (!reason) return;
  const changed = await db.nrmsOrderPoint.updateMany({ where: { propertyId: property.id, active: true }, data: { active: false } });
  if (changed.count === 0) return res.status(409).json({ error: "This property has no active order points" });
  await audit(req.user!.id, "NRMS_QR_POINTS_DEACTIVATE_ALL", property.ownerId, { propertyId: property.id, deactivated: changed.count, reason });
  await notifyOwner(property.ownerId, "nrms_qr_points_deactivated", { propertyTitle: property.title, reason });
  res.json({ deactivated: changed.count });
}) as RequestHandler);

router.post("/property/:propertyId/order-points/rotate-all", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const property = await loadNrmsProperty(res, Number(req.params.propertyId));
  if (!property) return;
  const reason = parseReason(req, res);
  if (!reason) return;
  const points = await db.nrmsOrderPoint.findMany({ where: { propertyId: property.id }, select: { id: true } });
  if (points.length === 0) return res.status(409).json({ error: "This property has no order points" });
  await db.$transaction(
    points.map((p: { id: number }) =>
      db.nrmsOrderPoint.update({ where: { id: p.id }, data: { token: generateOrderPointToken(), active: true } }),
    ),
  );
  await audit(req.user!.id, "NRMS_QR_POINTS_ROTATE_ALL", property.ownerId, { propertyId: property.id, rotated: points.length, reason });
  await notifyOwner(property.ownerId, "nrms_qr_points_deactivated", { propertyTitle: property.title, reason: `${reason} (all QR codes rotated; printed codes must be replaced)` });
  res.json({ rotated: points.length });
}) as RequestHandler);

router.post("/property/:propertyId/qr-ordering/freeze", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const property = await loadNrmsProperty(res, Number(req.params.propertyId));
  if (!property) return;
  const reason = parseReason(req, res);
  if (!reason) return;
  if (property.nrmsQrOrderingFrozenAt) return res.status(409).json({ error: "QR ordering is already frozen for this property" });
  await db.property.update({ where: { id: property.id }, data: { nrmsQrOrderingFrozenAt: new Date() } });
  await audit(req.user!.id, "NRMS_QR_ORDERING_FREEZE", property.ownerId, { propertyId: property.id, reason });
  await notifyOwner(property.ownerId, "nrms_qr_ordering_frozen", { propertyTitle: property.title, reason });
  res.json({ frozen: true });
}) as RequestHandler);

router.post("/property/:propertyId/qr-ordering/unfreeze", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const property = await loadNrmsProperty(res, Number(req.params.propertyId));
  if (!property) return;
  const reason = parseReason(req, res);
  if (!reason) return;
  if (!property.nrmsQrOrderingFrozenAt) return res.status(409).json({ error: "QR ordering is not frozen for this property" });
  await db.property.update({ where: { id: property.id }, data: { nrmsQrOrderingFrozenAt: null } });
  await audit(req.user!.id, "NRMS_QR_ORDERING_UNFREEZE", property.ownerId, { propertyId: property.id, reason });
  await notifyOwner(property.ownerId, "nrms_qr_ordering_unfrozen", { propertyTitle: property.title, reason });
  res.json({ frozen: false });
}) as RequestHandler);

// ── Payment instructions: clear pending owner correction ────────────────────

router.post("/property/:propertyId/pay-instructions/clear", requireNrmsFinanceApprover as unknown as RequestHandler, requireFinanceGrant as unknown as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const property = await loadNrmsProperty(res, Number(req.params.propertyId));
  if (!property) return;
  const reason = parseReason(req, res);
  if (!reason) return;
  const row = await db.property.findUnique({ where: { id: property.id }, select: { nrmsGuestPayInstructions: true } });
  const previous = Array.isArray(row?.nrmsGuestPayInstructions) ? row.nrmsGuestPayInstructions : [];
  if (previous.length === 0) return res.status(409).json({ error: "This property has no guest payment details" });
  await db.property.update({ where: { id: property.id }, data: { nrmsGuestPayInstructions: [] } });
  await audit(req.user!.id, "NRMS_PAY_INSTRUCTIONS_CLEAR", property.ownerId, { propertyId: property.id, previous, reason });
  await notifyOwner(property.ownerId, "nrms_pay_instructions_cleared", { propertyTitle: property.title, reason });
  res.json({ cleared: previous.length });
}) as RequestHandler);

// ── Enforcement history for the console feed ────────────────────────────────

router.get("/actions", (async (_req: AuthedRequest, res: Response) => {
  const actions = await db.adminAudit.findMany({
    where: { action: { startsWith: "NRMS_" } },
    include: { admin: { select: { id: true, fullName: true, name: true, email: true } } },
    orderBy: { id: "desc" },
    take: 50,
  });
  res.json({
    actions: actions.map((a: any) => ({
      id: a.id,
      action: a.action,
      targetUserId: a.targetUserId,
      details: a.details,
      createdAt: a.createdAt,
      admin: a.admin ? { id: a.admin.id, name: a.admin.fullName || a.admin.name || a.admin.email || `Admin #${a.admin.id}` } : null,
    })),
  });
}) as RequestHandler);

export default router;
