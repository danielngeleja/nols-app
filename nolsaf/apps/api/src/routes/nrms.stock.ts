// Goods-level stock control API (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 1).
// Mounted at /api/nrms/stock.
//
// Reads are open to every role holding stock.read, narrowed to the outlets the
// caller serves. Every write carries blockImpersonated: an admin support
// session may look, but a receipt or a recipe change must never land in the
// stock ledger under the owner's or a staff member's name.

import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { sanitizeText } from "../lib/sanitize.js";
import { requireNrmsPropertyCapability, type NrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";
import { hasNrmsCapability } from "../lib/nrmsAuthorization.js";
import {
  NRMS_STOCK_ALREADY_REVERSED,
  NRMS_STOCK_NOT_REVERSIBLE,
  NRMS_STOCK_OPENING_EXISTS,
  NRMS_STOCK_REVERSAL_SHORT,
  STOCK_BASE_UNITS,
  STOCK_CATEGORIES,
  STOCK_COUNT_STYLES,
  ensureOutletStockLocation,
  recordStockReceipt,
  reverseStockReceipt,
  roundCost,
  roundQty,
  syncMenuAvailability,
} from "../lib/nrmsInventory.js";
import { type ScopedLocation, loadStockSettings, locationInScope, scopedLocations } from "../lib/nrmsStockScope.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
// Receipts lock the stock item row and touch balances and menu availability.
// Same headroom as the order transactions (slow Render-to-database round trips).
const STOCK_TX_OPTIONS = { maxWait: 5000, timeout: 15000 };

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function propertyIdParam(req: AuthedRequest): number {
  return Number(req.params.propertyId);
}

/** Cost figures are for the people who buy and price goods, not the serving floor. */
function canSeeCost(access: NrmsPropertyAccess): boolean {
  return hasNrmsCapability(access.role, "stock.catalog.manage") || hasNrmsCapability(access.role, "stock.receive");
}

const quantitySchema = z.number().finite().positive().max(100_000_000);

const packUnitSchema = z.object({
  name: z.string().trim().min(1).max(40),
  baseQuantity: quantitySchema,
});

const itemCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(STOCK_CATEGORIES),
  baseUnit: z.enum(STOCK_BASE_UNITS),
  countStyle: z.enum(STOCK_COUNT_STYLES).default("WHOLE"),
  perishable: z.boolean().default(false),
  shelfLifeDays: z.number().int().min(1).max(3650).optional().nullable(),
  packUnits: z.array(packUnitSchema).max(8).default([]),
});

const itemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category: z.enum(STOCK_CATEGORIES).optional(),
  baseUnit: z.enum(STOCK_BASE_UNITS).optional(),
  countStyle: z.enum(STOCK_COUNT_STYLES).optional(),
  perishable: z.boolean().optional(),
  shelfLifeDays: z.number().int().min(1).max(3650).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

const levelsSchema = z.object({
  locationId: z.number().int().positive(),
  parLevel: z.number().finite().min(0).max(100_000_000).nullable(),
  reorderPoint: z.number().finite().min(0).max(100_000_000).nullable(),
});

const receiptSchema = z.object({
  locationId: z.number().int().positive(),
  stockItemId: z.number().int().positive(),
  /** Either a base-unit quantity, or a pack and how many packs arrived. */
  quantity: quantitySchema.optional(),
  packUnitId: z.number().int().positive().optional(),
  packCount: quantitySchema.optional(),
  /** Either the price per base unit or the total paid for the line. */
  unitCost: z.number().finite().min(0).max(1_000_000_000).optional(),
  totalCost: z.number().finite().min(0).max(100_000_000_000).optional(),
  note: z.string().trim().max(300).optional().nullable(),
  opening: z.boolean().default(false),
});

const recipeSchema = z.object({
  lines: z.array(z.object({
    stockItemId: z.number().int().positive(),
    quantity: quantitySchema,
    yieldPercent: z.number().int().min(1).max(100).default(100),
  })).max(12),
});

const convertSchema = z.object({
  items: z.array(z.object({
    menuItemId: z.number().int().positive(),
    category: z.enum(STOCK_CATEGORIES),
    baseUnit: z.enum(STOCK_BASE_UNITS),
    unitCost: z.number().finite().min(0).max(1_000_000_000).optional().nullable(),
  })).min(1).max(50),
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });

