// Stock insight (docs/NRMS_STOCK_AND_PURCHASING.md sections 7.5, 7.6 and
// milestone 6): profit per menu item, purchase price watch, supplier
// performance, wastage, dead stock, valuation, the owner digest, and breakfast
// consumption. Mounted at /api/nrms/stock beside the other stock routers.
//
// Reports are read-only and owner/manager only (stock.insights.read).
// Breakfast posting moves stock and follows the write-off rules.

import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { requireNrmsPropertyCapability } from "../lib/nrmsPropertyAccess.js";
import { hasNrmsCapability } from "../lib/nrmsAuthorization.js";
import { BREAKFAST_SOURCE, StockShortError, issueStock, roundCost, roundMoney, roundQty } from "../lib/nrmsInventory.js";
import { locationInScope, scopedLocations } from "../lib/nrmsStockScope.js";
import { breakfastSourceId, breakfastUsage, isDeadStock, menuItemProfit, priceMovement, recipeCost } from "../lib/nrmsStockInsights.js";
import { computeStockDigest } from "../lib/nrmsStockDigest.js";
import { buildBreakfastList } from "../lib/nrmsBreakfastList.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
const TX_OPTIONS = { maxWait: 5000, timeout: 20000 };
const REPORTS = "stock.insights.read";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOSED_ORDER_STATUSES = ["CANCELLED", "VOIDED"];

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A report window from ?from=&to= (YYYY-MM-DD, EAT days), default the last `days` days. */
function windowFrom(req: AuthedRequest, days: number): { start: Date; end: Date; from: string; to: string } {
  const eatToday = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const to = typeof req.query.to === "string" && DATE.test(req.query.to) ? req.query.to : eatToday;
  const fallbackFrom = new Date(new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const from = typeof req.query.from === "string" && DATE.test(req.query.from) && req.query.from <= to ? req.query.from : fallbackFrom;
  return { start: new Date(`${from}T00:00:00+03:00`), end: new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86_400_000), from, to };
}

async function userNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id): id is number => Number.isInteger(id)))];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, fullName: true, email: true } });
  return new Map(users.map((user: any) => [user.id, user.fullName || user.name || user.email || `User ${user.id}`]));
}

// ================================================================== menu profit

/**
 * GET /property/:propertyId/insights/menu-profit - what each recipe-linked
 * menu item costs to make at today's average cost, its margin at the menu
 * price, and what it sold in the window.
 */
