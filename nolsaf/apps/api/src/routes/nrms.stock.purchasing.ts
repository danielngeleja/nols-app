// Purchasing (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 4): the reorder
// list, requisitions from the shelves and purchase orders to suppliers.
// Mounted at /api/nrms/stock beside the other stock routers.
//
// Flow: a shelf asks (requisition) or the reorder list suggests -> owner or
// manager raises an order per supplier (DRAFT) -> submit, which approves it at
// once unless a manager's order is above the owner's limit -> send (PDF plus a
// WhatsApp, SMS or email message carrying the supplier's no-login link) ->
// goods received notes against the order fill it line by line.
//
// Orders never move stock; only the goods received note does.

import crypto from "crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { sanitizeText } from "../lib/sanitize.js";
import { requireNrmsPropertyCapability, type NrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";
import { hasNrmsCapability, type NrmsCapability } from "../lib/nrmsAuthorization.js";
import { roundCost, roundMoney, roundQty } from "../lib/nrmsInventory.js";
import { loadStockSettings, locationInScope, scopedLocations } from "../lib/nrmsStockScope.js";
import { buildReorderList } from "../lib/nrmsStockQueries.js";
import {
  OPEN_ORDER_STATUSES,
  RECEIVABLE_ORDER_STATUSES,
  SEND_CHANNELS,
  internationalPhone,
  orderNeedsOwner,
  requisitionStatus,
  supplierMessage,
} from "../lib/nrmsPurchasing.js";
import {
  ORDER_DOCUMENT_INCLUDE,
  newSupplierToken,
  orderLineQuantity,
  renderPurchaseOrderPdf,
  supplierOrderUrl,
} from "../lib/nrmsPurchaseOrderDocument.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
const TX_OPTIONS = { maxWait: 5000, timeout: 20000 };
const OPEN_REQUISITION_STATUSES = ["OPEN", "PARTLY_ORDERED"];
const CANCELLABLE_ORDER_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"];

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

async function userNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id): id is number => Number.isInteger(id)))];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, fullName: true, email: true } });
  return new Map(users.map((user: any) => [user.id, user.fullName || user.name || user.email || `User ${user.id}`]));
}

function dateOnly(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function reasonFrom(body: any): string | null {
  const parsed = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(body ?? {});
  return parsed.success ? sanitizeText(parsed.data.reason) : null;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

/** Base quantity plus the pack it was entered in; an error message when invalid. */
function resolveAmount(good: any, input: { quantity?: number; packUnitId?: number; packCount?: number }): { quantity: number; pack: any | null; packCount: number | null } | string {
  let quantity: number;
  let pack: any = null;
  if (input.packUnitId != null) {
    pack = good.packUnits.find((row: any) => row.id === input.packUnitId);
    if (!pack || input.packCount == null) return `Choose how ${good.name} is packed`;
    quantity = roundQty(number(pack.baseQuantity) * input.packCount);
  } else {
    if (input.quantity == null) return `Enter how much ${good.name}`;
    quantity = roundQty(input.quantity);
  }
  if (quantity <= 0) return `Enter how much ${good.name}`;
  if (good.countStyle === "WHOLE" && !Number.isInteger(quantity)) return `${good.name} is counted in whole units. Enter whole numbers.`;
  return { quantity, pack, packCount: pack ? roundQty(input.packCount!) : null };
}

// ================================================================== reorder list

router.get("/property/:propertyId/reorder", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.read");
  if (!access) return;
  const canManage = can(access, "stock.purchase.manage");
  if (!canManage && !can(access, "stock.requisition")) return res.status(403).json({ error: "Your role does not order goods" });
  const locations = await scopedLocations(db, access);
  const locationId = Number(req.query.locationId) || null;
  const chosen = locationId ? locations.filter((location) => location.id === locationId) : locations;
  // Prices and suppliers are the manager's business; the shelf sees quantities.
  res.json({ rows: await buildReorderList(access.property.id, chosen, canManage) });
}) as RequestHandler);

