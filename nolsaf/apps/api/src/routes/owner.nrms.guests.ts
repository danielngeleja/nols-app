// apps/api/src/routes/owner.nrms.guests.ts
// Property-scoped guest records (doc 7.6): search for the front-desk
// search-or-create flow and a stay-history view. Tenant-isolated; no
// cross-owner guest visibility (doc 4).
import { Router, type Response } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { requireNrms, loadOwnedActiveNrmsProperty } from "../lib/nrms.js";
import { canonicalGuestPhone, loadGuestSmsEligibility, noPhoneEligibility } from "../lib/guestSmsCampaigns.js";

export const router = Router();

router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, requireNrms as RequestHandler);

/**
 * GET /api/owner/nrms/guests/:propertyId?q=&page=&pageSize=&sortOrder=
 * Search guests by name or phone for one owned property.
 */
router.get("/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const property = active.property;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const page = Math.max(Math.floor(Number(req.query.page) || 1), 1);
    const pageSize = Math.min(Math.max(Math.floor(Number(req.query.pageSize) || 10), 1), 50);
    const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
    const where = {
      propertyId: property.id as number,
      ...(q ? { OR: [{ fullName: { contains: q } }, { phone: { contains: q } }] } : {}),
    };

    const [total, guests] = await prisma.$transaction([
      prisma.guestProfile.count({ where }),
      prisma.guestProfile.findMany({
        where,
        include: {
          _count: { select: { reservations: true } },
          reservations: {
            where: { status: { in: ["CHECKED_OUT", "CHECKED_IN"] } },
            orderBy: { checkIn: "desc" },
            take: 1,
            select: { checkIn: true, checkOut: true, status: true },
          },
        },
        orderBy: [{ fullName: sortOrder }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const smsEligibility = await loadGuestSmsEligibility(ownerId, guests.map((guest) => guest.phone));
    res.json({
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      guests: guests.map((g) => {
        const phone = canonicalGuestPhone(g.phone);
        return {
          id: g.id,
          fullName: g.fullName,
          phone: g.phone,
          email: g.email,
          nationality: g.nationality,
          reservationCount: g._count.reservations,
          lastStay: g.reservations[0] ?? null,
          smsOutreach: phone ? (smsEligibility.get(phone) ?? noPhoneEligibility()) : noPhoneEligibility(),
        };
      }),
    });
  } catch (err) {
    console.error("[owner.nrms.guests] search failed", err);
    res.status(500).json({ error: "Failed to search guests" });
  }
}) as RequestHandler);

/**
 * GET /api/owner/nrms/guests/:propertyId/:guestId
 * Guest detail with full stay history for this property.
 */
router.get("/:propertyId/:guestId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const property = active.property;
    const guestId = Number(req.params.guestId);
    if (!Number.isInteger(guestId) || guestId <= 0) {
      return res.status(400).json({ error: "Invalid guest id" });
    }
    const guest = await prisma.guestProfile.findFirst({
      where: { id: guestId, propertyId: property.id as number, ownerId },
      include: {
        reservations: {
          orderBy: { checkIn: "desc" },
          select: {
            id: true,
            status: true,
            source: true,
            checkIn: true,
            checkOut: true,
            totalAmount: true,
            amountPaid: true,
            currency: true,
          },
        },
      },
    });
    if (!guest) return res.status(404).json({ error: "Guest not found" });

    const normalizedPhone = canonicalGuestPhone(guest.phone);
    const smsEligibility = normalizedPhone
      ? (await loadGuestSmsEligibility(ownerId, [guest.phone])).get(normalizedPhone) ?? noPhoneEligibility()
      : noPhoneEligibility();
    res.json({
      guest: {
        id: guest.id,
        fullName: guest.fullName,
        phone: guest.phone,
        email: guest.email,
        nationality: guest.nationality,
        notes: guest.notes,
        createdAt: guest.createdAt,
        smsOutreach: smsEligibility,
        reservations: guest.reservations.map((r) => ({
          ...r,
          totalAmount: r.totalAmount != null ? Number(r.totalAmount) : null,
          amountPaid: r.amountPaid != null ? Number(r.amountPaid) : null,
        })),
      },
    });
  } catch (err) {
    console.error("[owner.nrms.guests] detail failed", err);
    res.status(500).json({ error: "Failed to load guest" });
  }
}) as RequestHandler);

export default router;
