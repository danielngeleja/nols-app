// Goods-level stock control (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 1).
//
// nrmsStock.ts counts menu items; this module counts the physical goods behind
// them. A menu item with recipe lines consumes stock items at its outlet's
// location when it is ordered, and gives them back when the order is cancelled.
// Every balance change is paired with an append-only NrmsStockMovement row in
// the same transaction, so a balance can always be explained line by line and
// nobody can "just fix the number".
//
// Two count styles decide how strict a sale is:
//   WHOLE   (beer, cans, pieces) a sale can never take the book below zero,
//           same guarantee the legacy counter gives today.
//   PARTIAL (spirits by the tot, meat and fish by weight) a sale may take the
//           book below zero. Refusing a guest's gin because the opening count
//           was 20 ml off would stop service over a rounding error; the
//           negative balance is shown on the stock page and the next count
//           corrects it.

import { StockError } from "./nrmsStock.js";

export const STOCK_CATEGORIES = [
  "BEER",
  "SPIRITS",
  "WINE",
  "SOFT_DRINKS",
  "WATER",
  "MEAT",
  "FISH_SEAFOOD",
  "POULTRY",
  "PRODUCE",
  "DAIRY_EGGS",
  "DRY_GOODS",
  "OTHER",
] as const;
export type StockCategory = (typeof STOCK_CATEGORIES)[number];

export const STOCK_BASE_UNITS = ["BOTTLE", "CAN", "PIECE", "ML", "G"] as const;
export type StockBaseUnit = (typeof STOCK_BASE_UNITS)[number];

export const STOCK_COUNT_STYLES = ["WHOLE", "PARTIAL"] as const;
export type StockCountStyle = (typeof STOCK_COUNT_STYLES)[number];

/** Every movement type the ledger accepts. */
export const STOCK_MOVEMENT_TYPES = [
  "OPENING_BALANCE", "RECEIPT", "RECEIPT_REVERSAL", "SALE", "SALE_REVERSAL",
  "TRANSFER_OUT", "TRANSFER_IN", "TRANSFER_RETURN",
  "WASTAGE", "STAFF_MEAL", "COMPLIMENTARY",
  "COUNT_ADJUSTMENT",
  "BREAKFAST_SERVICE",
] as const;

export const WRITE_OFF_TYPES = ["WASTAGE", "STAFF_MEAL", "COMPLIMENTARY"] as const;
export type WriteOffType = (typeof WRITE_OFF_TYPES)[number];
export const WASTAGE_REASONS = ["BROKEN", "SPOILED", "EXPIRED", "SPILLED", "GUEST_RETURN", "OTHER"] as const;
export const REJECT_REASONS = ["DAMAGED", "SPOILED", "WRONG_ITEM", "SHORT_DATED", "OTHER"] as const;
export const GOODS_RECEIPT_SOURCE = "GOODS_RECEIPT";
export const TRANSFER_SOURCE = "STOCK_TRANSFER";
export const WRITE_OFF_SOURCE = "STOCK_WRITE_OFF";
export const COUNT_SOURCE = "STOCK_COUNT";
/** Breakfast served without per-guest orders (sourceId = service date as 20260925). */
export const BREAKFAST_SOURCE = "BREAKFAST_SERVICE";
export const NRMS_STOCK_SHORT = "NRMS_STOCK_SHORT";

/**
 * Compare a price paid with what was expected. The agreed price wins when one
 * exists (it is the owner's own number); otherwise the last price paid.
 */
export function priceFlagFor(input: { unitCost: number; lastUnitCost: number | null; agreedUnitCost: number | null; alertPercent: number }): { flag: "NONE" | "ABOVE_LAST" | "ABOVE_AGREED"; compared: number | null } {
  const factor = 1 + Math.max(0, input.alertPercent) / 100;
  if (input.agreedUnitCost != null && input.agreedUnitCost > 0) {
    return { flag: input.unitCost > input.agreedUnitCost * factor ? "ABOVE_AGREED" : "NONE", compared: input.agreedUnitCost };
  }
  if (input.lastUnitCost != null && input.lastUnitCost > 0) {
    return { flag: input.unitCost > input.lastUnitCost * factor ? "ABOVE_LAST" : "NONE", compared: input.lastUnitCost };
  }
  return { flag: "NONE", compared: null };
}
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const ORDER_SOURCE = "OUTLET_ORDER";
export const MOVEMENT_SOURCE = "STOCK_MOVEMENT";

