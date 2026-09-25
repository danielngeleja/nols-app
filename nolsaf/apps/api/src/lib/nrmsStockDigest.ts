// The owner stock digest (docs/NRMS_STOCK_AND_PURCHASING.md section 7.6):
// gather the facts, then word them with the fixed templates in
// nrmsStockInsights.buildDigest. Shared by the insights page card and the
// daily or weekly worker that posts it to the owner's notifications.

import { prisma } from "@nolsaf/prisma";
import { buildDigest, type DigestLine } from "./nrmsStockInsights.js";
import { buildReorderList, payablesFor } from "./nrmsStockQueries.js";
import { loadStockSettings } from "./nrmsStockScope.js";

const db = prisma as any;

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type StockDigest = { headline: string; lines: DigestLine[]; since: Date; currency: string };

/** Everything the digest reports, for one property, since `since`. */
export async function computeStockDigest(propertyId: number, since: Date, currency = "TZS"): Promise<StockDigest> {
  const settings = await loadStockSettings(db, propertyId);
  const [locations, counts, flaggedLines, writeOffs, payables] = await Promise.all([
    db.nrmsStockLocation.findMany({ where: { propertyId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: [{ kind: "desc" }, { name: "asc" }] }),
    // The latest approved count per location in the last 30 days.
    db.nrmsStockCount.findMany({
      where: { propertyId, status: "APPROVED", approvedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { approvedAt: "desc" },
      select: { id: true, locationId: true, location: { select: { name: true } }, lines: { select: { varianceCost: true, varianceSales: true, stockItem: { select: { name: true } } } } },
    }),
    db.nrmsGoodsReceiptLine.findMany({
      where: { priceFlag: { not: "NONE" }, previousUnitCost: { gt: 0 }, receipt: { propertyId, status: "POSTED", receivedAt: { gte: since } } },
      select: { unitCost: true, previousUnitCost: true, stockItem: { select: { name: true } }, receipt: { select: { supplier: { select: { name: true } } } } },
    }),
    db.nrmsStockWriteOff.findMany({
      where: { propertyId, status: "APPROVED", createdAt: { gte: since }, value: { gt: settings.writeOffLimit } },
      orderBy: { value: "desc" },
      select: { value: true, reasonCode: true, stockItem: { select: { name: true } } },
    }),
    payablesFor(propertyId, new Date()),
  ]);

  const seenLocations = new Set<number>();
  const variances: Array<{ name: string; locationName: string; varianceSales: number; varianceCost: number }> = [];
  for (const count of counts) {
    if (seenLocations.has(count.locationId)) continue;
    seenLocations.add(count.locationId);
    for (const line of count.lines) {
      variances.push({ name: line.stockItem?.name ?? "A good", locationName: count.location?.name ?? "", varianceSales: number(line.varianceSales), varianceCost: number(line.varianceCost) });
    }
  }

  const priceJumps = flaggedLines
    .map((line: any) => ({ name: line.stockItem?.name ?? "A good", supplierName: line.receipt?.supplier?.name ?? null, changePercent: Math.round(((number(line.unitCost) - number(line.previousUnitCost)) / number(line.previousUnitCost)) * 100) }))
    .filter((row: any) => row.changePercent > 0)
    .sort((a: any, b: any) => b.changePercent - a.changePercent);

  const reorder = await buildReorderList(propertyId, locations, false);
  const lowWithoutOrder = reorder.filter((row) => row.onOrder <= 0).map((row) => ({ name: row.name, locationName: row.locationName }));

  const overdue = payables.filter((row: any) => row.overdue > 0);
  const digest = buildDigest({
    currency,
    variances,
    priceJumps,
    bigWriteOffs: writeOffs.map((row: any) => ({ name: row.stockItem?.name ?? "A good", value: number(row.value), reason: row.reasonCode })),
    lowWithoutOrder,
    overduePayables: { total: overdue.reduce((sum: number, row: any) => sum + row.overdue, 0), suppliers: overdue.length },
  });
  return { ...digest, since, currency };
}
