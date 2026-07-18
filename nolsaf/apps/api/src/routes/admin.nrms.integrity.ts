// NRMS Admin Oversight, Phase 5: human-reviewed signals and activity timeline.
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireFinanceGrant, requireNrmsFinanceApprover } from "../middleware/financeGrant.js";
import { notifyOwner } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";

const router = Router();
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);
const db = prisma as any;

router.get("/signals", (async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "OPEN";
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const signals = await db.nrmsIntegritySignal.findMany({ where: { ...(status === "ALL" ? {} : { status }), ...(cursor ? { id: { lt: cursor } } : {}) }, include: { property: { select: { id: true, title: true, ownerId: true } } }, orderBy: [{ detectedAt: "desc" }, { id: "desc" }], take: limit + 1 });
  const hasMore = signals.length > limit;
  const pageSignals = hasMore ? signals.slice(0, limit) : signals;
  const byProperty = new Map<number, any>();
  for (const signal of pageSignals) {
    const current = byProperty.get(signal.propertyId) ?? { property: signal.property, signals: [] };
    current.signals.push({ ...signal, metricValue: signal.metricValue == null ? null : Number(signal.metricValue), baseline: signal.baseline == null ? null : Number(signal.baseline) });
    byProperty.set(signal.propertyId, current);
  }
  res.json({ properties: [...byProperty.values()], signals: [...byProperty.values()].flatMap((row) => row.signals), pagination: { limit, nextCursor: hasMore ? pageSignals[pageSignals.length - 1].id : null } });
}) as RequestHandler);

router.post("/signals/:signalId/acknowledge", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const parsed = z.object({ reason: z.string().trim().min(5).max(300).transform(sanitizeText) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A reason of at least 5 characters is required" });
  const signal = await db.nrmsIntegritySignal.findUnique({ where: { id: Number(req.params.signalId) }, include: { property: { select: { title: true, ownerId: true } } } });
  if (!signal) return res.status(404).json({ error: "Signal not found" });
  if (signal.status !== "OPEN") return res.status(409).json({ error: "This signal was already reviewed" });
  await db.$transaction([db.nrmsIntegritySignal.update({ where: { id: signal.id }, data: { status: "ACKNOWLEDGED", reviewedAt: new Date() } }), db.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: signal.property.ownerId, action: "NRMS_SIGNAL_ACKNOWLEDGE", details: { propertyId: signal.propertyId, signalId: signal.id, kind: signal.kind, reason: parsed.data.reason } } })]);
  await notifyOwner(signal.property.ownerId, "nrms_signal_reviewed", { propertyTitle: signal.property.title, kind: signal.kind, reason: parsed.data.reason });
  res.json({ signal: { id: signal.id, status: "ACKNOWLEDGED" } });
}) as RequestHandler);

router.get("/property/:propertyId/timeline", (async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { id: true, title: true, ownerId: true } });
  if (!property) return res.status(404).json({ error: "Property not found" });
  const [reservationEvents, usageEvents, audits, nightAudits, signals] = await Promise.all([
    db.reservationEvent.findMany({ where: { reservation: { propertyId } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, type: true, data: true, createdAt: true, reservationId: true } }),
    db.nrmsUsageEvent.findMany({ where: { propertyId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, classification: true, amount: true, currency: true, serviceDate: true, createdAt: true } }),
    db.adminAudit.findMany({ where: { targetUserId: property.ownerId, action: { startsWith: "NRMS_" } }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.nrmsNightAuditRun.findMany({ where: { propertyId }, orderBy: { startedAt: "desc" }, take: 100, select: { id: true, status: true, reportNumber: true, startedAt: true, completedAt: true } }),
    db.nrmsIntegritySignal.findMany({ where: { propertyId }, orderBy: { detectedAt: "desc" }, take: 100 }),
  ]);
  const auditRows = audits.filter((a: any) => !a.details || typeof a.details !== "object" || a.details.propertyId == null || Number(a.details.propertyId) === propertyId);
  const timeline = [
    ...reservationEvents.map((e: any) => ({ id: `reservation-${e.id}`, kind: "RESERVATION", title: e.type.replaceAll("_", " "), at: e.createdAt, details: { reservationId: e.reservationId, data: e.data } })),
    ...usageEvents.map((e: any) => ({ id: `usage-${e.id}`, kind: "BILLING", title: e.classification.replaceAll("_", " "), at: e.createdAt, details: { amount: Number(e.amount), currency: e.currency, serviceDate: e.serviceDate } })),
    ...auditRows.map((e: any) => ({ id: `audit-${e.id}`, kind: "ADMIN", title: e.action.replace(/^NRMS_/, "").replaceAll("_", " "), at: e.createdAt, details: e.details })),
    ...nightAudits.map((e: any) => ({ id: `night-${e.id}`, kind: "NIGHT_AUDIT", title: `Night audit ${e.status}`, at: e.completedAt || e.startedAt, details: { reportNumber: e.reportNumber } })),
    ...signals.map((e: any) => ({ id: `signal-${e.id}`, kind: "SIGNAL", title: e.kind.replaceAll("_", " "), at: e.detectedAt, details: { status: e.status, severity: e.severity } })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 300);
  res.json({ property, timeline });
}) as RequestHandler);

export default router;
