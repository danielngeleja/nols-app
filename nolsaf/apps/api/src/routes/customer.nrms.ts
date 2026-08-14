import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { buildStayOrderingToken } from "../lib/nrmsStayToken.js";

const router = Router();
const db = prisma as any;

router.use(requireAuth as RequestHandler);

/**
 * GET /api/customer/nrms/room-ordering
 *
 * The signed-in guest's outlet-ordering entitlement for their current stay
 * (NRMS_QR_ORDERING.md m7). Returns a per-stay token, never the printed room
 * QR token, so nothing the app holds outlives the stay.
 *
 * Deliberately resolved on every call rather than handed out once: the app
 * stores nothing, and checkout takes ordering away by itself because this stops
 * returning a stay. Only `source = "NOLSAF"` reservations can be matched, since
 * walk-in and OTA guests have no NoLSAF account; they keep the printed QR.
 * `propertyId` scopes the lookup so accounts with simultaneous stays get the
 * entitlement for the property they are currently viewing.
 */
router.get("/room-ordering", (async (req, res) => {
  const userId = (req as AuthedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const rawPropertyId = Array.isArray(req.query.propertyId) ? req.query.propertyId[0] : req.query.propertyId;
  const requestedPropertyId = rawPropertyId == null || rawPropertyId === "" ? null : Number(rawPropertyId);
  if (requestedPropertyId != null && (!Number.isSafeInteger(requestedPropertyId) || requestedPropertyId <= 0)) {
    return res.status(400).json({ error: "Choose a valid property" });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const systemSetting = await db.systemSetting.findUnique({
      where: { id: 1 },
      select: { nrmsQrOrderingEnabled: true },
    });
    if (systemSetting?.nrmsQrOrderingEnabled === false) return res.json({ stay: null });

    const reservation = await db.reservation.findFirst({
      where: {
        status: "CHECKED_IN",
        source: "NOLSAF",
        booking: { userId },
        ...(requestedPropertyId ? { propertyId: requestedPropertyId } : {}),
        property: { nrmsActivatedAt: { not: null }, nrmsQrOrderingFrozenAt: null },
      },
      select: {
        id: true,
        propertyId: true,
        property: { select: { title: true } },
        allocations: {
          where: { status: "ACTIVE", roomUnitId: { not: null } },
          select: { roomUnitId: true, roomUnit: { select: { code: true } } },
          orderBy: { id: "asc" },
        },
      },
      orderBy: { id: "desc" },
    });
    if (!reservation) return res.json({ stay: null });

    const roomUnitIds = reservation.allocations
      .map((allocation: { roomUnitId: number | null }) => allocation.roomUnitId)
      .filter((id: number | null): id is number => id != null);
    if (!roomUnitIds.length) return res.json({ stay: null });

    // The stay token resolves through this same point, so if the room has no
    // active ordering QR there is nothing to offer: same rule the welcome SMS
    // applies when it skips with NO_ACTIVE_ROOM_QR.
    const point = await db.nrmsOrderPoint.findFirst({
      where: {
        propertyId: reservation.propertyId,
        type: "ROOM",
        roomUnitId: { in: roomUnitIds },
        active: true,
        orderingEnabled: true,
      },
      select: { id: true, roomUnitId: true },
      orderBy: { id: "asc" },
    });
    if (!point) return res.json({ stay: null });

    const outletCount = await db.nrmsOutlet.count({
      where: { propertyId: reservation.propertyId, status: "ACTIVE" },
    });
    if (!outletCount) return res.json({ stay: null });

    const roomCode =
      reservation.allocations.find(
        (allocation: { roomUnitId: number | null }) => allocation.roomUnitId === point.roomUnitId
      )?.roomUnit?.code || reservation.allocations[0]?.roomUnit?.code || "";

    return res.json({
      stay: {
        token: buildStayOrderingToken(reservation.id),
        roomLabel: roomCode ? `Room ${roomCode}` : "your room",
        propertyId: reservation.propertyId,
        propertyTitle: reservation.property?.title || "",
      },
    });
  } catch (err: any) {
    console.error("customer.nrms.roomOrdering failed", err);
    // Ordering is an extra, never a blocker on the property screen.
    return res.json({ stay: null });
  }
}) as RequestHandler);

export default router;
