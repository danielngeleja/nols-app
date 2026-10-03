// Stock counts and the variance report (docs/NRMS_STOCK_AND_PURCHASING.md,
// milestone 3). Mounted at /api/nrms/stock beside the other stock routers.
//
// Flow: start (blind by default) -> count lines, saved as you go -> submit
// (expected is frozen per line as of the moment it was counted) -> a manager
// reviews, may send lines back for a recount, and approves, which posts one
// COUNT_ADJUSTMENT per line. Nothing is editable after approval.

import crypto from "crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { sanitizeText } from "../lib/sanitize.js";
import { requireNrmsPropertyCapability, type NrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";
import { hasNrmsCapability } from "../lib/nrmsAuthorization.js";
import { COUNT_SOURCE, STOCK_CATEGORIES, adjustStock, roundCost, roundMoney, roundQty } from "../lib/nrmsInventory.js";
import { locationInScope, scopedLocations } from "../lib/nrmsStockScope.js";
import { DEFAULT_VARIANCE_TOLERANCES, expectedAt, lineVariance, stockFell, summarisePeriod, toleranceFor, unitSellPrices, withinTolerance } from "../lib/nrmsStockCount.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
const TX_OPTIONS = { maxWait: 5000, timeout: 30000 };
const OPEN_STATUSES = ["IN_PROGRESS", "SUBMITTED", "RECOUNT"];

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function idParam(req: AuthedRequest, name: string): number | null {
  const value = Number(req.params[name]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function canApprove(access: NrmsPropertyAccess): boolean {
  return hasNrmsCapability(access.role, "stock.adjustment.approve");
}

async function userNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id): id is number => Number.isInteger(id)))];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, fullName: true, email: true } });
  return new Map(users.map((user: any) => [user.id, user.fullName || user.name || user.email || `User ${user.id}`]));
}

// ======================================================================= settings

const countSettingsSchema = z.object({
  varianceTolerances: z.record(z.enum(STOCK_CATEGORIES), z.number().min(0).max(100)).optional(),
  handoverCountItems: z.record(z.string().regex(/^\d+$/), z.array(z.number().int().positive()).max(40)).optional(),
});

router.get("/property/:propertyId/count-settings", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.read");
  if (!access) return;
  const row = await db.nrmsStockSettings.findUnique({ where: { propertyId: access.property.id }, select: { varianceTolerances: true, handoverCountItems: true } });
  const overrides = (row?.varianceTolerances ?? {}) as Record<string, number>;
  res.json({
    tolerances: Object.fromEntries(STOCK_CATEGORIES.map((category) => [category, toleranceFor(category, overrides)])),
    defaults: DEFAULT_VARIANCE_TOLERANCES,
    handoverCountItems: row?.handoverCountItems ?? {},
    canEdit: access.role === "OWNER",
  });
}) as RequestHandler);

/** PUT /property/:propertyId/count-settings - owner only, like every other stock limit. */
router.put("/property/:propertyId/count-settings", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.read");
  if (!access) return;
  if (access.role !== "OWNER") return res.status(403).json({ error: "Only the owner can change count tolerances" });
  const parsed = countSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the count settings", details: parsed.error.flatten() });
  const propertyId = access.property.id;
  const data: Record<string, unknown> = {};
  if (parsed.data.varianceTolerances) data.varianceTolerances = parsed.data.varianceTolerances;
  if (parsed.data.handoverCountItems) {
    const locations = new Set((await scopedLocations(db, access)).map((location) => String(location.id)));
    for (const key of Object.keys(parsed.data.handoverCountItems)) if (!locations.has(key)) return res.status(400).json({ error: "Unknown location in the handover list" });
    data.handoverCountItems = parsed.data.handoverCountItems;
  }
  await db.nrmsStockSettings.upsert({ where: { propertyId }, create: { propertyId, ...data }, update: data });
  res.json({ ok: true });
}) as RequestHandler);

// ========================================================================= counts

const startSchema = z.object({
  locationId: z.number().int().positive(),
  scope: z.enum(["FULL", "SPOT", "HANDOVER"]),
  stockItemIds: z.array(z.number().int().positive()).max(400).optional(),
  blind: z.boolean().optional(),
  note: z.string().trim().max(300).optional().nullable(),
});

/**
 * POST /property/:propertyId/counts - start a count. One open count per
 * location at a time, so two people never count the same shelf into two books.
 */