router.get("/property/:propertyId/insights/menu-profit", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), REPORTS);
  if (!access) return;
  const propertyId = access.property.id;
  const window = windowFrom(req, 30);
  const targetMargin = Math.min(95, Math.max(0, Number(req.query.target) || 60));
  const [items, unlinked, sales] = await Promise.all([
    db.nrmsMenuItem.findMany({
      where: { outlet: { propertyId }, status: "ACTIVE", recipeLines: { some: {} } },
      select: { id: true, name: true, category: true, price: true, outlet: { select: { id: true, name: true, type: true } }, recipeLines: { select: { quantity: true, yieldPercent: true, stockItem: { select: { name: true, baseUnit: true, averageCost: true } } } } },
    }),
    db.nrmsMenuItem.count({ where: { outlet: { propertyId }, status: "ACTIVE", recipeLines: { none: {} } } }),
    db.nrmsOutletOrderItem.groupBy({
      by: ["menuItemId"],
      where: { menuItemId: { not: null }, order: { propertyId, status: { notIn: CLOSED_ORDER_STATUSES }, createdAt: { gte: window.start, lt: window.end } } },
      _sum: { quantity: true, lineTotal: true },
    }),
  ]);
  const sold = new Map<number, { units: number; revenue: number }>(sales.map((row: any) => [row.menuItemId, { units: number(row._sum?.quantity), revenue: number(row._sum?.lineTotal) }]));
  const rows = items.map((item: any) => {
    const cost = recipeCost(item.recipeLines.map((line: any) => ({ quantity: number(line.quantity), yieldPercent: line.yieldPercent, unitCost: number(line.stockItem.averageCost) })));
    const price = number(item.price);
    const profit = menuItemProfit({ price, cost, targetMargin });
    const sale = sold.get(item.id) ?? { units: 0, revenue: 0 };
    const uncosted = item.recipeLines.filter((line: any) => number(line.stockItem.averageCost) <= 0).map((line: any) => line.stockItem.name);
    return {
      menuItemId: item.id,
      name: item.name,
      category: item.category,
      outletId: item.outlet.id,
      outletName: item.outlet.name,
      price,
      ...profit,
      uncosted,
      unitsSold: sale.units,
      revenue: roundMoney(sale.revenue),
      costOfSales: roundMoney(sale.units * profit.cost),
      grossProfit: roundMoney(sale.revenue - sale.units * profit.cost),
      ingredients: item.recipeLines.map((line: any) => ({ name: line.stockItem.name, baseUnit: line.stockItem.baseUnit, quantity: number(line.quantity), yieldPercent: line.yieldPercent, unitCost: roundCost(number(line.stockItem.averageCost)) })),
    };
  });
  rows.sort((a: any, b: any) => Number(b.belowCost) - Number(a.belowCost) || (a.margin ?? 999) - (b.margin ?? 999));
  const outlets = new Map<number, { outletId: number; outletName: string; revenue: number; costOfSales: number; grossProfit: number }>();
  for (const row of rows) {
    const outlet = outlets.get(row.outletId) ?? { outletId: row.outletId, outletName: row.outletName, revenue: 0, costOfSales: 0, grossProfit: 0 };
    outlet.revenue = roundMoney(outlet.revenue + row.revenue);
    outlet.costOfSales = roundMoney(outlet.costOfSales + row.costOfSales);
    outlet.grossProfit = roundMoney(outlet.grossProfit + row.grossProfit);
    outlets.set(row.outletId, outlet);
  }
  res.json({
    currency: access.property.currency || "TZS",
    range: { from: window.from, to: window.to },
    targetMargin,
    unlinkedItems: unlinked,
    outlets: [...outlets.values()].map((row) => ({ ...row, margin: row.revenue > 0 ? Math.round((row.grossProfit / row.revenue) * 1000) / 10 : null })),
    items: rows,
  });
}) as RequestHandler);

// ================================================================== price watch

router.get("/property/:propertyId/insights/price-watch", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), REPORTS);
  if (!access) return;
  const propertyId = access.property.id;
  const window = windowFrom(req, 90);
  const lines = await db.nrmsGoodsReceiptLine.findMany({
    where: { quantity: { gt: 0 }, receipt: { propertyId, status: "POSTED", receivedAt: { gte: window.start, lt: window.end } } },
    select: { stockItemId: true, unitCost: true, priceFlag: true, stockItem: { select: { name: true, baseUnit: true, category: true } }, receipt: { select: { supplierId: true, receivedAt: true, supplier: { select: { name: true } } } } },
  });
  const groups = new Map<string, any>();
  for (const line of lines) {
    const key = `${line.receipt.supplierId ?? 0}:${line.stockItemId}`;
    const group = groups.get(key) ?? { supplierId: line.receipt.supplierId, supplierName: line.receipt.supplier?.name ?? null, stockItemId: line.stockItemId, name: line.stockItem.name, baseUnit: line.stockItem.baseUnit, category: line.stockItem.category, points: [] };
    group.points.push({ unitCost: number(line.unitCost), at: new Date(line.receipt.receivedAt), flag: line.priceFlag });
    groups.set(key, group);
  }
  const supplierIds = [...new Set([...groups.values()].map((group) => group.supplierId).filter(Boolean))];
  const agreed = supplierIds.length ? await db.nrmsSupplierPrice.findMany({ where: { supplierId: { in: supplierIds }, agreedUnitCost: { not: null } }, select: { supplierId: true, stockItemId: true, agreedUnitCost: true } }) : [];
  const agreedBy = new Map<string, number>(agreed.map((row: any) => [`${row.supplierId}:${row.stockItemId}`, number(row.agreedUnitCost)]));
  const rows = [...groups.values()].map((group) => {
    const movement = priceMovement(group.points)!;
    const agreedUnitCost = group.supplierId ? agreedBy.get(`${group.supplierId}:${group.stockItemId}`) ?? null : null;
    return {
      supplierId: group.supplierId,
      supplierName: group.supplierName,
      stockItemId: group.stockItemId,
      name: group.name,
      baseUnit: group.baseUnit,
      category: group.category,
      ...movement,
      agreedUnitCost,
      aboveAgreedPercent: agreedUnitCost && agreedUnitCost > 0 ? Math.round(((movement.latest - agreedUnitCost) / agreedUnitCost) * 1000) / 10 : null,
    };
  });
  rows.sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
  res.json({ currency: access.property.currency || "TZS", range: { from: window.from, to: window.to }, rows });
}) as RequestHandler);

