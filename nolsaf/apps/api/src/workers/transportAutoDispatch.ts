import type { Server } from "socket.io";
import { prisma } from "@nolsaf/prisma";
import { AUTO_DISPATCH_GRACE_MS, AUTO_DISPATCH_LOOKAHEAD_MS } from "../lib/transportPolicy.js";
import { isDriverApprovedForProtectedAccess } from "../lib/driverAccess.js";

const AUTO_DISPATCH_WARN_MS = 5 * 60 * 1000;
const AUTO_DISPATCH_EARLY_ESCALATION_MS = 2 * 60 * 1000;
const OFFER_TTL_MS = 3 * 60 * 1000;
const LIVE_LOCATION_RECENCY_MS = 2 * 60 * 1000;

const RADIUS_PRIMARY_KM = 1;
const RADIUS_EXPANDED_KM = 3;
const MAX_OFFERS_PER_ROUND = 3;
const MAX_DRIVER_LOCATIONS_SCAN = 250;

const ACTION_EARLY = "TRANSPORT_AUTO_DISPATCH_NO_ACCEPT_2MIN";
const ACTION_WARN = "TRANSPORT_AUTO_DISPATCH_WARN_ADMIN";
const ACTION_TAKEOVER = "TRANSPORT_AUTO_DISPATCH_ESCALATED_TO_ADMIN";
const STATUS_ADMIN_TAKEOVER = "PENDING_ADMIN_ASSIGNMENT";