/** GET /property/:propertyId/purchasing - what the page needs up front, plus the badges. */
router.get("/property/:propertyId/purchasing", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.read");
  if (!access) return;
  const propertyId = access.property.id;
  const canManage = can(access, "stock.purchase.manage");
  const canRequest = can(access, "stock.requisition");
  const canReceive = can(access, "stock.receive");
  if (!canManage && !canRequest && !canReceive) return res.status(403).json({ error: "Your role does not order goods" });
  const settings = await loadStockSettings(db, propertyId);
  const locations = await scopedLocations(db, access, settings);
  const locationIds = locations.map((location) => location.id);
  const [openRequisitions, drafts, pendingApproval, awaitingDelivery, reorder] = await Promise.all([
    db.nrmsStockRequisition.count({ where: { propertyId, status: { in: OPEN_REQUISITION_STATUSES }, ...(canManage ? {} : { locationId: { in: locationIds } }) } }),
    canManage ? db.nrmsPurchaseOrder.count({ where: { propertyId, status: "DRAFT" } }) : 0,
    canManage ? db.nrmsPurchaseOrder.count({ where: { propertyId, status: "PENDING_APPROVAL" } }) : 0,
    db.nrmsPurchaseOrder.count({ where: { propertyId, status: { in: RECEIVABLE_ORDER_STATUSES }, ...(canManage ? {} : { locationId: { in: locationIds } }) } }),
    canManage || canRequest ? buildReorderList(propertyId, locations, false).then((rows) => rows.length) : 0,
  ]);
  res.json({
    role: access.role,
    canManage,
    canRequest,
    canReceive,
    canApproveOrders: access.role === "OWNER",
    purchaseOrderLimit: settings.purchaseOrderLimit,
    overDeliveryPercent: settings.overDeliveryPercent,
    counts: { openRequisitions, drafts, pendingApproval, awaitingDelivery, reorder },
  });
}) as RequestHandler);

// ================================================================== requisitions

const requisitionSchema = z.object({
  locationId: z.number().int().positive(),
  neededBy: dateSchema.optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
  lines: z.array(amountSchema).min(1).max(60),
});

function shapeRequisition(row: any, names: Map<number, string>) {
  return {
    id: row.id,
    requisitionNumber: row.requisitionNumber,
    status: row.status,
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    neededBy: row.neededBy,
    note: row.note,
    requestedAt: row.requestedAt,
    requestedById: row.requestedById,
    requestedBy: row.requestedById ? names.get(row.requestedById) ?? null : null,
    closedAt: row.closedAt,
    closedBy: row.closedById ? names.get(row.closedById) ?? null : null,
    closeNote: row.closeNote,
    lines: (row.lines ?? []).map((line: any) => ({
      id: line.id,
      stockItemId: line.stockItemId,
      stockItemName: line.stockItem?.name ?? null,
      baseUnit: line.stockItem?.baseUnit ?? null,
      category: line.stockItem?.category ?? null,
      quantity: roundQty(number(line.quantity)),
      packUnitName: line.packUnitName,
      packCount: line.packCount == null ? null : roundQty(number(line.packCount)),
      purchaseOrderId: line.purchaseOrderId,
      orderNumber: line.purchaseOrder?.orderNumber ?? null,
      orderStatus: line.purchaseOrder?.status ?? null,
    })),
  };
}

const REQUISITION_INCLUDE = {
  location: { select: { name: true } },
  lines: { include: { stockItem: { select: { name: true, baseUnit: true, category: true } }, purchaseOrder: { select: { orderNumber: true, status: true } } }, orderBy: { id: "asc" as const } },
};

router.get("/property/:propertyId/requisitions", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.read");
  if (!access) return;
  const canManage = can(access, "stock.purchase.manage");
  if (!canManage && !can(access, "stock.requisition")) return res.status(403).json({ error: "Your role does not ask for goods" });
  const locationIds = (await scopedLocations(db, access)).map((location) => location.id);
  const status = typeof req.query.status === "string" ? req.query.status : "open";
  const rows = await db.nrmsStockRequisition.findMany({
    where: {
      propertyId: access.property.id,
      ...(canManage ? {} : { locationId: { in: locationIds } }),
      ...(status === "open" ? { status: { in: OPEN_REQUISITION_STATUSES } } : status && status !== "all" ? { status } : {}),
    },
    include: REQUISITION_INCLUDE,
    orderBy: { requestedAt: "desc" },
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 80)),
  });
  const names = await userNames(rows.flatMap((row: any) => [row.requestedById, row.closedById]));
  res.json({ canManage, myUserId: req.user!.id, requisitions: rows.map((row: any) => shapeRequisition(row, names)) });
}) as RequestHandler);

router.post("/property/:propertyId/requisitions", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.requisition");
  if (!access) return;
  const parsed = requisitionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the request", details: parsed.error.flatten() });
  const input = parsed.data;
  const propertyId = access.property.id;
  const location = await locationInScope(db, access, input.locationId);
  if (!location) return res.status(403).json({ error: "You can only ask for goods for your own shelves" });
  const goods = await loadGoods(propertyId, input.lines.map((line) => line.stockItemId));
  const seen = new Set<number>();
  const lines: any[] = [];
  for (const [index, line] of input.lines.entries()) {
    const good = goods.get(line.stockItemId);
    if (!good) return res.status(404).json({ error: `Line ${index + 1}: stock item not found` });
    if (seen.has(good.id)) return res.status(400).json({ error: `${good.name} is on the list twice` });
    seen.add(good.id);
    const amount = resolveAmount(good, line);
    if (typeof amount === "string") return res.status(400).json({ error: amount });
    lines.push({ stockItemId: good.id, quantity: amount.quantity, packUnitName: amount.pack?.name ?? null, packCount: amount.packCount });
  }
  const created = await db.nrmsStockRequisition.create({
    data: {
      propertyId,
      requisitionNumber: documentNumber("REQ"),
      locationId: location.id,
      neededBy: dateOnly(input.neededBy),
      note: input.note ? sanitizeText(input.note) : null,
      requestedById: req.user!.id,
      lines: { create: lines },
    },
  });
  res.status(201).json({ requisitionId: created.id, requisitionNumber: created.requisitionNumber });
}) as RequestHandler);

