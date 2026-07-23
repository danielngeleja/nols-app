import crypto from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { requireNrms, loadOwnedActiveNrmsProperty } from "../lib/nrms.js";
import { NRMS_REVIEW_CATEGORIES, NRMS_REVIEW_CATEGORY_KEYS, averageCategoryRatings, resolveReviewCategories } from "../lib/nrmsReviewCategories.js";

export const router = Router();
router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, requireNrms as RequestHandler);

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalId = z.number().int().positive().nullable().optional();
const ratePlanSchema = z.object({
  roomTypeId: optionalId,
  code: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "_")),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  currency: z.string().trim().length(3).default("TZS").transform((value) => value.toUpperCase()),
  adjustmentType: z.enum(["BASE", "FIXED", "OFFSET", "PERCENT"]).default("BASE"),
  adjustment: z.number().finite().default(0),
  mealPlan: z.enum(["ROOM_ONLY", "BREAKFAST", "HALF_BOARD", "FULL_BOARD", "ALL_INCLUSIVE"]).default("ROOM_ONLY"),
  refundable: z.boolean().default(true),
  minAdvanceDays: z.number().int().min(0).nullable().optional(),
  maxAdvanceDays: z.number().int().min(0).nullable().optional(),
  defaultMinStay: z.number().int().min(1).max(365).default(1),
  defaultMaxStay: z.number().int().min(1).max(365).nullable().optional(),
  isDefault: z.boolean().default(false),
});
const seasonSchema = z.object({
  name: z.string().trim().min(2).max(120), startDate: dateText, endDate: dateText,
  adjustmentType: z.enum(["FIXED", "OFFSET", "PERCENT"]).default("OFFSET"), adjustment: z.number().finite(),
  minStay: z.number().int().min(1).max(365).nullable().optional(), maxStay: z.number().int().min(1).max(365).nullable().optional(),
  closedToArrival: z.boolean().default(false), closedToDeparture: z.boolean().default(false), priority: z.number().int().min(0).max(100).default(0),
});
const restrictionSchema = z.object({
  roomTypeId: optionalId, ratePlanId: optionalId, name: z.string().trim().min(2).max(120), startDate: dateText, endDate: dateText,
  minStay: z.number().int().min(1).max(365).nullable().optional(), maxStay: z.number().int().min(1).max(365).nullable().optional(),
  minAdvanceDays: z.number().int().min(0).nullable().optional(), maxAdvanceDays: z.number().int().min(0).nullable().optional(),
  stopSell: z.boolean().default(false), closedToArrival: z.boolean().default(false), closedToDeparture: z.boolean().default(false),
  channelCode: z.string().trim().max(40).nullable().optional(),
});
const serviceCaseSchema = z.object({
  roomUnitId: optionalId, reservationId: optionalId, guestProfileId: optionalId,
  category: z.enum(["MAINTENANCE", "GUEST_REQUEST", "SAFETY", "IT", "OTHER"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  title: z.string().trim().min(3).max(160), description: z.string().trim().max(5000).nullable().optional(), dueAt: z.string().datetime().nullable().optional(),
});
const caseUpdateSchema = z.object({
  version: z.number().int().positive(), status: z.enum(["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CANCELLED"]),
  note: z.string().trim().max(1000).nullable().optional(), resolution: z.string().trim().max(1000).nullable().optional(), assignedToId: optionalId,
});
const journeySchema = z.object({
  name: z.string().trim().min(2).max(120), trigger: z.enum(["BOOKED", "PRE_ARRIVAL", "CHECK_IN", "PRE_DEPARTURE", "CHECK_OUT"]),
  offsetMinutes: z.number().int().min(-100_800).max(100_800).default(0), channel: z.enum(["SMS", "EMAIL"]).default("SMS"),
  subject: z.string().trim().max(160).nullable().optional(), message: z.string().trim().min(3).max(1000), active: z.boolean().default(true),
});
const paymentRequestSchema = z.object({
  reservationId: z.number().int().positive(), kind: z.enum(["DEPOSIT", "BALANCE", "INCIDENTAL"]).default("DEPOSIT"),
  amount: z.number().positive(), currency: z.string().trim().length(3).default("TZS").transform((value) => value.toUpperCase()),
  dueAt: z.string().datetime().nullable().optional(),
});
const ratePlanUpdateSchema = ratePlanSchema.partial().extend({ version: z.number().int().positive() });

const ONBOARDING_CHECKS = [
  ["PROPERTY", "Property identity and operating details"], ["ROOMS", "Room types and sellable room units"],
  ["RATES", "Default rate plan and restrictions"], ["PAYMENTS", "Guest payment instructions"],
  ["STAFF", "Operational roles and access"], ["JOURNEY", "Guest journey communication"],
  ["DRY_RUN", "Availability and reservation dry run"], ["RECOVERY", "Rollback snapshot verified"],
] as const;

function day(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function token(): string { return crypto.randomBytes(24).toString("base64url"); }
function reference(propertyId: number): string { return `SC-${propertyId}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; }
function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function daysBetween(start: Date, end: Date): number { return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000)); }

async function owned(req: AuthedRequest, res: Response) {
  return loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
}

/**
 * Reputation summary for the owner: overall average, per-category averages and
 * how departing guests answered the NoLSAF repeat-use question. Category scores
 * are the actionable part, an overall 3.8 says nothing, "security 2.4" does.
 */
function buildReviewInsights(rows: Array<{ rating: number | null; categoryRatings: unknown; platformIntent: string | null }>, storedCategories: unknown) {
  const rated = rows.filter((row) => typeof row.rating === "number");
  const overall = rated.length ? Number((rated.reduce((sum, row) => sum + (row.rating ?? 0), 0) / rated.length).toFixed(2)) : null;
  const intent = { YES: 0, MAYBE: 0, NO: 0 } as Record<string, number>;
  for (const row of rows) if (row.platformIntent && row.platformIntent in intent) intent[row.platformIntent] += 1;
  return {
    responses: rows.length,
    overall,
    categories: averageCategoryRatings(rows),
    selectedCategories: resolveReviewCategories(storedCategories),
    availableCategories: NRMS_REVIEW_CATEGORIES.map((item) => ({ key: item.key, label: item.label })),
    platformIntent: intent,
  };
}

router.put("/:propertyId/review-categories", (async (req: AuthedRequest, res: Response) => {
  const parsed = z.object({ categories: z.array(z.enum(NRMS_REVIEW_CATEGORY_KEYS as [string, ...string[]])).max(NRMS_REVIEW_CATEGORY_KEYS.length) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose valid review categories" });
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId);
    const categories = resolveReviewCategories(parsed.data.categories);
    await prisma.property.update({ where: { id: propertyId }, data: { nrmsReviewCategories: categories as Prisma.InputJsonValue } });
    res.json({ categories });
  } catch (error) { console.error("[owner.nrms.market-readiness] review categories failed", error); res.status(500).json({ error: "Failed to save review categories" }); }
}) as RequestHandler);

/** Close a recovery task once the hotel has actually contacted the unhappy guest. */
router.post("/:propertyId/reviews/:reviewId/recovered", (async (req: AuthedRequest, res: Response) => {
  const parsed = z.object({ note: z.string().trim().max(500).nullable().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Recovery note is too long" });
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId);
    const changed = await prisma.nrmsReviewRequest.updateMany({ where: { id: Number(req.params.reviewId), propertyId, needsRecovery: true, recoveredAt: null }, data: { recoveredAt: new Date(), recoveryNote: parsed.data.note ?? null } });
    if (!changed.count) return res.status(404).json({ error: "No open recovery task for this response" });
    res.json({ recovered: true });
  } catch (error) { console.error("[owner.nrms.market-readiness] review recovery failed", error); res.status(500).json({ error: "Failed to close the recovery task" }); }
}) as RequestHandler);

router.get("/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await owned(req, res); if (!active) return;
    const propertyId = Number(req.params.propertyId);
    const [ratePlans, restrictions, onboarding, serviceCases, paymentRequests, journeys, forecast, recommendations, loyalty, reviews, portfolios, roomTypes, roomUnits, eligibleReservations, ownerProperties, reviewResponses, reviewSettings] = await Promise.all([
      prisma.nrmsRatePlan.findMany({ where: { propertyId }, include: { roomType: { select: { id: true, name: true } }, seasons: { orderBy: [{ priority: "desc" }, { startDate: "asc" }] } }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
      prisma.nrmsRateRestriction.findMany({ where: { propertyId, status: "ACTIVE" }, include: { roomType: { select: { id: true, name: true } }, ratePlan: { select: { id: true, name: true } } }, orderBy: { startDate: "asc" } }),
      prisma.nrmsOnboardingRun.findFirst({ where: { propertyId, status: { not: "ROLLED_BACK" } }, include: { checks: { orderBy: { id: "asc" } } }, orderBy: { createdAt: "desc" } }),
      prisma.nrmsServiceCase.findMany({ where: { propertyId }, include: { roomUnit: { select: { id: true, code: true } }, guestProfile: { select: { id: true, fullName: true } }, events: { orderBy: { createdAt: "desc" }, take: 3 } }, orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }], take: 100 }),
      prisma.nrmsGuestPaymentRequest.findMany({ where: { reservation: { propertyId } }, include: { reservation: { select: { id: true, receiptNumber: true, guestProfile: { select: { fullName: true, phone: true } } } } }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.nrmsJourneyTemplate.findMany({ where: { propertyId }, include: { _count: { select: { deliveries: true } } }, orderBy: { name: "asc" } }),
      prisma.nrmsForecastSnapshot.findFirst({ where: { propertyId }, orderBy: { generatedAt: "desc" } }),
      prisma.nrmsPricingRecommendation.findMany({ where: { propertyId, status: "PENDING" }, include: { roomType: { select: { name: true } } }, orderBy: { stayDate: "asc" }, take: 50 }),
      prisma.nrmsLoyaltyAccount.findMany({ where: { propertyId }, include: { guestProfile: { select: { fullName: true, phone: true } } }, orderBy: [{ tier: "desc" }, { lifetimeSpend: "desc" }], take: 50 }),
      prisma.nrmsReviewRequest.findMany({ where: { propertyId }, include: { guestProfile: { select: { fullName: true } }, reservation: { select: { receiptNumber: true, checkedOutAt: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.nrmsPortfolio.findMany({ where: { ownerId: req.user!.id, status: "ACTIVE" }, include: { properties: { include: { property: { select: { id: true, title: true, status: true, nrmsActivatedAt: true } } }, orderBy: { sortOrder: "asc" } } }, orderBy: { name: "asc" } }),
      prisma.roomType.findMany({ where: { propertyId }, select: { id: true, name: true, baseRate: true, currency: true }, orderBy: { sortOrder: "asc" } }),
      prisma.roomUnit.findMany({ where: { propertyId }, select: { id: true, code: true, status: true, housekeepingStatus: true, roomTypeId: true }, orderBy: { code: "asc" } }),
      prisma.reservation.findMany({ where: { propertyId, status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] } }, select: { id: true, receiptNumber: true, status: true, currency: true, totalAmount: true, amountPaid: true, chargesTotal: true, guestProfile: { select: { fullName: true, phone: true } } }, orderBy: { checkIn: "asc" }, take: 100 }),
      prisma.property.findMany({ where: { ownerId: req.user!.id, nrmsActivatedAt: { not: null } }, select: { id: true, title: true, status: true }, orderBy: { title: "asc" } }),
      prisma.nrmsReviewRequest.findMany({ where: { propertyId, respondedAt: { not: null } }, select: { rating: true, categoryRatings: true, platformIntent: true }, orderBy: { respondedAt: "desc" }, take: 500 }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { nrmsReviewCategories: true } }),
    ]);
    res.json({ property: active.property, ratePlans, restrictions, onboarding, serviceCases, paymentRequests, journeys, forecast, recommendations, loyalty, reviews, portfolios, roomTypes, roomUnits, eligibleReservations, ownerProperties, reviewInsights: buildReviewInsights(reviewResponses, reviewSettings?.nrmsReviewCategories) });
  } catch (error) { console.error("[owner.nrms.market-readiness] dashboard failed", error); res.status(500).json({ error: "Failed to load hotel controls" }); }
}) as RequestHandler);

router.post("/:propertyId/rate-plans", (async (req: AuthedRequest, res: Response) => {
  const parsed = ratePlanSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid rate plan", details: parsed.error.flatten() });
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId);
    if (parsed.data.roomTypeId && !(await prisma.roomType.count({ where: { id: parsed.data.roomTypeId, propertyId } }))) return res.status(400).json({ error: "Room type does not belong to this property" });
    const plan = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) await tx.nrmsRatePlan.updateMany({ where: { propertyId }, data: { isDefault: false } });
      return tx.nrmsRatePlan.create({ data: { propertyId, ...parsed.data } });
    });
    res.status(201).json({ plan });
  } catch (error) { console.error("[owner.nrms.market-readiness] rate plan failed", error); res.status(500).json({ error: "Failed to save rate plan" }); }
}) as RequestHandler);

router.patch("/:propertyId/rate-plans/:ratePlanId", (async (req: AuthedRequest, res: Response) => {
  const parsed = ratePlanUpdateSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid rate plan update", details: parsed.error.flatten() });
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const id = Number(req.params.ratePlanId); const { version, ...data } = parsed.data;
    const changed = await prisma.nrmsRatePlan.updateMany({ where: { id, propertyId, version }, data: { ...data, version: { increment: 1 } } });
    if (!changed.count) return res.status(409).json({ error: "This rate plan changed on another device", code: "VERSION_CONFLICT" });
    res.json({ plan: await prisma.nrmsRatePlan.findUnique({ where: { id }, include: { seasons: true } }) });
  } catch (error) { console.error("[owner.nrms.market-readiness] rate plan update failed", error); res.status(500).json({ error: "Failed to update rate plan" }); }
}) as RequestHandler);

router.post("/:propertyId/rate-plans/:ratePlanId/seasons", (async (req: AuthedRequest, res: Response) => {
  const parsed = seasonSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid season", details: parsed.error.flatten() });
  if (day(parsed.data.endDate) < day(parsed.data.startDate)) return res.status(400).json({ error: "Season end date must not precede its start date" });
  try { const active = await owned(req, res); if (!active) return; const ratePlanId = Number(req.params.ratePlanId); const plan = await prisma.nrmsRatePlan.findFirst({ where: { id: ratePlanId, propertyId: Number(req.params.propertyId) } }); if (!plan) return res.status(404).json({ error: "Rate plan not found" }); const season = await prisma.nrmsRateSeason.create({ data: { ratePlanId, ...parsed.data, startDate: day(parsed.data.startDate), endDate: day(parsed.data.endDate) } }); res.status(201).json({ season }); }
  catch (error) { console.error("[owner.nrms.market-readiness] season failed", error); res.status(500).json({ error: "Failed to save season" }); }
}) as RequestHandler);

router.post("/:propertyId/restrictions", (async (req: AuthedRequest, res: Response) => {
  const parsed = restrictionSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid restriction", details: parsed.error.flatten() });
  if (day(parsed.data.endDate) < day(parsed.data.startDate)) return res.status(400).json({ error: "Restriction end date must not precede its start date" });
  try { const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const restriction = await prisma.nrmsRateRestriction.create({ data: { propertyId, ...parsed.data, startDate: day(parsed.data.startDate), endDate: day(parsed.data.endDate) } }); res.status(201).json({ restriction }); }
  catch (error) { console.error("[owner.nrms.market-readiness] restriction failed", error); res.status(500).json({ error: "Failed to save restriction" }); }
}) as RequestHandler);

router.post("/:propertyId/onboarding/start", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId);
    const [rooms, units, rates] = await Promise.all([prisma.roomType.count({ where: { propertyId, status: "ACTIVE" } }), prisma.roomUnit.count({ where: { propertyId, status: "ACTIVE" } }), prisma.nrmsRatePlan.count({ where: { propertyId, status: "ACTIVE" } })]);
    const run = await prisma.nrmsOnboardingRun.create({ data: { propertyId, source: "MANUAL", createdById: req.user!.id, rollbackSnapshot: json({ roomTypeIds: [], roomUnitIds: [], ratePlanIds: [] }), validationResult: json({ rooms, units, rates }), checks: { create: ONBOARDING_CHECKS.map(([key, label]) => ({ key, label, status: key === "ROOMS" && rooms > 0 && units > 0 ? "VERIFIED" : key === "RATES" && rates > 0 ? "VERIFIED" : key === "PROPERTY" ? "VERIFIED" : "PENDING", verifiedAt: key === "PROPERTY" || (key === "ROOMS" && rooms > 0 && units > 0) || (key === "RATES" && rates > 0) ? new Date() : null })) } }, include: { checks: true } });
    res.status(201).json({ run });
  } catch (error) { console.error("[owner.nrms.market-readiness] onboarding start failed", error); res.status(500).json({ error: "Failed to start readiness workflow" }); }
}) as RequestHandler);

router.patch("/:propertyId/onboarding/checks/:checkId", (async (req: AuthedRequest, res: Response) => {
  const parsed = z.object({ status: z.enum(["PENDING", "VERIFIED", "BLOCKED"]), evidence: z.record(z.unknown()).optional() }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid checklist update" });
  try { const active = await owned(req, res); if (!active) return; const check = await prisma.nrmsOnboardingChecklist.findFirst({ where: { id: Number(req.params.checkId), run: { propertyId: Number(req.params.propertyId), status: "IN_PROGRESS" } } }); if (!check) return res.status(404).json({ error: "Active checklist item not found" }); const updated = await prisma.nrmsOnboardingChecklist.update({ where: { id: check.id }, data: { status: parsed.data.status, evidence: parsed.data.evidence ? json(parsed.data.evidence) : undefined, verifiedAt: parsed.data.status === "VERIFIED" ? new Date() : null, updatedById: req.user!.id } }); res.json({ check: updated }); }
  catch (error) { console.error("[owner.nrms.market-readiness] checklist failed", error); res.status(500).json({ error: "Failed to update readiness check" }); }
}) as RequestHandler);

router.post("/:propertyId/onboarding/complete", (async (req: AuthedRequest, res: Response) => {
  try { const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const run = await prisma.nrmsOnboardingRun.findFirst({ where: { propertyId, status: "IN_PROGRESS" }, include: { checks: true }, orderBy: { createdAt: "desc" } }); if (!run) return res.status(404).json({ error: "No active readiness workflow" }); const blocked = run.checks.filter((item) => item.required && item.status !== "VERIFIED"); if (blocked.length) return res.status(409).json({ error: "Required readiness checks remain", checks: blocked.map((item) => item.key) }); const completed = await prisma.nrmsOnboardingRun.update({ where: { id: run.id }, data: { status: "COMPLETED", currentStep: "COMPLETE", completedAt: new Date(), validationResult: json({ passed: true, checkedAt: new Date().toISOString() }) } }); res.json({ run: completed }); }
  catch (error) { console.error("[owner.nrms.market-readiness] onboarding complete failed", error); res.status(500).json({ error: "Failed to complete readiness workflow" }); }
}) as RequestHandler);

router.post("/:propertyId/service-cases", (async (req: AuthedRequest, res: Response) => {
  const parsed = serviceCaseSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid service case", details: parsed.error.flatten() });
  try { const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const created = await prisma.nrmsServiceCase.create({ data: { propertyId, reference: reference(propertyId), createdById: req.user!.id, ...parsed.data, dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, events: { create: { type: "CREATED", toStatus: "OPEN", actorId: req.user!.id } } }, include: { roomUnit: { select: { code: true } }, events: true } }); res.status(201).json({ serviceCase: created }); }
  catch (error) { console.error("[owner.nrms.market-readiness] service case failed", error); res.status(500).json({ error: "Failed to create service case" }); }
}) as RequestHandler);

router.patch("/:propertyId/service-cases/:caseId", (async (req: AuthedRequest, res: Response) => {
  const parsed = caseUpdateSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid service case update" });
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const id = Number(req.params.caseId);
    const current = await prisma.nrmsServiceCase.findFirst({ where: { id, propertyId } }); if (!current) return res.status(404).json({ error: "Service case not found" });
    if (current.version !== parsed.data.version) return res.status(409).json({ error: "This case changed on another device", code: "VERSION_CONFLICT", current });
    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.nrmsServiceCase.updateMany({ where: { id, propertyId, version: parsed.data.version }, data: { status: parsed.data.status, assignedToId: parsed.data.assignedToId, resolution: parsed.data.resolution, acknowledgedAt: parsed.data.status === "ACKNOWLEDGED" && !current.acknowledgedAt ? new Date() : undefined, resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : null, version: { increment: 1 } } });
      if (!changed.count) return null;
      await tx.nrmsServiceCaseEvent.create({ data: { serviceCaseId: id, type: "STATUS_CHANGED", fromStatus: current.status, toStatus: parsed.data.status, note: parsed.data.note, actorId: req.user!.id } });
      return tx.nrmsServiceCase.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "desc" }, take: 5 } } });
    });
    if (!result) return res.status(409).json({ error: "This case changed on another device", code: "VERSION_CONFLICT" }); res.json({ serviceCase: result });
  } catch (error) { console.error("[owner.nrms.market-readiness] service update failed", error); res.status(500).json({ error: "Failed to update service case" }); }
}) as RequestHandler);

router.post("/:propertyId/payment-requests", (async (req: AuthedRequest, res: Response) => {
  const parsed = paymentRequestSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid payment request", details: parsed.error.flatten() });
  try { const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const reservation = await prisma.reservation.findFirst({ where: { id: parsed.data.reservationId, propertyId }, include: { property: { select: { nrmsGuestPayInstructions: true } } } }); if (!reservation) return res.status(404).json({ error: "Reservation not found" }); const request = await prisma.nrmsGuestPaymentRequest.create({ data: { ...parsed.data, dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, publicToken: token(), instructions: reservation.property.nrmsGuestPayInstructions ?? undefined, createdById: req.user!.id } }); res.status(201).json({ paymentRequest: request }); }
  catch (error) { console.error("[owner.nrms.market-readiness] payment request failed", error); res.status(500).json({ error: "Failed to create payment request" }); }
}) as RequestHandler);

router.post("/:propertyId/journeys", (async (req: AuthedRequest, res: Response) => {
  const parsed = journeySchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid journey template", details: parsed.error.flatten() });
  try { const active = await owned(req, res); if (!active) return; const journey = await prisma.nrmsJourneyTemplate.create({ data: { propertyId: Number(req.params.propertyId), ...parsed.data } }); res.status(201).json({ journey }); }
  catch (error) { console.error("[owner.nrms.market-readiness] journey failed", error); res.status(500).json({ error: "Failed to save journey template" }); }
}) as RequestHandler);

router.post("/:propertyId/journeys/schedule", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const now = new Date();
    const [templates, reservations] = await Promise.all([prisma.nrmsJourneyTemplate.findMany({ where: { propertyId, active: true } }), prisma.reservation.findMany({ where: { propertyId, status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] }, checkOut: { gte: new Date(now.getTime() - 7 * 86_400_000) } }, include: { guestProfile: true } })]);
    let queued = 0;
    for (const template of templates) for (const reservation of reservations) {
      const base = template.trigger === "BOOKED" ? reservation.createdAt : template.trigger === "PRE_ARRIVAL" ? reservation.checkIn : template.trigger === "CHECK_IN" ? (reservation.checkedInAt ?? reservation.checkIn) : template.trigger === "PRE_DEPARTURE" ? reservation.checkOut : (reservation.checkedOutAt ?? reservation.checkOut);
      const scheduledAt = new Date(base.getTime() + template.offsetMinutes * 60_000); const guest = reservation.guestProfile;
      const renderedMessage = template.message.split("{{guest}}").join(guest?.fullName ?? "Guest").split("{{property}}").join(String(active.property.title)).split("{{receipt}}").join(reservation.receiptNumber ?? String(reservation.id));
      await prisma.nrmsJourneyDelivery.upsert({ where: { templateId_reservationId: { templateId: template.id, reservationId: reservation.id } }, create: { templateId: template.id, reservationId: reservation.id, guestProfileId: reservation.guestProfileId, scheduledAt, renderedMessage }, update: {} }); queued += 1;
    }
    res.json({ queued });
  } catch (error) { console.error("[owner.nrms.market-readiness] journey scheduling failed", error); res.status(500).json({ error: "Failed to schedule guest journeys" }); }
}) as RequestHandler);

router.post("/:propertyId/forecast/recompute", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const horizonDays = Math.min(Math.max(Number(req.body?.horizonDays) || 30, 7), 90); const start = day(new Date().toISOString().slice(0, 10)); const end = new Date(start.getTime() + horizonDays * 86_400_000);
    const [units, reservations, roomTypes] = await Promise.all([prisma.roomUnit.count({ where: { propertyId, status: "ACTIVE" } }), prisma.reservation.findMany({ where: { propertyId, status: { in: ["HELD", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] }, checkIn: { lt: end }, checkOut: { gt: start } }, select: { checkIn: true, checkOut: true, totalAmount: true } }), prisma.roomType.findMany({ where: { propertyId, status: "ACTIVE", baseRate: { not: null } }, select: { id: true, baseRate: true, currency: true } })]);
    let soldNights = 0; let roomRevenue = 0;
    for (const reservation of reservations) { const overlapStart = reservation.checkIn > start ? reservation.checkIn : start; const overlapEnd = reservation.checkOut < end ? reservation.checkOut : end; const overlap = daysBetween(overlapStart, overlapEnd); soldNights += overlap; roomRevenue += Number(reservation.totalAmount) * overlap / daysBetween(reservation.checkIn, reservation.checkOut); }
    const sellableNights = units * horizonDays; const occupancy = sellableNights ? soldNights / sellableNights : 0; const adr = soldNights ? roomRevenue / soldNights : 0; const revpar = sellableNights ? roomRevenue / sellableNights : 0;
    const forecast = await prisma.nrmsForecastSnapshot.upsert({ where: { propertyId_forecastDate_horizonDays: { propertyId, forecastDate: start, horizonDays } }, create: { propertyId, forecastDate: start, horizonDays, sellableNights, soldNights, occupancyPct: occupancy, roomRevenue, adr, revpar, confidence: reservations.length >= 20 ? 0.8 : reservations.length >= 5 ? 0.65 : 0.45, inputs: json({ activeUnits: units, reservationCount: reservations.length }) }, update: { sellableNights, soldNights, occupancyPct: occupancy, roomRevenue, adr, revpar, confidence: reservations.length >= 20 ? 0.8 : reservations.length >= 5 ? 0.65 : 0.45, inputs: json({ activeUnits: units, reservationCount: reservations.length }), generatedAt: new Date() } });
    const factor = occupancy >= 0.8 ? 1.15 : occupancy <= 0.35 ? 0.9 : 1; const reason = occupancy >= 0.8 ? "High forward occupancy supports a measured rate increase." : occupancy <= 0.35 ? "Low forward occupancy supports a controlled demand offer." : "Forward occupancy is balanced; protect the current rate.";
    for (const roomType of roomTypes) for (let offset = 0; offset < Math.min(horizonDays, 14); offset += 1) { const stayDate = new Date(start.getTime() + offset * 86_400_000); const currentRate = Number(roomType.baseRate); await prisma.nrmsPricingRecommendation.upsert({ where: { roomTypeId_stayDate: { roomTypeId: roomType.id, stayDate } }, create: { propertyId, roomTypeId: roomType.id, stayDate, currency: roomType.currency, currentRate, recommendedRate: Math.round(currentRate * factor), floorRate: Math.round(currentRate * 0.8), ceilingRate: Math.round(currentRate * 1.4), reason, factors: json({ occupancy, horizonDays }) }, update: { currentRate, recommendedRate: Math.round(currentRate * factor), reason, factors: json({ occupancy, horizonDays }), status: "PENDING", appliedAt: null, dismissedAt: null } }); }
    res.json({ forecast });
  } catch (error) { console.error("[owner.nrms.market-readiness] forecast failed", error); res.status(500).json({ error: "Failed to recompute forecast" }); }
}) as RequestHandler);

router.post("/:propertyId/recommendations/:recommendationId/:decision", (async (req: AuthedRequest, res: Response) => {
  const decision = z.enum(["apply", "dismiss"]).safeParse(req.params.decision); if (!decision.success) return res.status(400).json({ error: "Decision must be apply or dismiss" });
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const id = Number(req.params.recommendationId);
    const recommendation = await prisma.nrmsPricingRecommendation.findFirst({ where: { id, propertyId, status: "PENDING" }, include: { roomType: true } }); if (!recommendation) return res.status(404).json({ error: "Pending recommendation not found" });
    if (decision.data === "dismiss") { const updated = await prisma.nrmsPricingRecommendation.update({ where: { id }, data: { status: "DISMISSED", dismissedAt: new Date() } }); return res.json({ recommendation: updated }); }
    const updated = await prisma.$transaction(async (tx) => {
      let plan = await tx.nrmsRatePlan.findFirst({ where: { propertyId, roomTypeId: recommendation.roomTypeId, status: "ACTIVE" }, orderBy: [{ isDefault: "desc" }, { id: "asc" }] });
      if (!plan) plan = await tx.nrmsRatePlan.create({ data: { propertyId, roomTypeId: recommendation.roomTypeId, code: `GUIDANCE_${recommendation.roomTypeId}`, name: `${recommendation.roomType.name} managed rate`, currency: recommendation.currency, adjustmentType: "BASE" } });
      await tx.nrmsRateSeason.create({ data: { ratePlanId: plan.id, name: `Pricing guidance ${recommendation.stayDate.toISOString().slice(0, 10)}`, startDate: recommendation.stayDate, endDate: recommendation.stayDate, adjustmentType: "FIXED", adjustment: recommendation.recommendedRate, priority: 90 } });
      return tx.nrmsPricingRecommendation.update({ where: { id }, data: { status: "APPLIED", appliedAt: new Date() } });
    });
    res.json({ recommendation: updated });
  } catch (error) { console.error("[owner.nrms.market-readiness] recommendation decision failed", error); res.status(500).json({ error: "Failed to apply pricing decision" }); }
}) as RequestHandler);

router.post("/:propertyId/loyalty/rebuild", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const stays = await prisma.reservation.findMany({ where: { propertyId, status: "CHECKED_OUT", guestProfileId: { not: null } }, select: { guestProfileId: true, totalAmount: true, checkedOutAt: true } }); const totals = new Map<number, { stays: number; spend: number; last: Date | null }>();
    for (const stay of stays) { const id = stay.guestProfileId!; const current = totals.get(id) ?? { stays: 0, spend: 0, last: null }; current.stays += 1; current.spend += Number(stay.totalAmount); if (stay.checkedOutAt && (!current.last || stay.checkedOutAt > current.last)) current.last = stay.checkedOutAt; totals.set(id, current); }
    for (const [guestProfileId, value] of totals) { const points = Math.floor(value.spend / 10_000); const tier = value.stays >= 10 ? "PLATINUM" : value.stays >= 5 ? "GOLD" : value.stays >= 2 ? "SILVER" : "MEMBER"; await prisma.nrmsLoyaltyAccount.upsert({ where: { propertyId_guestProfileId: { propertyId, guestProfileId } }, create: { propertyId, guestProfileId, tier, pointsBalance: points, lifetimePoints: points, lifetimeStays: value.stays, lifetimeSpend: value.spend, lastStayAt: value.last }, update: { tier, pointsBalance: points, lifetimePoints: points, lifetimeStays: value.stays, lifetimeSpend: value.spend, lastStayAt: value.last } }); }
    res.json({ accounts: totals.size });
  } catch (error) { console.error("[owner.nrms.market-readiness] loyalty failed", error); res.status(500).json({ error: "Failed to rebuild loyalty records" }); }
}) as RequestHandler);

router.post("/:propertyId/reviews/queue", (async (req: AuthedRequest, res: Response) => {
  try { const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const stays = await prisma.reservation.findMany({ where: { propertyId, status: "CHECKED_OUT", checkedOutAt: { not: null } }, select: { id: true, guestProfileId: true, checkedOutAt: true } }); let queued = 0; for (const stay of stays) { await prisma.nrmsReviewRequest.upsert({ where: { reservationId: stay.id }, create: { propertyId, reservationId: stay.id, guestProfileId: stay.guestProfileId, publicToken: token(), sendAfter: new Date(stay.checkedOutAt!.getTime() + 2 * 60 * 60 * 1000) }, update: {} }); queued += 1; } res.json({ queued }); }
  catch (error) { console.error("[owner.nrms.market-readiness] reviews failed", error); res.status(500).json({ error: "Failed to queue verified-stay review requests" }); }
}) as RequestHandler);

router.post("/:propertyId/portfolios", (async (req: AuthedRequest, res: Response) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(120), propertyIds: z.array(z.number().int().positive()).min(1) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid portfolio" });
  try { const active = await owned(req, res); if (!active) return; const ownedCount = await prisma.property.count({ where: { id: { in: parsed.data.propertyIds }, ownerId: req.user!.id, nrmsActivatedAt: { not: null } } }); if (ownedCount !== new Set(parsed.data.propertyIds).size) return res.status(400).json({ error: "Every portfolio property must be an active NRMS property you own" }); const portfolio = await prisma.nrmsPortfolio.create({ data: { ownerId: req.user!.id, name: parsed.data.name, properties: { create: [...new Set(parsed.data.propertyIds)].map((propertyId, sortOrder) => ({ propertyId, sortOrder })) } }, include: { properties: { include: { property: { select: { id: true, title: true } } } } } }); res.status(201).json({ portfolio }); }
  catch (error) { console.error("[owner.nrms.market-readiness] portfolio failed", error); res.status(500).json({ error: "Failed to create portfolio" }); }
}) as RequestHandler);

const offlineSchema = z.object({ deviceId: z.string().trim().min(3).max(100), mutations: z.array(z.object({ clientMutationId: z.string().trim().min(3).max(100), action: z.enum(["SERVICE_CASE_CREATE", "SERVICE_CASE_STATUS", "ROOM_HOUSEKEEPING_STATUS"]), targetId: z.number().int().positive().nullable().optional(), baseVersion: z.number().int().positive().nullable().optional(), payload: z.record(z.unknown()) })).min(1).max(100) });
router.post("/:propertyId/offline/replay", (async (req: AuthedRequest, res: Response) => {
  const parsed = offlineSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid offline replay batch", details: parsed.error.flatten() });
  try {
    const active = await owned(req, res); if (!active) return; const propertyId = Number(req.params.propertyId); const results: Array<Record<string, unknown>> = [];
    for (const mutation of parsed.data.mutations) {
      const prior = await prisma.nrmsOfflineMutation.findUnique({ where: { userId_deviceId_clientMutationId: { userId: req.user!.id, deviceId: parsed.data.deviceId, clientMutationId: mutation.clientMutationId } } }); if (prior) { results.push({ clientMutationId: mutation.clientMutationId, status: prior.status, result: prior.result, conflict: prior.conflict }); continue; }
      const inbox = await prisma.nrmsOfflineMutation.create({ data: { propertyId, userId: req.user!.id, deviceId: parsed.data.deviceId, clientMutationId: mutation.clientMutationId, action: mutation.action, targetType: mutation.action.startsWith("SERVICE_CASE") ? "SERVICE_CASE" : "ROOM_UNIT", targetId: mutation.targetId, baseVersion: mutation.baseVersion, payload: json(mutation.payload) } });
      try {
        let result: unknown;
        if (mutation.action === "SERVICE_CASE_CREATE") { const input = serviceCaseSchema.parse(mutation.payload); result = await prisma.nrmsServiceCase.create({ data: { propertyId, reference: reference(propertyId), createdById: req.user!.id, ...input, dueAt: input.dueAt ? new Date(input.dueAt) : null, events: { create: { type: "CREATED_OFFLINE", toStatus: "OPEN", actorId: req.user!.id } } } }); }
        else if (mutation.action === "SERVICE_CASE_STATUS") { const input = caseUpdateSchema.parse({ ...mutation.payload, version: mutation.baseVersion }); const current = await prisma.nrmsServiceCase.findFirst({ where: { id: mutation.targetId ?? -1, propertyId } }); if (!current || current.version !== mutation.baseVersion) { const conflict = { expectedVersion: mutation.baseVersion, currentVersion: current?.version ?? null, current }; await prisma.nrmsOfflineMutation.update({ where: { id: inbox.id }, data: { status: "CONFLICT", conflict: json(conflict), processedAt: new Date() } }); results.push({ clientMutationId: mutation.clientMutationId, status: "CONFLICT", conflict }); continue; } result = await prisma.nrmsServiceCase.update({ where: { id: current.id }, data: { status: input.status, resolution: input.resolution, assignedToId: input.assignedToId, version: { increment: 1 }, resolvedAt: input.status === "RESOLVED" ? new Date() : null } }); }
        else { const input = z.object({ housekeepingStatus: z.enum(["CLEAN", "DIRTY", "IN_PROGRESS", "INSPECTED"]) }).parse(mutation.payload); const room = await prisma.roomUnit.findFirst({ where: { id: mutation.targetId ?? -1, propertyId } }); if (!room) throw new Error("ROOM_NOT_FOUND"); result = await prisma.roomUnit.update({ where: { id: room.id }, data: { housekeepingStatus: input.housekeepingStatus, housekeepingUpdatedAt: new Date() } }); }
        await prisma.nrmsOfflineMutation.update({ where: { id: inbox.id }, data: { status: "APPLIED", result: json(result), processedAt: new Date() } }); results.push({ clientMutationId: mutation.clientMutationId, status: "APPLIED", result });
      } catch (error) { const message = error instanceof Error ? error.message : "Offline mutation failed"; await prisma.nrmsOfflineMutation.update({ where: { id: inbox.id }, data: { status: "FAILED", errorMessage: message, processedAt: new Date() } }); results.push({ clientMutationId: mutation.clientMutationId, status: "FAILED", error: message }); }
    }
    res.json({ results });
  } catch (error) { console.error("[owner.nrms.market-readiness] offline replay failed", error); res.status(500).json({ error: "Failed to replay offline operations" }); }
}) as RequestHandler);

export default router;
