// Stock control milestone 2 API (docs/NRMS_STOCK_AND_PURCHASING.md): stock
// settings, suppliers, goods received notes, transfers between locations and
// write-offs, with manager approval above the owner's limits.
// Mounted at /api/nrms/stock beside the catalogue router.
//
// Stock moves only when a document is POSTED (receipt), sent/received
// (transfer) or APPROVED (write-off), always inside one transaction with its
// ledger rows. Every write carries blockImpersonated.

import crypto from "crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { sanitizeText } from "../lib/sanitize.js";
import { requireNrmsPropertyCapability, type NrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";
import { hasNrmsCapability, type NrmsCapability } from "../lib/nrmsAuthorization.js";
import {
  GOODS_RECEIPT_SOURCE,
  NRMS_STOCK_REVERSAL_SHORT,
  REJECT_REASONS,
  StockShortError,
  TRANSFER_SOURCE,
  WASTAGE_REASONS,
  WRITE_OFF_SOURCE,
  WRITE_OFF_TYPES,
  issueStock,
  placeStock,
  priceFlagFor,
  recordStockReceipt,
  reverseStockReceipt,
  roundCost,
  roundMoney,
  roundQty,
} from "../lib/nrmsInventory.js";
import { loadStockSettings, locationInScope, scopedLocations } from "../lib/nrmsStockScope.js";
import { RECEIVABLE_ORDER_STATUSES, overDeliveryCeiling, statusAfterReceipt } from "../lib/nrmsPurchasing.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
const TX_OPTIONS = { maxWait: 5000, timeout: 20000 };
const PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"] as const;
const PAYMENT_TERMS = ["CASH_ON_DELIVERY", "CREDIT_7", "CREDIT_14", "CREDIT_30"] as const;

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function propertyIdParam(req: AuthedRequest): number {
  return Number(req.params.propertyId);
}

function idParam(req: AuthedRequest, name: string): number | null {
  const value = Number(req.params[name]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function can(access: NrmsPropertyAccess, capability: NrmsCapability): boolean {
  return hasNrmsCapability(access.role, capability);
}

function documentNumber(prefix: string): string {
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `${prefix}-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Display names for a set of user ids (actor columns are plain ids). */
async function userNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id): id is number => Number.isInteger(id)))];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, fullName: true, email: true } });
  return new Map(users.map((user: any) => [user.id, user.fullName || user.name || user.email || `User ${user.id}`]));
}

function cleanPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const cleaned = (trimmed.startsWith("+") ? "+" : "") + trimmed.replace(/[^\d]/g, "");
  return cleaned.replace(/^\+$/, "") || null;
}

const moneySchema = z.number().finite().min(0).max(100_000_000_000);

/** A quantity entered either in base units or as packs of a named pack unit. */
const amountSchema = z.object({
  stockItemId: z.number().int().positive(),
  quantity: z.number().finite().min(0).max(100_000_000).optional(),
  packUnitId: z.number().int().positive().optional(),
  packCount: z.number().finite().min(0).max(100_000_000).optional(),
});

async function loadGoods(propertyId: number, ids: number[]) {
  const goods = await db.nrmsStockItem.findMany({ where: { id: { in: [...new Set(ids)] }, propertyId, status: "ACTIVE" }, include: { packUnits: true } });
  return new Map<number, any>(goods.map((good: any) => [good.id, good]));
}

/** Base-unit quantity from either form; null when the pack is unknown. */
function baseQuantity(good: any, input: { quantity?: number; packUnitId?: number; packCount?: number }): { quantity: number; pack: any | null } | null {
  if (input.packUnitId != null) {
    const pack = good.packUnits.find((row: any) => row.id === input.packUnitId);
    if (!pack || input.packCount == null) return null;
    return { quantity: roundQty(number(pack.baseQuantity) * input.packCount), pack };
  }
  if (input.quantity == null) return null;
  return { quantity: roundQty(input.quantity), pack: null };
}

// ======================================================================= settings

const settingsSchema = z.object({
  storeEnabled: z.boolean(),
  storeName: z.string().trim().min(1).max(120).optional(),
  directPurchaseLimit: moneySchema,
  writeOffLimit: moneySchema,
  priceAlertPercent: z.number().int().min(0).max(500),
  purchaseOrderLimit: moneySchema.optional(),
  overDeliveryPercent: z.number().int().min(0).max(100).optional(),
});

router.get("/property/:propertyId/settings", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  const settings = await loadStockSettings(db, access.property.id);
  const store = await db.nrmsStockLocation.findFirst({ where: { propertyId: access.property.id, kind: "STORE" }, orderBy: { id: "asc" } });
  res.json({ settings, storeName: store?.name ?? "Main store", canEdit: access.role === "OWNER" });
}) as RequestHandler);

/**
 * PUT /property/:propertyId/settings - owner only: the limits decide what a
 * manager or storekeeper may do without asking, so they cannot set their own.
 */
router.put("/property/:propertyId/settings", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  if (access.role !== "OWNER") return res.status(403).json({ error: "Only the owner can change stock limits" });
  const parsed = settingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the stock settings", details: parsed.error.flatten() });
  const input = parsed.data;
  const propertyId = access.property.id;

  const store = await db.nrmsStockLocation.findFirst({ where: { propertyId, kind: "STORE" }, orderBy: { id: "asc" } });
  if (!input.storeEnabled && store && store.status === "ACTIVE") {
    // Switching the store off must not strand goods where nobody can see them.
    const held = await db.nrmsStockBalance.count({ where: { locationId: store.id, quantity: { not: 0 } } });
    if (held > 0) return res.status(409).json({ error: "The store still holds stock. Transfer it to an outlet before switching the store off." });
    const open = await db.nrmsStockTransfer.count({ where: { status: "IN_TRANSIT", OR: [{ fromLocationId: store.id }, { toLocationId: store.id }] } });
    if (open > 0) return res.status(409).json({ error: "A transfer to or from the store is still in transit." });
  }

  // Older screens send only the milestone 2 limits; keep the order limits as they are.
  const current = await loadStockSettings(db, propertyId);
  const limits = {
    storeEnabled: input.storeEnabled,
    directPurchaseLimit: input.directPurchaseLimit,
    writeOffLimit: input.writeOffLimit,
    priceAlertPercent: input.priceAlertPercent,
    purchaseOrderLimit: input.purchaseOrderLimit ?? current.purchaseOrderLimit,
    overDeliveryPercent: input.overDeliveryPercent ?? current.overDeliveryPercent,
  };
  await db.$transaction(async (tx: any) => {
    await tx.nrmsStockSettings.upsert({
      where: { propertyId },
      create: { propertyId, ...limits },
      update: limits,
    });
    const storeName = input.storeName ? sanitizeText(input.storeName) : undefined;
    if (input.storeEnabled) {
      if (store) await tx.nrmsStockLocation.update({ where: { id: store.id }, data: { status: "ACTIVE", ...(storeName ? { name: storeName } : {}) } });
      else await tx.nrmsStockLocation.create({ data: { propertyId, kind: "STORE", name: storeName ?? "Main store" } });
    } else if (store) {
      await tx.nrmsStockLocation.update({ where: { id: store.id }, data: { status: "INACTIVE" } });
    }
  }, TX_OPTIONS);
  res.json({ settings: await loadStockSettings(db, propertyId) });
}) as RequestHandler);

// ====================================================================== suppliers

const payChannelSchema = z.object({ label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(120) });
const supplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal("")),
  tin: z.string().trim().max(30).optional().nullable(),
  vrn: z.string().trim().max(30).optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  paymentTerms: z.enum(PAYMENT_TERMS).default("CASH_ON_DELIVERY"),
  payChannels: z.array(payChannelSchema).max(6).optional().nullable(),
  deliveryDays: z.string().trim().max(120).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(365).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

function supplierData(input: z.infer<typeof supplierSchema>) {
  const text = (value: string | null | undefined) => (value && value.trim() ? sanitizeText(value) : null);
  return {
    name: sanitizeText(input.name),
    contactName: text(input.contactName),
    phone: cleanPhone(input.phone),
    email: input.email ? input.email.toLowerCase() : null,
    tin: text(input.tin),
    vrn: text(input.vrn),
    location: text(input.location),
    paymentTerms: input.paymentTerms,
    payChannels: input.payChannels?.length ? input.payChannels.map((row) => ({ label: sanitizeText(row.label), value: sanitizeText(row.value) })) : null,
    deliveryDays: text(input.deliveryDays),
    leadTimeDays: input.leadTimeDays ?? null,
    notes: text(input.notes),
  };
}

/** Anyone who receives goods needs the list to pick from. */
function canUseSuppliers(access: NrmsPropertyAccess): boolean {
  return can(access, "stock.receive") || can(access, "stock.supplier.manage");
}

router.get("/property/:propertyId/suppliers", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  if (!canUseSuppliers(access)) return res.status(403).json({ error: "Your role does not work with suppliers" });
  const propertyId = access.property.id;
  const suppliers = await db.nrmsSupplier.findMany({ where: { propertyId }, orderBy: [{ status: "asc" }, { name: "asc" }] });
  const stats = await db.nrmsGoodsReceipt.groupBy({
    by: ["supplierId", "paymentMode"],
    where: { propertyId, status: "POSTED", supplierId: { not: null } },
    _sum: { totalCost: true },
    _count: { _all: true },
    _max: { receivedAt: true },
  });
  const bySupplier = new Map<number, { receipts: number; spend: number; onCredit: number; lastReceivedAt: Date | null }>();
  for (const row of stats) {
    const current = bySupplier.get(row.supplierId) ?? { receipts: 0, spend: 0, onCredit: 0, lastReceivedAt: null };
    current.receipts += Number(row._count?._all ?? 0);
    current.spend += number(row._sum?.totalCost);
    if (row.paymentMode === "CREDIT") current.onCredit += number(row._sum?.totalCost);
    const last = row._max?.receivedAt ? new Date(row._max.receivedAt) : null;
    if (last && (!current.lastReceivedAt || last > current.lastReceivedAt)) current.lastReceivedAt = last;
    bySupplier.set(row.supplierId, current);
  }
  res.json({
    canManage: can(access, "stock.supplier.manage"),
    suppliers: suppliers.map((supplier: any) => ({
      ...supplier,
      stats: bySupplier.get(supplier.id) ?? { receipts: 0, spend: 0, onCredit: 0, lastReceivedAt: null },
    })),
  });
}) as RequestHandler);

router.post("/property/:propertyId/suppliers", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  // A storekeeper meeting a new market vendor at the door may add them; editing
  // and retiring suppliers stays with owner and manager.
  if (!canUseSuppliers(access)) return res.status(403).json({ error: "Your role cannot add suppliers" });
  const parsed = supplierSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the supplier details", details: parsed.error.flatten() });
  try {
    const supplier = await db.nrmsSupplier.create({ data: { propertyId: access.property.id, ...supplierData(parsed.data) } });
    res.status(201).json({ supplier });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "A supplier with this name already exists" });
    throw error;
  }
}) as RequestHandler);

async function loadSupplier(req: AuthedRequest, res: Response, capability: NrmsCapability) {
  const supplierId = idParam(req, "supplierId");
  if (!supplierId) { res.status(400).json({ error: "Invalid supplier" }); return null; }
  const supplier = await db.nrmsSupplier.findUnique({ where: { id: supplierId } });
  if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return null; }
  const access = await requireNrmsPropertyCapability(req, res, supplier.propertyId, capability);
  if (!access) return null;
  return { supplier, access };
}

router.get("/suppliers/:supplierId", (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadSupplier(req, res, "stock.read");
  if (!loaded) return;
  if (!canUseSuppliers(loaded.access)) return res.status(403).json({ error: "Your role does not work with suppliers" });
  const [prices, receipts] = await Promise.all([
    db.nrmsSupplierPrice.findMany({ where: { supplierId: loaded.supplier.id }, include: { stockItem: { select: { id: true, name: true, baseUnit: true } } }, orderBy: { updatedAt: "desc" } }),
    db.nrmsGoodsReceipt.findMany({ where: { supplierId: loaded.supplier.id }, include: { location: { select: { name: true } }, _count: { select: { lines: true } } }, orderBy: { receivedAt: "desc" }, take: 30 }),
  ]);
  res.json({
    supplier: loaded.supplier,
    canManage: can(loaded.access, "stock.supplier.manage"),
    prices: prices.map((row: any) => ({
      stockItemId: row.stockItemId,
      stockItemName: row.stockItem.name,
      baseUnit: row.stockItem.baseUnit,
      lastUnitCost: row.lastUnitCost == null ? null : roundCost(number(row.lastUnitCost)),
      agreedUnitCost: row.agreedUnitCost == null ? null : roundCost(number(row.agreedUnitCost)),
      lastReceivedAt: row.lastReceivedAt,
    })),
    receipts: receipts.map((row: any) => ({ id: row.id, receiptNumber: row.receiptNumber, status: row.status, paymentMode: row.paymentMode, totalCost: number(row.totalCost), receivedAt: row.receivedAt, locationName: row.location.name, lineCount: row._count.lines, flaggedLines: row.flaggedLines })),
  });
}) as RequestHandler);

router.patch("/suppliers/:supplierId", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadSupplier(req, res, "stock.supplier.manage");
  if (!loaded) return;
  const parsed = supplierSchema.partial().extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the supplier details", details: parsed.error.flatten() });
  const merged = supplierData({ ...loaded.supplier, ...parsed.data, paymentTerms: parsed.data.paymentTerms ?? loaded.supplier.paymentTerms, name: parsed.data.name ?? loaded.supplier.name } as any);
  try {
    const supplier = await db.nrmsSupplier.update({ where: { id: loaded.supplier.id }, data: { ...merged, ...(parsed.data.status ? { status: parsed.data.status } : {}) } });
    res.json({ supplier });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "A supplier with this name already exists" });
    throw error;
  }
}) as RequestHandler);

/** PUT /suppliers/:supplierId/prices/:stockItemId - the price the owner agreed, per base unit. */
router.put("/suppliers/:supplierId/prices/:stockItemId", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadSupplier(req, res, "stock.supplier.manage");
  if (!loaded) return;
  const stockItemId = idParam(req, "stockItemId");
  const parsed = z.object({ agreedUnitCost: z.number().finite().min(0).max(1_000_000_000).nullable() }).safeParse(req.body ?? {});
  if (!stockItemId || !parsed.success) return res.status(400).json({ error: "Check the agreed price" });
  const good = await db.nrmsStockItem.findFirst({ where: { id: stockItemId, propertyId: loaded.supplier.propertyId } });
  if (!good) return res.status(404).json({ error: "Stock item not found" });
  const agreed = parsed.data.agreedUnitCost && parsed.data.agreedUnitCost > 0 ? roundCost(parsed.data.agreedUnitCost) : null;
  await db.nrmsSupplierPrice.upsert({
    where: { supplierId_stockItemId: { supplierId: loaded.supplier.id, stockItemId } },
    create: { supplierId: loaded.supplier.id, stockItemId, agreedUnitCost: agreed },
    update: { agreedUnitCost: agreed },
  });
  res.json({ ok: true });
}) as RequestHandler);

// ============================================================= goods received notes

const receiptLineSchema = amountSchema.extend({
  claimedQuantity: z.number().finite().min(0).max(100_000_000).optional().nullable(),
  rejectedQuantity: z.number().finite().min(0).max(100_000_000).optional().nullable(),
  rejectReason: z.enum(REJECT_REASONS).optional().nullable(),
  /** Total paid for the accepted quantity, or the price per base unit. */
  totalCost: moneySchema.optional(),
  unitCost: z.number().finite().min(0).max(1_000_000_000).optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  /** The purchase order line this delivery line fills (milestone 4). */
  purchaseOrderLineId: z.number().int().positive().optional().nullable(),
});

const receiptSchema = z.object({
  supplierId: z.number().int().positive().optional().nullable(),
  /** Receiving against a purchase order: supplier and location come from the order. */
  purchaseOrderId: z.number().int().positive().optional().nullable(),
  locationId: z.number().int().positive(),
  paymentMode: z.enum(["PAID", "CREDIT"]),
  paymentMethod: z.enum(PAYMENT_METHODS).optional().nullable(),
  paymentReference: z.string().trim().max(80).optional().nullable(),
  supplierDocumentNumber: z.string().trim().max(80).optional().nullable(),
  photoUrl: z.string().trim().url().max(500).startsWith("https://").optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
  lines: z.array(receiptLineSchema).min(1).max(60),
});

/**
 * Write the ledger rows for a receipt: one RECEIPT per accepted line at the
 * price actually paid, and the supplier's last price for each good.
 */
async function postReceipt(tx: any, receipt: any, actorId: number) {
  const lines = await tx.nrmsGoodsReceiptLine.findMany({ where: { receiptId: receipt.id }, orderBy: { id: "asc" } });
  const location = await tx.nrmsStockLocation.findUnique({ where: { id: receipt.locationId }, select: { id: true, outletId: true } });
  for (const line of lines) {
    const quantity = number(line.quantity);
    if (quantity <= 0) continue;
    const movement = await recordStockReceipt(tx, {
      propertyId: receipt.propertyId,
      location,
      stockItemId: line.stockItemId,
      quantity,
      unitCost: number(line.unitCost),
      note: `Received on ${receipt.receiptNumber}`,
      actorId,
      sourceType: GOODS_RECEIPT_SOURCE,
      sourceId: receipt.id,
    });
    await tx.nrmsGoodsReceiptLine.update({ where: { id: line.id }, data: { movementId: movement.id } });
    if (line.purchaseOrderLineId) {
      await tx.nrmsPurchaseOrderLine.update({ where: { id: line.purchaseOrderLineId }, data: { receivedQuantity: { increment: quantity } } });
    }
    if (receipt.supplierId) {
      await tx.nrmsSupplierPrice.upsert({
        where: { supplierId_stockItemId: { supplierId: receipt.supplierId, stockItemId: line.stockItemId } },
        create: { supplierId: receipt.supplierId, stockItemId: line.stockItemId, lastUnitCost: number(line.unitCost), lastReceivedAt: receipt.receivedAt },
        update: { lastUnitCost: number(line.unitCost), lastReceivedAt: receipt.receivedAt },
      });
    }
  }
  if (receipt.purchaseOrderId) await refreshOrderStatus(tx, receipt.purchaseOrderId);
}

/** Recompute an order's status from what its lines have received so far. */
async function refreshOrderStatus(tx: any, orderId: number) {
  const order = await tx.nrmsPurchaseOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!order) return;
  const next = statusAfterReceipt(order.status, order.lines.map((line: any) => ({ quantity: number(line.quantity), receivedQuantity: number(line.receivedQuantity) })));
  if (next !== order.status) await tx.nrmsPurchaseOrder.update({ where: { id: orderId }, data: { status: next } });
}

function shapeReceipt(row: any, names: Map<number, string>) {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    status: row.status,
    supplierId: row.supplierId,
    supplierName: row.supplier?.name ?? null,
    purchaseOrderId: row.purchaseOrderId ?? null,
    orderNumber: row.purchaseOrder?.orderNumber ?? null,
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    paymentMode: row.paymentMode,
    paymentMethod: row.paymentMethod,
    paymentReference: row.paymentReference,
    supplierDocumentNumber: row.supplierDocumentNumber,
    photoUrl: row.photoUrl,
    note: row.note,
    totalCost: number(row.totalCost),
    rejectedValue: number(row.rejectedValue),
    flaggedLines: row.flaggedLines,
    receivedAt: row.receivedAt,
    receivedBy: row.receivedById ? names.get(row.receivedById) ?? null : null,
    receivedById: row.receivedById,
    decidedBy: row.decidedById ? names.get(row.decidedById) ?? null : null,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    voidedBy: row.voidedById ? names.get(row.voidedById) ?? null : null,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    lineCount: row._count?.lines ?? row.lines?.length ?? 0,
    lines: row.lines?.map((line: any) => ({
      id: line.id,
      stockItemId: line.stockItemId,
      stockItemName: line.stockItem?.name ?? null,
      baseUnit: line.stockItem?.baseUnit ?? null,
      packUnitName: line.packUnitName,
      packCount: line.packCount == null ? null : roundQty(number(line.packCount)),
      quantity: roundQty(number(line.quantity)),
      claimedQuantity: line.claimedQuantity == null ? null : roundQty(number(line.claimedQuantity)),
      rejectedQuantity: roundQty(number(line.rejectedQuantity)),
      rejectReason: line.rejectReason,
      unitCost: roundCost(number(line.unitCost)),
      lineTotal: number(line.lineTotal),
      previousUnitCost: line.previousUnitCost == null ? null : roundCost(number(line.previousUnitCost)),
      priceFlag: line.priceFlag,
      expiresAt: line.expiresAt,
      purchaseOrderLineId: line.purchaseOrderLineId ?? null,
    })),
  };
}

router.get("/property/:propertyId/goods-receipts", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  if (!can(access, "stock.receive") && !can(access, "stock.adjustment.approve")) return res.status(403).json({ error: "Your role does not receive goods" });
  const locationIds = (await scopedLocations(db, access)).map((location) => location.id);
  const status = typeof req.query.status === "string" && req.query.status ? String(req.query.status) : undefined;
  const supplierId = Number(req.query.supplierId) || undefined;
  const rows = await db.nrmsGoodsReceipt.findMany({
    where: { propertyId: access.property.id, locationId: { in: locationIds }, ...(status ? { status } : {}), ...(supplierId ? { supplierId } : {}) },
    include: { supplier: { select: { name: true } }, location: { select: { name: true } }, purchaseOrder: { select: { orderNumber: true } }, _count: { select: { lines: true } } },
    orderBy: { receivedAt: "desc" },
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 60)),
  });
  const names = await userNames(rows.flatMap((row: any) => [row.receivedById, row.decidedById, row.voidedById]));
  res.json({ receipts: rows.map((row: any) => shapeReceipt(row, names)) });
}) as RequestHandler);

router.get("/goods-receipts/:receiptId", (async (req: AuthedRequest, res: Response) => {
  const receiptId = idParam(req, "receiptId");
  if (!receiptId) return res.status(400).json({ error: "Invalid receipt" });
  const row = await db.nrmsGoodsReceipt.findUnique({
    where: { id: receiptId },
    include: { supplier: { select: { name: true } }, location: { select: { name: true } }, purchaseOrder: { select: { orderNumber: true } }, lines: { include: { stockItem: { select: { name: true, baseUnit: true } } }, orderBy: { id: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Receipt not found" });
  const access = await requireNrmsPropertyCapability(req, res, row.propertyId, "stock.read");
  if (!access) return;
  if (!(await locationInScope(db, access, row.locationId))) return res.status(403).json({ error: "This receipt is outside your assignment" });
  const names = await userNames([row.receivedById, row.decidedById, row.voidedById]);
  res.json({ receipt: shapeReceipt(row, names), canApprove: can(access, "stock.adjustment.approve") });
}) as RequestHandler);

/**
 * POST /property/:propertyId/goods-receipts - record what arrived. Accepted
 * quantities enter stock at once, unless the total is above the owner's
 * direct-purchase limit and the receiver cannot approve: then it waits.
 */
router.post("/property/:propertyId/goods-receipts", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.receive");
  if (!access) return;
  const parsed = receiptSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the delivery details", details: parsed.error.flatten() });
  const input = parsed.data;
  const propertyId = access.property.id;

  const location = await locationInScope(db, access, input.locationId);
  if (!location) return res.status(403).json({ error: "This location is outside your assignment" });

  // Against an order, the order decides who delivered and where it goes.
  const order = input.purchaseOrderId
    ? await db.nrmsPurchaseOrder.findFirst({ where: { id: input.purchaseOrderId, propertyId }, include: { lines: true } })
    : null;
  if (input.purchaseOrderId && !order) return res.status(404).json({ error: "Purchase order not found" });
  if (order && !RECEIVABLE_ORDER_STATUSES.includes(order.status)) return res.status(409).json({ error: "This order cannot be received against. It must be approved and still open." });
  if (order && order.locationId !== location.id) return res.status(400).json({ error: "This order is delivered to another location. Receive it there." });
  if (order && input.supplierId && input.supplierId !== order.supplierId) return res.status(400).json({ error: "This order is from another supplier" });
  const supplierId = order ? order.supplierId : input.supplierId ?? null;
  const supplier = supplierId ? await db.nrmsSupplier.findFirst({ where: { id: supplierId, propertyId } }) : null;
  if (supplierId && !supplier) return res.status(404).json({ error: "Supplier not found" });
  if (!order && supplier && supplier.status !== "ACTIVE") return res.status(404).json({ error: "Supplier not found" });
  if (input.paymentMode === "CREDIT" && !supplier) return res.status(400).json({ error: "Goods on credit need a supplier, so the debt has a name." });
  if (input.paymentMode === "PAID" && !input.paymentMethod) return res.status(400).json({ error: "Choose how this delivery was paid" });

  const settings = await loadStockSettings(db, propertyId);
  const goods = await loadGoods(propertyId, input.lines.map((line) => line.stockItemId));
  const prices = supplier
    ? new Map<number, any>((await db.nrmsSupplierPrice.findMany({ where: { supplierId: supplier.id, stockItemId: { in: [...goods.keys()] } } })).map((row: any) => [row.stockItemId, row]))
    : new Map<number, any>();

  const orderLines = new Map<number, any>((order?.lines ?? []).map((line: any) => [line.id, line]));
  const orderLineByGood = new Map<number, any>((order?.lines ?? []).map((line: any) => [line.stockItemId, line]));
  // Accepted quantity per order line across this delivery, for the over-delivery check.
  const acceptedOnOrderLine = new Map<number, number>();

  const lines: any[] = [];
  let total = 0;
  let offOrderTotal = 0;
  let rejectedValue = 0;
  let flagged = 0;
  for (const [index, line] of input.lines.entries()) {
    const good = goods.get(line.stockItemId);
    if (!good) return res.status(404).json({ error: `Line ${index + 1}: stock item not found` });
    let orderLine: any = null;
    if (order) {
      orderLine = line.purchaseOrderLineId ? orderLines.get(line.purchaseOrderLineId) : orderLineByGood.get(good.id);
      if (line.purchaseOrderLineId && (!orderLine || orderLine.stockItemId !== good.id)) return res.status(400).json({ error: `Line ${index + 1}: ${good.name} is not on this order` });
    } else if (line.purchaseOrderLineId) {
      return res.status(400).json({ error: "Choose the order this delivery belongs to" });
    }
    const amount = baseQuantity(good, line);
    if (!amount) return res.status(400).json({ error: `Line ${index + 1}: enter how much of ${good.name} was accepted` });
    const rejected = roundQty(line.rejectedQuantity ?? 0);
    if (amount.quantity <= 0 && rejected <= 0) return res.status(400).json({ error: `Line ${index + 1}: nothing accepted or rejected for ${good.name}` });
    if (good.countStyle === "WHOLE" && (!Number.isInteger(amount.quantity) || !Number.isInteger(rejected))) {
      return res.status(400).json({ error: `${good.name} is counted in whole units. Enter whole numbers.` });
    }
    if (rejected > 0 && !line.rejectReason) return res.status(400).json({ error: `Line ${index + 1}: say why ${good.name} was rejected` });

    let unitCost = 0;
    if (amount.quantity > 0) {
      if (line.totalCost != null) unitCost = roundCost(line.totalCost / amount.quantity);
      else if (line.unitCost != null) unitCost = roundCost(line.unitCost);
      if (unitCost <= 0) return res.status(400).json({ error: `Line ${index + 1}: enter what was paid for ${good.name}` });
    }
    const lineTotal = roundMoney(line.totalCost != null ? line.totalCost : unitCost * amount.quantity);
    const price = prices.get(good.id);
    const expected = { lastUnitCost: price?.lastUnitCost != null ? number(price.lastUnitCost) : (number(good.averageCost) || null), agreedUnitCost: price?.agreedUnitCost != null ? number(price.agreedUnitCost) : null };
    let flag: { flag: string; compared: number | null } = amount.quantity > 0 ? priceFlagFor({ unitCost, ...expected, alertPercent: settings.priceAlertPercent }) : { flag: "NONE", compared: null };
    // On an order, the price the supplier was asked to honour is the yardstick.
    if (orderLine && amount.quantity > 0) {
      const ordered = number(orderLine.unitCost);
      flag = { flag: ordered > 0 && unitCost > ordered * (1 + settings.priceAlertPercent / 100) ? "ABOVE_ORDER" : "NONE", compared: ordered };
      acceptedOnOrderLine.set(orderLine.id, (acceptedOnOrderLine.get(orderLine.id) ?? 0) + amount.quantity);
    } else {
      offOrderTotal += lineTotal;
    }
    if (flag.flag !== "NONE") flagged += 1;
    total += lineTotal;
    rejectedValue += rejected * (unitCost || expected.agreedUnitCost || expected.lastUnitCost || 0);
    lines.push({
      stockItemId: good.id,
      packUnitName: amount.pack?.name ?? null,
      packCount: amount.pack ? line.packCount : null,
      quantity: amount.quantity,
      claimedQuantity: line.claimedQuantity != null ? roundQty(line.claimedQuantity) : null,
      rejectedQuantity: rejected,
      rejectReason: rejected > 0 ? line.rejectReason : null,
      unitCost,
      lineTotal,
      previousUnitCost: flag.compared,
      priceFlag: flag.flag,
      expiresAt: line.expiresAt ? new Date(`${line.expiresAt}T00:00:00.000Z`) : null,
      purchaseOrderLineId: orderLine?.id ?? null,
    });
  }
  total = roundMoney(total);

  // More than ordered, beyond the owner's allowance, waits for a manager.
  // Deliveries still waiting for approval count too, so two small deliveries
  // cannot slip an excess past the check.
  let overDelivered: string[] = [];
  if (order && acceptedOnOrderLine.size > 0) {
    const pending = await db.nrmsGoodsReceiptLine.groupBy({
      by: ["purchaseOrderLineId"],
      where: { purchaseOrderLineId: { in: [...acceptedOnOrderLine.keys()] }, receipt: { status: "PENDING_APPROVAL" } },
      _sum: { quantity: true },
    });
    const pendingByLine = new Map<number, number>(pending.map((row: any) => [row.purchaseOrderLineId, number(row._sum?.quantity)]));
    overDelivered = [...acceptedOnOrderLine.entries()].filter(([lineId, accepted]) => {
      const orderLine = orderLines.get(lineId);
      const good = goods.get(orderLine.stockItemId);
      const ceiling = overDeliveryCeiling({ ordered: number(orderLine.quantity), tolerancePercent: settings.overDeliveryPercent, countStyle: good?.countStyle ?? "WHOLE" });
      return number(orderLine.receivedQuantity) + (pendingByLine.get(lineId) ?? 0) + accepted > ceiling + 1e-9;
    }).map(([lineId]) => goods.get(orderLines.get(lineId).stockItemId)?.name ?? "a good");
  }
  // Goods on an approved order were already approved; only the extra goods
  // and any excess over the order count against the delivery limit.
  const needsApproval = !can(access, "stock.adjustment.approve")
    && (overDelivered.length > 0 || roundMoney(order ? offOrderTotal : total) > settings.directPurchaseLimit);

  try {
    const receipt = await db.$transaction(async (tx: any) => {
      const created = await tx.nrmsGoodsReceipt.create({
        data: {
          propertyId,
          receiptNumber: documentNumber("GRN"),
          supplierId: supplier?.id ?? null,
          locationId: location.id,
          purchaseOrderId: order?.id ?? null,
          status: needsApproval ? "PENDING_APPROVAL" : "POSTED",
          paymentMode: input.paymentMode,
          paymentMethod: input.paymentMode === "PAID" ? input.paymentMethod : null,
          paymentReference: input.paymentReference ? sanitizeText(input.paymentReference) : null,
          supplierDocumentNumber: input.supplierDocumentNumber ? sanitizeText(input.supplierDocumentNumber) : null,
          photoUrl: input.photoUrl ?? null,
          note: input.note ? sanitizeText(input.note) : null,
          totalCost: total,
          rejectedValue: roundMoney(rejectedValue),
          flaggedLines: flagged,
          receivedById: req.user!.id,
          lines: { create: lines },
        },
      });
      if (!needsApproval) await postReceipt(tx, created, req.user!.id);
      return created;
    }, TX_OPTIONS);
    res.status(201).json({ receiptId: receipt.id, receiptNumber: receipt.receiptNumber, status: receipt.status, totalCost: total, flaggedLines: flagged, overDelivered });
  } catch (error) {
    console.error("[nrms.stock.operations] goods receipt failed", error);
    res.status(500).json({ error: "Unable to record the delivery" });
  }
}) as RequestHandler);

async function loadReceiptForDecision(req: AuthedRequest, res: Response) {
  const receiptId = idParam(req, "receiptId");
  if (!receiptId) { res.status(400).json({ error: "Invalid receipt" }); return null; }
  const receipt = await db.nrmsGoodsReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt) { res.status(404).json({ error: "Receipt not found" }); return null; }
  const access = await requireNrmsPropertyCapability(req, res, receipt.propertyId, "stock.adjustment.approve");
  if (!access) return null;
  return { receipt, access };
}

router.post("/goods-receipts/:receiptId/approve", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadReceiptForDecision(req, res);
  if (!loaded) return;
  const note = typeof req.body?.note === "string" && req.body.note.trim() ? sanitizeText(req.body.note.trim().slice(0, 300)) : null;
  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsGoodsReceipt.updateMany({
        where: { id: loaded.receipt.id, status: "PENDING_APPROVAL" },
        data: { status: "POSTED", decidedById: req.user!.id, decidedAt: new Date(), decisionNote: note },
      });
      if (changed.count !== 1) throw new Error("NRMS_RECEIPT_NOT_PENDING");
      await postReceipt(tx, loaded.receipt, req.user!.id);
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_RECEIPT_NOT_PENDING") return res.status(409).json({ error: "This receipt is no longer waiting for approval" });
    console.error("[nrms.stock.operations] receipt approval failed", error);
    return res.status(500).json({ error: "Unable to approve the receipt" });
  }
  // Separation of duties is a warning here, not a block (decision D6): small
  // properties often have one person who both buys and approves.
  res.json({ ok: true, selfApproved: loaded.receipt.receivedById === req.user!.id });
}) as RequestHandler);

router.post("/goods-receipts/:receiptId/reject", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadReceiptForDecision(req, res);
  if (!loaded) return;
  const parsed = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Give a reason for rejecting this receipt" });
  const changed = await db.nrmsGoodsReceipt.updateMany({
    where: { id: loaded.receipt.id, status: "PENDING_APPROVAL" },
    data: { status: "REJECTED", decidedById: req.user!.id, decidedAt: new Date(), decisionNote: sanitizeText(parsed.data.reason) },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "This receipt is no longer waiting for approval" });
  res.json({ ok: true });
}) as RequestHandler);

/** POST /goods-receipts/:receiptId/void - take a posted receipt back out of stock, line by line. */
router.post("/goods-receipts/:receiptId/void", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadReceiptForDecision(req, res);
  if (!loaded) return;
  const parsed = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Give a reason for voiding this receipt" });
  const reason = sanitizeText(parsed.data.reason);
  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsGoodsReceipt.updateMany({
        where: { id: loaded.receipt.id, status: "POSTED" },
        data: { status: "VOIDED", voidedById: req.user!.id, voidedAt: new Date(), voidReason: reason },
      });
      if (changed.count !== 1) throw new Error("NRMS_RECEIPT_NOT_POSTED");
      const lines = await tx.nrmsGoodsReceiptLine.findMany({ where: { receiptId: loaded.receipt.id, movementId: { not: null } } });
      for (const line of lines) {
        await reverseStockReceipt(tx, { propertyId: loaded.receipt.propertyId, movementId: line.movementId, reason: `Receipt ${loaded.receipt.receiptNumber} voided: ${reason}`, actorId: req.user!.id });
        if (line.purchaseOrderLineId) {
          await tx.nrmsPurchaseOrderLine.update({ where: { id: line.purchaseOrderLineId }, data: { receivedQuantity: { decrement: number(line.quantity) } } });
        }
      }
      if (loaded.receipt.purchaseOrderId) await refreshOrderStatus(tx, loaded.receipt.purchaseOrderId);
    }, TX_OPTIONS);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NRMS_RECEIPT_NOT_POSTED") return res.status(409).json({ error: "Only a posted receipt can be voided" });
    if (code === NRMS_STOCK_REVERSAL_SHORT) return res.status(409).json({ error: "Some of these goods have already been sold or moved, so the receipt cannot be taken back in full." });
    console.error("[nrms.stock.operations] receipt void failed", error);
    return res.status(500).json({ error: "Unable to void the receipt" });
  }
  res.json({ ok: true });
}) as RequestHandler);

// ====================================================================== transfers

const transferSchema = z.object({
  fromLocationId: z.number().int().positive(),
  toLocationId: z.number().int().positive(),
  note: z.string().trim().max(300).optional().nullable(),
  lines: z.array(amountSchema).min(1).max(60),
});

function shapeTransfer(row: any, names: Map<number, string>) {
  return {
    id: row.id,
    transferNumber: row.transferNumber,
    status: row.status,
    fromLocationId: row.fromLocationId,
    fromLocationName: row.fromLocation?.name ?? null,
    toLocationId: row.toLocationId,
    toLocationName: row.toLocation?.name ?? null,
    note: row.note,
    sentAt: row.sentAt,
    sentBy: row.sentById ? names.get(row.sentById) ?? null : null,
    receivedAt: row.receivedAt,
    receivedBy: row.receivedById ? names.get(row.receivedById) ?? null : null,
    cancelledAt: row.cancelledAt,
    lines: (row.lines ?? []).map((line: any) => ({
      id: line.id,
      stockItemId: line.stockItemId,
      stockItemName: line.stockItem?.name ?? null,
      baseUnit: line.stockItem?.baseUnit ?? null,
      quantitySent: roundQty(number(line.quantitySent)),
      quantityReceived: line.quantityReceived == null ? null : roundQty(number(line.quantityReceived)),
      unitCost: roundCost(number(line.unitCost)),
    })),
  };
}

router.get("/property/:propertyId/transfers", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  const locationIds = (await scopedLocations(db, access)).map((location) => location.id);
  const status = typeof req.query.status === "string" && req.query.status ? String(req.query.status) : undefined;
  const rows = await db.nrmsStockTransfer.findMany({
    where: { propertyId: access.property.id, OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }], ...(status ? { status } : {}) },
    include: { fromLocation: { select: { name: true } }, toLocation: { select: { name: true } }, lines: { include: { stockItem: { select: { name: true, baseUnit: true } } }, orderBy: { id: "asc" } } },
    orderBy: { sentAt: "desc" },
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 60)),
  });
  const names = await userNames(rows.flatMap((row: any) => [row.sentById, row.receivedById]));
  res.json({
    canSend: can(access, "stock.transfer.send"),
    canReceive: can(access, "stock.transfer.receive"),
    myLocationIds: locationIds,
    transfers: rows.map((row: any) => shapeTransfer(row, names)),
  });
}) as RequestHandler);

/** POST /property/:propertyId/transfers - send goods; the sending shelf drops now. */
router.post("/property/:propertyId/transfers", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.transfer.send");
  if (!access) return;
  const parsed = transferSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the transfer", details: parsed.error.flatten() });
  const input = parsed.data;
  if (input.fromLocationId === input.toLocationId) return res.status(400).json({ error: "Choose two different locations" });
  const propertyId = access.property.id;
  const from = await locationInScope(db, access, input.fromLocationId);
  if (!from) return res.status(403).json({ error: "You cannot send from this location" });
  // The destination only has to belong to the property: a bar may send to the kitchen.
  const to = await db.nrmsStockLocation.findFirst({ where: { id: input.toLocationId, propertyId, status: "ACTIVE" } });
  if (!to) return res.status(404).json({ error: "Destination not found" });

  const goods = await loadGoods(propertyId, input.lines.map((line) => line.stockItemId));
  const planned: Array<{ good: any; quantity: number }> = [];
  for (const [index, line] of input.lines.entries()) {
    const good = goods.get(line.stockItemId);
    if (!good) return res.status(404).json({ error: `Line ${index + 1}: stock item not found` });
    const amount = baseQuantity(good, line);
    if (!amount || amount.quantity <= 0) return res.status(400).json({ error: `Line ${index + 1}: enter how much ${good.name} to send` });
    if (good.countStyle === "WHOLE" && !Number.isInteger(amount.quantity)) return res.status(400).json({ error: `${good.name} is counted in whole units.` });
    planned.push({ good, quantity: amount.quantity });
  }

  try {
    const transfer = await db.$transaction(async (tx: any) => {
      const created = await tx.nrmsStockTransfer.create({
        data: { propertyId, transferNumber: documentNumber("TRF"), fromLocationId: from.id, toLocationId: to.id, note: input.note ? sanitizeText(input.note) : null, sentById: req.user!.id },
      });
      for (const row of planned) {
        const issued = await issueStock(tx, { propertyId, locationId: from.id, stockItemId: row.good.id, quantity: row.quantity, type: "TRANSFER_OUT", sourceType: TRANSFER_SOURCE, sourceId: created.id, note: `Sent to ${to.name} on ${created.transferNumber}`, actorId: req.user!.id });
        await tx.nrmsStockTransferLine.create({ data: { transferId: created.id, stockItemId: row.good.id, quantitySent: row.quantity, unitCost: issued.unitCost } });
      }
      return created;
    }, TX_OPTIONS);
    res.status(201).json({ transferId: transfer.id, transferNumber: transfer.transferNumber });
  } catch (error) {
    if (error instanceof StockShortError) return res.status(409).json({ error: `${from.name} does not have that much ${error.itemName} to send.` });
    console.error("[nrms.stock.operations] transfer failed", error);
    res.status(500).json({ error: "Unable to send the transfer" });
  }
}) as RequestHandler);

async function loadTransfer(req: AuthedRequest, res: Response, capability: NrmsCapability) {
  const transferId = idParam(req, "transferId");
  if (!transferId) { res.status(400).json({ error: "Invalid transfer" }); return null; }
  const transfer = await db.nrmsStockTransfer.findUnique({ where: { id: transferId }, include: { lines: true, fromLocation: true, toLocation: true } });
  if (!transfer) { res.status(404).json({ error: "Transfer not found" }); return null; }
  const access = await requireNrmsPropertyCapability(req, res, transfer.propertyId, capability);
  if (!access) return null;
  return { transfer, access };
}

/**
 * POST /transfers/:transferId/receive - the receiving side confirms what
 * actually arrived. Anything short stays recorded on the transfer as lost in
 * transit; it never reaches the receiving shelf.
 */
router.post("/transfers/:transferId/receive", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadTransfer(req, res, "stock.transfer.receive");
  if (!loaded) return;
  const { transfer, access } = loaded;
  if (!(await locationInScope(db, access, transfer.toLocationId))) return res.status(403).json({ error: "Only the receiving location can confirm this transfer" });
  const parsed = z.object({ lines: z.array(z.object({ lineId: z.number().int().positive(), quantityReceived: z.number().finite().min(0).max(100_000_000) })).min(1) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Enter what arrived for each line" });
  const received = new Map(parsed.data.lines.map((line) => [line.lineId, roundQty(line.quantityReceived)]));
  for (const line of transfer.lines) {
    const quantity = received.get(line.id);
    if (quantity == null) return res.status(400).json({ error: "Confirm every line of the transfer" });
    if (quantity > number(line.quantitySent)) return res.status(400).json({ error: "More cannot arrive than was sent" });
  }
  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsStockTransfer.updateMany({ where: { id: transfer.id, status: "IN_TRANSIT" }, data: { status: "RECEIVED", receivedById: req.user!.id, receivedAt: new Date() } });
      if (changed.count !== 1) throw new Error("NRMS_TRANSFER_NOT_IN_TRANSIT");
      for (const line of transfer.lines) {
        const quantity = received.get(line.id)!;
        await tx.nrmsStockTransferLine.update({ where: { id: line.id }, data: { quantityReceived: quantity } });
        await placeStock(tx, { propertyId: transfer.propertyId, locationId: transfer.toLocationId, stockItemId: line.stockItemId, quantity, unitCost: number(line.unitCost), type: "TRANSFER_IN", sourceType: TRANSFER_SOURCE, sourceId: transfer.id, note: `Received from ${transfer.fromLocation.name} on ${transfer.transferNumber}`, actorId: req.user!.id });
      }
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_TRANSFER_NOT_IN_TRANSIT") return res.status(409).json({ error: "This transfer is no longer in transit" });
    console.error("[nrms.stock.operations] transfer receive failed", error);
    return res.status(500).json({ error: "Unable to confirm the transfer" });
  }
  const short = transfer.lines.filter((line: any) => (received.get(line.id) ?? 0) < number(line.quantitySent)).length;
  res.json({ ok: true, shortLines: short, selfReceived: transfer.sentById === req.user!.id });
}) as RequestHandler);

/** POST /transfers/:transferId/cancel - the sender takes an unconfirmed transfer back. */
router.post("/transfers/:transferId/cancel", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadTransfer(req, res, "stock.transfer.send");
  if (!loaded) return;
  const { transfer, access } = loaded;
  if (!(await locationInScope(db, access, transfer.fromLocationId))) return res.status(403).json({ error: "Only the sending location can cancel this transfer" });
  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsStockTransfer.updateMany({ where: { id: transfer.id, status: "IN_TRANSIT" }, data: { status: "CANCELLED", cancelledById: req.user!.id, cancelledAt: new Date() } });
      if (changed.count !== 1) throw new Error("NRMS_TRANSFER_NOT_IN_TRANSIT");
      for (const line of transfer.lines) {
        await placeStock(tx, { propertyId: transfer.propertyId, locationId: transfer.fromLocationId, stockItemId: line.stockItemId, quantity: number(line.quantitySent), unitCost: number(line.unitCost), type: "TRANSFER_RETURN", sourceType: TRANSFER_SOURCE, sourceId: transfer.id, note: `Transfer ${transfer.transferNumber} cancelled`, actorId: req.user!.id });
      }
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_TRANSFER_NOT_IN_TRANSIT") return res.status(409).json({ error: "This transfer is no longer in transit" });
    console.error("[nrms.stock.operations] transfer cancel failed", error);
    return res.status(500).json({ error: "Unable to cancel the transfer" });
  }
  res.json({ ok: true });
}) as RequestHandler);

// ===================================================================== write-offs

const writeOffSchema = amountSchema.extend({
  locationId: z.number().int().positive(),
  type: z.enum(WRITE_OFF_TYPES),
  reasonCode: z.enum(WASTAGE_REASONS).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
  photoUrl: z.string().trim().url().max(500).startsWith("https://").optional().nullable(),
});

function shapeWriteOff(row: any, names: Map<number, string>) {
  return {
    id: row.id,
    type: row.type,
    reasonCode: row.reasonCode,
    status: row.status,
    stockItemId: row.stockItemId,
    stockItemName: row.stockItem?.name ?? null,
    baseUnit: row.stockItem?.baseUnit ?? null,
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    quantity: roundQty(number(row.quantity)),
    unitCost: roundCost(number(row.unitCost)),
    value: number(row.value),
    note: row.note,
    photoUrl: row.photoUrl,
    requestedBy: row.requestedById ? names.get(row.requestedById) ?? null : null,
    decidedBy: row.decidedById ? names.get(row.decidedById) ?? null : null,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt,
  };
}

router.get("/property/:propertyId/write-offs", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  const locationIds = (await scopedLocations(db, access)).map((location) => location.id);
  const status = typeof req.query.status === "string" && req.query.status ? String(req.query.status) : undefined;
  const rows = await db.nrmsStockWriteOff.findMany({
    where: { propertyId: access.property.id, locationId: { in: locationIds }, ...(status ? { status } : {}) },
    include: { stockItem: { select: { name: true, baseUnit: true } }, location: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 80)),
  });
  const names = await userNames(rows.flatMap((row: any) => [row.requestedById, row.decidedById]));
  res.json({
    canRecord: can(access, "stock.writeoff.record"),
    canApprove: can(access, "stock.adjustment.approve"),
    writeOffs: rows.map((row: any) => shapeWriteOff(row, names)),
  });
}) as RequestHandler);

/**
 * POST /property/:propertyId/write-offs - goods leaving for a reason other
 * than a sale. Leaves stock at once when worth no more than the owner's limit
 * or recorded by someone who can approve; otherwise waits for a manager.
 */
router.post("/property/:propertyId/write-offs", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.writeoff.record");
  if (!access) return;
  const parsed = writeOffSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the write-off", details: parsed.error.flatten() });
  const input = parsed.data;
  const propertyId = access.property.id;
  const location = await locationInScope(db, access, input.locationId);
  if (!location) return res.status(403).json({ error: "This location is outside your assignment" });
  if (input.type === "WASTAGE" && !input.reasonCode) return res.status(400).json({ error: "Say why it was wasted" });
  if (input.type === "WASTAGE" && input.reasonCode === "OTHER" && !input.note) return res.status(400).json({ error: "Describe what happened" });
  const good = (await loadGoods(propertyId, [input.stockItemId])).get(input.stockItemId);
  if (!good) return res.status(404).json({ error: "Stock item not found" });
  const amount = baseQuantity(good, input);
  if (!amount || amount.quantity <= 0) return res.status(400).json({ error: "Enter how much" });
  if (good.countStyle === "WHOLE" && !Number.isInteger(amount.quantity)) return res.status(400).json({ error: `${good.name} is counted in whole units.` });

  const settings = await loadStockSettings(db, propertyId);
  const unitCost = roundCost(number(good.averageCost));
  const value = roundMoney(unitCost * amount.quantity);
  const autoApprove = can(access, "stock.adjustment.approve") || value <= settings.writeOffLimit;

  try {
    const writeOff = await db.$transaction(async (tx: any) => {
      const created = await tx.nrmsStockWriteOff.create({
        data: {
          propertyId,
          locationId: location.id,
          stockItemId: good.id,
          type: input.type,
          reasonCode: input.type === "WASTAGE" ? input.reasonCode! : input.type,
          quantity: amount.quantity,
          unitCost,
          value,
          note: input.note ? sanitizeText(input.note) : null,
          photoUrl: input.photoUrl ?? null,
          status: autoApprove ? "APPROVED" : "PENDING",
          requestedById: req.user!.id,
          ...(autoApprove ? { decidedById: req.user!.id, decidedAt: new Date() } : {}),
        },
      });
      if (autoApprove) {
        const issued = await issueStock(tx, { propertyId, locationId: location.id, stockItemId: good.id, quantity: amount.quantity, type: input.type, sourceType: WRITE_OFF_SOURCE, sourceId: created.id, note: input.note ? sanitizeText(input.note) : null, actorId: req.user!.id });
        await tx.nrmsStockWriteOff.update({ where: { id: created.id }, data: { movementId: issued.movement.id } });
      }
      return created;
    }, TX_OPTIONS);
    res.status(201).json({ writeOffId: writeOff.id, status: writeOff.status, value });
  } catch (error) {
    if (error instanceof StockShortError) return res.status(409).json({ error: `${location.name} does not have that much ${error.itemName}.` });
    console.error("[nrms.stock.operations] write-off failed", error);
    res.status(500).json({ error: "Unable to record the write-off" });
  }
}) as RequestHandler);

async function loadWriteOffForDecision(req: AuthedRequest, res: Response) {
  const writeOffId = idParam(req, "writeOffId");
  if (!writeOffId) { res.status(400).json({ error: "Invalid write-off" }); return null; }
  const writeOff = await db.nrmsStockWriteOff.findUnique({ where: { id: writeOffId } });
  if (!writeOff) { res.status(404).json({ error: "Write-off not found" }); return null; }
  const access = await requireNrmsPropertyCapability(req, res, writeOff.propertyId, "stock.adjustment.approve");
  if (!access) return null;
  return { writeOff, access };
}

router.post("/write-offs/:writeOffId/approve", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadWriteOffForDecision(req, res);
  if (!loaded) return;
  const { writeOff } = loaded;
  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsStockWriteOff.updateMany({ where: { id: writeOff.id, status: "PENDING" }, data: { status: "APPROVED", decidedById: req.user!.id, decidedAt: new Date() } });
      if (changed.count !== 1) throw new Error("NRMS_WRITE_OFF_NOT_PENDING");
      const issued = await issueStock(tx, { propertyId: writeOff.propertyId, locationId: writeOff.locationId, stockItemId: writeOff.stockItemId, quantity: number(writeOff.quantity), type: writeOff.type, sourceType: WRITE_OFF_SOURCE, sourceId: writeOff.id, note: writeOff.note, actorId: req.user!.id });
      await tx.nrmsStockWriteOff.update({ where: { id: writeOff.id }, data: { movementId: issued.movement.id } });
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_WRITE_OFF_NOT_PENDING") return res.status(409).json({ error: "This write-off is no longer waiting" });
    if (error instanceof StockShortError) return res.status(409).json({ error: `There is no longer that much ${error.itemName} on the shelf. Reject this and record the right amount.` });
    console.error("[nrms.stock.operations] write-off approval failed", error);
    return res.status(500).json({ error: "Unable to approve the write-off" });
  }
  res.json({ ok: true });
}) as RequestHandler);

router.post("/write-offs/:writeOffId/reject", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadWriteOffForDecision(req, res);
  if (!loaded) return;
  const parsed = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Give a reason for rejecting this write-off" });
  const changed = await db.nrmsStockWriteOff.updateMany({
    where: { id: loaded.writeOff.id, status: "PENDING" },
    data: { status: "REJECTED", decidedById: req.user!.id, decidedAt: new Date(), decisionNote: sanitizeText(parsed.data.reason) },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "This write-off is no longer waiting" });
  res.json({ ok: true });
}) as RequestHandler);

// ====================================================================== approvals

/** GET /property/:propertyId/attention - what is waiting on someone, for badges. */
router.get("/property/:propertyId/attention", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, propertyIdParam(req), "stock.read");
  if (!access) return;
  const propertyId = access.property.id;
  const locationIds = (await scopedLocations(db, access)).map((location) => location.id);
  const canApprove = can(access, "stock.adjustment.approve");
  const [pendingReceipts, pendingWriteOffs, incomingTransfers] = await Promise.all([
    canApprove ? db.nrmsGoodsReceipt.count({ where: { propertyId, status: "PENDING_APPROVAL" } }) : 0,
    canApprove ? db.nrmsStockWriteOff.count({ where: { propertyId, status: "PENDING" } }) : 0,
    can(access, "stock.transfer.receive") ? db.nrmsStockTransfer.count({ where: { propertyId, status: "IN_TRANSIT", toLocationId: { in: locationIds } } }) : 0,
  ]);
  res.json({ pendingReceipts, pendingWriteOffs, incomingTransfers, total: pendingReceipts + pendingWriteOffs + incomingTransfers });
}) as RequestHandler);

export default router;