async function loadRequisition(req: AuthedRequest, res: Response) {
  const requisitionId = idParam(req, "requisitionId");
  if (!requisitionId) { res.status(400).json({ error: "Invalid request" }); return null; }
  const requisition = await db.nrmsStockRequisition.findUnique({ where: { id: requisitionId }, include: { lines: true } });
  if (!requisition) { res.status(404).json({ error: "Request not found" }); return null; }
  const access = await requireNrmsPropertyCapability(req, res, requisition.propertyId, "stock.read");
  if (!access) return null;
  return { requisition, access };
}

/** POST /requisitions/:requisitionId/cancel - the requester (or a manager) withdraws it before anything is ordered. */
router.post("/requisitions/:requisitionId/cancel", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadRequisition(req, res);
  if (!loaded) return;
  const { requisition, access } = loaded;
  const own = requisition.requestedById === req.user!.id && can(access, "stock.requisition");
  if (!own && !can(access, "stock.purchase.manage")) return res.status(403).json({ error: "Only the person who asked, or a manager, can cancel this" });
  const changed = await db.nrmsStockRequisition.updateMany({
    where: { id: requisition.id, status: "OPEN" },
    data: { status: "CANCELLED", closedById: req.user!.id, closedAt: new Date(), closeNote: "Cancelled" },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "Part of this request is already on an order. A manager can close it instead." });
  res.json({ ok: true });
}) as RequestHandler);

/** POST /requisitions/:requisitionId/close - a manager answers it another way ("sent from the store"). */
router.post("/requisitions/:requisitionId/close", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadRequisition(req, res);
  if (!loaded) return;
  if (!can(loaded.access, "stock.purchase.manage")) return res.status(403).json({ error: "Only owner or manager can close a request" });
  const reason = reasonFrom(req.body);
  if (!reason) return res.status(400).json({ error: "Say how this request was answered" });
  const changed = await db.nrmsStockRequisition.updateMany({
    where: { id: loaded.requisition.id, status: { in: OPEN_REQUISITION_STATUSES } },
    data: { status: "CLOSED", closedById: req.user!.id, closedAt: new Date(), closeNote: reason },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "This request is already closed" });
  res.json({ ok: true });
}) as RequestHandler);

/** Recompute the status of every requisition touched by these line ids. */
async function refreshRequisitions(tx: any, requisitionIds: number[]) {
  for (const id of [...new Set(requisitionIds)]) {
    const row = await tx.nrmsStockRequisition.findUnique({ where: { id }, include: { lines: { select: { purchaseOrderId: true } } } });
    if (!row) continue;
    const next = requisitionStatus(row.status, row.lines);
    if (next !== row.status) await tx.nrmsStockRequisition.update({ where: { id }, data: { status: next } });
  }
}

// =============================================================== purchase orders

const orderLineSchema = amountSchema.extend({
  /** Expected price per base unit. */
  unitCost: z.number().finite().min(0).max(1_000_000_000),
});

const orderSchema = z.object({
  supplierId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  expectedDate: dateSchema.optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  lines: z.array(orderLineSchema).min(1).max(80),
  /** Requisition lines this order answers. */
  requisitionLineIds: z.array(z.number().int().positive()).max(200).optional(),
});

type OrderAccess = { access: NrmsPropertyAccess; canManage: boolean; canReceive: boolean; inScope: boolean };

async function orderAccess(req: AuthedRequest, res: Response, order: any): Promise<OrderAccess | null> {
  const access = await requireNrmsPropertyCapability(req, res, order.propertyId, "stock.read");
  if (!access) return null;
  const canManage = can(access, "stock.purchase.manage");
  const inScope = Boolean(await locationInScope(db, access, order.locationId));
  const canReceive = can(access, "stock.receive") && inScope && RECEIVABLE_ORDER_STATUSES.includes(order.status);
  // A receiver may open an order only while it is theirs to receive.
  if (!canManage && !canReceive) { res.status(403).json({ error: "This order is not yours to open" }); return null; }
  return { access, canManage, canReceive, inScope };
}