function shapeItem(item: any, locationById: Map<number, ScopedLocation>, showCost: boolean) {
  const balances = (item.balances ?? [])
    .filter((row: any) => locationById.has(row.locationId))
    .map((row: any) => ({
      outletId: locationById.get(row.locationId)!.outletId,
      locationId: row.locationId,
      quantity: roundQty(number(row.quantity)),
      parLevel: row.parLevel == null ? null : roundQty(number(row.parLevel)),
      reorderPoint: row.reorderPoint == null ? null : roundQty(number(row.reorderPoint)),
    }));
  const totalQuantity = roundQty(balances.reduce((sum: number, row: any) => sum + row.quantity, 0));
  const averageCost = roundCost(number(item.averageCost));
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    baseUnit: item.baseUnit,
    countStyle: item.countStyle,
    perishable: item.perishable,
    shelfLifeDays: item.shelfLifeDays,
    status: item.status,
    packUnits: (item.packUnits ?? []).map((pack: any) => ({ id: pack.id, name: pack.name, baseQuantity: roundQty(number(pack.baseQuantity)) })),
    menuItemCount: Number(item._count?.recipeLines ?? 0),
    balances,
    totalQuantity,
    averageCost: showCost ? averageCost : null,
    stockValue: showCost ? Math.round(Math.max(0, totalQuantity) * averageCost * 100) / 100 : null,
  };
}

/**
 * GET /property/:propertyId/overview
 * Every stock item with its balance at each outlet the caller may see, plus
 * the legacy per-menu-item counters still waiting to be converted.
 */
router.get("/property/:propertyId/overview", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  const propertyId = access.property.id;
  const settings = await loadStockSettings(db, propertyId);
  const locations = await scopedLocations(db, access, settings);
  const locationById = new Map<number, ScopedLocation>(locations.map((location) => [location.id, location]));
  const showCost = canSeeCost(access);
  const canManageCatalog = hasNrmsCapability(access.role, "stock.catalog.manage");

  const items = await db.nrmsStockItem.findMany({
    where: { propertyId },
    include: {
      packUnits: { orderBy: { baseQuantity: "asc" } },
      balances: { where: { locationId: { in: [...locationById.keys()] } } },
      _count: { select: { recipeLines: true } },
    },
    orderBy: [{ status: "asc" }, { category: "asc" }, { name: "asc" }],
  });

  // Tracked legacy counters (menu-item quantity, no recipe) are offered for
  // conversion to the owner and manager only; nobody else can act on them.
  const legacy = canManageCatalog
    ? await db.nrmsMenuItem.findMany({
        where: { outlet: { propertyId }, status: "ACTIVE", stockQuantity: { not: null }, recipeLines: { none: {} } },
        select: { id: true, name: true, category: true, stockQuantity: true, outletId: true, outlet: { select: { name: true, type: true } } },
        orderBy: [{ outletId: "asc" }, { name: "asc" }],
      })
    : [];

  res.json({
    currency: access.property.currency ?? "TZS",
    canManageCatalog,
    canReceive: hasNrmsCapability(access.role, "stock.receive"),
    canTransfer: hasNrmsCapability(access.role, "stock.transfer.send"),
    canWriteOff: hasNrmsCapability(access.role, "stock.writeoff.record"),
    canApprove: hasNrmsCapability(access.role, "stock.adjustment.approve"),
    canManageSuppliers: hasNrmsCapability(access.role, "stock.supplier.manage"),
    showCost,
    settings,
    locations,
    items: items.map((item: any) => shapeItem(item, locationById, showCost)),
    legacy: legacy.map((row: any) => ({ menuItemId: row.id, name: row.name, category: row.category, stockQuantity: row.stockQuantity, outletId: row.outletId, outletName: row.outlet.name, outletType: row.outlet.type })),
  });
}) as RequestHandler);

