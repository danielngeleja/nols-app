import { randomBytes } from "crypto";
import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { getSupportContact, isShareableTrip, loadTripSnapshot, LOCAL_EMERGENCY_CONTACTS, tripShareExpiry, TRIP_SERVICE_KINDS } from "../lib/tripSafety.js";

const router = Router();
router.use(requireAuth as RequestHandler);

const createSchema = z.object({
  serviceKind: z.enum(TRIP_SERVICE_KINDS),
  serviceId: z.number().int().positive(),
});

function webOrigin(): string {
  return String(process.env.WEB_ORIGIN || process.env.FRONTEND_URL || process.env.APP_ORIGIN || "https://nolsaf.com").replace(/\/$/, "");
}

router.get("/", (async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const now = new Date();
  const [support, stays, tours, groups, rides] = await Promise.all([
    getSupportContact(),
    prisma.booking.findMany({ where: { userId, status: { in: ["CONFIRMED", "CHECKED_IN"] }, checkOut: { gte: now } }, select: { id: true } }),
    prisma.tourBooking.findMany({ where: { customerId: userId, status: { in: ["PAID", "CONFIRMED", "IN_PROGRESS"] }, OR: [{ endDate: null }, { endDate: { gte: now } }] }, select: { id: true } }),
    prisma.groupBooking.findMany({ where: { userId, status: { in: ["AWAITING_DEPOSIT", "CONFIRMED", "PROCESSING"] }, OR: [{ checkOut: null }, { checkOut: { gte: now } }] }, select: { id: true } }),
    prisma.transportBooking.findMany({ where: { userId, status: { in: ["PENDING", "CONFIRMED", "ASSIGNED", "IN_PROGRESS"] }, scheduledDate: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }, select: { id: true } }),
  ]);

  const requested = [
    ...stays.map((row) => ["STAY", row.id] as const),
    ...tours.map((row) => ["TOUR", row.id] as const),
    ...groups.map((row) => ["GROUP_STAY", row.id] as const),
    ...rides.map((row) => ["RIDE", row.id] as const),
  ];
  const snapshots = (await Promise.all(requested.map(([kind, id]) => loadTripSnapshot(kind, id, userId))))
    .filter((item) => item && isShareableTrip(item));

  const activeShares = await prisma.tripShare.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { token: true, serviceKind: true, serviceId: true, expiresAt: true },
  });
  const shareByTrip = new Map<string, (typeof activeShares)[number]>(
    activeShares.map((share) => [`${share.serviceKind}:${share.serviceId}`, share] as [string, (typeof activeShares)[number]])
  );
  const trips = snapshots.map((snapshot) => {
    const share = shareByTrip.get(`${snapshot!.serviceKind}:${snapshot!.serviceId}`);
    return {
      ...snapshot!,
      activeShare: share ? { token: share.token, expiresAt: share.expiresAt, url: `${webOrigin()}/share/trip/${share.token}` } : null,
    };
  });

  return res.json({ support, emergencyContacts: LOCAL_EMERGENCY_CONTACTS, trips });
}) as RequestHandler);

router.post("/shares", (async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Choose a valid active trip" });
  const snapshot = await loadTripSnapshot(parsed.data.serviceKind, parsed.data.serviceId, req.user!.id);
  if (!snapshot) return res.status(404).json({ ok: false, error: "Trip not found" });
  if (!isShareableTrip(snapshot)) return res.status(409).json({ ok: false, error: "Only active or upcoming trips can be shared" });

  const existing = await prisma.tripShare.findFirst({
    where: { userId: req.user!.id, serviceKind: snapshot.serviceKind, serviceId: snapshot.serviceId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return res.json({ ok: true, reused: true, token: existing.token, expiresAt: existing.expiresAt, url: `${webOrigin()}/share/trip/${existing.token}` });

  const token = randomBytes(24).toString("base64url");
  const expiresAt = tripShareExpiry(snapshot);
  await prisma.tripShare.create({
    data: { token, userId: req.user!.id, serviceKind: snapshot.serviceKind, serviceId: snapshot.serviceId, expiresAt },
  });
  return res.status(201).json({ ok: true, token, expiresAt, url: `${webOrigin()}/share/trip/${token}` });
}) as RequestHandler);

router.delete("/shares/:token", (async (req: AuthedRequest, res) => {
  const token = String(req.params.token || "");
  const result = await prisma.tripShare.updateMany({ where: { token, userId: req.user!.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!result.count) return res.status(404).json({ ok: false, error: "Active share link not found" });
  return res.json({ ok: true });
}) as RequestHandler);

export default router;