/** Validated order lines; an error message when something does not add up. */
async function buildOrderLines(propertyId: number, lines: z.infer<typeof orderLineSchema>[]) {
  const goods = await loadGoods(propertyId, lines.map((line) => line.stockItemId));
  const seen = new Set<number>();
  const rows: any[] = [];
  let total = 0;
  for (const [index, line] of lines.entries()) {
    const good = goods.get(line.stockItemId);
    if (!good) return { error: `Line ${index + 1}: stock item not found` };
    if (seen.has(good.id)) return { error: `${good.name} is on the order twice. Put it on one line.` };
    seen.add(good.id);
    const amount = resolveAmount(good, line);
    if (typeof amount === "string") return { error: amount };
    const unitCost = roundCost(line.unitCost);
    const lineTotal = roundMoney(unitCost * amount.quantity);
    total += lineTotal;
    rows.push({ stockItemId: good.id, packUnitName: amount.pack?.name ?? null, packCount: amount.packCount, quantity: amount.quantity, unitCost, lineTotal });
  }
  return { rows, total: roundMoney(total) };
}

function shapeOrderSummary(row: any) {
  const lines = row.lines ?? [];
  const ordered = lines.reduce((sum: number, line: any) => sum + number(line.quantity), 0);
  const received = lines.reduce((sum: number, line: any) => sum + Math.min(number(line.quantity), number(line.receivedQuantity)), 0);
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    supplierId: row.supplierId,
    supplierName: row.supplier?.name ?? null,
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    expectedDate: row.expectedDate,
    totalCost: number(row.totalCost),
    lineCount: lines.length,
    receivedShare: ordered > 0 ? Math.round((received / ordered) * 100) : 0,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    sentVia: row.sentVia,
    supplierConfirmedAt: row.supplierConfirmedAt,
    supplierDeliveryDate: row.supplierDeliveryDate,
  };
}

router.get("/property/:propertyId/purchase-orders", (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.read");
  if (!access) return;
  const canManage = can(access, "stock.purchase.manage");
  if (!canManage && !can(access, "stock.receive")) return res.status(403).json({ error: "Your role does not work with orders" });
  const locationIds = (await scopedLocations(db, access)).map((location) => location.id);
  const status = typeof req.query.status === "string" && req.query.status ? String(req.query.status) : "";
  const statusWhere = status === "open" ? { status: { in: OPEN_ORDER_STATUSES } }
    : status === "receivable" ? { status: { in: RECEIVABLE_ORDER_STATUSES } }
    : status && status !== "all" ? { status } : {};
  const where = canManage
    ? { propertyId: access.property.id, ...statusWhere }
    // Receivers see only orders waiting at their own shelves.
    : { propertyId: access.property.id, locationId: { in: locationIds }, status: { in: RECEIVABLE_ORDER_STATUSES } };
  const rows = await db.nrmsPurchaseOrder.findMany({
    where: { ...where, ...(Number(req.query.supplierId) ? { supplierId: Number(req.query.supplierId) } : {}) },
    include: { supplier: { select: { name: true } }, location: { select: { name: true } }, lines: { select: { quantity: true, receivedQuantity: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 80)),
  });
  res.json({ canManage, orders: rows.map(shapeOrderSummary) });
}) as RequestHandler);

const ORDER_DETAIL_INCLUDE = {
  supplier: true,
  location: { select: { name: true } },
  lines: { include: { stockItem: { select: { name: true, baseUnit: true, category: true, countStyle: true, packUnits: true } } }, orderBy: { id: "asc" as const } },
  receipts: { select: { id: true, receiptNumber: true, status: true, receivedAt: true, receivedById: true, totalCost: true, flaggedLines: true }, orderBy: { receivedAt: "asc" as const } },
  requisitionLines: { select: { id: true, stockItemId: true, requisition: { select: { id: true, requisitionNumber: true, locationId: true } } } },
};