type StartOptions = {
  io?: Server;
  intervalMs?: number;
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function kmToLatDelta(km: number): number {
  return km / 111;
}

/** Map raw driverProfile.vehicleType strings to the canonical booking vehicleType enum values. */
function normalizeVehicleType(vehicleType?: string | null): string | null {
  if (!vehicleType) return null;
  const v = vehicleType.toLowerCase();
  if (v.includes("motor") || v.includes("boda") || v.includes("bike")) return "BODA";
  if (v.includes("tuktuk") || v.includes("bajaji") || v.includes("tuk")) return "BAJAJI";
  if (v.includes("xl") || v.includes("van") || v.includes("hiace") || v.includes("minibus")) return "XL";
  if (v.includes("car") || v.includes("sedan") || v.includes("suv") || v.includes("hatchback")) return "CAR";
  return v.toUpperCase();
}

function kmToLngDelta(km: number, atLatDeg: number): number {
  const latRad = (atLatDeg * Math.PI) / 180;
  const denom = 111 * Math.cos(latRad);
  if (!Number.isFinite(denom) || denom <= 0) return km / 111;
  return km / denom;
}

function isDriverOnlineToggled(driver: any): boolean {
  if (!isDriverApprovedForProtectedAccess(driver)) return false;
  // Support both schema variants.
  if (driver?.available === false) return false;
  return true;
}

async function getActiveOfferDriverIds(bookingId: number, now: Date): Promise<number[]> {
  try {
    if (!(prisma as any).transportBookingOffer) return [];
    const rows = await (prisma as any).transportBookingOffer.findMany({
      where: {
        bookingId,
        status: "OFFERED",
        expiresAt: { gt: now },
      },
      select: { driverId: true },
      take: 20,
    });
    return (rows || []).map((r: any) => Number(r.driverId)).filter((id: any) => Number.isFinite(id));
  } catch {
    return [];
  }
}

async function getExcludedOfferDriverIds(bookingId: number): Promise<Set<number>> {
  const excluded = new Set<number>();
  try {
    if (!(prisma as any).transportBookingOffer) return excluded;
    const rows = await (prisma as any).transportBookingOffer.findMany({
      where: {
        bookingId,
        status: { in: ["OFFERED", "DECLINED", "EXPIRED", "CANCELLED"] },
      },
      select: { driverId: true },
      take: 500,
    });
    for (const r of rows || []) {
      const id = Number((r as any).driverId);
      if (Number.isFinite(id)) excluded.add(id);
    }
  } catch {
    // ignore
  }
  return excluded;
}

async function markExpiredOffers(bookingId: number, now: Date) {
  try {
    if (!(prisma as any).transportBookingOffer) return;
    await (prisma as any).transportBookingOffer.updateMany({
      where: { bookingId, status: "OFFERED", expiresAt: { lte: now } },
      data: { status: "EXPIRED", respondedAt: now },
    });
  } catch {
    // ignore
  }
}

type Candidate = {
  driverId: number;
  lat: number;
  lng: number;
  distanceKm: number;
  driver: any;
};

async function findCandidatesWithinRadius({
  pickup,
  radiusKm,
  excludeDriverIds,
  bookingVehicleType,
}: {
  pickup: { lat: number; lng: number };
  radiusKm: number;
  excludeDriverIds: Set<number>;
  bookingVehicleType?: string | null;
}): Promise<Candidate[]> {
  if (!(prisma as any).driverLiveLocation) return [];

  const since = new Date(Date.now() - LIVE_LOCATION_RECENCY_MS);
  const dLat = kmToLatDelta(radiusKm);
  const dLng = kmToLngDelta(radiusKm, pickup.lat);

  const minLat = pickup.lat - dLat;
  const maxLat = pickup.lat + dLat;
  const minLng = pickup.lng - dLng;
  const maxLng = pickup.lng + dLng;

  const rows = await (prisma as any).driverLiveLocation.findMany({
    where: {
      updatedAt: { gte: since },
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
    },
    take: MAX_DRIVER_LOCATIONS_SCAN,
    orderBy: { updatedAt: "desc" },
    include: {
      driver: {
        select: {
          id: true,
          role: true,
          available: true,
          isDisabled: true,
          suspendedAt: true,
          kycStatus: true,
          vehicleType: true,
          isVipDriver: true,
        },
      },
    },
  });

  const candidates: Candidate[] = [];
  for (const r of rows || []) {
    const driverId = Number((r as any).driverId ?? (r as any)?.driver?.id);
    if (!Number.isFinite(driverId)) continue;
    if (excludeDriverIds.has(driverId)) continue;

    const driver = (r as any).driver;
    if (!isDriverOnlineToggled(driver)) continue;

    const lat = Number((r as any).lat);
    const lng = Number((r as any).lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const distanceKm = haversineKm(pickup, { lat, lng });
    if (!Number.isFinite(distanceKm) || distanceKm > radiusKm) continue;

    // Vehicle type matching: ensure the driver can serve this booking category.
    if (bookingVehicleType) {
      const bvt = String(bookingVehicleType).toUpperCase();
      if (bvt === "PREMIUM") {
        if (!driver?.isVipDriver) continue;
      } else {
        const dvt = normalizeVehicleType(driver?.vehicleType);
        if (dvt !== bvt) continue;
      }
    }

    candidates.push({ driverId, lat, lng, distanceKm, driver });
  }

  candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  return candidates;
}

async function pickTopDriversForOffer({
  bookingId,
  pickup,
  radiusKm,
  candidates,
}: {
  bookingId: number;
  pickup: { lat: number; lng: number };
  radiusKm: number;
  candidates: Candidate[];
}): Promise<Array<{ driverId: number; distanceKm: number; score: number }>> {
  if (candidates.length === 1) {
    return [{ driverId: candidates[0].driverId, distanceKm: candidates[0].distanceKm, score: 100 }];
  }

  const driverIds = candidates.map((c) => c.driverId);

  // Fetch rating + workload + reliability in bulk (best-effort).
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const since180 = daysAgo(180);
  const since90 = daysAgo(90);
  const since7 = daysAgo(7);

  const avgRatingByDriverId = new Map<number, number>();
  const workloadByDriverId = new Map<number, number>();
  const reliabilityByDriverId = new Map<number, { completed: number; canceled: number }>();

  try {
    if ((prisma as any).transportBooking?.groupBy) {
      const [ratingRows, workloadRows, statusRows] = await Promise.all([
        (prisma as any).transportBooking.groupBy({
          by: ["driverId"],
          where: {
            driverId: { in: driverIds },
            scheduledDate: { gte: since180 },
            status: "COMPLETED",
            userRating: { not: null },
          },
          _avg: { userRating: true },
        }),
        (prisma as any).transportBooking.groupBy({
          by: ["driverId"],
          where: {
            driverId: { in: driverIds },
            scheduledDate: { gte: since7 },
            status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
          },
          _count: { _all: true },
        }),
        (prisma as any).transportBooking.groupBy({
          by: ["driverId", "status"],
          where: {
            driverId: { in: driverIds },
            scheduledDate: { gte: since90 },
            status: { in: ["COMPLETED", "CANCELED", "CANCELLED"] },
          },
          _count: { _all: true },
        }),
      ]);

      for (const r of ratingRows || []) {
        const driverId = Number((r as any).driverId);
        const avg = (r as any)?._avg?.userRating;
        const n = typeof avg === "number" ? avg : Number(avg);
        if (Number.isFinite(driverId) && Number.isFinite(n)) avgRatingByDriverId.set(driverId, n);
      }
      for (const r of workloadRows || []) {
        const driverId = Number((r as any).driverId);
        const cnt = Number((r as any)?._count?._all ?? 0);
        if (Number.isFinite(driverId)) workloadByDriverId.set(driverId, cnt);
      }
      for (const r of statusRows || []) {
        const driverId = Number((r as any).driverId);
        const status = String((r as any).status ?? "").toUpperCase();
        const cnt = Number((r as any)?._count?._all ?? 0);
        if (!Number.isFinite(driverId) || !Number.isFinite(cnt)) continue;
        const prev = reliabilityByDriverId.get(driverId) || { completed: 0, canceled: 0 };
        if (status === "COMPLETED") prev.completed += cnt;
        if (status === "CANCELED" || status === "CANCELLED") prev.canceled += cnt;
        reliabilityByDriverId.set(driverId, prev);
      }
    }
  } catch {
    // ignore
  }

  const scored = candidates.map((c) => {
    const distanceKm = c.distanceKm;
    const distanceScore = 60 * Math.max(0, Math.min(1, 1 - distanceKm / Math.max(0.001, radiusKm)));

    const avgRating = avgRatingByDriverId.get(c.driverId);
    const ratingScore = typeof avgRating === "number" && Number.isFinite(avgRating)
      ? 20 * Math.max(0, Math.min(1, avgRating / 5))
      : 12;

    const workload = workloadByDriverId.get(c.driverId) ?? 0;
    const workloadScore = 5 * Math.max(0, 1 - Math.min(1, workload / 10));

    const rel = reliabilityByDriverId.get(c.driverId) || { completed: 0, canceled: 0 };
    const totalReviewed = rel.completed + rel.canceled;
    const completionRate = totalReviewed > 0 ? rel.completed / totalReviewed : 0.75;
    const reliabilityScore = 15 * Math.max(0, Math.min(1, completionRate));

    const score = distanceScore + ratingScore + reliabilityScore + workloadScore;
    return { driverId: c.driverId, distanceKm, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_OFFERS_PER_ROUND);
}

async function issueOffers({
  io,
  booking,
  pickup,
  bookingVehicleType,
}: {
  io?: Server;
  booking: any;
  pickup: { lat: number; lng: number };
  bookingVehicleType?: string | null;
}): Promise<boolean> {
  const bookingId = Number(booking.id);
  if (!Number.isFinite(bookingId)) return false;

  const now = new Date();

  // If there are active offers, wait.
  const activeOfferDriverIds = await getActiveOfferDriverIds(bookingId, now);
  if (activeOfferDriverIds.length) return false;

  await markExpiredOffers(bookingId, now);

  const excluded = await getExcludedOfferDriverIds(bookingId);

  // Find candidates in 1km; if none, expand to 3km.
  let radiusKm = RADIUS_PRIMARY_KM;
  let candidates: Candidate[] = [];
  try {
    candidates = await findCandidatesWithinRadius({ pickup, radiusKm, excludeDriverIds: excluded, bookingVehicleType });
  } catch {
    candidates = [];
  }
  if (!candidates.length) {
    radiusKm = RADIUS_EXPANDED_KM;
    try {
      candidates = await findCandidatesWithinRadius({ pickup, radiusKm, excludeDriverIds: excluded, bookingVehicleType });
    } catch {
      candidates = [];
    }
  }
  if (!candidates.length) return false;

  const top = await pickTopDriversForOffer({ bookingId, pickup, radiusKm, candidates });
  if (!top.length) return false;

  const expiresAt = new Date(now.getTime() + OFFER_TTL_MS);

  try {
    await prisma.transportBookingOffer.createMany({
        data: top.map((t) => ({
          bookingId,
          driverId: t.driverId,
          status: "OFFERED",
          offeredAt: now,
          expiresAt,
          radiusKm,
          distanceKm: t.distanceKm,
          score: t.score,
        })),
        skipDuplicates: false,
      });
  } catch (error) {
    console.warn("[transport-auto-dispatch] offer persistence failed", error);
    return false;
  }

  // Push wakes drivers whose app is sleeping; the saved offer remains the
  // authority when they open the app. Expired offers are suppressed at send time.
  try {
    await prisma.notification.createMany({
      data: top.map((driver) => ({
        userId: driver.driverId,
        title: "New trip nearby",
        body: "Open NoLSAF Driver to review this trip offer.",
        type: "ride",
        meta: { transportBookingId: bookingId, offerExpiresAt: expiresAt.toISOString() },
      })),
    });
  } catch (error) {
    console.warn("[transport-auto-dispatch] driver push notification unavailable", error);
  }

  // Emit targeted offer events to the selected drivers.
  try {
    for (const t of top) {
      io?.to(`driver:${t.driverId}`).emit("transport:booking:created", {
        bookingId,
        tripCode: (booking as any).tripCode ?? null,
        vehicleType: (booking as any).vehicleType ?? null,
        scheduledDate: (booking as any).scheduledDate ?? null,
        fromAddress: (booking as any).fromAddress ?? null,
        toAddress: (booking as any).toAddress ?? null,
        fromLatitude: (booking as any).fromLatitude ?? null,
        fromLongitude: (booking as any).fromLongitude ?? null,
        toLatitude: (booking as any).toLatitude ?? null,
        toLongitude: (booking as any).toLongitude ?? null,
        amount: (booking as any).amount ?? null,
        currency: (booking as any).currency ?? "TZS",
        offer: {
          expiresAt: expiresAt.toISOString(),
          radiusKm,
        },
      });
    }
  } catch {
    // ignore
  }

  return true;
}

async function tryAutoAssignOne(io?: Server): Promise<boolean> {
  const now = new Date();
  const lookahead = new Date(now.getTime() + AUTO_DISPATCH_LOOKAHEAD_MS);
  const graceStartCutoff = new Date(now.getTime() - AUTO_DISPATCH_GRACE_MS);

  // Only consider trips that are happening soon, paid, unassigned, and still within auto-dispatch grace.
  const trip = await prisma.transportBooking.findFirst({
    where: {
      status: "PENDING_ASSIGNMENT",
      driverId: null,
      paymentStatus: "PAID" as any,
      scheduledDate: { gte: now, lte: lookahead },
      createdAt: { gte: graceStartCutoff },
    } as any,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      scheduledDate: true,
      fromLatitude: true,
      fromLongitude: true,
      fromAddress: true,
      toAddress: true,
      toLatitude: true,
      toLongitude: true,
      amount: true,
      currency: true,
      vehicleType: true,
      tripCode: true,
    } as any,
  });

  if (!trip) return false;

  const pickupLat = Number((trip as any).fromLatitude);
  const pickupLng = Number((trip as any).fromLongitude);
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) return false;

  // New behavior: issue targeted offers (top 3) and let the first driver accept.
  // If offer storage isn't available in the deployment, fall back to emitting offers only.
  return await issueOffers({
    io,
    booking: trip,
    pickup: { lat: pickupLat, lng: pickupLng },
    bookingVehicleType: (trip as any).vehicleType ?? null,
  });
}

async function processEscalations(io?: Server) {
  const now = new Date();
  const lookahead = new Date(now.getTime() + AUTO_DISPATCH_LOOKAHEAD_MS);
  const warnCutoff = new Date(now.getTime() - AUTO_DISPATCH_WARN_MS);
  const takeoverCutoff = new Date(now.getTime() - AUTO_DISPATCH_GRACE_MS);

  // Candidates: near-term, paid, unassigned, and old enough to be at least warned.
  const candidates = await prisma.transportBooking.findMany({
    where: {
      status: "PENDING_ASSIGNMENT",
      driverId: null,
      paymentStatus: "PAID" as any,
      scheduledDate: { gte: now, lte: lookahead },
      createdAt: { lte: warnCutoff },
    } as any,
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      userId: true,
      createdAt: true,
      scheduledDate: true,
      fromAddress: true,
      toAddress: true,
      amount: true,
      currency: true,
      vehicleType: true,
    } as any,
  });

  if (!candidates.length) return;

  // Idempotency markers via audit logs (best-effort; schema differs between deployments)
  const alreadyEarly = new Set<number>();
  const alreadyWarned = new Set<number>();
  const alreadyTakenOver = new Set<number>();
  try {
    if ((prisma as any).auditLog) {
      const rows = await (prisma as any).auditLog.findMany({
        where: {
          entity: "TRANSPORT_BOOKING",
          entityId: { in: candidates.map((c: any) => c.id) },
          action: { in: [ACTION_EARLY, ACTION_WARN, ACTION_TAKEOVER] },
        },
        select: { entityId: true, action: true },
      });
      for (const r of rows || []) {
        const id = Number((r as any).entityId);
        const action = String((r as any).action || "");
        if (!Number.isFinite(id)) continue;
        if (action === ACTION_EARLY) alreadyEarly.add(id);
        if (action === ACTION_WARN) alreadyWarned.add(id);
        if (action === ACTION_TAKEOVER) alreadyTakenOver.add(id);
      }
    }
  } catch {
    // ignore
  }

  const { notifyAdmins } = await import("../lib/notifications.js");

  for (const trip of candidates as any[]) {
    const tripId = Number(trip.id);
    if (!Number.isFinite(tripId)) continue;

    const createdAt = trip.createdAt ? new Date(trip.createdAt) : null;
    if (!createdAt || !Number.isFinite(createdAt.getTime())) continue;

    const ageMs = now.getTime() - createdAt.getTime();
    const shouldTakeover = ageMs >= AUTO_DISPATCH_GRACE_MS;
    const shouldWarn = !shouldTakeover && ageMs >= AUTO_DISPATCH_WARN_MS;
    const shouldEarly = !shouldTakeover && !shouldWarn && ageMs >= AUTO_DISPATCH_EARLY_ESCALATION_MS;

    if (shouldEarly) {
      if (alreadyEarly.has(tripId) || alreadyWarned.has(tripId) || alreadyTakenOver.has(tripId)) continue;

      // Notify admins early so they can prepare manual assignment while system keeps trying.
      try {
        await notifyAdmins("transport_auto_dispatch_no_drivers_2m", {
          transportBookingId: tripId,
          scheduledDate: trip.scheduledDate ?? null,
          fromAddress: trip.fromAddress ?? null,
          toAddress: trip.toAddress ?? null,
          amount: trip.amount ?? null,
          currency: trip.currency ?? "TZS",
          vehicleType: trip.vehicleType ?? null,
          policy: "2_min_soft_escalation",
        });
      } catch {
        // ignore
      }

      try {
        await (prisma as any).auditLog?.create?.({
          data: {
            actorId: null,
            actorRole: "SYSTEM",
            action: ACTION_EARLY,
            entity: "TRANSPORT_BOOKING",
            entityId: tripId,
            beforeJson: null,
            afterJson: { reason: "no_driver_accept_within_2_min" },
            ip: null,
            ua: "system/transport-auto-dispatch",
          },
        });
      } catch {
        // ignore
      }

      try {
        io?.emit?.("transport:booking:soft_escalation", { bookingId: tripId });
      } catch {
        // ignore
      }

      continue;
    }

    if (shouldTakeover) {
      if (alreadyTakenOver.has(tripId)) continue;

      // Concurrency-safe: only flip if still pending+unassigned.
      const updated = await prisma.transportBooking.updateMany({
        where: { id: tripId, status: "PENDING_ASSIGNMENT", driverId: null } as any,
        data: { status: STATUS_ADMIN_TAKEOVER } as any,
      });

      if (!updated?.count) continue;

      try {
        await notifyAdmins("transport_auto_dispatch_takeover", {
          transportBookingId: tripId,
          scheduledDate: trip.scheduledDate ?? null,
          fromAddress: trip.fromAddress ?? null,
          toAddress: trip.toAddress ?? null,
          amount: trip.amount ?? null,
          currency: trip.currency ?? "TZS",
          vehicleType: trip.vehicleType ?? null,
          policy: "10_min_takeover",
        });
      } catch {
        // ignore
      }

      try {
        await (prisma as any).auditLog?.create?.({
          data: {
            actorId: null,
            actorRole: "SYSTEM",
            action: ACTION_TAKEOVER,
            entity: "TRANSPORT_BOOKING",
            entityId: tripId,
            beforeJson: { status: "PENDING_ASSIGNMENT" },
            afterJson: { status: STATUS_ADMIN_TAKEOVER, reason: "no_driver_accept_within_10_min" },
            ip: null,
            ua: "system/transport-auto-dispatch",
          },
        });
      } catch {
        // ignore
      }

      // Optional realtime hint to any connected dashboards.
      try {
        io?.emit?.("transport:booking:admin_takeover", { bookingId: tripId });
      } catch {
        // ignore
      }

      continue;
    }

    if (shouldWarn) {
      if (alreadyWarned.has(tripId) || alreadyTakenOver.has(tripId)) continue;

      try {
        await notifyAdmins("transport_auto_dispatch_warning", {
          transportBookingId: tripId,
          scheduledDate: trip.scheduledDate ?? null,
          fromAddress: trip.fromAddress ?? null,
          toAddress: trip.toAddress ?? null,
          amount: trip.amount ?? null,
          currency: trip.currency ?? "TZS",
          vehicleType: trip.vehicleType ?? null,
          policy: "5_min_warning",
        });
      } catch {
        // ignore
      }

      try {
        await (prisma as any).auditLog?.create?.({
          data: {
            actorId: null,
            actorRole: "SYSTEM",
            action: ACTION_WARN,
            entity: "TRANSPORT_BOOKING",
            entityId: tripId,
            beforeJson: null,
            afterJson: { reason: "no_driver_accept_within_5_min" },
            ip: null,
            ua: "system/transport-auto-dispatch",
          },
        });
      } catch {
        // ignore
      }
    }
  }
}

export function startTransportAutoDispatch({ io, intervalMs = 30_000 }: StartOptions = {}) {
  if ((global as any).__transportAutoDispatchStarted) return;
  (global as any).__transportAutoDispatchStarted = true;

  const tick = async () => {
    try {
      // Try a few assignments per tick to avoid long single DB loops.
      for (let i = 0; i < 5; i++) {
        const didWork = await tryAutoAssignOne(io);
        if (!didWork) break;
      }

      // Escalation checkpoints: 5-minute admin warning, 10-minute admin takeover.
      try {
        await processEscalations(io);
      } catch (e) {
        console.warn("[transport-auto-dispatch] escalation failed", e);
      }
    } catch (e) {
      console.warn("[transport-auto-dispatch] tick failed", e);
    }
  };

  // Run quickly on startup, then on interval.
  void tick();
  setInterval(() => void tick(), intervalMs);
}
