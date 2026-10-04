import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { getSupportContact, isShareableTrip, loadTripSnapshot, LOCAL_EMERGENCY_CONTACTS, type TripServiceKind } from "../lib/tripSafety.js";

const router = Router();
const TOKEN = /^[A-Za-z0-9_-]{32}$/;

router.get("/:token", (async (req, res) => {
  const token = String(req.params.token || "");
  if (!TOKEN.test(token)) return res.status(400).json({ ok: false, error: "Invalid trip link" });
  const share = await prisma.tripShare.findUnique({ where: { token } });
  if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) {
    return res.status(410).json({ ok: false, error: "This trip link has expired or was turned off" });
  }
  const snapshot = await loadTripSnapshot(share.serviceKind as TripServiceKind, share.serviceId);
  if (!snapshot || !isShareableTrip(snapshot)) return res.status(410).json({ ok: false, error: "This trip is no longer active" });

  const now = new Date();
  await prisma.tripShare.update({
    where: { id: share.id },
    data: { openCount: { increment: 1 }, lastOpenedAt: now, ...(share.firstOpenedAt ? {} : { firstOpenedAt: now }) },
  }).catch(() => undefined);
  const [support, traveller] = await Promise.all([
    getSupportContact(),
    prisma.user.findUnique({ where: { id: share.userId }, select: { name: true } }),
  ]);
  const firstName = String(traveller?.name || "Traveller").trim().split(/\s+/)[0] || "Traveller";
  return res.json({
    ok: true,
    trip: snapshot,
    travellerName: firstName,
    support,
    emergencyContacts: LOCAL_EMERGENCY_CONTACTS,
    expiresAt: share.expiresAt,
    privacy: "This safety link does not include payment details, identity documents, room access codes, passenger rosters, or live location.",
  });
}) as RequestHandler);

export default router;