router.get("/purchase-orders/:orderId", (async (req: AuthedRequest, res: Response) => {
  const orderId = idParam(req, "orderId");
  if (!orderId) return res.status(400).json({ error: "Invalid order" });
  const order = await db.nrmsPurchaseOrder.findUnique({ where: { id: orderId }, include: ORDER_DETAIL_INCLUDE });
  if (!order) return res.status(404).json({ error: "Order not found" });
  const allowed = await orderAccess(req, res, order);
  if (!allowed) return;
  const { access, canManage } = allowed;
  const settings = await loadStockSettings(db, order.propertyId);
  const names = await userNames([order.createdById, order.submittedById, order.approvedById, order.sentById, order.cancelledById, order.closedById, ...order.receipts.map((row: any) => row.receivedById)]);
  const name = (id: number | null) => (id ? names.get(id) ?? null : null);
  const hasPendingReceipt = order.receipts.some((row: any) => row.status === "PENDING_APPROVAL");
  const anyReceived = order.lines.some((line: any) => number(line.receivedQuantity) > 0);
  // Separation of duties (decision D6): someone who approved another person's
  // order and then received it alone is shown, never blocked.
  const separateApproval = order.approvedById && order.submittedById && order.approvedById !== order.submittedById;
  const isOwner = access.role === "OWNER";

  res.json({
    order: {
      ...shapeOrderSummary(order),
      note: order.note,
      paymentTerms: order.supplier?.paymentTerms ?? null,
      supplier: { id: order.supplier.id, name: order.supplier.name, phone: order.supplier.phone, email: order.supplier.email, contactName: order.supplier.contactName, paymentTerms: order.supplier.paymentTerms },
      createdBy: name(order.createdById),
      submittedBy: name(order.submittedById),
      submittedAt: order.submittedAt,
      approvedBy: name(order.approvedById),
      approvedAt: order.approvedAt,
      approvalNote: order.approvalNote,
      sentBy: name(order.sentById),
      cancelledBy: name(order.cancelledById),
      cancelledAt: order.cancelledAt,
      closedBy: name(order.closedById),
      closedAt: order.closedAt,
      closeReason: order.closeReason,
      supplierViewedAt: order.supplierViewedAt,
      supplierNote: order.supplierNote,
      supplierLink: canManage && order.supplierToken ? supplierOrderUrl(order.supplierToken) : null,
      lines: order.lines.map((line: any) => {
        const quantity = orderLineQuantity(line);
        return {
          id: line.id,
          stockItemId: line.stockItemId,
          stockItemName: line.stockItem?.name ?? null,
          baseUnit: line.stockItem?.baseUnit ?? null,
          category: line.stockItem?.category ?? null,
          countStyle: line.stockItem?.countStyle ?? "WHOLE",
          packUnitName: line.packUnitName,
          packCount: line.packCount == null ? null : roundQty(number(line.packCount)),
          packUnitId: line.packUnitName ? line.stockItem?.packUnits?.find((pack: any) => pack.name === line.packUnitName)?.id ?? null : null,
          quantity: roundQty(number(line.quantity)),
          quantityLabel: quantity.label,
          unitCost: roundCost(number(line.unitCost)),
          lineTotal: number(line.lineTotal),
          receivedQuantity: roundQty(number(line.receivedQuantity)),
          outstanding: roundQty(Math.max(0, number(line.quantity) - number(line.receivedQuantity))),
        };
      }),
      receipts: order.receipts.map((row: any) => ({
        id: row.id,
        receiptNumber: row.receiptNumber,
        status: row.status,
        receivedAt: row.receivedAt,
        receivedBy: name(row.receivedById),
        totalCost: number(row.totalCost),
        flaggedLines: row.flaggedLines,
        receivedByApprover: Boolean(separateApproval && row.receivedById === order.approvedById),
      })),
      requisitions: [...new Map(order.requisitionLines.map((line: any) => [line.requisition.id, { id: line.requisition.id, requisitionNumber: line.requisition.requisitionNumber }])).values()],
    },
    limits: { purchaseOrderLimit: settings.purchaseOrderLimit, overDeliveryPercent: settings.overDeliveryPercent, priceAlertPercent: settings.priceAlertPercent },
    viewer: { isOwner },
    actions: {
      edit: canManage && order.status === "DRAFT",
      submit: canManage && order.status === "DRAFT",
      submitNeedsOwner: order.status === "DRAFT" && orderNeedsOwner({ role: access.role, total: number(order.totalCost), limit: settings.purchaseOrderLimit }),
      approve: isOwner && order.status === "PENDING_APPROVAL",
      send: canManage && RECEIVABLE_ORDER_STATUSES.includes(order.status),
      receive: allowed.canReceive,
      cancel: canManage && CANCELLABLE_ORDER_STATUSES.includes(order.status) && !anyReceived && !hasPendingReceipt,
      close: canManage && order.status === "PARTIALLY_RECEIVED" && !hasPendingReceipt,
      pdf: true,
    },
  });
}) as RequestHandler);

/** Link requisition lines to an order: same property, same shelf, not yet ordered, goods on the order. */
async function claimRequisitionLines(tx: any, input: { propertyId: number; orderId: number; locationId: number; lineIds: number[]; stockItemIds: Set<number> }) {
  if (input.lineIds.length === 0) return;
  const lines = await tx.nrmsStockRequisitionLine.findMany({
    where: { id: { in: input.lineIds }, purchaseOrderId: null, requisition: { propertyId: input.propertyId, locationId: input.locationId, status: { in: OPEN_REQUISITION_STATUSES } } },
    select: { id: true, stockItemId: true, requisitionId: true },
  });
  const usable = lines.filter((line: any) => input.stockItemIds.has(line.stockItemId));
  if (usable.length === 0) return;
  await tx.nrmsStockRequisitionLine.updateMany({ where: { id: { in: usable.map((line: any) => line.id) }, purchaseOrderId: null }, data: { purchaseOrderId: input.orderId } });
  await refreshRequisitions(tx, usable.map((line: any) => line.requisitionId));
}