// ============================================================= supplier performance

router.get("/property/:propertyId/insights/suppliers", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), REPORTS);
  if (!access) return;
  const propertyId = access.property.id;
  const window = windowFrom(req, 90);
  const [receipts, closedShort, billedMore] = await Promise.all([
    db.nrmsGoodsReceipt.findMany({
      where: { propertyId, status: "POSTED", supplierId: { not: null }, receivedAt: { gte: window.start, lt: window.end } },
      select: {
        supplierId: true, receivedAt: true, totalCost: true, rejectedValue: true, flaggedLines: true,
        supplier: { select: { name: true } },
        purchaseOrder: { select: { id: true, expectedDate: true, supplierDeliveryDate: true } },
        lines: { select: { quantity: true, claimedQuantity: true, unitCost: true, rejectedQuantity: true } },
      },
    }),
    db.nrmsPurchaseOrder.groupBy({ by: ["supplierId"], where: { propertyId, status: "CLOSED_SHORT", closedAt: { gte: window.start, lt: window.end } }, _count: { _all: true } }),
    db.nrmsSupplierInvoice.groupBy({ by: ["supplierId"], where: { propertyId, voidedAt: null, matchStatus: "BILLED_MORE", invoiceDate: { gte: window.start, lt: window.end } }, _count: { _all: true } }),
  ]);
  const closedBy = new Map<number, number>(closedShort.map((row: any) => [row.supplierId, Number(row._count?._all ?? 0)]));
  const billedBy = new Map<number, number>(billedMore.map((row: any) => [row.supplierId, Number(row._count?._all ?? 0)]));
  const bySupplier = new Map<number, any>();
  const seenOrders = new Set<number>();
  for (const receipt of receipts) {
    const row = bySupplier.get(receipt.supplierId) ?? { supplierId: receipt.supplierId, supplierName: receipt.supplier?.name ?? "", deliveries: 0, value: 0, rejectedValue: 0, flaggedLines: 0, shortOnScaleValue: 0, shortOnScaleLines: 0, onTime: 0, late: 0 };
    row.deliveries += 1;
    row.value = roundMoney(row.value + number(receipt.totalCost));
    row.rejectedValue = roundMoney(row.rejectedValue + number(receipt.rejectedValue));
    row.flaggedLines += receipt.flaggedLines;
    for (const line of receipt.lines) {
      const claimed = line.claimedQuantity == null ? null : number(line.claimedQuantity);
      if (claimed != null && claimed > number(line.quantity) + number(line.rejectedQuantity)) {
        row.shortOnScaleLines += 1;
        row.shortOnScaleValue = roundMoney(row.shortOnScaleValue + (claimed - number(line.quantity) - number(line.rejectedQuantity)) * number(line.unitCost));
      }
    }
    // Punctuality: the first delivery on an order against the date promised (the supplier's own, else the one asked for).
    const order = receipt.purchaseOrder;
    const promised = order?.supplierDeliveryDate ?? order?.expectedDate ?? null;
    if (order && promised && !seenOrders.has(order.id)) {
      seenOrders.add(order.id);
      const receivedDay = new Date(new Date(receipt.receivedAt).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
      if (receivedDay > new Date(promised).toISOString().slice(0, 10)) row.late += 1; else row.onTime += 1;
    }
    bySupplier.set(receipt.supplierId, row);
  }
  const rows = [...bySupplier.values()].map((row) => ({
    ...row,
    rejectedPercent: row.value + row.rejectedValue > 0 ? Math.round((row.rejectedValue / (row.value + row.rejectedValue)) * 1000) / 10 : 0,
    onTimePercent: row.onTime + row.late > 0 ? Math.round((row.onTime / (row.onTime + row.late)) * 100) : null,
    closedShort: closedBy.get(row.supplierId) ?? 0,
    invoicesBilledMore: billedBy.get(row.supplierId) ?? 0,
  }));
  rows.sort((a, b) => b.value - a.value);
  res.json({ currency: access.property.currency || "TZS", range: { from: window.from, to: window.to }, rows });
}) as RequestHandler);