export const NRMS_STOCK_OPENING_EXISTS = "NRMS_STOCK_OPENING_EXISTS";
export const NRMS_STOCK_ALREADY_REVERSED = "NRMS_STOCK_ALREADY_REVERSED";
export const NRMS_STOCK_REVERSAL_SHORT = "NRMS_STOCK_REVERSAL_SHORT";
export const NRMS_STOCK_NOT_REVERSIBLE = "NRMS_STOCK_NOT_REVERSIBLE";

export function roundQty(value: number): number {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

export function roundCost(value: number): number {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Base units taken from stock for one menu item sold, grossed up for trimming/cooking loss. */
export function perUnitConsumption(line: { quantity: number; yieldPercent: number }): number {
  const yieldPercent = Math.min(100, Math.max(1, Math.round(Number(line.yieldPercent) || 100)));
  return roundQty((Number(line.quantity) * 100) / yieldPercent);
}

/** Total base units per stock item consumed by a set of order lines. */
export function recipeConsumption(
  orderLines: Array<{ menuItemId: number | null; quantity: number }>,
  recipeLines: Array<{ menuItemId: number; stockItemId: number; quantity: number; yieldPercent: number }>,
): Map<number, number> {
  const byMenuItem = new Map<number, typeof recipeLines>();
  for (const line of recipeLines) {
    const list = byMenuItem.get(line.menuItemId) ?? [];
    list.push(line);
    byMenuItem.set(line.menuItemId, list);
  }
  const need = new Map<number, number>();
  for (const orderLine of orderLines) {
    if (orderLine.menuItemId == null || orderLine.quantity <= 0) continue;
    for (const recipe of byMenuItem.get(orderLine.menuItemId) ?? []) {
      const amount = perUnitConsumption(recipe) * orderLine.quantity;
      need.set(recipe.stockItemId, roundQty((need.get(recipe.stockItemId) ?? 0) + amount));
    }
  }
  return need;
}

/**
 * Weighted average cost after a receipt. Stock at or below zero, or stock
 * carried with no known cost (an opening balance entered without a price),
 * has nothing to average against, so the received price becomes the average.
 */
export function nextAverageCost(input: { onHand: number; currentAverage: number; receivedQty: number; receivedUnitCost: number }): number {
  const { onHand, currentAverage, receivedQty, receivedUnitCost } = input;
  if (receivedQty <= 0) return roundCost(currentAverage);
  if (receivedUnitCost <= 0) return roundCost(currentAverage);
  if (onHand <= 0 || currentAverage <= 0) return roundCost(receivedUnitCost);
  return roundCost((onHand * currentAverage + receivedQty * receivedUnitCost) / (onHand + receivedQty));
}

/** Average cost after a receipt is taken back out. Never negative. */
export function averageCostAfterReversal(input: { onHand: number; currentAverage: number; reversedQty: number; reversedUnitCost: number }): number {
  const remaining = input.onHand - input.reversedQty;
  if (remaining <= 0) return roundCost(input.currentAverage);
  const value = input.onHand * input.currentAverage - input.reversedQty * input.reversedUnitCost;
  return roundCost(Math.max(0, value / remaining));
}

/**
 * Whether one unit of a menu item can be made from the location's balances.
 * Only WHOLE ingredients gate availability (see the header for why PARTIAL
 * ones never do). A recipe with no WHOLE ingredient is always sellable.
 */
export function menuItemCoverable(
  recipe: Array<{ stockItemId: number; perUnit: number; countStyle: string }>,
  balances: Map<number, number>,
): boolean {
  return recipe.every((line) => line.countStyle !== "WHOLE" || (balances.get(line.stockItemId) ?? 0) >= line.perUnit);
}

type Tx = any;

/** The stock location for an outlet, created on first use. */
export async function ensureOutletStockLocation(tx: Tx, outlet: { id: number; propertyId: number; name: string }) {
  const existing = await tx.nrmsStockLocation.findUnique({ where: { outletId: outlet.id } });
  if (existing) return existing;
  try {
    return await tx.nrmsStockLocation.create({ data: { propertyId: outlet.propertyId, kind: "OUTLET", outletId: outlet.id, name: outlet.name } });
  } catch (error: any) {
    // Two first sales at a new outlet raced to create it; the loser reads the winner's row.
    if (error?.code === "P2002") return tx.nrmsStockLocation.findUnique({ where: { outletId: outlet.id } });
    throw error;
  }
}

/**
 * Move a balance. With `guard`, a decrease that would go below zero changes
 * nothing and returns false; the conditional update makes concurrent sales
 * race safely, exactly like reserveMenuStock's gte guard.
 */
async function applyBalanceDelta(tx: Tx, input: { locationId: number; stockItemId: number; delta: number; guard: boolean }): Promise<boolean> {
  const balance = await tx.nrmsStockBalance.upsert({
    where: { locationId_stockItemId: { locationId: input.locationId, stockItemId: input.stockItemId } },
    create: { locationId: input.locationId, stockItemId: input.stockItemId, quantity: 0 },
    update: {},
    select: { id: true },
  });
  const delta = roundQty(input.delta);
  if (delta === 0) return true;
  if (input.guard && delta < 0) {
    const updated = await tx.nrmsStockBalance.updateMany({
      where: { id: balance.id, quantity: { gte: -delta } },
      data: { quantity: { increment: delta } },
    });
    return updated.count === 1;
  }
  await tx.nrmsStockBalance.update({ where: { id: balance.id }, data: { quantity: { increment: delta } } });
  return true;
}

/** Row lock on the item so two receipts cannot interleave their average-cost maths. */
async function lockStockItem(tx: Tx, stockItemId: number) {
  await tx.$queryRaw`SELECT id FROM nrms_stock_item WHERE id = ${stockItemId} FOR UPDATE`;
  return tx.nrmsStockItem.findUnique({ where: { id: stockItemId } });
}

async function propertyOnHand(tx: Tx, stockItemId: number): Promise<number> {
  const sum = await tx.nrmsStockBalance.aggregate({ where: { stockItemId }, _sum: { quantity: true } });
  return roundQty(Number(sum?._sum?.quantity ?? 0));
}

async function writeMovement(tx: Tx, data: {
  propertyId: number;
  locationId: number;
  stockItemId: number;
  type: StockMovementType;
  quantity: number;
  unitCost: number;
  sourceType?: string | null;
  sourceId?: number | null;
  note?: string | null;
  actorId?: number | null;
}) {
  const quantity = roundQty(data.quantity);
  const unitCost = roundCost(data.unitCost);
  return tx.nrmsStockMovement.create({
    data: {
      propertyId: data.propertyId,
      locationId: data.locationId,
      stockItemId: data.stockItemId,
      type: data.type,
      quantity,
      unitCost,
      totalCost: roundMoney(quantity * unitCost),
      sourceType: data.sourceType ?? null,
      sourceId: data.sourceId ?? null,
      note: data.note ?? null,
      actorId: data.actorId ?? null,
    },
  });
}

/**
 * Re-derive availability for the outlet's recipe items that use any of the
 * given stock items. The system only switches back on what it switched off
 * itself (stockAutoOut); a manager's manual "86" is never overridden.
 */
export async function syncMenuAvailability(tx: Tx, input: { outletId: number; locationId: number; stockItemIds: number[] }) {
  if (input.stockItemIds.length === 0) return;
  const menuItems = await tx.nrmsMenuItem.findMany({
    where: { outletId: input.outletId, status: "ACTIVE", recipeLines: { some: { stockItemId: { in: input.stockItemIds } } } },
    select: {
      id: true,
      inStock: true,
      stockAutoOut: true,
      recipeLines: { select: { stockItemId: true, quantity: true, yieldPercent: true, stockItem: { select: { countStyle: true } } } },
    },
  });
  if (menuItems.length === 0) return;
  const involved = [...new Set(menuItems.flatMap((item: any) => item.recipeLines.map((line: any) => line.stockItemId)))];
  const balances = await tx.nrmsStockBalance.findMany({ where: { locationId: input.locationId, stockItemId: { in: involved } }, select: { stockItemId: true, quantity: true } });
  const balanceMap = new Map<number, number>(balances.map((row: any) => [row.stockItemId, Number(row.quantity)]));
  for (const item of menuItems) {
    const recipe = item.recipeLines.map((line: any) => ({
      stockItemId: line.stockItemId,
      perUnit: perUnitConsumption({ quantity: Number(line.quantity), yieldPercent: line.yieldPercent }),
      countStyle: line.stockItem.countStyle,
    }));
    const coverable = menuItemCoverable(recipe, balanceMap);
    if (!coverable && item.inStock) {
      await tx.nrmsMenuItem.update({ where: { id: item.id }, data: { inStock: false, stockAutoOut: true } });
    } else if (coverable && !item.inStock && item.stockAutoOut) {
      await tx.nrmsMenuItem.update({ where: { id: item.id }, data: { inStock: true, stockAutoOut: false } });
    }
  }
}

/**
 * Availability rules for a menu item that draws from stock items. Returns null
 * for an unlinked item (the legacy deriveStockPatch applies). A linked item has
 * no quantity of its own, and cannot be switched on while a WHOLE ingredient
 * is short. Any manual switch clears stockAutoOut: it is now a person's call.
 */
export async function linkedAvailabilityPatch(
  tx: Tx,
  item: { id: number; outletId: number },
  input: { inStock?: boolean; stockQuantity?: number | null },
): Promise<{ data: { inStock?: boolean; stockAutoOut?: boolean }; error?: string } | null> {
  const recipe = await tx.nrmsMenuRecipeLine.findMany({
    where: { menuItemId: item.id },
    select: { stockItemId: true, quantity: true, yieldPercent: true, stockItem: { select: { countStyle: true } } },
  });
  if (recipe.length === 0) return null;
  if (input.stockQuantity !== undefined && input.stockQuantity !== null) {
    return { data: {}, error: "This item draws from stock items. Record received stock on the Stock page instead of typing a quantity here." };
  }
  if (input.inStock === undefined) return { data: {} };
  if (input.inStock) {
    const location = await tx.nrmsStockLocation.findUnique({ where: { outletId: item.outletId }, select: { id: true } });
    const balances = location
      ? await tx.nrmsStockBalance.findMany({ where: { locationId: location.id, stockItemId: { in: recipe.map((line: any) => line.stockItemId) } }, select: { stockItemId: true, quantity: true } })
      : [];
    const coverable = menuItemCoverable(
      recipe.map((line: any) => ({ stockItemId: line.stockItemId, perUnit: perUnitConsumption({ quantity: Number(line.quantity), yieldPercent: line.yieldPercent }), countStyle: line.stockItem.countStyle })),
      new Map<number, number>(balances.map((row: any) => [row.stockItemId, Number(row.quantity)])),
    );
    if (!coverable) return { data: {}, error: "An ingredient of this item is out of stock. Record the received stock first." };
  }
  return { data: { inStock: input.inStock, stockAutoOut: false } };
}

/**
 * Take an order's recipe ingredients out of its outlet's location. Call inside
 * the order-creation transaction after the order row exists. Menu items with
 * no recipe are ignored here (the legacy counter handles them).
 */
export async function consumeOrderStock(tx: Tx, input: {
  propertyId: number;
  outlet: { id: number; propertyId: number; name: string };
  orderId: number;
  items: Array<{ menuItemId: number | null; quantity: number; nameSnapshot?: string }>;
  actorId?: number | null;
}) {
  const menuItemIds = [...new Set(input.items.map((line) => line.menuItemId).filter((id): id is number => id != null))];
  if (menuItemIds.length === 0) return;
  const recipeLines = await tx.nrmsMenuRecipeLine.findMany({
    where: { menuItemId: { in: menuItemIds } },
    select: { menuItemId: true, stockItemId: true, quantity: true, yieldPercent: true, stockItem: { select: { id: true, countStyle: true, averageCost: true } } },
  });
  if (recipeLines.length === 0) return;
  const need = recipeConsumption(
    input.items,
    recipeLines.map((line: any) => ({ menuItemId: line.menuItemId, stockItemId: line.stockItemId, quantity: Number(line.quantity), yieldPercent: line.yieldPercent })),
  );
  const stockById = new Map<number, any>(recipeLines.map((line: any) => [line.stockItemId, line.stockItem]));
  // The guest-facing error names the dish, not the ingredient.
  const menuNameByStock = new Map<number, string>();
  for (const line of recipeLines) {
    if (menuNameByStock.has(line.stockItemId)) continue;
    const orderLine = input.items.find((item) => item.menuItemId === line.menuItemId);
    menuNameByStock.set(line.stockItemId, orderLine?.nameSnapshot ?? "An item");
  }
  const location = await ensureOutletStockLocation(tx, input.outlet);
  // Fixed order keeps two concurrent orders from locking balances in opposite orders.
  for (const stockItemId of [...need.keys()].sort((a, b) => a - b)) {
    const quantity = need.get(stockItemId)!;
    if (quantity <= 0) continue;
    const stockItem = stockById.get(stockItemId);
    const ok = await applyBalanceDelta(tx, { locationId: location.id, stockItemId, delta: -quantity, guard: stockItem.countStyle === "WHOLE" });
    if (!ok) throw new StockError(menuNameByStock.get(stockItemId) ?? "An item");
    await writeMovement(tx, {
      propertyId: input.propertyId,
      locationId: location.id,
      stockItemId,
      type: "SALE",
      quantity: -quantity,
      unitCost: Number(stockItem.averageCost),
      sourceType: ORDER_SOURCE,
      sourceId: input.orderId,
      actorId: input.actorId ?? null,
    });
  }
  await syncMenuAvailability(tx, { outletId: input.outlet.id, locationId: location.id, stockItemIds: [...need.keys()] });
}

/**
 * Give a cancelled order's ingredients back, mirroring its SALE rows at the
 * cost they left at. Idempotent: an order already reversed is left alone.
 */
export async function reverseOrderStock(tx: Tx, input: { orderId: number; actorId?: number | null; note?: string | null }) {
  const sales = await tx.nrmsStockMovement.findMany({ where: { sourceType: ORDER_SOURCE, sourceId: input.orderId, type: "SALE" }, orderBy: { id: "asc" } });
  if (sales.length === 0) return;
  const alreadyReversed = await tx.nrmsStockMovement.count({ where: { sourceType: ORDER_SOURCE, sourceId: input.orderId, type: "SALE_REVERSAL" } });
  if (alreadyReversed > 0) return;
  const touched = new Map<number, Set<number>>();
  for (const sale of sales) {
    const quantity = -Number(sale.quantity);
    await applyBalanceDelta(tx, { locationId: sale.locationId, stockItemId: sale.stockItemId, delta: quantity, guard: false });
    await writeMovement(tx, {
      propertyId: sale.propertyId,
      locationId: sale.locationId,
      stockItemId: sale.stockItemId,
      type: "SALE_REVERSAL",
      quantity,
      unitCost: Number(sale.unitCost),
      sourceType: ORDER_SOURCE,
      sourceId: input.orderId,
      note: input.note ?? null,
      actorId: input.actorId ?? null,
    });
    const set = touched.get(sale.locationId) ?? new Set<number>();
    set.add(sale.stockItemId);
    touched.set(sale.locationId, set);
  }
  for (const [locationId, stockItemIds] of touched) {
    const location = await tx.nrmsStockLocation.findUnique({ where: { id: locationId }, select: { outletId: true } });
    if (location?.outletId) await syncMenuAvailability(tx, { outletId: location.outletId, locationId, stockItemIds: [...stockItemIds] });
  }
}

/** Goods arriving at a location. Updates the weighted average cost. */
export async function recordStockReceipt(tx: Tx, input: {
  propertyId: number;
  location: { id: number; outletId: number | null };
  stockItemId: number;
  quantity: number;
  unitCost: number;
  note?: string | null;
  actorId: number;
  type?: "RECEIPT" | "OPENING_BALANCE";
  sourceType?: string | null;
  sourceId?: number | null;
}) {
  const type = input.type ?? "RECEIPT";
  const item = await lockStockItem(tx, input.stockItemId);
  if (!item || item.propertyId !== input.propertyId) throw new Error("NRMS_STOCK_ITEM_NOT_FOUND");
  if (type === "OPENING_BALANCE") {
    const prior = await tx.nrmsStockMovement.count({ where: { locationId: input.location.id, stockItemId: input.stockItemId } });
    if (prior > 0) throw new Error(NRMS_STOCK_OPENING_EXISTS);
  }
  const onHand = await propertyOnHand(tx, input.stockItemId);
  const averageCost = nextAverageCost({ onHand, currentAverage: Number(item.averageCost), receivedQty: input.quantity, receivedUnitCost: input.unitCost });
  await tx.nrmsStockItem.update({ where: { id: item.id }, data: { averageCost } });
  await applyBalanceDelta(tx, { locationId: input.location.id, stockItemId: input.stockItemId, delta: input.quantity, guard: false });
  const movement = await writeMovement(tx, {
    propertyId: input.propertyId,
    locationId: input.location.id,
    stockItemId: input.stockItemId,
    type,
    quantity: input.quantity,
    unitCost: input.unitCost,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    note: input.note ?? null,
    actorId: input.actorId,
  });
  if (input.location.outletId) await syncMenuAvailability(tx, { outletId: input.location.outletId, locationId: input.location.id, stockItemIds: [input.stockItemId] });
  return movement;
}

/**
 * Take back a mistaken receipt (typed 100 for 10). A WHOLE item cannot be
 * reversed below zero: if the goods were already sold, the receipt was real.
 */
export async function reverseStockReceipt(tx: Tx, input: { propertyId: number; movementId: number; reason: string; actorId: number }) {
  const original = await tx.nrmsStockMovement.findUnique({ where: { id: input.movementId } });
  if (!original || original.propertyId !== input.propertyId) throw new Error("NRMS_STOCK_MOVEMENT_NOT_FOUND");
  if (original.type !== "RECEIPT" && original.type !== "OPENING_BALANCE") throw new Error(NRMS_STOCK_NOT_REVERSIBLE);
  const item = await lockStockItem(tx, original.stockItemId);
  const already = await tx.nrmsStockMovement.count({ where: { sourceType: MOVEMENT_SOURCE, sourceId: original.id, type: "RECEIPT_REVERSAL" } });
  if (already > 0) throw new Error(NRMS_STOCK_ALREADY_REVERSED);
  const quantity = Number(original.quantity);
  const onHand = await propertyOnHand(tx, original.stockItemId);
  const ok = await applyBalanceDelta(tx, { locationId: original.locationId, stockItemId: original.stockItemId, delta: -quantity, guard: item.countStyle === "WHOLE" });
  if (!ok) throw new Error(NRMS_STOCK_REVERSAL_SHORT);
  const averageCost = averageCostAfterReversal({ onHand, currentAverage: Number(item.averageCost), reversedQty: quantity, reversedUnitCost: Number(original.unitCost) });
  await tx.nrmsStockItem.update({ where: { id: item.id }, data: { averageCost } });
  const movement = await writeMovement(tx, {
    propertyId: original.propertyId,
    locationId: original.locationId,
    stockItemId: original.stockItemId,
    type: "RECEIPT_REVERSAL",
    quantity: -quantity,
    unitCost: Number(original.unitCost),
    sourceType: MOVEMENT_SOURCE,
    sourceId: original.id,
    note: input.reason,
    actorId: input.actorId,
  });
  const location = await tx.nrmsStockLocation.findUnique({ where: { id: original.locationId }, select: { outletId: true } });
  if (location?.outletId) await syncMenuAvailability(tx, { outletId: location.outletId, locationId: original.locationId, stockItemIds: [original.stockItemId] });
  return movement;
}

/**
 * Take goods out of a location for a reason other than a sale (transfer out,
 * wastage, staff meal, complimentary), at today's average cost. WHOLE goods
 * never go below zero; PARTIAL goods may, like a sale.
 */
export async function issueStock(tx: Tx, input: {
  propertyId: number;
  locationId: number;
  stockItemId: number;
  quantity: number;
  type: "TRANSFER_OUT" | "WASTAGE" | "STAFF_MEAL" | "COMPLIMENTARY" | "BREAKFAST_SERVICE";
  sourceType: string;
  sourceId: number;
  note?: string | null;
  actorId: number;
}) {
  const item = await tx.nrmsStockItem.findUnique({ where: { id: input.stockItemId }, select: { id: true, name: true, countStyle: true, averageCost: true, propertyId: true } });
  if (!item || item.propertyId !== input.propertyId) throw new Error("NRMS_STOCK_ITEM_NOT_FOUND");
  const quantity = roundQty(input.quantity);
  const ok = await applyBalanceDelta(tx, { locationId: input.locationId, stockItemId: item.id, delta: -quantity, guard: item.countStyle === "WHOLE" });
  if (!ok) throw new StockShortError(item.name);
  const movement = await writeMovement(tx, {
    propertyId: input.propertyId,
    locationId: input.locationId,
    stockItemId: item.id,
    type: input.type,
    quantity: -quantity,
    unitCost: Number(item.averageCost),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    note: input.note ?? null,
    actorId: input.actorId,
  });
  await syncLocationMenu(tx, input.locationId, [item.id]);
  return { movement, unitCost: roundCost(Number(item.averageCost)) };
}

/**
 * Put goods into a location that already belong to the property (transfer in,
 * a cancelled transfer going back). Carries the cost they left at and leaves
 * the average alone: nothing was bought.
 */
export async function placeStock(tx: Tx, input: {
  propertyId: number;
  locationId: number;
  stockItemId: number;
  quantity: number;
  unitCost: number;
  type: "TRANSFER_IN" | "TRANSFER_RETURN";
  sourceType: string;
  sourceId: number;
  note?: string | null;
  actorId: number;
}) {
  const quantity = roundQty(input.quantity);
  if (quantity <= 0) return null;
  await applyBalanceDelta(tx, { locationId: input.locationId, stockItemId: input.stockItemId, delta: quantity, guard: false });
  const movement = await writeMovement(tx, {
    propertyId: input.propertyId,
    locationId: input.locationId,
    stockItemId: input.stockItemId,
    type: input.type,
    quantity,
    unitCost: input.unitCost,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    note: input.note ?? null,
    actorId: input.actorId,
  });
  await syncLocationMenu(tx, input.locationId, [input.stockItemId]);
  return movement;
}

/** Availability follows the shelf only at outlet locations; a store sells nothing. */
async function syncLocationMenu(tx: Tx, locationId: number, stockItemIds: number[]) {
  const location = await tx.nrmsStockLocation.findUnique({ where: { id: locationId }, select: { outletId: true } });
  if (location?.outletId) await syncMenuAvailability(tx, { outletId: location.outletId, locationId, stockItemIds });
}

/** Raised when a WHOLE good would go below zero outside a sale. */
export class StockShortError extends Error {
  constructor(public itemName: string) {
    super(NRMS_STOCK_SHORT);
    this.name = "StockShortError";
  }
}

/**
 * Bring the book in line with an approved count. Never guarded: the shelf was
 * counted, so the book follows it even below zero (a sale after the count may
 * already have moved the balance). Valued at today's average cost.
 */
export async function adjustStock(tx: Tx, input: {
  propertyId: number;
  locationId: number;
  stockItemId: number;
  delta: number;
  sourceType: string;
  sourceId: number;
  note?: string | null;
  actorId: number;
}) {
  const delta = roundQty(input.delta);
  if (delta === 0) return null;
  const item = await tx.nrmsStockItem.findUnique({ where: { id: input.stockItemId }, select: { averageCost: true } });
  await applyBalanceDelta(tx, { locationId: input.locationId, stockItemId: input.stockItemId, delta, guard: false });
  const movement = await writeMovement(tx, {
    propertyId: input.propertyId,
    locationId: input.locationId,
    stockItemId: input.stockItemId,
    type: "COUNT_ADJUSTMENT",
    quantity: delta,
    unitCost: Number(item?.averageCost ?? 0),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    note: input.note ?? null,
    actorId: input.actorId,
  });
  await syncLocationMenu(tx, input.locationId, [input.stockItemId]);
  return movement;
}
