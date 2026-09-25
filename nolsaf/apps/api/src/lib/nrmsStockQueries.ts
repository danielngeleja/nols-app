// Stock queries shared by the purchasing, payables and insight routes and the
// owner digest worker (docs/NRMS_STOCK_AND_PURCHASING.md, milestones 4 to 6).

import { prisma } from "@nolsaf/prisma";
import { roundCost, roundMoney, roundQty } from "./nrmsInventory.js";
import { ageDebts, dueDateFor } from "./nrmsPayables.js";
import { OPEN_ORDER_STATUSES, suggestReorder } from "./nrmsPurchasing.js";

const db = prisma as any;
const OPEN_REQUISITION_STATUSES = ["OPEN", "PARTLY_ORDERED"];

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ================================================================== reorder list

export type ReorderRow = {
  locationId: number;
  locationName: string;
  stockItemId: number;
  name: string;
  category: string;
  baseUnit: string;
  countStyle: string;
  onHand: number;
  parLevel: number | null;
  reorderPoint: number | null;
  onOrder: number;
  requested: number;
  suggestedQuantity: number;
  suggestedPackUnitId: number | null;
  suggestedPackName: string | null;
  suggestedPackCount: number | null;
  supplierId: number | null;
  supplierName: string | null;
  unitCost: number | null;
};

/**
 * Every good at or below its reorder point on the given shelves, with what is
 * already on order, what staff have asked for, and a suggested quantity in
 * whole packs. The usual supplier is whoever delivered it last.
 */
