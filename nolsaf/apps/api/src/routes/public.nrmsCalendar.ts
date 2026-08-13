// apps/api/src/routes/public.nrmsCalendar.ts
//
// The calendar NRMS publishes for an OTA to poll. Airbnb, Booking.com and
// Vrbo all consume the same thing: an unauthenticated .ics URL holding a
// secret in its path.
//
// The token is a bearer credential, so it is looked up by fingerprint rather
// than by decrypting every feed row, and the response carries no guest data:
// a busy period is two dates and the words "Not available".
import crypto from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { limitPublicNrmsCalendarCapability } from "../middleware/rateLimit.js";
import { buildIcalDocument, getRoomTypeBusyPeriods } from "../lib/channels/icalExport.js";

export const router = Router();
const db = prisma as any;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,80}$/;

export function calendarTokenFingerprint(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * GET /:token.ics
 *
 * Providers poll this on their own schedule and some of them cache
 * aggressively, so the response says explicitly that it must not be stored.
 */
const capabilityHeaders: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
};

const validateCalendarToken: RequestHandler = (req, res, next) => {
  const token = String(req.params.token || "");
  if (!TOKEN_PATTERN.test(token)) return res.status(404).json({ error: "Calendar not found" });
  next();
};

router.get("/:token.ics", capabilityHeaders, validateCalendarToken, limitPublicNrmsCalendarCapability as RequestHandler, (async (req: Request, res: Response) => {
  const token = String(req.params.token || "");

  const feed = await db.channelCalendarFeed.findFirst({
    where: { direction: "EXPORT", status: "ACTIVE", urlFingerprint: calendarTokenFingerprint(token) },
    include: {
      roomType: { select: { id: true, name: true, propertyId: true } },
      connection: { select: { propertyId: true, status: true, property: { select: { title: true, status: true } } } },
    },
  });
  if (!feed || !feed.roomType) return res.status(404).json({ error: "Calendar not found" });
  // NRMS rides on an approved Marketplace listing, so a property that has left
  // the Marketplace stops publishing too.
  if (feed.connection.property.status !== "APPROVED" || feed.connection.status === "DISCONNECTED") {
    return res.status(410).json({ error: "This calendar is no longer published" });
  }

  const periods = await getRoomTypeBusyPeriods(db, feed.connection.propertyId, feed.roomType.id, new Date(), {
    buffer: Number(feed.exportBuffer ?? 0),
  });
  const document = buildIcalDocument({
    calendarName: `${feed.connection.property.title} - ${feed.roomType.name}`,
    roomTypeId: feed.roomType.id,
    periods,
  });

  await db.channelCalendarFeed.update({
    where: { id: feed.id },
    data: { lastPolledAt: new Date(), lastSuccessAt: new Date(), lastError: null },
  }).catch(() => {
    // Recording that a provider called is useful, not essential. Never fail
    // the calendar because the bookkeeping write did.
  });

  res.type("text/calendar; charset=utf-8");
  res.set("Content-Disposition", `inline; filename="nolsaf-${feed.roomType.id}.ics"`);
  return res.send(document);
}) as RequestHandler);

export default router;
