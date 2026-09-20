// apps/api/src/routes/owner.nrms.calendar.ts
// Unified room calendar feed (doc 7.2, 10.3): NoLSAF bookings, NRMS
// reservations, and availability blocks in one normalized response, plus the
// room structure needed to render the tape. The frontend never needs to know
// which migration stage a property has reached.
import { Router, type Response } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { loadNrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";

/** Everyone who has to see what is free before they can sell or assign it. */
const CALENDAR_READ_ROLES = ["OWNER", "MANAGER", "FRONT_DESK", "SALES_EXECUTIVE"] as const;
import { getCalendarEntries } from "../lib/nrmsAvailability.js";
import { connectExistingNoLsafBookings } from "../lib/nolsafMarketplaceNrms.js";

export const router = Router();

// Access is resolved per handler rather than at the router, because reading
// availability is not owner-only work: a sales executive holds
// `availability.read` and cannot sell without it. loadNrmsPropertyAccess also
// checks the PROPERTY owner's NRMS enrollment, which is the check requireNrms
// used to make against the caller's own account and which no staff member has.
router.use(requireAuth as RequestHandler);

const MAX_RANGE_DAYS = 92;

function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * GET /api/owner/nrms/calendar/:propertyId?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Defaults to the coming 7 days. Range capped so one request can never scan
 * an unbounded window (connectivity-friendly single payload, doc 4.1).
 */
router.get("/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const access = await loadNrmsPropertyAccess(req, res, Number(req.params.propertyId), CALENDAR_READ_ROLES);
    if (!access) return;
    const active = { property: access.property, account: access.account };
    const property = active.property;

    const now = new Date();
    const start = parseDay(req.query.start) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let end = parseDay(req.query.end) ?? new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (end.getTime() <= start.getTime()) {
      return res.status(400).json({ error: "end must be after start" });
    }
    const maxEnd = new Date(start.getTime() + MAX_RANGE_DAYS * 24 * 60 * 60 * 1000);
    if (end.getTime() > maxEnd.getTime()) end = maxEnd;

    const propertyId = property.id as number;
    // Repair legacy projections only on the deliberate initial/manual load.
    // Socket and timer refreshes are read-only calendar requests.
    if (req.query.repair === "1") {
      try {
        await connectExistingNoLsafBookings(prisma, propertyId, start, end);
      } catch (err) {
        console.error("[owner.nrms.calendar] marketplace self-heal failed", err);
      }
    }
    const [entries, roomTypes] = await Promise.all([
      getCalendarEntries(propertyId, start, end),
      req.query.compact === "1" ? Promise.resolve(null) : prisma.roomType.findMany({
        where: { propertyId },
        select: {
          id: true,
          name: true,
          baseRate: true,
          currency: true,
          status: true,
          sortOrder: true,
          units: {
            select: { id: true, code: true, floor: true, status: true },
            orderBy: { code: "asc" },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
    ]);

    res.json({
      property,
      range: { start, end },
      roomTypes: roomTypes?.map((type) => ({
        ...type,
        baseRate: type.baseRate != null ? Number(type.baseRate) : null,
      })) ?? undefined,
      entries,
    });
  } catch (err) {
    console.error("[owner.nrms.calendar] feed failed", err);
    res.status(500).json({ error: "Failed to load room calendar" });
  }
}) as RequestHandler);

export default router;