/** POST /property/:propertyId/items - add a stock item (owner/manager). */
router.post("/property/:propertyId/items", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.catalog.manage");
  if (!access) return;
  const parsed = itemCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the stock item details", details: parsed.error.flatten() });
  const input = parsed.data;
  const packNames = new Set(input.packUnits.map((pack) => pack.name.toLowerCase()));
  if (packNames.size !== input.packUnits.length) return res.status(400).json({ error: "Each pack needs a different name" });
  try {
    const item = await db.nrmsStockItem.create({
      data: {
        propertyId: access.property.id,
        name: sanitizeText(input.name),
        category: input.category,
        baseUnit: input.baseUnit,
        countStyle: input.countStyle,
        perishable: input.perishable,
        shelfLifeDays: input.shelfLifeDays ?? null,
        packUnits: { create: input.packUnits.map((pack) => ({ name: sanitizeText(pack.name), baseQuantity: roundQty(pack.baseQuantity) })) },
      },
      include: { packUnits: true },
    });
    res.status(201).json({ item: { id: item.id, name: item.name } });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "A stock item with this name already exists" });
    throw error;
  }
}) as RequestHandler);

/**
 * POST /property/:propertyId/items/bulk - add many goods at once (the starter
 * catalogue). Names that already exist are skipped, not errors, so the same
 * selection can be submitted twice without harm.
 */
router.post("/property/:propertyId/items/bulk", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.catalog.manage");
  if (!access) return;
  const parsed = z.object({ items: z.array(itemCreateSchema).min(1).max(400) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the selected goods", details: parsed.error.flatten() });
  const propertyId = access.property.id;
  const existing = new Set<string>((await db.nrmsStockItem.findMany({ where: { propertyId }, select: { name: true } })).map((row: any) => String(row.name).toLowerCase()));
  const created: number[] = [];
  const skipped: string[] = [];
  for (const input of parsed.data.items) {
    const name = sanitizeText(input.name);
    if (existing.has(name.toLowerCase())) { skipped.push(name); continue; }
    try {
      const item = await db.nrmsStockItem.create({
        data: {
          propertyId,
          name,
          category: input.category,
          baseUnit: input.baseUnit,
          countStyle: input.baseUnit === "G" || input.baseUnit === "ML" ? "PARTIAL" : input.countStyle,
          perishable: input.perishable,
          shelfLifeDays: input.shelfLifeDays ?? null,
          packUnits: { create: input.packUnits.map((pack) => ({ name: sanitizeText(pack.name), baseQuantity: roundQty(pack.baseQuantity) })) },
        },
      });
      existing.add(name.toLowerCase());
      created.push(item.id);
    } catch (error: any) {
      if (error?.code === "P2002") { skipped.push(name); continue; }
      throw error;
    }
  }
  res.status(201).json({ created, skipped });
}) as RequestHandler);

async function loadItemForAccess(req: AuthedRequest, res: Response, capability: "stock.catalog.manage" | "stock.read") {
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    res.status(400).json({ error: "Invalid stock item" });
    return null;
  }
  const item = await db.nrmsStockItem.findUnique({ where: { id: itemId } });
  if (!item) {
    res.status(404).json({ error: "Stock item not found" });
    return null;
  }
  const access = await requireNrmsPropertyCapability(req, res, item.propertyId, capability);
  if (!access) return null;
  return { item, access };
}

/**
 * PATCH /items/:itemId - rename, recategorise, retire. The unit and count
 * style are locked once anything has moved: history is in those units.
 */
router.patch("/items/:itemId", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadItemForAccess(req, res, "stock.catalog.manage");
  if (!loaded) return;
  const parsed = itemUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the stock item details", details: parsed.error.flatten() });
  const input = parsed.data;
  const unitChange = (input.baseUnit !== undefined && input.baseUnit !== loaded.item.baseUnit)
    || (input.countStyle !== undefined && input.countStyle !== loaded.item.countStyle);
  if (unitChange && (await db.nrmsStockMovement.count({ where: { stockItemId: loaded.item.id } })) > 0) {
    return res.status(409).json({ error: "This item already has stock history in its current unit. Create a new item instead of changing the unit." });
  }
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = sanitizeText(input.name);
  if (input.category !== undefined) data.category = input.category;
  if (input.baseUnit !== undefined) data.baseUnit = input.baseUnit;
  if (input.countStyle !== undefined) data.countStyle = input.countStyle;
  if (input.perishable !== undefined) data.perishable = input.perishable;
  if (input.shelfLifeDays !== undefined) data.shelfLifeDays = input.shelfLifeDays;
  if (input.status !== undefined) data.status = input.status;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });
  try {
    await db.nrmsStockItem.update({ where: { id: loaded.item.id }, data });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "A stock item with this name already exists" });
    throw error;
  }
  res.json({ ok: true });
}) as RequestHandler);

