import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { adminRecordReferenceOrNull as recordRef } from "../lib/adminRecordReference.js";

// GET /api/admin/users/travellers?segment=all|staying|arriving|repeat|new&q=&page=&pageSize=
// The customer side of accommodation bookings: one row per traveller account,
// with their stays, spend and the stay that is happening now or next.
// A "stay" is a paid booking (CONFIRMED, PENDING_CHECKIN, CHECKED_IN, CHECKED_OUT);
// unpaid (NEW) and cancelled bookings are not stays.
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

const STAY = ["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN", "CHECKED_OUT"];
const LIVE = ["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN"];
const SEGMENTS = ["all", "staying", "arriving", "repeat", "new"] as const;
type Segment = (typeof SEGMENTS)[number];
const DAY = 86_400_000;

router.get("/", async (req, res) => {
  try {
    const segment: Segment = SEGMENTS.includes(String(req.query.segment) as Segment) ? (String(req.query.segment) as Segment) : "all";
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 20));
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * DAY);
    const monthAgo = new Date(now.getTime() - 30 * DAY);

    // Every traveller with at least one stay, with totals.
    const grouped = await prisma.booking.groupBy({
      by: ["userId"],
      where: { userId: { not: null }, status: { in: STAY } },
      _count: { _all: true },
      _sum: { totalAmount: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });

    const [stayingRows, arrivingRows, walkIns] = await Promise.all([
      prisma.booking.findMany({ where: { userId: { not: null }, status: "CHECKED_IN" }, select: { userId: true }, distinct: ["userId"] }),
      prisma.booking.findMany({
        where: { userId: { not: null }, status: { in: ["CONFIRMED", "PENDING_CHECKIN"] }, checkIn: { gte: new Date(now.getTime() - DAY), lte: weekAhead } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.booking.count({ where: { userId: null, status: { in: STAY } } }),
    ]);
    const staying = new Set(stayingRows.map((r) => r.userId as number));
    const arriving = new Set(arrivingRows.map((r) => r.userId as number));

    let rows = grouped.map((g) => ({
      userId: g.userId as number,
      stays: g._count._all,
      spent: Number(g._sum.totalAmount ?? 0),
      firstBookedAt: g._min.createdAt,
      lastBookedAt: g._max.createdAt,
    }));

    const summary = {
      travellers: rows.length,
      staying: staying.size,
      arriving: arriving.size,
      repeat: rows.filter((r) => r.stays >= 2).length,
      new: rows.filter((r) => r.firstBookedAt && r.firstBookedAt >= monthAgo).length,
      walkInStays: walkIns,
    };

    if (segment === "staying") rows = rows.filter((r) => staying.has(r.userId));
    if (segment === "arriving") rows = rows.filter((r) => arriving.has(r.userId));
    if (segment === "repeat") rows = rows.filter((r) => r.stays >= 2);
    if (segment === "new") rows = rows.filter((r) => r.firstBookedAt && r.firstBookedAt >= monthAgo);

    if (q) {
      const matches = await prisma.user.findMany({
        where: { id: { in: rows.map((r) => r.userId) }, OR: [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] },
        select: { id: true },
        take: 2000,
      });
      const ids = new Set(matches.map((m) => m.id));
      rows = rows.filter((r) => ids.has(r.userId));
    }

    rows.sort((a, b) => (b.lastBookedAt?.getTime() ?? 0) - (a.lastBookedAt?.getTime() ?? 0));
    const total = rows.length;
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    const ids = slice.map((r) => r.userId);

    const [users, liveStays, lastStays] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, fullName: true, email: true, phone: true, avatarUrl: true } as any }),
      // The stay happening now, or the next one coming.
      prisma.booking.findMany({
        where: { userId: { in: ids }, status: { in: LIVE }, checkOut: { gte: now } },
        orderBy: { checkIn: "asc" },
        select: { id: true, userId: true, status: true, checkIn: true, checkOut: true, totalAmount: true, property: { select: { title: true, regionName: true } } },
      }),
      // The most recent finished stay.
      prisma.booking.findMany({
        where: { userId: { in: ids }, status: "CHECKED_OUT" },
        orderBy: { checkOut: "desc" },
        select: { userId: true, checkOut: true, property: { select: { title: true, regionName: true } } },
      }),
    ]);
    const userById = new Map((users as any[]).map((u) => [u.id, u]));
    const liveByUser = new Map<number, (typeof liveStays)[number]>();
    for (const b of liveStays) if (b.userId && !liveByUser.has(b.userId)) liveByUser.set(b.userId, b);
    const lastByUser = new Map<number, (typeof lastStays)[number]>();
    for (const b of lastStays) if (b.userId && !lastByUser.has(b.userId)) lastByUser.set(b.userId, b);

    const items = slice.map((r) => {
      const u = userById.get(r.userId);
      const live = liveByUser.get(r.userId);
      const last = lastByUser.get(r.userId);
      return {
        ref: recordRef("user", r.userId),
        name: (u?.fullName || u?.name || "").trim() || null,
        email: u?.email ?? null,
        phone: u?.phone ?? null,
        avatarUrl: u?.avatarUrl ?? null,
        stays: r.stays,
        spent: r.spent,
        firstBookedAt: r.firstBookedAt,
        lastBookedAt: r.lastBookedAt,
        current: live
          ? {
              bookingRef: recordRef("booking", live.id),
              status: live.status,
              checkIn: live.checkIn,
              checkOut: live.checkOut,
              amount: Number(live.totalAmount ?? 0),
              property: live.property?.title ?? null,
              region: live.property?.regionName ?? null,
            }
          : null,
        lastStay: last ? { checkOut: last.checkOut, property: last.property?.title ?? null, region: last.property?.regionName ?? null } : null,
      };
    });

    res.json({ summary, segment, page, pageSize, total, items });
  } catch (err) {
    console.error("[GET /admin/users/travellers]", err);
    res.status(500).json({ error: "Unable to load travellers" });
  }
});

export default router;