router.post("/property/:propertyId/counts", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.count");
  if (!access) return;
  const parsed = startSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the count", details: parsed.error.flatten() });
  const input = parsed.data;
  const propertyId = access.property.id;
  const location = await locationInScope(db, access, input.locationId);
  if (!location) return res.status(403).json({ error: "This location is outside your assignment" });
  const open = await db.nrmsStockCount.findFirst({ where: { locationId: location.id, status: { in: OPEN_STATUSES } }, select: { countNumber: true } });
  if (open) return res.status(409).json({ error: `${open.countNumber} is still open at ${location.name}. Finish or cancel it first.` });

  let stockItemIds: number[];
  if (input.scope === "FULL") {
    // Everything that has ever sat on this shelf and is still stocked.
    const balances = await db.nrmsStockBalance.findMany({ where: { locationId: location.id, stockItem: { status: "ACTIVE" } }, select: { stockItemId: true } });
    stockItemIds = balances.map((row: any) => row.stockItemId);
  } else if (input.scope === "HANDOVER") {
    const settings = await db.nrmsStockSettings.findUnique({ where: { propertyId }, select: { handoverCountItems: true } });
    stockItemIds = ((settings?.handoverCountItems ?? {}) as Record<string, number[]>)[String(location.id)] ?? [];
    if (stockItemIds.length === 0) return res.status(400).json({ error: "No handover list is set for this location. The owner sets it under count settings." });
  } else {
    stockItemIds = input.stockItemIds ?? [];
  }
  const goods = await db.nrmsStockItem.findMany({ where: { id: { in: [...new Set(stockItemIds)] }, propertyId, status: "ACTIVE" }, select: { id: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  if (goods.length === 0) return res.status(400).json({ error: input.scope === "FULL" ? "Nothing is stocked here yet. Record deliveries or opening counts first." : "Choose at least one good to count" });

  // Only a manager may run an open (non-blind) count: showing the book to the
  // person counting invites counting to match it.
  const blind = canApprove(access) ? input.blind ?? true : true;
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const count = await db.nrmsStockCount.create({
    data: {
      propertyId,
      locationId: location.id,
      countNumber: `CNT-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      scope: input.scope,
      blind,
      note: input.note ? sanitizeText(input.note) : null,
      startedById: req.user!.id,
      lines: { create: goods.map((good: any) => ({ stockItemId: good.id })) },
    },
  });
  res.status(201).json({ countId: count.id, countNumber: count.countNumber, lineCount: goods.length });
}) as RequestHandler);

router.get("/property/:propertyId/counts", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.read");
  if (!access) return;
  const locationIds = (await scopedLocations(db, access)).map((location) => location.id);
  const status = typeof req.query.status === "string" && req.query.status ? String(req.query.status) : undefined;
  const rows = await db.nrmsStockCount.findMany({
    where: { propertyId: access.property.id, locationId: { in: locationIds }, ...(status === "OPEN" ? { status: { in: OPEN_STATUSES } } : status ? { status } : {}) },
    include: { location: { select: { name: true, kind: true } }, lines: { select: { countedQuantity: true, recountRequested: true } } },
    orderBy: { startedAt: "desc" },
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 60)),
  });
  const names = await userNames(rows.flatMap((row: any) => [row.startedById, row.approvedById]));
  const showMoney = canApprove(access) || hasNrmsCapability(access.role, "stock.receive");
  res.json({
    canCount: hasNrmsCapability(access.role, "stock.count"),
    canApprove: canApprove(access),
    counts: rows.map((row: any) => ({
      id: row.id,
      countNumber: row.countNumber,
      scope: row.scope,
      blind: row.blind,
      status: row.status,
      locationId: row.locationId,
      locationName: row.location.name,
      lineCount: row.lines.length,
      countedLines: row.lines.filter((line: any) => line.countedQuantity != null).length,
      recountLines: row.lines.filter((line: any) => line.recountRequested).length,
      startedAt: row.startedAt,
      startedBy: row.startedById ? names.get(row.startedById) ?? null : null,
      approvedAt: row.approvedAt,
      approvedBy: row.approvedById ? names.get(row.approvedById) ?? null : null,
      varianceCost: showMoney && row.varianceCost != null ? number(row.varianceCost) : null,
      varianceSales: showMoney && row.varianceSales != null ? number(row.varianceSales) : null,
      note: row.note,
    })),
  });
}) as RequestHandler);

async function loadCount(req: AuthedRequest, res: Response, capability: "stock.read" | "stock.count" | "stock.adjustment.approve") {
  const countId = idParam(req, "countId");
  if (!countId) { res.status(400).json({ error: "Invalid count" }); return null; }
  const count = await db.nrmsStockCount.findUnique({ where: { id: countId }, include: { location: true } });
  if (!count) { res.status(404).json({ error: "Count not found" }); return null; }
  const access = await requireNrmsPropertyCapability(req, res, count.propertyId, capability);
  if (!access) return null;
  if (!(await locationInScope(db, access, count.locationId))) { res.status(403).json({ error: "This count is outside your assignment" }); return null; }
  return { count, access };
}

/**
 * GET /counts/:countId - the count sheet. Expected quantities and variances
 * are withheld from the counter until approval on a blind count; a manager
 * sees them from submission so they can review.
 */
router.get("/counts/:countId", (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadCount(req, res, "stock.read");
  if (!loaded) return;
  const { count, access } = loaded;
  const lines = await db.nrmsStockCountLine.findMany({
    where: { countId: count.id },
    include: { stockItem: { select: { id: true, name: true, category: true, baseUnit: true, countStyle: true, packUnits: { orderBy: { baseQuantity: "asc" } } } } },
    orderBy: [{ stockItem: { category: "asc" } }, { stockItem: { name: "asc" } }],
  });
  const approver = canApprove(access);
  const reviewing = approver && count.status !== "IN_PROGRESS";
  const revealVariance = count.status === "APPROVED" || reviewing;
  // An open count shows the live book to the counter; a blind one never does.
  const liveExpected = !count.blind && ["IN_PROGRESS", "RECOUNT"].includes(count.status)
    ? new Map<number, number>(await Promise.all(lines.map(async (line: any) => [line.stockItemId, await expectedAt(db, { locationId: count.locationId, stockItemId: line.stockItemId, at: new Date() })] as [number, number])))
    : null;
  const settings = await db.nrmsStockSettings.findUnique({ where: { propertyId: count.propertyId }, select: { varianceTolerances: true } });
  const names = await userNames([count.startedById, count.submittedById, count.approvedById, count.cancelledById, ...lines.map((line: any) => line.countedById)]);
  const showMoney = approver || hasNrmsCapability(access.role, "stock.receive");

  res.json({
    count: {
      id: count.id,
      countNumber: count.countNumber,
      scope: count.scope,
      blind: count.blind,
      status: count.status,
      locationId: count.locationId,
      locationName: count.location.name,
      note: count.note,
      startedAt: count.startedAt,
      startedBy: count.startedById ? names.get(count.startedById) ?? null : null,
      submittedAt: count.submittedAt,
      submittedBy: count.submittedById ? names.get(count.submittedById) ?? null : null,
      approvedAt: count.approvedAt,
      approvedBy: count.approvedById ? names.get(count.approvedById) ?? null : null,
      decisionNote: count.decisionNote,
      varianceCost: showMoney && count.varianceCost != null ? number(count.varianceCost) : null,
      varianceSales: showMoney && count.varianceSales != null ? number(count.varianceSales) : null,
    },
    canCount: hasNrmsCapability(access.role, "stock.count"),
    canApprove: approver,
    showMoney,
    lines: lines.map((line: any) => {
      const expected = line.expectedQuantity != null ? roundQty(number(line.expectedQuantity)) : null;
      const variance = line.varianceQuantity != null ? roundQty(number(line.varianceQuantity)) : null;
      const tolerance = toleranceFor(line.stockItem.category, settings?.varianceTolerances);
      return {
        id: line.id,
        stockItemId: line.stockItemId,
        name: line.stockItem.name,
        category: line.stockItem.category,
        baseUnit: line.stockItem.baseUnit,
        countStyle: line.stockItem.countStyle,
        packUnits: line.stockItem.packUnits.map((pack: any) => ({ id: pack.id, name: pack.name, baseQuantity: roundQty(number(pack.baseQuantity)) })),
        countedQuantity: line.countedQuantity != null ? roundQty(number(line.countedQuantity)) : null,
        countedAt: line.countedAt,
        countedBy: line.countedById ? names.get(line.countedById) ?? null : null,
        recountRequested: line.recountRequested,
        note: line.note,
        expectedQuantity: revealVariance ? expected : liveExpected?.get(line.stockItemId) ?? null,
        varianceQuantity: revealVariance ? variance : null,
        varianceCost: revealVariance && showMoney && line.varianceCost != null ? number(line.varianceCost) : null,
        varianceSales: revealVariance && showMoney && line.varianceSales != null ? number(line.varianceSales) : null,
        tolerancePercent: tolerance,
        withinTolerance: revealVariance && expected != null && variance != null ? withinTolerance({ expected, variance, tolerancePercent: tolerance, countStyle: line.stockItem.countStyle }) : null,
      };
    }),
  });
}) as RequestHandler);

const saveLinesSchema = z.object({
  lines: z.array(z.object({
    lineId: z.number().int().positive(),
    countedQuantity: z.number().finite().min(0).max(100_000_000).nullable(),
    countedAt: z.string().datetime().optional(),
    note: z.string().trim().max(300).optional().nullable(),
  })).min(1).max(400),
});

/**
 * PATCH /counts/:countId/lines - save counted quantities. Setting a value is
 * idempotent, so a phone that lost signal in the store room can replay its
 * queue safely. `countedAt` from the device (bounded to the count's life) keeps
 * the moment of counting, not the moment the signal came back.
 */
router.patch("/counts/:countId/lines", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadCount(req, res, "stock.count");
  if (!loaded) return;
  const { count } = loaded;
  if (!["IN_PROGRESS", "RECOUNT"].includes(count.status)) return res.status(409).json({ error: "This count is no longer open for counting" });
  const parsed = saveLinesSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the counted quantities" });
  const lines = await db.nrmsStockCountLine.findMany({ where: { countId: count.id }, include: { stockItem: { select: { name: true, countStyle: true } } } });
  const byId = new Map<number, any>(lines.map((line: any) => [line.id, line]));
  const now = Date.now();
  for (const input of parsed.data.lines) {
    const line = byId.get(input.lineId);
    if (!line) return res.status(404).json({ error: "A line is not part of this count" });
    if (count.status === "RECOUNT" && !line.recountRequested) return res.status(409).json({ error: `${line.stockItem.name} is not part of the recount` });
    if (input.countedQuantity != null && line.stockItem.countStyle === "WHOLE" && !Number.isInteger(roundQty(input.countedQuantity))) {
      return res.status(400).json({ error: `${line.stockItem.name} is counted in whole units` });
    }
  }
  await db.$transaction(parsed.data.lines.map((input) => {
    const deviceAt = input.countedAt ? new Date(input.countedAt).getTime() : NaN;
    const at = Number.isFinite(deviceAt) && deviceAt >= new Date(count.startedAt).getTime() && deviceAt <= now ? new Date(deviceAt) : new Date(now);
    return db.nrmsStockCountLine.update({
      where: { id: input.lineId },
      data: input.countedQuantity == null
        ? { countedQuantity: null, countedAt: null, countedById: null, ...(input.note !== undefined ? { note: input.note ? sanitizeText(input.note) : null } : {}) }
        : { countedQuantity: roundQty(input.countedQuantity), countedAt: at, countedById: req.user!.id, ...(input.note !== undefined ? { note: input.note ? sanitizeText(input.note) : null } : {}) },
    });
  }));
  res.json({ ok: true, saved: parsed.data.lines.length });
}) as RequestHandler);

/**
 * POST /counts/:countId/submit - freeze the book as of each line's counting
 * moment, and the variance against it. Every line must be counted.
 */
router.post("/counts/:countId/submit", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadCount(req, res, "stock.count");
  if (!loaded) return;
  const { count } = loaded;
  if (!["IN_PROGRESS", "RECOUNT"].includes(count.status)) return res.status(409).json({ error: "This count has already been submitted" });
  const lines = await db.nrmsStockCountLine.findMany({ where: { countId: count.id }, include: { stockItem: { select: { name: true, averageCost: true } } } });
  const missing = lines.filter((line: any) => line.countedQuantity == null);
  if (missing.length) return res.status(400).json({ error: `${missing.length} ${missing.length === 1 ? "good is" : "goods are"} not counted yet: ${missing.slice(0, 3).map((line: any) => line.stockItem.name).join(", ")}${missing.length > 3 ? "…" : ""}` });

  const prices = await unitSellPrices(db, { propertyId: count.propertyId, stockItemIds: lines.map((line: any) => line.stockItemId), outletId: count.location.outletId });
  const updates: any[] = [];
  for (const line of lines) {
    const expected = await expectedAt(db, { locationId: count.locationId, stockItemId: line.stockItemId, at: new Date(line.countedAt) });
    const unitCost = roundCost(number(line.stockItem.averageCost));
    const unitSellPrice = prices.get(line.stockItemId) ?? null;
    const variance = lineVariance({ counted: number(line.countedQuantity), expected, unitCost, unitSellPrice });
    updates.push(db.nrmsStockCountLine.update({
      where: { id: line.id },
      data: { expectedQuantity: expected, varianceQuantity: variance.varianceQuantity, unitCost, varianceCost: variance.varianceCost, unitSellPrice, varianceSales: variance.varianceSales, recountRequested: false },
    }));
  }
  const changed = await db.nrmsStockCount.updateMany({ where: { id: count.id, status: { in: ["IN_PROGRESS", "RECOUNT"] } }, data: { status: "SUBMITTED", submittedById: req.user!.id, submittedAt: new Date() } });
  if (changed.count !== 1) return res.status(409).json({ error: "This count has already been submitted" });
  await db.$transaction(updates);
  res.json({ ok: true });
}) as RequestHandler);

/** POST /counts/:countId/recount - send chosen lines back to be counted again, blind. */
router.post("/counts/:countId/recount", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadCount(req, res, "stock.adjustment.approve");
  if (!loaded) return;
  const parsed = z.object({ lineIds: z.array(z.number().int().positive()).min(1).max(400), note: z.string().trim().max(300).optional().nullable() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Choose the lines to count again" });
  if (loaded.count.status !== "SUBMITTED") return res.status(409).json({ error: "Only a submitted count can be sent back" });
  await db.$transaction([
    db.nrmsStockCountLine.updateMany({
      where: { countId: loaded.count.id, id: { in: parsed.data.lineIds } },
      data: { recountRequested: true, countedQuantity: null, countedAt: null, countedById: null, expectedQuantity: null, varianceQuantity: null, varianceCost: null, varianceSales: null },
    }),
    db.nrmsStockCount.update({ where: { id: loaded.count.id }, data: { status: "RECOUNT", ...(parsed.data.note ? { decisionNote: sanitizeText(parsed.data.note) } : {}) } }),
  ]);
  res.json({ ok: true });
}) as RequestHandler);

/**
 * POST /counts/:countId/approve - post the variances. Lines outside tolerance
 * need an explanation in the decision note. Counting and approving by the
 * same person is allowed and reported (decision D6).
 */
router.post("/counts/:countId/approve", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadCount(req, res, "stock.adjustment.approve");
  if (!loaded) return;
  const { count } = loaded;
  const parsed = z.object({ decisionNote: z.string().trim().max(500).optional().nullable() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the note" });
  if (count.status !== "SUBMITTED") return res.status(409).json({ error: "Only a submitted count can be approved" });
  const lines = await db.nrmsStockCountLine.findMany({ where: { countId: count.id }, include: { stockItem: { select: { name: true, category: true, countStyle: true } } } });
  const settingsRow = await db.nrmsStockSettings.findUnique({ where: { propertyId: count.propertyId }, select: { varianceTolerances: true } });
  const outside = lines.filter((line: any) => !withinTolerance({ expected: number(line.expectedQuantity), variance: number(line.varianceQuantity), tolerancePercent: toleranceFor(line.stockItem.category, settingsRow?.varianceTolerances), countStyle: line.stockItem.countStyle }));
  const note = parsed.data.decisionNote?.trim() ? sanitizeText(parsed.data.decisionNote.trim()) : null;
  if (outside.length && !note) return res.status(400).json({ error: `${outside.length} ${outside.length === 1 ? "good is" : "goods are"} outside the normal loss. Say what you found before approving.` });

  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsStockCount.updateMany({ where: { id: count.id, status: "SUBMITTED" }, data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), decisionNote: note } });
      if (changed.count !== 1) throw new Error("NRMS_COUNT_NOT_SUBMITTED");
      let varianceCost = 0;
      let varianceSales = 0;
      for (const line of lines) {
        varianceCost += number(line.varianceCost);
        varianceSales += number(line.varianceSales);
        const movement = await adjustStock(tx, {
          propertyId: count.propertyId,
          locationId: count.locationId,
          stockItemId: line.stockItemId,
          delta: number(line.varianceQuantity),
          sourceType: COUNT_SOURCE,
          sourceId: count.id,
          note: `Count ${count.countNumber}`,
          actorId: req.user!.id,
        });
        if (movement) await tx.nrmsStockCountLine.update({ where: { id: line.id }, data: { movementId: movement.id } });
      }
      await tx.nrmsStockCount.update({ where: { id: count.id }, data: { varianceCost: roundMoney(varianceCost), varianceSales: roundMoney(varianceSales) } });
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_COUNT_NOT_SUBMITTED") return res.status(409).json({ error: "This count is no longer waiting for approval" });
    console.error("[nrms.stock.counts] approval failed", error);
    return res.status(500).json({ error: "Unable to approve the count" });
  }
  const counters = new Set(lines.map((line: any) => line.countedById));
  res.json({ ok: true, selfApproved: counters.has(req.user!.id) });
}) as RequestHandler);

router.post("/counts/:countId/cancel", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadCount(req, res, "stock.count");
  if (!loaded) return;
  const { count, access } = loaded;
  if (count.startedById !== req.user!.id && !canApprove(access)) return res.status(403).json({ error: "Only whoever started the count or a manager can cancel it" });
  const changed = await db.nrmsStockCount.updateMany({ where: { id: count.id, status: { in: OPEN_STATUSES } }, data: { status: "CANCELLED", cancelledById: req.user!.id, cancelledAt: new Date() } });
  if (changed.count !== 1) return res.status(409).json({ error: "This count can no longer be cancelled" });
  res.json({ ok: true });
}) as RequestHandler);

// ====================================================================== reports

/**
 * GET /counts/:countId/report - the variance report for one approved count:
 * per good, what the shelf should have held (previous count, deliveries,
 * transfers, sales, write-offs) against what was found, the same good's last
 * eight counts, who worked the location, and transfers that arrived short.
 */
router.get("/counts/:countId/report", (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadCount(req, res, "stock.read");
  if (!loaded) return;
  const { count, access } = loaded;
  if (count.status !== "APPROVED" && !(canApprove(access) && count.status === "SUBMITTED")) {
    return res.status(409).json({ error: "The report is ready once the count is approved" });
  }
  const showMoney = canApprove(access) || hasNrmsCapability(access.role, "stock.receive");
  const lines = await db.nrmsStockCountLine.findMany({ where: { countId: count.id }, include: { stockItem: { select: { name: true, category: true, baseUnit: true, countStyle: true } } } });
  const settingsRow = await db.nrmsStockSettings.findUnique({ where: { propertyId: count.propertyId }, select: { varianceTolerances: true } });

  // Earlier approved lines for the same goods at the same location, newest first.
  const history = await db.nrmsStockCountLine.findMany({
    where: { stockItemId: { in: lines.map((line: any) => line.stockItemId) }, count: { locationId: count.locationId, status: "APPROVED", id: { not: count.id } }, countedAt: { lt: new Date(Math.max(...lines.map((line: any) => new Date(line.countedAt).getTime()))) } },
    select: { stockItemId: true, countedQuantity: true, countedAt: true, varianceQuantity: true, varianceCost: true, count: { select: { countNumber: true, approvedAt: true } } },
    orderBy: { countedAt: "desc" },
  });

  let windowStart: Date | null = null;
  const rows: any[] = [];
  for (const line of lines) {
    const countedAt = new Date(line.countedAt);
    const previous = history.find((row: any) => row.stockItemId === line.stockItemId && new Date(row.countedAt) < countedAt) ?? null;
    const since = previous ? new Date(previous.countedAt) : null;
    if (since && (!windowStart || since < windowStart)) windowStart = since;
    const movements = await db.nrmsStockMovement.findMany({
      where: { locationId: count.locationId, stockItemId: line.stockItemId, occurredAt: { ...(since ? { gt: since } : {}), lte: countedAt }, type: { not: "COUNT_ADJUSTMENT" } },
      select: { type: true, quantity: true },
    });
    const breakdown = summarisePeriod(previous ? number(previous.countedQuantity) : 0, movements.map((row: any) => ({ type: row.type, quantity: number(row.quantity) })));
    const counted = number(line.countedQuantity);
    const expected = number(line.expectedQuantity);
    const variance = number(line.varianceQuantity);
    const tolerance = toleranceFor(line.stockItem.category, settingsRow?.varianceTolerances);
    rows.push({
      stockItemId: line.stockItemId,
      name: line.stockItem.name,
      category: line.stockItem.category,
      baseUnit: line.stockItem.baseUnit,
      since,
      previousCount: previous?.count?.countNumber ?? null,
      breakdown,
      expected,
      counted,
      variance,
      stockFell: stockFell(breakdown, counted),
      // Consistency check: the breakdown should rebuild the frozen expected
      // figure; a gap means movements were back-dated around the count.
      breakdownMatches: Math.abs(breakdown.expected - expected) < 0.001,
      varianceCost: showMoney ? number(line.varianceCost) : null,
      varianceSales: showMoney && line.varianceSales != null ? number(line.varianceSales) : null,
      tolerancePercent: tolerance,
      withinTolerance: withinTolerance({ expected, variance, tolerancePercent: tolerance, countStyle: line.stockItem.countStyle }),
      note: line.note,
      trend: history.filter((row: any) => row.stockItemId === line.stockItemId).slice(0, 8).reverse().map((row: any) => ({
        countNumber: row.count.countNumber,
        at: row.countedAt,
        variance: roundQty(number(row.varianceQuantity)),
        varianceCost: showMoney ? number(row.varianceCost) : null,
      })),
    });
  }
  rows.sort((a, b) => (a.varianceSales ?? a.varianceCost ?? a.variance) - (b.varianceSales ?? b.varianceCost ?? b.variance));

  const windowEnd = new Date(Math.max(...lines.map((line: any) => new Date(line.countedAt).getTime())));
  const from = windowStart ?? new Date(count.startedAt.getTime() - 7 * 86_400_000);

  // Who worked this outlet in the window: shifts of staff assigned to it.
  // Context for the owner, never an accusation.
  let staff: Array<{ name: string; shifts: number; from: string; to: string | null }> = [];
  if (count.location.outletId) {
    const memberships = await db.nrmsStaffMembership.findMany({ where: { propertyId: count.propertyId, outletId: count.location.outletId }, select: { userId: true } });
    const userIds = [...new Set(memberships.map((row: any) => row.userId))];
    if (userIds.length) {
      const shifts = await db.nrmsCashierShift.findMany({
        where: { propertyId: count.propertyId, userId: { in: userIds }, openedAt: { lte: windowEnd }, OR: [{ closedAt: null }, { closedAt: { gte: from } }] },
        select: { userId: true, openedAt: true, closedAt: true },
        orderBy: { openedAt: "asc" },
      });
      const names = await userNames(shifts.map((row: any) => row.userId));
      const byUser = new Map<number, { name: string; shifts: number; from: string; to: string | null }>();
      for (const shift of shifts) {
        const current = byUser.get(shift.userId) ?? { name: names.get(shift.userId) ?? "Staff", shifts: 0, from: shift.openedAt.toISOString(), to: null };
        current.shifts += 1;
        current.to = shift.closedAt ? shift.closedAt.toISOString() : null;
        byUser.set(shift.userId, current);
      }
      staff = [...byUser.values()].sort((a, b) => b.shifts - a.shifts);
    }
  }

  const shortTransfers = await db.nrmsStockTransferLine.findMany({
    where: { transfer: { status: "RECEIVED", sentAt: { gte: from, lte: windowEnd }, OR: [{ fromLocationId: count.locationId }, { toLocationId: count.locationId }] }, quantityReceived: { not: null } },
    select: { stockItemId: true, quantitySent: true, quantityReceived: true, transfer: { select: { transferNumber: true, fromLocation: { select: { name: true } }, toLocation: { select: { name: true } } } }, stockItem: { select: { name: true, baseUnit: true } } },
  });

  const totals = rows.reduce((sum, row) => ({
    varianceCost: sum.varianceCost + (row.varianceCost ?? 0),
    varianceSales: sum.varianceSales + (row.varianceSales ?? 0),
    outside: sum.outside + (row.withinTolerance ? 0 : 1),
  }), { varianceCost: 0, varianceSales: 0, outside: 0 });

  res.json({
    count: { id: count.id, countNumber: count.countNumber, status: count.status, locationName: count.location.name, blind: count.blind, scope: count.scope, approvedAt: count.approvedAt, decisionNote: count.decisionNote },
    window: { from, to: windowEnd },
    showMoney,
    totals: { varianceCost: showMoney ? roundMoney(totals.varianceCost) : null, varianceSales: showMoney ? roundMoney(totals.varianceSales) : null, outsideTolerance: totals.outside, lines: rows.length },
    rows,
    staff,
    shortTransfers: shortTransfers
      .filter((row: any) => number(row.quantityReceived) < number(row.quantitySent))
      .map((row: any) => ({ transferNumber: row.transfer.transferNumber, from: row.transfer.fromLocation.name, to: row.transfer.toLocation.name, name: row.stockItem.name, baseUnit: row.stockItem.baseUnit, sent: roundQty(number(row.quantitySent)), received: roundQty(number(row.quantityReceived)) })),
  });
}) as RequestHandler);

/**
 * GET /property/:propertyId/variance - losses across approved counts in a
 * date range, per location and good, worst first: the owner's weekly view.
 */
router.get("/property/:propertyId/variance", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.read");
  if (!access) return;
  const showMoney = canApprove(access) || hasNrmsCapability(access.role, "stock.receive");
  const to = typeof req.query.to === "string" && !Number.isNaN(Date.parse(req.query.to)) ? new Date(`${req.query.to.slice(0, 10)}T23:59:59.999+03:00`) : new Date();
  const from = typeof req.query.from === "string" && !Number.isNaN(Date.parse(req.query.from)) ? new Date(`${req.query.from.slice(0, 10)}T00:00:00.000+03:00`) : new Date(to.getTime() - 30 * 86_400_000);
  const locations = await scopedLocations(db, access);
  const locationFilter = Number(req.query.locationId) || undefined;
  const locationIds = locations.map((location) => location.id).filter((id) => !locationFilter || id === locationFilter);
  const lines = await db.nrmsStockCountLine.findMany({
    where: { count: { propertyId: access.property.id, locationId: { in: locationIds }, status: "APPROVED", approvedAt: { gte: from, lte: to } } },
    select: { stockItemId: true, varianceQuantity: true, varianceCost: true, varianceSales: true, stockItem: { select: { name: true, category: true, baseUnit: true } }, count: { select: { id: true, locationId: true, countNumber: true, approvedAt: true } } },
  });
  const key = (row: any) => `${row.count.locationId}:${row.stockItemId}`;
  const grouped = new Map<string, any>();
  for (const row of lines) {
    const current = grouped.get(key(row)) ?? {
      locationId: row.count.locationId,
      locationName: locations.find((location) => location.id === row.count.locationId)?.name ?? "",
      stockItemId: row.stockItemId,
      name: row.stockItem.name,
      category: row.stockItem.category,
      baseUnit: row.stockItem.baseUnit,
      counts: 0,
      countsShort: 0,
      varianceQuantity: 0,
      varianceCost: 0,
      varianceSales: 0,
      hasSales: false,
    };
    current.counts += 1;
    if (number(row.varianceQuantity) < 0) current.countsShort += 1;
    current.varianceQuantity = roundQty(current.varianceQuantity + number(row.varianceQuantity));
    current.varianceCost = roundMoney(current.varianceCost + number(row.varianceCost));
    if (row.varianceSales != null) { current.varianceSales = roundMoney(current.varianceSales + number(row.varianceSales)); current.hasSales = true; }
    grouped.set(key(row), current);
  }
  const rows = [...grouped.values()]
    .map((row) => ({ ...row, varianceCost: showMoney ? row.varianceCost : null, varianceSales: showMoney && row.hasSales ? row.varianceSales : null }))
    .sort((a, b) => (a.varianceSales ?? a.varianceCost ?? a.varianceQuantity) - (b.varianceSales ?? b.varianceCost ?? b.varianceQuantity));
  const approvedCounts = new Set(lines.map((row: any) => row.count.id)).size;
  const byLocation = locations.filter((location) => locationIds.includes(location.id)).map((location) => {
    const mine = rows.filter((row) => row.locationId === location.id);
    return { locationId: location.id, name: location.name, lines: mine.length, varianceCost: showMoney ? roundMoney(mine.reduce((sum, row) => sum + (row.varianceCost ?? 0), 0)) : null, varianceSales: showMoney ? roundMoney(mine.reduce((sum, row) => sum + (row.varianceSales ?? 0), 0)) : null };
  });
  res.json({
    from,
    to,
    showMoney,
    approvedCounts,
    totals: {
      varianceCost: showMoney ? roundMoney(rows.reduce((sum, row) => sum + (row.varianceCost ?? 0), 0)) : null,
      varianceSales: showMoney ? roundMoney(rows.reduce((sum, row) => sum + (row.varianceSales ?? 0), 0)) : null,
      goodsShort: rows.filter((row) => row.varianceQuantity < 0).length,
    },
    byLocation,
    rows,
  });
}) as RequestHandler);

export default router;
