// Which stock locations a caller may see and act on, plus the per-property
// stock settings. Shared by the stock catalogue router and the purchasing,
// transfer and write-off router (docs/NRMS_STOCK_AND_PURCHASING.md).
//
// Locations are the outlets that hold stock and, when the owner switches it
// on, one main store. Owner, manager and storekeeper see all of them; outlet
// staff see only the outlets they serve, never the store.

import type { NrmsPropertyAccess } from "./nrmsPropertyAccess.js";

type Db = any;

export const PROPERTY_WIDE_STOCK_ROLES = new Set(["OWNER", "MANAGER", "STOREKEEPER"]);

export type StockSettings = {
  storeEnabled: boolean;
  directPurchaseLimit: number;
  writeOffLimit: number;
  priceAlertPercent: number;
  purchaseOrderLimit: number;
  overDeliveryPercent: number;
};

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  storeEnabled: false,
  directPurchaseLimit: 200000,
  writeOffLimit: 20000,
  priceAlertPercent: 10,
  purchaseOrderLimit: 500000,
  overDeliveryPercent: 5,
};

export type ScopedLocation = {
  id: number;
  kind: "STORE" | "OUTLET";
  name: string;
  outletId: number | null;
  outletType: string | null;
};

export function outletInScope(access: NrmsPropertyAccess, outlet: { id: number; type: string }): boolean {
  if (PROPERTY_WIDE_STOCK_ROLES.has(access.role)) return true;
  if (access.outletId != null) return access.outletId === outlet.id;
  if (access.role === "BAR") return outlet.type === "BAR";
  if (access.role === "RESTAURANT") return outlet.type === "RESTAURANT";
  return access.role === "OUTLET_SUPERVISOR";
}

export async function loadStockSettings(db: Db, propertyId: number): Promise<StockSettings> {
  const row = await db.nrmsStockSettings.findUnique({ where: { propertyId } });
  if (!row) return { ...DEFAULT_STOCK_SETTINGS };
  return {
    storeEnabled: Boolean(row.storeEnabled),
    directPurchaseLimit: Number(row.directPurchaseLimit),
    writeOffLimit: Number(row.writeOffLimit),
    priceAlertPercent: Number(row.priceAlertPercent),
    purchaseOrderLimit: row.purchaseOrderLimit == null ? DEFAULT_STOCK_SETTINGS.purchaseOrderLimit : Number(row.purchaseOrderLimit),
    overDeliveryPercent: row.overDeliveryPercent == null ? DEFAULT_STOCK_SETTINGS.overDeliveryPercent : Number(row.overDeliveryPercent),
  };
}

/**
 * The locations this caller may work with, store first. Outlet locations are
 * created here if missing, so every screen can key on location ids from the
 * first visit (the row is a pure container; creating it moves no stock).
 */
export async function scopedLocations(db: Db, access: NrmsPropertyAccess, settings?: StockSettings): Promise<ScopedLocation[]> {
  const propertyId = access.property.id;
  const resolvedSettings = settings ?? await loadStockSettings(db, propertyId);
  const outlets = (await db.nrmsOutlet.findMany({
    where: { propertyId, status: "ACTIVE" },
    select: { id: true, name: true, type: true, stockLocation: { select: { id: true, name: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  })).filter((outlet: any) => outletInScope(access, outlet));

  const result: ScopedLocation[] = [];
  if (resolvedSettings.storeEnabled && PROPERTY_WIDE_STOCK_ROLES.has(access.role)) {
    const store = await db.nrmsStockLocation.findFirst({ where: { propertyId, kind: "STORE", status: "ACTIVE" }, orderBy: { id: "asc" } });
    if (store) result.push({ id: store.id, kind: "STORE", name: store.name, outletId: null, outletType: null });
  }
  for (const outlet of outlets) {
    let locationId = outlet.stockLocation?.id as number | undefined;
    if (!locationId) {
      try {
        locationId = (await db.nrmsStockLocation.create({ data: { propertyId, kind: "OUTLET", outletId: outlet.id, name: outlet.name } })).id;
      } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        locationId = (await db.nrmsStockLocation.findUnique({ where: { outletId: outlet.id } }))?.id;
      }
    }
    if (locationId) result.push({ id: locationId, kind: "OUTLET", name: outlet.name, outletId: outlet.id, outletType: outlet.type });
  }
  return result;
}

/** One location by id, only if the caller may act on it. */
export async function locationInScope(db: Db, access: NrmsPropertyAccess, locationId: number): Promise<ScopedLocation | null> {
  const locations = await scopedLocations(db, access);
  return locations.find((location) => location.id === locationId) ?? null;
}