// ====================================================================== wastage

router.get("/property/:propertyId/insights/wastage", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), REPORTS);
  if (!access) return;
  const window = windowFrom(req, 30);
  const rows = await db.nrmsStockWriteOff.findMany({
    where: { propertyId: access.property.id, status: "APPROVED", createdAt: { gte: window.start, lt: window.end } },
    select: { type: true, reasonCode: true, value: true, quantity: true, requestedById: true, stockItemId: true, stockItem: { select: { name: true, baseUnit: true } }, location: { select: { name: true } } },
  });
  const names = await userNames(rows.map((row: any) => row.requestedById));
  const group = (keyOf: (row: any) => string) => {
    const map = new Map<string, { key: string; value: number; count: number }>();
    for (const row of rows) {
      const key = keyOf(row);
      const current = map.get(key) ?? { key, value: 0, count: 0 };
      current.value = roundMoney(current.value + number(row.value));
      current.count += 1;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  };
  const items = new Map<number, { name: string; baseUnit: string; quantity: number; value: number; count: number }>();
  for (const row of rows) {
    const current = items.get(row.stockItemId) ?? { name: row.stockItem.name, baseUnit: row.stockItem.baseUnit, quantity: 0, value: 0, count: 0 };
    current.quantity = roundQty(current.quantity + number(row.quantity));
    current.value = roundMoney(current.value + number(row.value));
    current.count += 1;
    items.set(row.stockItemId, current);
  }
  res.json({
    currency: access.property.currency || "TZS",
    range: { from: window.from, to: window.to },
    total: roundMoney(rows.reduce((sum: number, row: any) => sum + number(row.value), 0)),
    byType: group((row) => row.type),
    byReason: group((row) => (row.type === "WASTAGE" ? row.reasonCode : row.type)),
    byLocation: group((row) => row.location?.name ?? "-"),
    byPerson: group((row) => (row.requestedById ? names.get(row.requestedById) ?? "Unknown" : "Unknown")),
    byItem: [...items.values()].sort((a, b) => b.value - a.value).slice(0, 25),
  });
}) as RequestHandler);

// =================================================================== dead stock

router.get("/property/:propertyId/insights/dead-stock", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), REPORTS);
  if (!access) return;
  const propertyId = access.property.id;
  const settingsRow = await db.nrmsStockSettings.findUnique({ where: { propertyId }, select: { deadStockDays: true } });
  const days = Math.min(365, Math.max(7, Number(req.query.days) || settingsRow?.deadStockDays || 30));
  const [balances, lastMoves] = await Promise.all([
    db.nrmsStockBalance.findMany({ where: { quantity: { gt: 0 }, stockItem: { propertyId, status: "ACTIVE" } }, select: { locationId: true, stockItemId: true, quantity: true, location: { select: { name: true } }, stockItem: { select: { name: true, category: true, baseUnit: true, averageCost: true, perishable: true } } } }),
    // A count is not movement: a counted bottle is still an unsold bottle.
    db.nrmsStockMovement.groupBy({ by: ["locationId", "stockItemId"], where: { propertyId, type: { not: "COUNT_ADJUSTMENT" } }, _max: { createdAt: true } }),
  ]);
  const lastBy = new Map<string, Date>(lastMoves.map((row: any) => [`${row.locationId}:${row.stockItemId}`, row._max?.createdAt ? new Date(row._max.createdAt) : null]));
  const now = new Date();
  const rows = balances
    .map((row: any) => {
      const lastMovedAt = lastBy.get(`${row.locationId}:${row.stockItemId}`) ?? null;
      return {
        locationId: row.locationId,
        locationName: row.location.name,
        stockItemId: row.stockItemId,
        name: row.stockItem.name,
        category: row.stockItem.category,
        baseUnit: row.stockItem.baseUnit,
        perishable: row.stockItem.perishable,
        quantity: roundQty(number(row.quantity)),
        value: roundMoney(number(row.quantity) * number(row.stockItem.averageCost)),
        lastMovedAt,
        idleDays: lastMovedAt ? Math.floor((now.getTime() - lastMovedAt.getTime()) / 86_400_000) : null,
        dead: isDeadStock({ quantity: number(row.quantity), lastMovedAt, days, now }),
      };
    })
    .filter((row: any) => row.dead)
    .sort((a: any, b: any) => b.value - a.value);
  res.json({ currency: access.property.currency || "TZS", days, total: roundMoney(rows.reduce((sum: number, row: any) => sum + row.value, 0)), rows });
}) as RequestHandler);