/** PUT /items/:itemId/packs - replace the purchase packs (crate, carton, sack). */
router.put("/items/:itemId/packs", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadItemForAccess(req, res, "stock.catalog.manage");
  if (!loaded) return;
  const parsed = z.object({ packUnits: z.array(packUnitSchema).max(8) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the pack details" });
  const names = new Set(parsed.data.packUnits.map((pack) => pack.name.toLowerCase()));
  if (names.size !== parsed.data.packUnits.length) return res.status(400).json({ error: "Each pack needs a different name" });
  // Packs are only an entry convenience: receipts store base units, so
  // replacing them never rewrites history.
  await db.$transaction([
    db.nrmsStockPackUnit.deleteMany({ where: { stockItemId: loaded.item.id } }),
    db.nrmsStockPackUnit.createMany({ data: parsed.data.packUnits.map((pack) => ({ stockItemId: loaded.item.id, name: sanitizeText(pack.name), baseQuantity: roundQty(pack.baseQuantity) })) }),
  ]);
  res.json({ ok: true });
}) as RequestHandler);

/** PATCH /items/:itemId/levels - par level and reorder point at one outlet. */
router.patch("/items/:itemId/levels", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadItemForAccess(req, res, "stock.catalog.manage");
  if (!loaded) return;
  const parsed = levelsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the stock levels" });
  const location = await locationInScope(db, loaded.access, parsed.data.locationId);
  if (!location) return res.status(404).json({ error: "Location not found" });
  const levels = {
    parLevel: parsed.data.parLevel == null ? null : roundQty(parsed.data.parLevel),
    reorderPoint: parsed.data.reorderPoint == null ? null : roundQty(parsed.data.reorderPoint),
  };
  // Levels are settings, not stock: the upsert never touches quantity.
  await db.nrmsStockBalance.upsert({
    where: { locationId_stockItemId: { locationId: location.id, stockItemId: loaded.item.id } },
    create: { locationId: location.id, stockItemId: loaded.item.id, quantity: 0, ...levels },
    update: levels,
  });
  res.json({ ok: true });
}) as RequestHandler);

/**
 * POST /property/:propertyId/receipts
 * Goods arriving at an outlet, or (owner/manager, once per item and outlet)
 * the opening balance counted at go-live. Supplier purchase orders and goods
 * received notes build on this in milestone 2.
 */
router.post("/property/:propertyId/receipts", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const parsed = receiptSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the received quantity and cost", details: parsed.error.flatten() });
  const input = parsed.data;
  // A plain receipt has no supplier and skips the delivery limit, so only
  // owner and manager may use it for corrections; everyone else records a
  // goods received note (nrms.stock.operations.ts).
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), input.opening ? "stock.catalog.manage" : "stock.adjustment.approve");
  if (!access) return;
  const propertyId = access.property.id;

  const location = await locationInScope(db, access, input.locationId);
  if (!location) return res.status(403).json({ error: "This location is outside your assignment" });
  const item = await db.nrmsStockItem.findFirst({ where: { id: input.stockItemId, propertyId, status: "ACTIVE" }, include: { packUnits: true } });
  if (!item) return res.status(404).json({ error: "Stock item not found" });

  let quantity: number;
  if (input.packUnitId != null) {
    const pack = item.packUnits.find((row: any) => row.id === input.packUnitId);
    if (!pack || input.packCount == null) return res.status(400).json({ error: "Choose a pack and how many arrived" });
    quantity = roundQty(number(pack.baseQuantity) * input.packCount);
  } else if (input.quantity != null) {
    quantity = roundQty(input.quantity);
  } else {
    return res.status(400).json({ error: "Enter how much arrived" });
  }
  if (quantity <= 0) return res.status(400).json({ error: "Enter how much arrived" });
  if (item.countStyle === "WHOLE" && !Number.isInteger(quantity)) {
    return res.status(400).json({ error: `${item.name} is counted in whole units. Enter a whole number.` });
  }

  let unitCost: number;
  if (input.totalCost != null) unitCost = roundCost(input.totalCost / quantity);
  else if (input.unitCost != null) unitCost = roundCost(input.unitCost);
  else if (input.opening) unitCost = roundCost(number(item.averageCost));
  else return res.status(400).json({ error: "Enter what was paid for this delivery" });
  // A free receipt would drag the average cost down and hide the real price.
  if (!input.opening && unitCost <= 0) return res.status(400).json({ error: "Enter what was paid for this delivery" });

  try {
    const movement = await db.$transaction(async (tx: any) => {
      return recordStockReceipt(tx, {
        propertyId,
        location: { id: location.id, outletId: location.outletId },
        stockItemId: item.id,
        quantity,
        unitCost,
        note: input.note ? sanitizeText(input.note) : null,
        actorId: req.user!.id,
        type: input.opening ? "OPENING_BALANCE" : "RECEIPT",
      });
    }, STOCK_TX_OPTIONS);
    res.status(201).json({ movementId: movement.id, quantity, unitCost });
  } catch (error) {
    if (error instanceof Error && error.message === NRMS_STOCK_OPENING_EXISTS) {
      return res.status(409).json({ error: "This item already has stock history at this outlet. Record a receipt instead of an opening balance." });
    }
    console.error("[nrms.stock] receipt failed", error);
    res.status(500).json({ error: "Unable to record the stock" });
  }
}) as RequestHandler);