/** Give requisition lines back to their requests (order cancelled, or the good was taken off it). */
async function releaseRequisitionLines(tx: any, orderId: number, keepStockItemIds?: Set<number>) {
  const lines = await tx.nrmsStockRequisitionLine.findMany({ where: { purchaseOrderId: orderId }, select: { id: true, stockItemId: true, requisitionId: true } });
  const released = keepStockItemIds ? lines.filter((line: any) => !keepStockItemIds.has(line.stockItemId)) : lines;
  if (released.length === 0) return;
  await tx.nrmsStockRequisitionLine.updateMany({ where: { id: { in: released.map((line: any) => line.id) } }, data: { purchaseOrderId: null } });
  await refreshRequisitions(tx, released.map((line: any) => line.requisitionId));
}

/** POST /property/:propertyId/purchase-orders - a draft order to one supplier. */
router.post("/property/:propertyId/purchase-orders", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const access = await requireNrmsPropertyCapability(req, res, Number(req.params.propertyId), "stock.purchase.manage");
  if (!access) return;
  const parsed = orderSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the order", details: parsed.error.flatten() });
  const input = parsed.data;
  const propertyId = access.property.id;
  const supplier = await db.nrmsSupplier.findFirst({ where: { id: input.supplierId, propertyId, status: "ACTIVE" } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  const location = await locationInScope(db, access, input.locationId);
  if (!location) return res.status(404).json({ error: "Delivery location not found" });
  const built = await buildOrderLines(propertyId, input.lines);
  if ("error" in built) return res.status(400).json({ error: built.error });

  try {
    const order = await db.$transaction(async (tx: any) => {
      const created = await tx.nrmsPurchaseOrder.create({
        data: {
          propertyId,
          orderNumber: documentNumber("PO"),
          supplierId: supplier.id,
          locationId: location.id,
          expectedDate: dateOnly(input.expectedDate),
          note: input.note ? sanitizeText(input.note) : null,
          totalCost: built.total,
          createdById: req.user!.id,
          lines: { create: built.rows },
        },
      });
      await claimRequisitionLines(tx, { propertyId, orderId: created.id, locationId: location.id, lineIds: input.requisitionLineIds ?? [], stockItemIds: new Set(built.rows.map((row: any) => row.stockItemId)) });
      return created;
    }, TX_OPTIONS);
    res.status(201).json({ orderId: order.id, orderNumber: order.orderNumber });
  } catch (error) {
    console.error("[nrms.stock.purchasing] order create failed", error);
    res.status(500).json({ error: "Unable to create the order" });
  }
}) as RequestHandler);

async function loadOrderForManager(req: AuthedRequest, res: Response) {
  const orderId = idParam(req, "orderId");
  if (!orderId) { res.status(400).json({ error: "Invalid order" }); return null; }
  const order = await db.nrmsPurchaseOrder.findUnique({ where: { id: orderId }, include: { lines: true, receipts: { select: { status: true } } } });
  if (!order) { res.status(404).json({ error: "Order not found" }); return null; }
  const access = await requireNrmsPropertyCapability(req, res, order.propertyId, "stock.purchase.manage");
  if (!access) return null;
  return { order, access };
}

/** PUT /purchase-orders/:orderId - edit a draft (header and lines). */
router.put("/purchase-orders/:orderId", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadOrderForManager(req, res);
  if (!loaded) return;
  const { order, access } = loaded;
  if (order.status !== "DRAFT") return res.status(409).json({ error: "Only a draft can be edited" });
  const parsed = orderSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the order", details: parsed.error.flatten() });
  const input = parsed.data;
  const supplier = await db.nrmsSupplier.findFirst({ where: { id: input.supplierId, propertyId: order.propertyId, status: "ACTIVE" } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  const location = await locationInScope(db, access, input.locationId);
  if (!location) return res.status(404).json({ error: "Delivery location not found" });
  const built = await buildOrderLines(order.propertyId, input.lines);
  if ("error" in built) return res.status(400).json({ error: built.error });
  const keep = new Set<number>(built.rows.map((row: any) => row.stockItemId));

  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsPurchaseOrder.updateMany({
        where: { id: order.id, status: "DRAFT" },
        data: { supplierId: supplier.id, locationId: location.id, expectedDate: dateOnly(input.expectedDate), note: input.note ? sanitizeText(input.note) : null, totalCost: built.total },
      });
      if (changed.count !== 1) throw new Error("NRMS_ORDER_NOT_DRAFT");
      await tx.nrmsPurchaseOrderLine.deleteMany({ where: { orderId: order.id } });
      await tx.nrmsPurchaseOrderLine.createMany({ data: built.rows.map((row: any) => ({ ...row, orderId: order.id })) });
      // Requests stay linked only while the order still carries their good and shelf.
      if (location.id !== order.locationId) await releaseRequisitionLines(tx, order.id);
      else await releaseRequisitionLines(tx, order.id, keep);
      await claimRequisitionLines(tx, { propertyId: order.propertyId, orderId: order.id, locationId: location.id, lineIds: input.requisitionLineIds ?? [], stockItemIds: keep });
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_ORDER_NOT_DRAFT") return res.status(409).json({ error: "Only a draft can be edited" });
    console.error("[nrms.stock.purchasing] order update failed", error);
    return res.status(500).json({ error: "Unable to save the order" });
  }
  res.json({ ok: true });
}) as RequestHandler);

