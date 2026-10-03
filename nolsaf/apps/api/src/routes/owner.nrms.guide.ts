// NRMS guide: the live state behind the in-app guide page. Read-only counts of
// what a property has set up, plus today's front-desk position, so the guide
// can say "3 of 7 setup steps done" and "4 arrivals today" instead of reciting
// static copy. Any NRMS role may read it; owner-only numbers are left out for
// staff roles rather than refused, so the page still works for everyone.
import { Router, type RequestHandler, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth } from "../middleware/auth.js";
import { loadNrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";
import { NRMS_STAFF_ROLES } from "../lib/nrmsStaffRoles.js";

const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
const ZONE = "Africa/Dar_es_Salaam";

function todayRange(): { start: Date; end: Date } {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = new Date(`${key}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

router.get("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  const access = await loadNrmsPropertyAccess(req, res, Number(req.params.propertyId), ["OWNER", ...NRMS_STAFF_ROLES]);
  if (!access) return;
  const propertyId = access.property.id;
  const managerView = access.role === "OWNER" || access.role === "MANAGER";
  const today = todayRange();
  try {
    const [
      roomTypes, roomUnits, activeStaff, pendingInvites, outlets, menuItems, orderPoints,
      reservations, closedBusinessDays, fiscal, arrivalsToday, departuresToday, inHouse,
    ] = await Promise.all([
      db.roomType.count({ where: { propertyId, status: "ACTIVE" } }),
      db.roomUnit.count({ where: { propertyId, status: "ACTIVE" } }),
      db.nrmsStaffMembership.count({ where: { propertyId, status: "ACTIVE" } }),
      db.nrmsStaffMembership.count({ where: { propertyId, status: "PENDING" } }),
      db.nrmsOutlet.count({ where: { propertyId, status: "ACTIVE" } }),
      db.nrmsMenuItem.count({ where: { status: "ACTIVE", outlet: { propertyId } } }),
      db.nrmsOrderPoint.count({ where: { propertyId, active: true } }),
      db.reservation.count({ where: { propertyId } }),
      db.nrmsBusinessDay.count({ where: { propertyId, status: "CLOSED" } }),
      db.nrmsFiscalConnection.findUnique({ where: { propertyId }, select: { mode: true, status: true } }),
      db.reservation.count({ where: { propertyId, status: { in: ["CONFIRMED", "CHECKED_IN"] }, checkIn: { gte: today.start, lt: today.end } } }),
      db.reservation.count({ where: { propertyId, status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, checkOut: { gte: today.start, lt: today.end } } }),
      db.reservation.count({ where: { propertyId, status: "CHECKED_IN" } }),
    ]);
    res.json({
      property: {
        id: propertyId,
        title: access.property.title,
        currency: access.property.currency,
        nightAuditCloseTime: access.property.nrmsNightAuditCloseTime,
        menuPublic: access.property.nrmsMenuPublic,
      },
      role: access.role,
      setup: {
        roomTypes,
        roomUnits,
        activeStaff: managerView ? activeStaff : null,
        pendingInvites: managerView ? pendingInvites : null,
        outlets,
        menuItems,
        orderPoints,
        reservations,
        closedBusinessDays,
        fiscalMode: managerView ? fiscal?.mode ?? "OFF" : null,
      },
      today: { arrivals: arrivalsToday, departures: departuresToday, inHouse },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[owner.nrms.guide] guide state failed", error);
    res.status(500).json({ error: "Could not load the guide's live status" });
  }
}) as RequestHandler);

export default router;
