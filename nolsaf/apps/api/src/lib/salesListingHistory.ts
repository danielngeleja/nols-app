// When a property first went live on the NoLSAF marketplace.
//
// A partner earns Marketplace commission only for a property they brought. A
// property that was already approved and public before the partner registered
// the lead was visible to anyone, so copying it into a lead proves nothing.
//
// There is no single "first approved" column: PropertyVerification.verifiedAt
// is reset on suspend and unsuspend, and audit rows can expire. So the earliest
// of every trace wins, and a property that is live with no trace at all counts
// as live since it was created (legacy approvals).

export type MarketplaceListingCheck = "OK" | "NOT_LISTED" | "LISTED_BEFORE_CLAIM";

const LIVE_STATUSES = ["APPROVED", "SUSPENDED"];

/** Whether a Marketplace claim may stand, given when the partner registered the lead. */
export function marketplaceListingCheck(input: { listedAt: Date | null; claimedAt: Date }): MarketplaceListingCheck {
  if (!input.listedAt) return "NOT_LISTED";
  if (input.listedAt.getTime() < input.claimedAt.getTime()) return "LISTED_BEFORE_CLAIM";
  return "OK";
}

function earliest(...dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const date of dates) {
    if (!date) continue;
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) continue;
    if (!best || value.getTime() < best.getTime()) best = value;
  }
  return best;
}

/** First-listed moment for each property id (null = never live). */
export async function loadPropertiesListedAt(db: any, propertyIds: number[]): Promise<Map<number, Date | null>> {
  const ids = [...new Set(propertyIds.filter((id) => Number.isInteger(id) && id > 0))];
  const out = new Map<number, Date | null>();
  if (!ids.length) return out;

  const [properties, verifications, approvals, bookings] = await Promise.all([
    db.property.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, createdAt: true } }),
    db.propertyVerification.findMany({
      where: { propertyId: { in: ids }, verifiedAt: { not: null } },
      select: { propertyId: true, verifiedAt: true },
    }),
    db.auditLog.groupBy({
      by: ["entityId"],
      where: { entity: "PROPERTY", action: "PROPERTY_APPROVE", entityId: { in: ids } },
      _min: { createdAt: true },
    }),
    db.booking.groupBy({
      by: ["propertyId"],
      where: { propertyId: { in: ids } },
      _min: { createdAt: true },
    }),
  ]);

  const verifiedBy = new Map<number, Date>(verifications.map((row: any) => [row.propertyId, row.verifiedAt]));
  const approvedBy = new Map<number, Date>(approvals.map((row: any) => [row.entityId, row._min?.createdAt]));
  const bookedBy = new Map<number, Date>(bookings.map((row: any) => [row.propertyId, row._min?.createdAt]));

  for (const property of properties) {
    const traced = earliest(verifiedBy.get(property.id), approvedBy.get(property.id), bookedBy.get(property.id));
    const live = LIVE_STATUSES.includes(String(property.status));
    out.set(property.id, traced ?? (live ? property.createdAt : null));
  }
  return out;
}

export async function loadPropertyListedAt(db: any, propertyId: number): Promise<Date | null> {
  return (await loadPropertiesListedAt(db, [propertyId])).get(propertyId) ?? null;
}
