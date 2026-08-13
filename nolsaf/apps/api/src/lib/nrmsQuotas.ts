type Resource = "staff" | "outlets" | "menuItems" | "orderPoints" | "rooms";

const fields: Record<Resource, string> = {
  staff: "maxStaff",
  outlets: "maxOutlets",
  menuItems: "maxMenuItems",
  orderPoints: "maxOrderPoints",
  rooms: "maxRooms",
};

export async function checkNrmsQuota(db: any, propertyId: number, resource: Resource, additional = 1) {
  const account = await db.ownerPaygAccount.findUnique({ where: { propertyId }, select: { [fields[resource]]: true } });
  if (!account) return { allowed: false, reason: "NRMS account not found" };
  const where = resource === "staff" ? { propertyId, status: { in: ["ACTIVE", "PENDING"] } } : resource === "outlets" ? { propertyId, status: "ACTIVE" } : resource === "menuItems" ? { outlet: { propertyId }, status: "ACTIVE" } : resource === "orderPoints" ? { propertyId, active: true } : { propertyId, status: "ACTIVE" };
  const model = resource === "staff" ? db.nrmsStaffMembership : resource === "outlets" ? db.nrmsOutlet : resource === "menuItems" ? db.nrmsMenuItem : resource === "orderPoints" ? db.nrmsOrderPoint : db.roomUnit;
  const current = await model.count({ where });
  const limit = Number(account[fields[resource]]);
  return { allowed: current + additional <= limit, current, limit, resource };
}