/**
 * POST /purchase-orders/:orderId/submit - finish the draft. The owner's
 * orders and a manager's orders within the owner's limit are approved at
 * once; a manager's order above it waits for the owner (decision D5).
 */
router.post("/purchase-orders/:orderId/submit", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadOrderForManager(req, res);
  if (!loaded) return;
  const { order, access } = loaded;
  if (order.status !== "DRAFT") return res.status(409).json({ error: "Only a draft can be submitted" });
  if (order.lines.length === 0) return res.status(400).json({ error: "Add at least one good to the order" });
  if (order.lines.some((line: any) => number(line.unitCost) <= 0)) return res.status(400).json({ error: "Enter the expected price for every good, so the delivery can be checked against it" });
  const settings = await loadStockSettings(db, order.propertyId);
  const total = number(order.totalCost);
  const waits = orderNeedsOwner({ role: access.role, total, limit: settings.purchaseOrderLimit });
  const now = new Date();
  const changed = await db.nrmsPurchaseOrder.updateMany({
    where: { id: order.id, status: "DRAFT" },
    data: waits
      ? { status: "PENDING_APPROVAL", submittedById: req.user!.id, submittedAt: now, closeReason: null }
      : { status: "APPROVED", submittedById: req.user!.id, submittedAt: now, approvedById: req.user!.id, approvedAt: now, closeReason: null },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "Only a draft can be submitted" });
  res.json({ ok: true, status: waits ? "PENDING_APPROVAL" : "APPROVED", limit: settings.purchaseOrderLimit });
}) as RequestHandler);

/** POST /purchase-orders/:orderId/approve - the owner approves a manager's order above the limit. */
router.post("/purchase-orders/:orderId/approve", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadOrderForManager(req, res);
  if (!loaded) return;
  if (loaded.access.role !== "OWNER") return res.status(403).json({ error: "Only the owner approves orders above the limit" });
  const note = typeof req.body?.note === "string" && req.body.note.trim() ? sanitizeText(req.body.note.trim().slice(0, 300)) : null;
  const changed = await db.nrmsPurchaseOrder.updateMany({
    where: { id: loaded.order.id, status: "PENDING_APPROVAL" },
    data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), approvalNote: note },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "This order is no longer waiting for approval" });
  res.json({ ok: true });
}) as RequestHandler);

/** POST /purchase-orders/:orderId/return - the owner sends it back to draft with a reason. */
router.post("/purchase-orders/:orderId/return", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadOrderForManager(req, res);
  if (!loaded) return;
  if (loaded.access.role !== "OWNER") return res.status(403).json({ error: "Only the owner can return an order" });
  const reason = reasonFrom(req.body);
  if (!reason) return res.status(400).json({ error: "Say what needs to change" });
  const changed = await db.nrmsPurchaseOrder.updateMany({
    where: { id: loaded.order.id, status: "PENDING_APPROVAL" },
    data: { status: "DRAFT", closeReason: `Returned by the owner: ${reason}`.slice(0, 300) },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "This order is no longer waiting for approval" });
  res.json({ ok: true });
}) as RequestHandler);

/**
 * POST /purchase-orders/:orderId/send - record how the order went out and
 * hand back the message and links to open (wa.me, sms:, mailto:). The first
 * send issues the supplier's no-login link; later sends reuse it.
 */