/** POST /movements/:movementId/reverse - take back a mistaken receipt (owner/manager, reason required). */
router.post("/movements/:movementId/reverse", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const movementId = Number(req.params.movementId);
  if (!Number.isInteger(movementId) || movementId <= 0) return res.status(400).json({ error: "Invalid stock entry" });
  const parsed = reasonSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Give a reason for reversing this entry" });
  const seed = await db.nrmsStockMovement.findUnique({ where: { id: movementId }, select: { propertyId: true, sourceType: true } });
  if (!seed) return res.status(404).json({ error: "Stock entry not found" });
  if (seed.sourceType === "GOODS_RECEIPT") return res.status(409).json({ error: "This came from a goods received note. Void the whole receipt instead." });
  const access = await requireNrmsPropertyCapability(req, res, seed.propertyId, "stock.catalog.manage");
  if (!access) return;
  try {
    await db.$transaction((tx: any) => reverseStockReceipt(tx, { propertyId: access.property.id, movementId, reason: sanitizeText(parsed.data.reason), actorId: req.user!.id }), STOCK_TX_OPTIONS);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === NRMS_STOCK_ALREADY_REVERSED) return res.status(409).json({ error: "This entry has already been reversed" });
    if (code === NRMS_STOCK_NOT_REVERSIBLE) return res.status(409).json({ error: "Only receipts and opening balances can be reversed" });
    if (code === NRMS_STOCK_REVERSAL_SHORT) return res.status(409).json({ error: "Some of these goods have already been sold, so the full receipt cannot be taken back." });
    console.error("[nrms.stock] reversal failed", error);
    return res.status(500).json({ error: "Unable to reverse the entry" });
  }
  res.json({ ok: true });
}) as RequestHandler);

/** GET /property/:propertyId/movements - the stock ledger, newest first. */
router.get("/property/:propertyId/movements", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  const propertyId = access.property.id;
  const stockItemId = Number(req.query.stockItemId) || undefined;
  const locationFilter = Number(req.query.locationId) || undefined;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const beforeId = Number(req.query.before) || undefined;

  const locationIds = (await scopedLocations(db, access))
    .map((location) => location.id)
    .filter((id) => !locationFilter || id === locationFilter);
  if (locationIds.length === 0) return res.json({ movements: [], nextBefore: null });

  const rows = await db.nrmsStockMovement.findMany({
    where: { propertyId, locationId: { in: locationIds }, ...(stockItemId ? { stockItemId } : {}), ...(beforeId ? { id: { lt: beforeId } } : {}) },
    include: {
      stockItem: { select: { name: true, baseUnit: true } },
      location: { select: { name: true, outletId: true } },
      actor: { select: { name: true, fullName: true } },
    },
    orderBy: { id: "desc" },
    take: limit,
  });
  const reversedIds = new Set<number>((await db.nrmsStockMovement.findMany({
    where: { type: "RECEIPT_REVERSAL", sourceType: "STOCK_MOVEMENT", sourceId: { in: rows.map((row: any) => row.id) } },
    select: { sourceId: true },
  })).map((row: any) => row.sourceId));
  const showCost = canSeeCost(access);
  res.json({
    movements: rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      stockItemId: row.stockItemId,
      itemName: row.stockItem.name,
      baseUnit: row.stockItem.baseUnit,
      outletId: row.location.outletId,
      locationId: row.locationId,
      locationName: row.location.name,
      quantity: roundQty(number(row.quantity)),
      unitCost: showCost ? roundCost(number(row.unitCost)) : null,
      totalCost: showCost ? number(row.totalCost) : null,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      note: row.note,
      actorName: row.actor?.fullName || row.actor?.name || null,
      occurredAt: row.occurredAt,
      reversed: reversedIds.has(row.id),
    })),
    nextBefore: rows.length === limit ? rows[rows.length - 1].id : null,
  });
}) as RequestHandler);