// ==================================================================== valuation

router.get("/property/:propertyId/insights/valuation", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), REPORTS);
  if (!access) return;
  const balances = await db.nrmsStockBalance.findMany({
    where: { quantity: { not: 0 }, stockItem: { propertyId: access.property.id, status: "ACTIVE" } },
    select: { quantity: true, location: { select: { id: true, name: true, kind: true } }, stockItem: { select: { category: true, averageCost: true } } },
  });
  const locations = new Map<number, { locationId: number; name: string; kind: string; value: number; goods: number }>();
  const categories = new Map<string, number>();
  let belowZero = 0;
  for (const row of balances) {
    const quantity = number(row.quantity);
    if (quantity < 0) { belowZero += 1; continue; }
    const value = quantity * number(row.stockItem.averageCost);
    const location = locations.get(row.location.id) ?? { locationId: row.location.id, name: row.location.name, kind: row.location.kind, value: 0, goods: 0 };
    location.value = roundMoney(location.value + value);
    location.goods += 1;
    locations.set(row.location.id, location);
    categories.set(row.stockItem.category, roundMoney((categories.get(row.stockItem.category) ?? 0) + value));
  }
  const byLocation = [...locations.values()].sort((a, b) => b.value - a.value);
  res.json({
    currency: access.property.currency || "TZS",
    asOf: new Date(),
    total: roundMoney(byLocation.reduce((sum, row) => sum + row.value, 0)),
    byLocation,
    byCategory: [...categories.entries()].map(([category, value]) => ({ category, value })).sort((a, b) => b.value - a.value),
    belowZero,
  });
}) as RequestHandler);

// ======================================================================= digest

router.get("/property/:propertyId/insights/digest", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), REPORTS);
  if (!access) return;
  const days = Math.min(31, Math.max(1, Number(req.query.days) || 7));
  const digest = await computeStockDigest(access.property.id, new Date(Date.now() - days * 86_400_000), access.property.currency || "TZS");
  const settings = await db.nrmsStockSettings.findUnique({ where: { propertyId: access.property.id }, select: { digestFrequency: true, digestLastSentAt: true } });
  res.json({ ...digest, days, frequency: settings?.digestFrequency ?? "OFF", lastSentAt: settings?.digestLastSentAt ?? null });
}) as RequestHandler);

// ===================================================================== settings

const insightSettingsSchema = z.object({
  digestFrequency: z.enum(["OFF", "DAILY", "WEEKLY"]).optional(),
  deadStockDays: z.number().int().min(7).max(365).optional(),
});

router.get("/property/:propertyId/insights/settings", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), REPORTS);
  if (!access) return;
  const row = await db.nrmsStockSettings.findUnique({ where: { propertyId: access.property.id }, select: { digestFrequency: true, digestLastSentAt: true, deadStockDays: true } });
  res.json({ digestFrequency: row?.digestFrequency ?? "OFF", digestLastSentAt: row?.digestLastSentAt ?? null, deadStockDays: row?.deadStockDays ?? 30, canEdit: access.role === "OWNER" });
}) as RequestHandler);