export async function buildReorderList(propertyId: number, locations: Array<{ id: number; name: string }>, withPrices: boolean): Promise<ReorderRow[]> {
  const locationIds = locations.map((location) => location.id);
  if (locationIds.length === 0) return [];
  const balances = await db.nrmsStockBalance.findMany({
    where: { locationId: { in: locationIds }, reorderPoint: { not: null }, stockItem: { propertyId, status: "ACTIVE" } },
    include: { stockItem: { include: { packUnits: true } } },
  });
  const low = balances.filter((row: any) => number(row.quantity) <= number(row.reorderPoint));
  if (low.length === 0) return [];
  const itemIds = [...new Set<number>(low.map((row: any) => row.stockItemId))];

  const [orderLines, requestLines, recentLines] = await Promise.all([
    db.nrmsPurchaseOrderLine.findMany({
      where: { stockItemId: { in: itemIds }, order: { propertyId, status: { in: OPEN_ORDER_STATUSES }, locationId: { in: locationIds } } },
      select: { stockItemId: true, quantity: true, receivedQuantity: true, order: { select: { locationId: true } } },
    }),
    db.nrmsStockRequisitionLine.findMany({
      where: { stockItemId: { in: itemIds }, purchaseOrderId: null, requisition: { propertyId, status: { in: OPEN_REQUISITION_STATUSES }, locationId: { in: locationIds } } },
      select: { stockItemId: true, quantity: true, requisition: { select: { locationId: true } } },
    }),
    db.nrmsGoodsReceiptLine.findMany({
      where: { stockItemId: { in: itemIds }, quantity: { gt: 0 }, receipt: { propertyId, status: "POSTED" } },
      orderBy: { id: "desc" },
      take: Math.min(2000, itemIds.length * 6),
      select: { stockItemId: true, packUnitName: true, receipt: { select: { supplierId: true } } },
    }),
  ]);

  const key = (locationId: number, itemId: number) => `${locationId}:${itemId}`;
  const onOrder = new Map<string, number>();
  for (const line of orderLines) {
    const k = key(line.order.locationId, line.stockItemId);
    onOrder.set(k, (onOrder.get(k) ?? 0) + Math.max(0, number(line.quantity) - number(line.receivedQuantity)));
  }
  const requested = new Map<string, number>();
  for (const line of requestLines) {
    const k = key(line.requisition.locationId, line.stockItemId);
    requested.set(k, (requested.get(k) ?? 0) + number(line.quantity));
  }
  const preferredPack = new Map<number, string>();
  const usualSupplier = new Map<number, number>();
  for (const line of recentLines) {
    if (line.packUnitName && !preferredPack.has(line.stockItemId)) preferredPack.set(line.stockItemId, line.packUnitName);
    if (line.receipt?.supplierId && !usualSupplier.has(line.stockItemId)) usualSupplier.set(line.stockItemId, line.receipt.supplierId);
  }

  const supplierIds = [...new Set(usualSupplier.values())];
  const [suppliers, prices] = await Promise.all([
    supplierIds.length ? db.nrmsSupplier.findMany({ where: { id: { in: supplierIds }, propertyId, status: "ACTIVE" }, select: { id: true, name: true } }) : [],
    withPrices && supplierIds.length ? db.nrmsSupplierPrice.findMany({ where: { supplierId: { in: supplierIds }, stockItemId: { in: itemIds } } }) : [],
  ]);
  const supplierName = new Map<number, string>(suppliers.map((row: any) => [row.id, row.name]));
  const priceOf = new Map<string, any>(prices.map((row: any) => [`${row.supplierId}:${row.stockItemId}`, row]));
  const locationName = new Map(locations.map((location) => [location.id, location.name]));

  const rows: ReorderRow[] = low.map((balance: any) => {
    const good = balance.stockItem;
    const k = key(balance.locationId, good.id);
    const packs = good.packUnits.map((pack: any) => ({ id: pack.id, name: pack.name, baseQuantity: number(pack.baseQuantity) }));
    const suggestion = suggestReorder({
      onHand: number(balance.quantity),
      parLevel: balance.parLevel == null ? null : number(balance.parLevel),
      reorderPoint: balance.reorderPoint == null ? null : number(balance.reorderPoint),
      onOrder: onOrder.get(k) ?? 0,
      packs,
      preferredPackName: preferredPack.get(good.id) ?? null,
      countStyle: good.countStyle,
    });
    const candidate = usualSupplier.get(good.id);
    const supplierId = candidate && supplierName.has(candidate) ? candidate : null;
    const price = supplierId ? priceOf.get(`${supplierId}:${good.id}`) : null;
    const unitCost = !withPrices ? null
      : price?.agreedUnitCost != null ? roundCost(number(price.agreedUnitCost))
      : price?.lastUnitCost != null ? roundCost(number(price.lastUnitCost))
      : number(good.averageCost) > 0 ? roundCost(number(good.averageCost)) : null;
    const pack = suggestion.pack ? packs.find((row: any) => row.name === suggestion.pack!.name) : null;
    return {
      locationId: balance.locationId,
      locationName: locationName.get(balance.locationId) ?? "",
      stockItemId: good.id,
      name: good.name,
      category: good.category,
      baseUnit: good.baseUnit,
      countStyle: good.countStyle,
      onHand: roundQty(number(balance.quantity)),
      parLevel: balance.parLevel == null ? null : roundQty(number(balance.parLevel)),
      reorderPoint: balance.reorderPoint == null ? null : roundQty(number(balance.reorderPoint)),
      onOrder: roundQty(onOrder.get(k) ?? 0),
      requested: roundQty(requested.get(k) ?? 0),
      suggestedQuantity: suggestion.quantity,
      suggestedPackUnitId: pack?.id ?? null,
      suggestedPackName: suggestion.pack?.name ?? null,
      suggestedPackCount: suggestion.packCount,
      supplierId: withPrices ? supplierId : null,
      supplierName: withPrices && supplierId ? supplierName.get(supplierId) ?? null : null,
      unitCost,
    };
  });
  const order = new Map(locations.map((location, index) => [location.id, index]));
  return rows.sort((a, b) => (order.get(a.locationId)! - order.get(b.locationId)!) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

// ====================================================================== payables

/** The day a delivery became a debt: when it entered stock. */
export function postedAt(receipt: any): Date {
  return new Date(receipt.decidedAt ?? receipt.receivedAt);
}

/** Due date of a delivery on credit: the invoice's, else the supplier's terms. */
export function debtDue(receipt: any, paymentTerms: string): Date {
  if (receipt.invoice?.dueDate && !receipt.invoice.voidedAt) return new Date(receipt.invoice.dueDate);
  return dueDateFor(postedAt(receipt), paymentTerms);
}

export const DEBT_SELECT = {
  id: true, supplierId: true, receiptNumber: true, totalCost: true, receivedAt: true, decidedAt: true, supplierInvoiceId: true,
  invoice: { select: { dueDate: true, voidedAt: true } },
};

/** Balances and ageing for every supplier of the property, from one pass over the data. */
export async function payablesFor(propertyId: number, asOf: Date) {
  const [suppliers, debts, payments, flagged] = await Promise.all([
    db.nrmsSupplier.findMany({ where: { propertyId }, select: { id: true, name: true, phone: true, paymentTerms: true, status: true } }),
    db.nrmsGoodsReceipt.findMany({ where: { propertyId, status: "POSTED", paymentMode: "CREDIT", supplierId: { not: null } }, select: DEBT_SELECT }),
    db.nrmsSupplierPayment.groupBy({ by: ["supplierId"], where: { propertyId, voidedAt: null }, _sum: { amount: true }, _max: { paidAt: true } }),
    db.nrmsSupplierInvoice.groupBy({ by: ["supplierId"], where: { propertyId, voidedAt: null, matchStatus: "BILLED_MORE" }, _count: { _all: true } }),
  ]);
  const paidBy = new Map<number, { total: number; last: Date | null }>(payments.map((row: any) => [row.supplierId, { total: number(row._sum?.amount), last: row._max?.paidAt ?? null }]));
  const flaggedBy = new Map<number, number>(flagged.map((row: any) => [row.supplierId, Number(row._count?._all ?? 0)]));
  const rows = suppliers.map((supplier: any) => {
    const own = debts.filter((row: any) => row.supplierId === supplier.id);
    const paid = paidBy.get(supplier.id);
    const aged = ageDebts(own.map((row: any) => ({ id: row.id, amount: number(row.totalCost), dueDate: debtDue(row, supplier.paymentTerms) })), paid?.total ?? 0, asOf);
    const owedTotal = roundMoney(own.reduce((sum: number, row: any) => sum + number(row.totalCost), 0));
    return {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      status: supplier.status,
      paymentTerms: supplier.paymentTerms,
      creditDeliveries: own.length,
      creditValue: owedTotal,
      paid: roundMoney(paid?.total ?? 0),
      lastPaidAt: paid?.last ?? null,
      outstanding: aged.outstanding,
      credit: aged.credit,
      buckets: aged.buckets,
      overdue: roundMoney(aged.buckets.DAYS_1_30 + aged.buckets.DAYS_31_60 + aged.buckets.DAYS_OVER_60),
      oldestDue: aged.open[0]?.dueDate ?? null,
      uninvoiced: own.filter((row: any) => !row.supplierInvoiceId || row.invoice?.voidedAt).length,
      flaggedInvoices: flaggedBy.get(supplier.id) ?? 0,
    };
  });
  return rows.filter((row: any) => row.creditDeliveries > 0 || row.paid > 0 || row.flaggedInvoices > 0);
}