/** GET /property/:propertyId/recipes - every active menu item with what it consumes. */
router.get("/property/:propertyId/recipes", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.catalog.manage");
  if (!access) return;
  const outlets = await db.nrmsOutlet.findMany({
    where: { propertyId: access.property.id, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      type: true,
      menuItems: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
          name: true,
          category: true,
          price: true,
          stockQuantity: true,
          recipeLines: { select: { stockItemId: true, quantity: true, yieldPercent: true, stockItem: { select: { name: true, baseUnit: true, averageCost: true } } }, orderBy: { id: "asc" } },
        },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      },
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  res.json({
    outlets: outlets.map((outlet: any) => ({
      id: outlet.id,
      name: outlet.name,
      type: outlet.type,
      menuItems: outlet.menuItems.map((item: any) => {
        const lines = item.recipeLines.map((line: any) => ({
          stockItemId: line.stockItemId,
          stockItemName: line.stockItem.name,
          baseUnit: line.stockItem.baseUnit,
          quantity: roundQty(number(line.quantity)),
          yieldPercent: line.yieldPercent,
          lineCost: Math.round(((number(line.quantity) * 100) / Math.max(1, line.yieldPercent)) * number(line.stockItem.averageCost) * 100) / 100,
        }));
        const cost = Math.round(lines.reduce((sum: number, line: any) => sum + line.lineCost, 0) * 100) / 100;
        const price = number(item.price);
        return {
          id: item.id,
          name: item.name,
          category: item.category,
          price,
          legacyTracked: item.stockQuantity != null && lines.length === 0,
          lines,
          cost,
          // Gross profit share at today's average cost. Null until the recipe costs something.
          marginPercent: cost > 0 && price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null,
        };
      }),
    })),
  });
}) as RequestHandler);

/**
 * PUT /menu-items/:menuItemId/recipe - what one unit of this menu item uses.
 * Linking a recipe retires the item's legacy quantity counter: from now on its
 * availability comes from the goods at its outlet. An empty list unlinks it.
 */
router.put("/menu-items/:menuItemId/recipe", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const menuItemId = Number(req.params.menuItemId);
  if (!Number.isInteger(menuItemId) || menuItemId <= 0) return res.status(400).json({ error: "Invalid menu item" });
  const menuItem = await db.nrmsMenuItem.findUnique({ where: { id: menuItemId }, include: { outlet: true } });
  if (!menuItem) return res.status(404).json({ error: "Menu item not found" });
  const access = await requireNrmsPropertyCapability(req, res, menuItem.outlet.propertyId, "stock.catalog.manage");
  if (!access) return;
  const parsed = recipeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the recipe quantities", details: parsed.error.flatten() });
  const lines = parsed.data.lines;
  const ids = lines.map((line) => line.stockItemId);
  if (new Set(ids).size !== ids.length) return res.status(400).json({ error: "Each stock item can appear once in a recipe" });
  const stockItems = ids.length
    ? await db.nrmsStockItem.findMany({ where: { id: { in: ids }, propertyId: access.property.id, status: "ACTIVE" }, select: { id: true, name: true, countStyle: true } })
    : [];
  if (stockItems.length !== ids.length) return res.status(400).json({ error: "One or more stock items are not available" });
  for (const line of lines) {
    const stockItem = stockItems.find((row: any) => row.id === line.stockItemId);
    if (stockItem?.countStyle === "WHOLE" && !Number.isInteger(roundQty(line.quantity))) {
      return res.status(400).json({ error: `${stockItem.name} is counted in whole units. Use a whole number, or set it to be counted in parts.` });
    }
  }
  const previous = await db.nrmsMenuRecipeLine.findMany({ where: { menuItemId }, select: { stockItemId: true } });

  await db.$transaction(async (tx: any) => {
    await tx.nrmsMenuRecipeLine.deleteMany({ where: { menuItemId } });
    if (lines.length > 0) {
      await tx.nrmsMenuRecipeLine.createMany({ data: lines.map((line) => ({ menuItemId, stockItemId: line.stockItemId, quantity: roundQty(line.quantity), yieldPercent: line.yieldPercent })) });
      await tx.nrmsMenuItem.update({ where: { id: menuItemId }, data: { stockQuantity: null } });
      const location = await ensureOutletStockLocation(tx, menuItem.outlet);
      await syncMenuAvailability(tx, { outletId: menuItem.outletId, locationId: location.id, stockItemIds: ids });
    } else if (previous.length > 0) {
      // Unlinked: nothing will switch it back on automatically any more.
      await tx.nrmsMenuItem.update({ where: { id: menuItemId }, data: { stockAutoOut: false } });
    }
  }, STOCK_TX_OPTIONS);
  res.json({ ok: true });
}) as RequestHandler);

