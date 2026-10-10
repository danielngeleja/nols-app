import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth } from "../middleware/auth.js";
import { customerBookingReference } from "../lib/customerBookingReference.js";
import { sanitizeText } from "../lib/sanitize.js";
import { EMPTY_KARIBU_PREFERENCES, isMissingTable, karibuPreferenceColumns, karibuPreferencesInput, preferenceStore, shapeKaribuPreferences } from "../lib/karibuPreferences.js";

const router = Router();
const db = prisma as any;
router.use(requireAuth as RequestHandler);

const DAY_MS = 86_400_000;
const nightsOf = (checkIn: Date | string, checkOut: Date | string) => Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / DAY_MS));
/** Stays read for the story totals; enough for any real traveller, bounded for safety. */
const STORY_STAYS = 300;

/** Only actual stays and issued gestures are visible. Eligibility and budgets stay private. */
router.get("/", (async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const [completedStayCount, firstStay, stays, upcoming, gestures] = await Promise.all([
    db.booking.count({ where: { userId, status: "CHECKED_OUT" } }),
    db.booking.findFirst({ where: { userId, status: "CHECKED_OUT" }, orderBy: { checkOut: "asc" },
      select: { id: true, checkOut: true, property: { select: { title: true } } } }),
    db.booking.findMany({ where: { userId, status: "CHECKED_OUT" }, orderBy: { checkOut: "desc" }, take: STORY_STAYS,
      select: { id: true, checkIn: true, checkOut: true, propertyId: true, property: { select: { title: true, city: true, district: true, regionName: true } } } }),
    db.booking.findFirst({ where: { userId, status: { in: ["CONFIRMED", "CHECKED_IN"] }, checkOut: { gte: new Date() } }, orderBy: { checkIn: "asc" },
      select: { id: true, status: true, checkIn: true, checkOut: true, property: { select: { title: true, city: true } } } }),
    db.karibuGesture.findMany({ where: { userId, status: { in: ["ORDERED", "SERVED"] } }, orderBy: { issuedAt: "desc" }, take: 20,
      select: { id: true, bookingId: true, status: true, issuedAt: true, servedAt: true,
        guestConfirmedReceived: true, guestFeedbackRating: true, guestFeedbackNote: true, guestFeedbackAt: true,
        order: { select: { items: { select: { nameSnapshot: true }, take: 1 } } } } }),
  ]);
  const bookingIds = gestures.map((gesture: any) => gesture.bookingId);
  const bookings = bookingIds.length ? await db.booking.findMany({ where: { id: { in: bookingIds }, userId },
    select: { id: true, checkIn: true, property: { select: { title: true } } } }) : [];
  const bookingById = new Map<number, any>(bookings.map((booking: any) => [booking.id, booking]));
  const storyStays: any[] = Array.isArray(stays) ? stays : [];
  // A place is the city; when a property has no city, its district or region, and failing that the property itself.
  const cities = new Set(storyStays.map((stay) => {
    const place = String(stay.property?.city || stay.property?.district || stay.property?.regionName || "").trim().toLowerCase();
    return place || `property:${stay.propertyId ?? stay.id}`;
  }));
  const welcomedBookings = new Map<number, any>(gestures.map((gesture: any) => [gesture.bookingId, gesture]));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    completedStayCount,
    totals: { nights: storyStays.reduce((sum, stay) => sum + nightsOf(stay.checkIn, stay.checkOut), 0), places: cities.size },
    upcoming: upcoming ? { bookingReference: customerBookingReference(upcoming.id), property: upcoming.property.title, city: upcoming.property.city ?? null,
      checkIn: upcoming.checkIn, checkOut: upcoming.checkOut, inHouse: upcoming.status === "CHECKED_IN" } : null,
    recentStays: storyStays.slice(0, 6).map((stay) => ({ bookingReference: customerBookingReference(stay.id), property: stay.property.title,
      city: stay.property.city || stay.property.district || stay.property.regionName || null,
      checkIn: stay.checkIn, checkOut: stay.checkOut, nights: nightsOf(stay.checkIn, stay.checkOut), welcomed: welcomedBookings.has(stay.id) })),
    firstStay: firstStay ? { bookingReference: customerBookingReference(firstStay.id), property: firstStay.property.title, completedAt: firstStay.checkOut } : null,
    moments: gestures.filter((gesture: any) => bookingById.has(gesture.bookingId)).map((gesture: any) => {
      const booking = bookingById.get(gesture.bookingId);
      return { id: gesture.id, bookingReference: customerBookingReference(gesture.bookingId), property: booking.property.title,
        checkIn: booking.checkIn, drink: gesture.order?.items?.[0]?.nameSnapshot ?? "A welcome drink", status: gesture.status,
        issuedAt: gesture.issuedAt, servedAt: gesture.servedAt,
        feedback: gesture.guestFeedbackAt ? { received: gesture.guestConfirmedReceived, rating: gesture.guestFeedbackRating,
          note: gesture.guestFeedbackNote, at: gesture.guestFeedbackAt } : null };
    }),
  });
}) as RequestHandler);