/** PUT /property/:propertyId/insights/settings - owner only, like every other stock setting. */
router.put("/property/:propertyId/insights/settings", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), REPORTS);
  if (!access) return;
  if (access.role !== "OWNER") return res.status(403).json({ error: "Only the owner can change the digest" });
  const parsed = insightSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the settings" });
  const data = { ...(parsed.data.digestFrequency ? { digestFrequency: parsed.data.digestFrequency } : {}), ...(parsed.data.deadStockDays ? { deadStockDays: parsed.data.deadStockDays } : {}) };
  await db.nrmsStockSettings.upsert({ where: { propertyId: access.property.id }, create: { propertyId: access.property.id, ...data }, update: data });
  res.json({ ok: true });
}) as RequestHandler);

// ==================================================================== breakfast

type RecipeLine = { stockItemId: number; quantity: number };

function readRecipe(value: unknown): RecipeLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row: any) => ({ stockItemId: Number(row?.stockItemId), quantity: Number(row?.quantity) }))
    .filter((row) => Number.isInteger(row.stockItemId) && row.stockItemId > 0 && Number.isFinite(row.quantity) && row.quantity > 0);
}

/**
 * GET /property/:propertyId/breakfast?date= - the per-cover recipe, the covers
 * on the breakfast list for that morning, what that uses, and whether the
 * morning is already posted.
 */
router.get("/property/:propertyId/breakfast", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.read");
  if (!access) return;
  const propertyId = access.property.id;
  const date = typeof req.query.date === "string" && DATE.test(req.query.date) ? req.query.date : new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const settings = await db.nrmsStockSettings.findUnique({ where: { propertyId }, select: { breakfastRecipe: true, breakfastLocationId: true } });
  const recipe = readRecipe(settings?.breakfastRecipe);
  const goods = recipe.length ? await db.nrmsStockItem.findMany({ where: { id: { in: recipe.map((row) => row.stockItemId) }, propertyId }, select: { id: true, name: true, baseUnit: true, countStyle: true, averageCost: true, status: true } }) : [];
  const goodById = new Map<number, any>(goods.map((good: any) => [good.id, good]));
  let covers = 0;
  try {
    const list = await buildBreakfastList({ propertyId, propertyTitle: access.property.title, serviceDate: date, entitledOnly: true });
    covers = list.totals.entitledCovers;
  } catch { covers = 0; }
  const posted = await db.nrmsStockMovement.findMany({ where: { propertyId, sourceType: BREAKFAST_SOURCE, sourceId: breakfastSourceId(date) }, select: { stockItemId: true, quantity: true, totalCost: true, createdAt: true, actorId: true } });
  const names = await userNames(posted.map((row: any) => row.actorId));
  const usage = breakfastUsage(covers, recipe.filter((row) => goodById.get(row.stockItemId)?.status === "ACTIVE"), (id) => goodById.get(id)?.countStyle ?? "WHOLE");
  const locations = await scopedLocations(db, access);
  res.json({
    date,
    covers,
    locationId: settings?.breakfastLocationId ?? null,
    locations: locations.map((row) => ({ id: row.id, name: row.name })),
    recipe: recipe.map((row) => ({ ...row, name: goodById.get(row.stockItemId)?.name ?? "Removed good", baseUnit: goodById.get(row.stockItemId)?.baseUnit ?? "PIECE" })),
    usage: usage.map((row) => ({ ...row, name: goodById.get(row.stockItemId)?.name ?? "", baseUnit: goodById.get(row.stockItemId)?.baseUnit ?? "PIECE", cost: roundMoney(row.quantity * number(goodById.get(row.stockItemId)?.averageCost)) })),
    posted: posted.length ? { at: posted[0].createdAt, by: posted[0].actorId ? names.get(posted[0].actorId) ?? null : null, cost: roundMoney(-posted.reduce((sum: number, row: any) => sum + number(row.totalCost), 0)), lines: posted.length } : null,
    canEditRecipe: hasNrmsCapability(access.role, "stock.catalog.manage"),
    canPost: hasNrmsCapability(access.role, "stock.writeoff.record"),
  });
}) as RequestHandler);

const recipeSchema = z.object({
  locationId: z.number().int().positive().nullable(),
  lines: z.array(z.object({ stockItemId: z.number().int().positive(), quantity: z.number().finite().positive().max(100_000) })).max(40),
});