/**
 * POST /property/:propertyId/convert-legacy
 * Move chosen menu-item counters onto stock items: one stock item per name
 * (a Kilimanjaro sold in the bar and the restaurant becomes one good), a
 * one-unit recipe, and the current count as that outlet's opening balance.
 * Nothing converts unless a manager picked it.
 */
router.post("/property/:propertyId/convert-legacy", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.catalog.manage");
  if (!access) return;
  const parsed = convertSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Choose the items to convert", details: parsed.error.flatten() });
  const propertyId = access.property.id;
  const converted: number[] = [];
  const skipped: Array<{ menuItemId: number; reason: string }> = [];

  for (const entry of parsed.data.items) {
    const menuItem = await db.nrmsMenuItem.findFirst({
      where: { id: entry.menuItemId, outlet: { propertyId }, status: "ACTIVE" },
      include: { outlet: true, _count: { select: { recipeLines: true } } },
    });
    if (!menuItem || menuItem.stockQuantity == null || menuItem._count.recipeLines > 0) {
      skipped.push({ menuItemId: entry.menuItemId, reason: "Not a counted menu item" });
      continue;
    }
    try {
      await db.$transaction(async (tx: any) => {
        const name = sanitizeText(menuItem.name);
        const stockItem = (await tx.nrmsStockItem.findUnique({ where: { propertyId_name: { propertyId, name } } }))
          ?? await tx.nrmsStockItem.create({ data: { propertyId, name, category: entry.category, baseUnit: entry.baseUnit, countStyle: "WHOLE" } });
        await tx.nrmsMenuRecipeLine.create({ data: { menuItemId: menuItem.id, stockItemId: stockItem.id, quantity: 1, yieldPercent: 100 } });
        const location = await ensureOutletStockLocation(tx, menuItem.outlet);
        const quantity = Math.max(0, Number(menuItem.stockQuantity));
        const prior = await tx.nrmsStockMovement.count({ where: { locationId: location.id, stockItemId: stockItem.id } });
        if (quantity > 0) {
          await recordStockReceipt(tx, {
            propertyId,
            location,
            stockItemId: stockItem.id,
            quantity,
            unitCost: roundCost(Number(entry.unitCost ?? 0)),
            note: `Converted from the menu counter of "${name}"`,
            actorId: req.user!.id,
            // A second menu item mapping to the same good at the same outlet
            // adds to it rather than claiming a second opening balance.
            type: prior > 0 ? "RECEIPT" : "OPENING_BALANCE",
          });
        }
        await tx.nrmsMenuItem.update({ where: { id: menuItem.id }, data: { stockQuantity: null } });
        await syncMenuAvailability(tx, { outletId: menuItem.outletId, locationId: location.id, stockItemIds: [stockItem.id] });
      }, STOCK_TX_OPTIONS);
      converted.push(menuItem.id);
    } catch (error) {
      console.error("[nrms.stock] legacy conversion failed", { menuItemId: menuItem.id, error });
      skipped.push({ menuItemId: menuItem.id, reason: "Could not convert" });
    }
  }
  res.json({ converted, skipped });
}) as RequestHandler);

export default router;