/** The guest's own preferences. `available: false` until the preference table is migrated. */
router.get("/preferences", (async (req: AuthedRequest, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const row = await preferenceStore(db).findUnique({ where: { userId: req.user!.id } });
    res.json({ available: true, preferences: shapeKaribuPreferences(row) });
  } catch (error) {
    if (isMissingTable(error)) return res.json({ available: false, preferences: EMPTY_KARIBU_PREFERENCES });
    throw error;
  }
}) as RequestHandler);

router.put("/preferences", (async (req: AuthedRequest, res) => {
  const parsed = karibuPreferencesInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid preferences" });
  const userId = req.user!.id;
  const data = karibuPreferenceColumns(parsed.data, sanitizeText);
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const row = await preferenceStore(db).upsert({ where: { userId }, update: data, create: { userId, ...data } });
    res.json({ available: true, preferences: shapeKaribuPreferences(row) });
  } catch (error) {
    if (isMissingTable(error)) return res.status(503).json({ error: "Preferences are not available yet" });
    throw error;
  }
}) as RequestHandler);

/** Turn sharing with the property on or off without touching the other preferences. */
router.patch("/preferences/sharing", (async (req: AuthedRequest, res) => {
  const parsed = z.object({ shareWithProperty: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose on or off" });
  const userId = req.user!.id;
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const row = await preferenceStore(db).upsert({ where: { userId }, update: { shareWithProperty: parsed.data.shareWithProperty },
      create: { userId, shareWithProperty: parsed.data.shareWithProperty, drinkLikes: [], dietaryTags: [] } });
    res.json({ available: true, preferences: shapeKaribuPreferences(row) });
  } catch (error) {
    if (isMissingTable(error)) return res.status(503).json({ error: "Preferences are not available yet" });
    throw error;
  }
}) as RequestHandler);

/** One action clears everything. */
router.delete("/preferences", (async (req: AuthedRequest, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    await preferenceStore(db).deleteMany({ where: { userId: req.user!.id } });
    res.json({ available: true, preferences: EMPTY_KARIBU_PREFERENCES });
  } catch (error) {
    if (isMissingTable(error)) return res.status(503).json({ error: "Preferences are not available yet" });
    throw error;
  }
}) as RequestHandler);

const feedbackSchema = z.object({
  received: z.boolean(),
  rating: z.number().int().min(1).max(5).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
}).refine((value) => value.received ? value.rating != null : value.rating == null, {
  message: "Rate a received welcome, or leave the rating empty when it did not arrive",
});

/** A guest can report delivery once, after the property has marked the drink served. */
router.post("/:id/feedback", (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = feedbackSchema.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) {
    return res.status(400).json({ error: parsed.success ? "Invalid welcome" : parsed.error.issues[0]?.message || "Invalid feedback" });
  }
  const { received, rating, note } = parsed.data;
  const changed = await db.karibuGesture.updateMany({ where: { id, userId: req.user!.id, status: "SERVED", guestFeedbackAt: null },
    data: { guestConfirmedReceived: received, guestFeedbackRating: rating, guestFeedbackNote: note ? sanitizeText(note).slice(0, 500) : null,
      guestFeedbackAt: new Date() } });
  if (changed.count !== 1) return res.status(409).json({ error: "This welcome is unavailable for feedback or has already been reviewed" });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ ok: true });
}) as RequestHandler);

export default router;