/** PUT /property/:propertyId/breakfast/recipe - what one cover uses; owner or manager (like any recipe). */
router.put("/property/:propertyId/breakfast/recipe", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.catalog.manage");
  if (!access) return;
  const parsed = recipeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the breakfast recipe" });
  const propertyId = access.property.id;
  const ids = [...new Set(parsed.data.lines.map((row) => row.stockItemId))];
  if (ids.length !== parsed.data.lines.length) return res.status(400).json({ error: "A good is on the recipe twice" });
  const found = ids.length ? await db.nrmsStockItem.count({ where: { id: { in: ids }, propertyId, status: "ACTIVE" } }) : 0;
  if (found !== ids.length) return res.status(404).json({ error: "A good on the recipe was not found" });
  if (parsed.data.locationId && !(await locationInScope(db, access, parsed.data.locationId))) return res.status(404).json({ error: "Location not found" });
  const data = { breakfastRecipe: parsed.data.lines.map((row) => ({ stockItemId: row.stockItemId, quantity: roundQty(row.quantity) })), breakfastLocationId: parsed.data.locationId };
  await db.nrmsStockSettings.upsert({ where: { propertyId }, create: { propertyId, ...data }, update: data });
  res.json({ ok: true });
}) as RequestHandler);

const postSchema = z.object({
  date: z.string().regex(DATE),
  /** The covers actually served; defaults to the breakfast list. */
  covers: z.number().int().min(1).max(10_000),
  locationId: z.number().int().positive(),
});

/**
 * POST /property/:propertyId/breakfast/post - take one morning's breakfast out
 * of the shelf: covers times the per-cover recipe, at average cost, once per
 * morning. Posts to cost of sales at Night Audit like any sale.
 */
router.post("/property/:propertyId/breakfast/post", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.writeoff.record");
  if (!access) return;
  const parsed = postSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Enter the morning and the covers served" });
  const input = parsed.data;
  const propertyId = access.property.id;
  const location = await locationInScope(db, access, input.locationId);
  if (!location) return res.status(403).json({ error: "This location is outside your assignment" });
  const settings = await db.nrmsStockSettings.findUnique({ where: { propertyId }, select: { breakfastRecipe: true } });
  const recipe = readRecipe(settings?.breakfastRecipe);
  if (recipe.length === 0) return res.status(400).json({ error: "Set up what one breakfast cover uses first" });
  const goods = await db.nrmsStockItem.findMany({ where: { id: { in: recipe.map((row) => row.stockItemId) }, propertyId, status: "ACTIVE" }, select: { id: true, countStyle: true } });
  const styleOf = new Map<number, string>(goods.map((good: any) => [good.id, good.countStyle]));
  const usage = breakfastUsage(input.covers, recipe.filter((row) => styleOf.has(row.stockItemId)), (id) => styleOf.get(id) ?? "WHOLE");
  const sourceId = breakfastSourceId(input.date);
  const note = `Breakfast ${input.date}, ${input.covers} ${input.covers === 1 ? "cover" : "covers"}`;
  try {
    await db.$transaction(async (tx: any) => {
      // One posting per morning: the settings row is the lock two phones queue on.
      await tx.$queryRaw`SELECT id FROM nrms_stock_settings WHERE propertyId = ${propertyId} FOR UPDATE`;
      const already = await tx.nrmsStockMovement.count({ where: { propertyId, sourceType: BREAKFAST_SOURCE, sourceId } });
      if (already > 0) throw new Error("NRMS_BREAKFAST_ALREADY_POSTED");
      for (const row of usage) {
        await issueStock(tx, { propertyId, locationId: location.id, stockItemId: row.stockItemId, quantity: row.quantity, type: "BREAKFAST_SERVICE", sourceType: BREAKFAST_SOURCE, sourceId, note, actorId: req.user!.id });
      }
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_BREAKFAST_ALREADY_POSTED") return res.status(409).json({ error: "This morning's breakfast is already posted. Correct any difference with a count." });
    if (error instanceof StockShortError) return res.status(409).json({ error: `${location.name} does not have enough ${error.itemName} on the books. Receive or transfer it first, or count the shelf.` });
    console.error("[nrms.stock.insights] breakfast post failed", error);
    return res.status(500).json({ error: "Unable to post breakfast" });
  }
  res.status(201).json({ ok: true, lines: usage.length });
}) as RequestHandler);

export default router;