router.post("/purchase-orders/:orderId/send", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadOrderForManager(req, res);
  if (!loaded) return;
  const parsed = z.object({ channel: z.enum(SEND_CHANNELS) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Choose how to send the order" });
  const channel = parsed.data.channel;
  const { order } = loaded;
  if (!RECEIVABLE_ORDER_STATUSES.includes(order.status)) return res.status(409).json({ error: "Only an approved order can be sent" });

  const token = order.supplierToken ?? newSupplierToken();
  const now = new Date();
  await db.nrmsPurchaseOrder.updateMany({
    where: { id: order.id, status: { in: RECEIVABLE_ORDER_STATUSES } },
    data: {
      supplierToken: token,
      sentVia: channel,
      ...(order.sentAt ? {} : { sentAt: now, sentById: req.user!.id }),
      ...(order.status === "APPROVED" ? { status: "SENT" } : {}),
    },
  });
  const full = await db.nrmsPurchaseOrder.findUnique({ where: { id: order.id }, include: ORDER_DOCUMENT_INCLUDE });
  const link = supplierOrderUrl(token);
  const currency = full.property?.currency || "TZS";
  const message = supplierMessage({
    supplierName: full.supplier.contactName || full.supplier.name,
    propertyName: full.property?.title ?? "We",
    orderNumber: full.orderNumber,
    lineCount: full.lines.length,
    total: `${currency} ${Math.round(number(full.totalCost)).toLocaleString("en-US")}`,
    expectedDate: full.expectedDate ? new Date(full.expectedDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null,
    deliverTo: full.location?.name ?? "the property",
    link,
  });
  const phone = internationalPhone(full.supplier.phone);
  res.json({
    link,
    message,
    whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`,
    smsUrl: full.supplier.phone ? `sms:${full.supplier.phone}?body=${encodeURIComponent(message)}` : null,
    mailtoUrl: full.supplier.email ? `mailto:${full.supplier.email}?subject=${encodeURIComponent(`Purchase order ${full.orderNumber}`)}&body=${encodeURIComponent(message)}` : null,
    hasPhone: Boolean(phone),
    hasEmail: Boolean(full.supplier.email),
  });
}) as RequestHandler);

/** GET /purchase-orders/:orderId/pdf - the order as a document. */
router.get("/purchase-orders/:orderId/pdf", (async (req: AuthedRequest, res: Response) => {
  const orderId = idParam(req, "orderId");
  if (!orderId) return res.status(400).json({ error: "Invalid order" });
  const order = await db.nrmsPurchaseOrder.findUnique({ where: { id: orderId }, include: ORDER_DOCUMENT_INCLUDE });
  if (!order) return res.status(404).json({ error: "Order not found" });
  const allowed = await orderAccess(req, res, order);
  if (!allowed) return;
  try {
    const names = await userNames([order.approvedById]);
    const pdf = await renderPurchaseOrderPdf(order, { issuedBy: order.approvedById ? names.get(order.approvedById) ?? null : null });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${order.orderNumber}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (error) {
    console.error("[nrms.stock.purchasing] order PDF failed", error);
    res.status(500).json({ error: "Unable to build the order PDF" });
  }
}) as RequestHandler);

/** POST /purchase-orders/:orderId/cancel - nothing has arrived yet; the order is withdrawn. */
router.post("/purchase-orders/:orderId/cancel", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadOrderForManager(req, res);
  if (!loaded) return;
  const { order } = loaded;
  const reason = reasonFrom(req.body);
  if (!reason) return res.status(400).json({ error: "Give a reason for cancelling" });
  if (order.lines.some((line: any) => number(line.receivedQuantity) > 0)) return res.status(409).json({ error: "Goods have already arrived on this order. Close it short instead." });
  if (order.receipts.some((row: any) => row.status === "PENDING_APPROVAL")) return res.status(409).json({ error: "A delivery on this order is waiting for approval. Decide it first." });
  try {
    await db.$transaction(async (tx: any) => {
      const changed = await tx.nrmsPurchaseOrder.updateMany({
        where: { id: order.id, status: { in: CANCELLABLE_ORDER_STATUSES } },
        data: { status: "CANCELLED", cancelledById: req.user!.id, cancelledAt: new Date(), closeReason: reason },
      });
      if (changed.count !== 1) throw new Error("NRMS_ORDER_NOT_CANCELLABLE");
      await releaseRequisitionLines(tx, order.id);
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Error && error.message === "NRMS_ORDER_NOT_CANCELLABLE") return res.status(409).json({ error: "This order can no longer be cancelled" });
    console.error("[nrms.stock.purchasing] order cancel failed", error);
    return res.status(500).json({ error: "Unable to cancel the order" });
  }
  res.json({ ok: true });
}) as RequestHandler);

/** POST /purchase-orders/:orderId/close - the rest is not coming; close a partly delivered order. */
router.post("/purchase-orders/:orderId/close", blockImpersonated as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadOrderForManager(req, res);
  if (!loaded) return;
  const { order } = loaded;
  const reason = reasonFrom(req.body);
  if (!reason) return res.status(400).json({ error: "Say why the rest is not coming" });
  if (order.receipts.some((row: any) => row.status === "PENDING_APPROVAL")) return res.status(409).json({ error: "A delivery on this order is waiting for approval. Decide it first." });
  const changed = await db.nrmsPurchaseOrder.updateMany({
    where: { id: order.id, status: "PARTIALLY_RECEIVED" },
    data: { status: "CLOSED_SHORT", closedById: req.user!.id, closedAt: new Date(), closeReason: reason },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "Only a partly delivered order can be closed short" });
  res.json({ ok: true });
}) as RequestHandler);

export default router;
